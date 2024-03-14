import { Server } from './Server'
import { getPortPromise } from 'portfinder'
import { CloseCode, Message, PeerId } from './types'
import WebSocket from 'ws'

describe('Server', () => {
  let wsUrl: string = ''
  let httpUrl: string = ''
  let server: Server
  const CAPACITY = 3
  const TIMEOUT = 3e3

  beforeAll(async () => {
    const port = await getPortPromise({ port: 3100 })

    wsUrl = `ws://localhost:${port}`
    httpUrl = `http://localhost:${port}`

    server = new Server({ port, capacity: CAPACITY, timeout: TIMEOUT })
    await server.listen()
  })

  const setup = async (quantity = CAPACITY) => {
    const roomCode = await createRoom()

    const peerIds: string[] = []
    for (let i = 0; i < quantity; i++) {
      if (i === 0) peerIds.push('host')
      else peerIds.push(`peer${i}`)
    }

    const sockets = await Promise.all(peerIds.map(peerId => joinRoom(roomCode, peerId)))

    const connections = peerIds.reduce((peers, peerId, i) => {
      peers[peerId] = sockets[i]
      return peers
    }, {} as { [key: string]: WebSocket })

    return { roomCode, connections }
  }

  afterAll(async () => server.close())

  describe('Create Room', () => {
    it('Should return a 200 and a 4 digit roomCode', async () => {
      const res = await fetch(`${httpUrl}/room`, { method: 'POST' })
      expect(res.status).toBe(200)
      const json = (await res.json()) as any
      expect(json).toHaveProperty('roomCode')
      expect(json.roomCode).toMatch(/^[A-Z0-9]{4}$/)
    })
  })

  describe('Room connections', () => {
    it('Peer should be able to join room', async () => {
      const peerId = 'host'
      const roomCode = await createRoom()
      const socket = await joinRoom(roomCode, peerId)
      expect(socket.readyState).toBe(WebSocket.OPEN)
    })
    it('Peer should not be able to join room that does not exist', () => {
      const peerId = `host`
      return expect(joinRoom('1234', peerId)).rejects.toBeDefined()
    })
    it('Peer should not be able to join room that they already joined', async () => {
      const peerId = `test`
      const roomCode = await createRoom()
      await joinRoom(roomCode, peerId)
      await expect(joinRoom(roomCode, peerId)).rejects.toBeDefined()
    })
    it('Peer should not be able to join room that is full', async () => {
      const { roomCode, connections } = await setup()
      const peerIds = Object.keys(connections)
      await expect(joinRoom(roomCode, peerIds[0])).rejects.toBeDefined()
    })
  })

  describe('Room lifecycle', () => {
    it('Room should remain open if someone joins', async () => {
      const roomCode = await createRoom()
      const socket = await joinRoom(roomCode, 'peer')

      await sleep(TIMEOUT + 50)
      expect(socket.readyState).toBe(WebSocket.OPEN)
      socket.terminate()
    })
    it('Room should close if no one joins', async () => {
      const roomCode = await createRoom()
      await sleep(TIMEOUT + 50)
      await expect(joinRoom(roomCode, 'peer')).rejects.toBeDefined()
    })

    it('Room should stay open if someone leaves', async () => {
      const { connections } = await setup()
      const sockets = Object.values(connections)

      sockets[1].close()
      await sleep(50)
      for (let i = 0; i < sockets.length; i++) {
        if (i === 1) expect(sockets[i].readyState).toBe(WebSocket.CLOSED)
        else expect(sockets[i].readyState).toBe(WebSocket.OPEN)
      }
    })
    it('Room should close if the host leaves', async () => {
      const { connections } = await setup()
      const sockets = Object.values(connections)

      sockets[0].close()
      await sleep(50)
      for (let i = 0; i < sockets.length; i++) {
        expect(sockets[i].readyState).toBe(WebSocket.CLOSED)
      }
    })
  })

  describe('Room communcation', () => {
    describe('Join', () => {
      it('All peers should receive a join message when someone joins', async () => {
        expect.assertions(CAPACITY * 3)
        const peerId = 'lastPeer'
        const { roomCode, connections } = await setup(CAPACITY - 1)

        const onmessage = (peerIds: Array<PeerId>) => (event: WebSocket.MessageEvent) => {
          const json = JSON.parse(event.data.toString()) as Message.Join
          expect(json.type).toBe('Join')
          expect(json.peerId).toBe(peerId)
          expect(json.peers).toEqual(peerIds)
        }

        const peerIds = Object.keys(connections)
        peerIds.push(peerId)

        for (const peerId in connections) {
          connections[peerId].onmessage = onmessage(peerIds)
        }

        await joinRoom(roomCode, peerId, onmessage(peerIds))

        await sleep(50)
      })
    })
    describe('Message', () => {
      it('Only the host should receive a data message when a peer sends data', async () => {
        expect.assertions(3)

        const { connections } = await setup()
        const entries = Object.entries(connections)
        const [peerId, socket] = entries[entries.length - 1]
        const data = 'test'

        entries.forEach(([, value], index) => {
          if (index === 0) {
            value.onmessage = (event: WebSocket.MessageEvent) => {
              const json = JSON.parse(event.data.toString()) as Message.DataOut
              expect(json.type).toBe('Data')
              expect(json.from).toBe(peerId)
              expect(json.data).toEqual(data)
            }
          } else {
            value.onmessage = () => fail('Peer should not receive data')
          }
        })

        socket.send(JSON.stringify({ type: 'Data', data }))

        await sleep(50)
      })
      it('All peers should receive a data message when the host sends data', async () => {
        expect.assertions((CAPACITY - 1) * 3)

        const { connections } = await setup()
        const entries = Object.entries(connections)
        const [hostId, socket] = entries[0]
        const data = 'test'

        entries.forEach(([, value], index) => {
          if (index === 0) {
            value.onmessage = () => fail('Host should not receive data')
          } else {
            value.onmessage = (event: WebSocket.MessageEvent) => {
              const json = JSON.parse(event.data.toString()) as Message.DataOut
              expect(json.type).toBe('Data')
              expect(json.from).toBe(hostId)
              expect(json.data).toEqual(data)
            }
          }
        })

        socket.send(JSON.stringify({ type: 'Data', data }))

        await sleep(50)
      })
    })
    describe('Close', () => {
      it('All peers should receive a leave message when someone leaves', async () => {
        expect.assertions((CAPACITY - 1) * 3)

        const { connections } = await setup()
        const entries = Object.entries(connections)
        const [peerId, socket] = entries[entries.length - 1]

        entries.forEach(([pid, value]) => {
          if (pid === peerId) return

          value.onmessage = (event: WebSocket.MessageEvent) => {
            const json = JSON.parse(event.data.toString()) as Message.Leave
            expect(json.type).toBe('Leave')
            expect(json.peerId).toBe(peerId)
            expect(json.peers).toEqual(Object.keys(connections).filter(id => id !== peerId))
          }
        })

        socket.close()

        await sleep(50)
      })
      it('All peers connections should close when the host leaves', async () => {
        expect.assertions(CAPACITY + CAPACITY - 1)
        const { connections } = await setup()

        for (const peerId in connections) {
          if (peerId === 'host') continue
          connections[peerId].onclose = event => expect(event.code).toBe(CloseCode.RoomClosed)
        }

        connections['host'].close()
        await sleep(50)

        Object.values(connections).forEach(socket => {
          expect(socket.readyState).toBe(WebSocket.CLOSED)
        })
      })
    })
    describe('Malformed Message', () => {
      it('Room should remain open if a malformed message is sent', async () => {
        const { connections } = await setup(CAPACITY - 1)

        connections['host'].send('This is a malformed message')
        connections['host'].send(234534545456)
        connections['host'].send(JSON.stringify({ type: 'Fake', data: 'help' }))
      })
      it('No peer should receive a message when a malformed one is sent', async () => {
        const { connections } = await setup()
        const entries = Object.entries(connections)
        const socket = entries[0][1]

        entries.forEach(([, value]) => {
          value.onmessage = () => fail('Peer should not receive data')
        })

        socket.send('This is a malformed message')
        socket.send(234534545456)
        socket.send(JSON.stringify({ type: 'Fake', data: 'help' }))

        await sleep(50)
      })
    })
  })

  const joinRoom = async (
    roomCode: string,
    peerId: string,
    onmessage?: (event: WebSocket.MessageEvent) => void
  ) => {
    return new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(`${wsUrl}/${peerId}/${roomCode}`)
      socket.onopen = event => {
        setTimeout(() => resolve(event.target), 100)
      }
      socket.onerror = e => reject(e)
      socket.onclose = e => reject(e.code)
      if (onmessage) socket.onmessage = onmessage
    })
  }

  const createRoom = async () => {
    const res = await fetch(`${httpUrl}/room`, { method: 'POST' })
    const json = (await res.json()) as { roomCode: string }
    return json.roomCode
  }

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
})
