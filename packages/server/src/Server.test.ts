import { Server } from './Server'
import { getPortPromise as getAvailablePort } from 'portfinder'
import WebSocket from 'ws'

describe('Server', () => {
  let wsUrl: string = 'ws://localhost:8080'
  let httpUrl: string = 'http://localhost:8080'
  let server: Server
  const capacity = 3
  const timeout = 3e3

  beforeAll(async () => {
    const port = await getAvailablePort({ port: 3100 })

    wsUrl = `ws://localhost:${port}`
    httpUrl = `http://localhost:${port}`

    server = new Server({ port, capacity, timeout })
    await server.listen()
  })

  const setup = async () => {
    const roomId = await createRoom()

    const peerIds = []
    for (let i = 0; i < capacity; i++) {
      if (i === 0) peerIds.push('host')
      else peerIds.push(`peer${i}`)
    }

    const sockets = await Promise.all(peerIds.map(peerId => joinRoom(roomId, peerId)))

    const connections = peerIds.reduce((peers, peerId, i) => {
      peers[peerId] = sockets[i]
      return peers
    }, {} as { [key: string]: WebSocket })

    return { roomId, connections }
  }

  afterAll(async () => server.close())

  describe('Version', () => {
    it('Version number should match the one in package.json', async () => {
      const pkg = require('../package.json')

      expect(pkg).toHaveProperty('version')
      const res = await fetch(`${httpUrl}/version`)
      expect(res.status).toBe(200)
      const json = (await res.json()) as { version: string }
      expect(json).toHaveProperty('version')
      expect(json.version).toBe(pkg.version)
    })
  })

  describe('Create Room', () => {
    it('Should return a 200 and a 4 digit roomId', async () => {
      const res = await fetch(`${httpUrl}/room`, { method: 'POST' })
      expect(res.status).toBe(200)
      const json = (await res.json()) as any
      expect(json).toHaveProperty('roomId')
      expect(json.roomId).toMatch(/^[A-Z0-9]{4}$/)
    })
  })

  describe('Room connections', () => {
    it('Peer should be able to join room', async () => {
      const peerId = 'host'
      const roomId = await createRoom()

      const socket = await joinRoom(roomId, peerId)
      expect(socket.readyState).toBe(WebSocket.OPEN)
    })

    it('Peer should not be able to join room that does not exist', () => {
      const peerId = `host`

      return expect(joinRoom('1234', peerId)).rejects.toBeDefined()
    })

    it('Peer should not be able to join room that they already joined', async () => {
      const peerId = `test`
      const roomId = await createRoom()

      await joinRoom(roomId, peerId)
      await expect(joinRoom(roomId, peerId)).rejects.toBeDefined()
    })

    it('Peer should not be able to join room that is full', async () => {
      const { roomId, connections } = await setup()
      const peerIds = Object.keys(connections)
      await expect(joinRoom(roomId, peerIds[0])).rejects.toBeDefined()
    })
  })

  describe('Room lifecycle', () => {
    it('Room should remain open if someone joins', async () => {
      const roomId = await createRoom()
      // Pass a negative number to keep the socket open and close manually to avoid race condition
      const socket = await joinRoom(roomId, 'peer', -1)

      await sleep(timeout + 50)
      expect(socket.readyState).toBe(WebSocket.OPEN)
      socket.terminate()
    })

    it('Room should close if no one joins', async () => {
      const roomId = await createRoom()

      await sleep(timeout + 50)
      await expect(joinRoom(roomId, 'peer')).rejects.toBeDefined()
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
        // Join message should contain the list of peers connected to the room
      })
    })
    describe('Data', () => {
      it('Only the host should receive a data message when a peer sends data', async () => {})
      it('All peers should receive a data message when the host sends data', async () => {})
    })
    describe('Leave', () => {
      it('All peers should receive a leave message when someone leaves', async () => {})
    })
  })

  const joinRoom = async (roomId: string, peerId: string, closeIn: number = 500) => {
    return new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(`${wsUrl}/${peerId}/${roomId}`)
      socket.onopen = event => {
        if (closeIn > 0) setTimeout(() => event.target?.close(), closeIn)
        setTimeout(() => resolve(event.target), 100)
      }
      socket.onerror = e => reject(e)
      socket.onclose = event => reject(event.code)
    })
  }

  const createRoom = async () => {
    const res = await fetch(`${httpUrl}/room`, { method: 'POST' })
    const json = (await res.json()) as { roomId: string }
    return json.roomId
  }

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
})
