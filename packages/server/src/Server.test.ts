import { Server } from './Server'
import { getPortPromise as getAvailablePort } from 'portfinder'
import { CloseCode, Message } from './types'
import fetch from 'node-fetch'
import WebSocket from 'ws'

// const log = debug('lf:relay:tests')

/**
 * In this context:
 * - `peerId` is always a peer id.
 * - `peer` is always a reference to a client's socket connection.
 * - `roomId` is always a room (elsewhere referred to as a 'channel' or a 'discovery roomId').
 */
describe('Server', () => {
  let testId = 0
  let relayUrl: string = 'ws://localhost:8080'
  let allocationUrl: string = 'http://localhost:8080'
  let server: Server

  beforeAll(async () => {
    // find a port and set things up

    const port = await getAvailablePort({ port: 3100 })
    relayUrl = `ws://localhost:${port}`
    allocationUrl = `http://localhost:${port}`

    server = new Server({ port })
    await server.listen()
  })

  const setup = () => {
    testId += 1
    const aliceId = `alice-${testId}`
    const bobId = `bob-${testId}`
    const roomId = `test-roomId-${testId}`
    return { aliceId, bobId, roomId }
  }

  afterAll(done => {
    server.close()
    done()
  })

  describe('Create Room', () => {
    let roomId: string
    it('Should return a 200 and a 4 digit roomId', async () => {
      const res = await fetch(`${allocationUrl}/room`, { method: 'POST' })
      expect(res.status).toBe(200)
      const json = (await res.json()) as any
      expect(json).toHaveProperty('roomId')
      expect(json.roomId).toMatch(/^[A-Z0-9]{4}$/)
      roomId = json.roomId
      done()
    })

    it('Room should exist and be empty', async () => {
      expect(server.rooms).toHaveProperty(roomId)
      expect(server.rooms[roomId]).toEqual([])
      done()
    })
  })

  describe('Room connections', () => {
    it('Peer should be able to join room', async done => {
      const peerId = 'host'
      const roomId = await createRoom()

      await expect(joinRoom(roomId, peerId, 500)).resolves.toBeDefined()

      done()
    })

    it('Peer should not be able to join room that does not exist', async done => {
      const peerId = `host`

      await expect(joinRoom('1234', peerId, 500)).rejects.toBe(CloseCode.RoomNotFound)

      done()
    })

    it('Peer should not be able to join room that they already joined', async done => {
      const peerId = `test`
      const roomId = await createRoom()

      await expect(joinRoom(roomId, peerId, 1000)).resolves.toBeDefined()
      await expect(joinRoom(roomId, peerId, 1000)).rejects.toBe(CloseCode.DuplicatePeerId)

      done()
    })

    it('Peer should not be able to join room that is full', async done => {
      const roomId = await createRoom()

      const capacity = server.roomCapacity
      const connections = []
      for (let i = 0; i < capacity; i++) {
        connections.push(joinRoom(roomId, `peer${i}`, 1000))
      }

      await Promise.all(connections)

      await expect(joinRoom(roomId, 'peer4', 1000)).rejects.toBe(CloseCode.RoomFull)

      done()
    })
  })

  describe('Room lifecycle', () => {
    it('Room should remain open if someone joins', async done => {
      const timeout = 500
      const oldTimeout = server.serverTimeout

      server.serverTimeout = timeout

      const roomId = await createRoom()

      server.serverTimeout = oldTimeout

      await joinRoom(roomId, 'test', timeout + 150)

      expect(server.rooms[roomId]).toBeDefined()

      setTimeout(() => {
        expect(server.rooms[roomId]).toBeDefined()
      }, timeout + 100)

      done()
    })

    it('Room should close if no one joins', async done => {
      const timeout = 200
      const oldTimeout = server.serverTimeout

      server.serverTimeout = timeout

      const roomId = await createRoom()

      server.serverTimeout = oldTimeout

      setTimeout(() => {
        expect(server.rooms[roomId]).toBeUndefined()
        done()
      }, timeout + 100)

      done()
    })

    it('Room should close if the host leaves', async done => {
      const hostId = 'host'
      const peer1Id = 'peer1'
      const peer2Id = 'peer2'
      const roomId = await createRoom()

      const [hostSocket, peer1Socket, peer2Socket] = await Promise.all([
        joinRoom(roomId, hostId, 1000),
        joinRoom(roomId, peer1Id, 1000),
        joinRoom(roomId, peer2Id, 1000),
      ])

      expect(server.rooms[roomId]).toBeDefined()
      expect(server.rooms[roomId].length).toBe(3)

      peer1Socket.close()
      console.log('peer1 closed')
      await new Promise(resolve => setTimeout(resolve, 50))
      console.log('peer1 closed')
      expect(peer1Socket.readyState).toBe(WebSocket.CLOSED)
      expect(server.rooms[roomId]).toBeDefined()
      expect(server.rooms[roomId].length).toBe(2)

      hostSocket.close()
      console.log('host closed')
      await new Promise(resolve => setTimeout(resolve, 1000))
      expect(server.rooms[roomId]).toBeUndefined()
      expect(peer2Socket.readyState).toBe(WebSocket.CLOSED)

      done()
    })
  })

  describe('Room communication', () => {})

  describe('Failure states', () => {})

  const joinRoom = async (roomId: string, peerId: string, closeIn?: number) => {
    return new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(`${relayUrl}/${roomId}/${peerId}`)
      socket.onopen = event => {
        setTimeout(() => resolve(event.target), 100)
        if (closeIn) setTimeout(event.target.close, closeIn)
      }
      socket.onerror = reject
      socket.onclose = event => reject(event.code)
    })
  }

  const createRoom = async () => {
    const res = await fetch(`${allocationUrl}/room`, { method: 'POST' })
    const json = (await res.json()) as { roomId: string }
    return json.roomId
  }

  // const requestIntroduction = (peerId: string, roomId: string) => {
  //   const peer = new WebSocket(`${url}/introduction/${peerId}`)
  //   const joinMessage: Message.Join = {
  //     type: 'Join',
  //     roomId,
  //   }
  //   peer.once('open', () => peer.send(JSON.stringify(joinMessage)))
  //   return peer
  // }

  //   describe('Introduction', () => {
  //     it('should make a connection', done => {
  //       const { aliceId } = setup()

  //       server.on('introductionConnection', peerId => {
  //         expect(peerId).toEqual(aliceId)
  //         expect(server.peers).toHaveProperty(aliceId)
  //         expect(server.roomIds).toEqual({})
  //         done()
  //       })

  //       // make a connection
  //       const alice = new WebSocket(`${url}/introduction/${aliceId}`)
  //     })

  //     it('should not crash when sent malformed JSON', done => {
  //       const { aliceId, bobId, roomId } = setup()

  //       const alice = requestIntroduction(aliceId, roomId)

  //       // Bob's behavior will be non-standard so we'll drive it by hand
  //       const bob = new WebSocket(`${url}/introduction/${bobId}`)

  //       const badMessage = '{╯°□°}╯︵ ┻━┻' // 🡐 not valid JSON

  //       bob.on('open', () => {
  //         // Bob sends an invalid message
  //         bob.send(badMessage)

  //         // No servers are harmed

  //         // Bob then sends a valid join message
  //         bob.send(
  //           JSON.stringify({
  //             type: 'Join',
  //             roomId,
  //           })
  //         )

  //         // The bad message didn't kill the server - Bob gets a response back
  //         bob.on('message', data => {
  //           const msg = JSON.parse(data.toString())
  //           expect(msg.type).toBe('Introduction')
  //           done()
  //         })
  //       })

  //       // We expect the server to emit an error event on Bob's bad message
  //       server.once('error', payload => {
  //         expect(payload.error.toString()).toMatch(/SyntaxError/)
  //         expect(payload.data).toEqual(badMessage)
  //       })
  //     })

  //     it('should invite peers to connect', async () => {
  //       const { aliceId, bobId, roomId } = setup()
  //       const alice = requestIntroduction(aliceId, roomId)
  //       const bob = requestIntroduction(bobId, roomId)

  //       const aliceDone = new Promise<void>(resolve => {
  //         alice.once('message', d => {
  //           const invitation = JSON.parse(d.toString())
  //           expect(invitation).toEqual({
  //             type: 'Introduction',
  //             peerId: bobId,
  //             roomId,
  //           })
  //           resolve()
  //         })
  //       })
  //       const bobDone = new Promise<void>(resolve => {
  //         bob.on('message', d => {
  //           const invitation = JSON.parse(d.toString())
  //           expect(invitation).toEqual({
  //             type: 'Introduction',
  //             peerId: aliceId,
  //             roomId,
  //           })
  //           resolve()
  //         })
  //       })
  //       await bobDone
  //       // await Promise.all([aliceDone, bobDone])
  //     })
  //   })

  //   describe('Peer connections', () => {
  //     it('should pipe connections between two peers', done => {
  //       const { aliceId, bobId, roomId } = setup()

  //       const aliceRequest = requestIntroduction(aliceId, roomId)
  //       const _bobRequest = requestIntroduction(bobId, roomId) // need to make request even if we don't use the result

  //       aliceRequest.once('message', d => {
  //         // recap of previous test: we'll get an invitation to connect to the remote peer
  //         const invitation = JSON.parse(d.toString())

  //         expect(invitation).toEqual({
  //           type: 'Introduction',
  //           peerId: bobId,
  //           roomId,
  //         })

  //         const alice = new WebSocket(`${url}/connection/${aliceId}/${bobId}/${roomId}`)
  //         const bob = new WebSocket(`${url}/connection/${bobId}/${aliceId}/${roomId}`)

  //         // send message from local to remote
  //         alice.once('open', () => alice.send('DUDE!!'))
  //         bob.once('message', data => {
  //           expect(data.toString()).toEqual('DUDE!!')
  //         })

  //         // send message from remote to local
  //         bob.once('open', () => bob.send('hello'))
  //         alice.once('message', data => {
  //           expect(data.toString()).toEqual('hello')
  //           done()
  //         })
  //       })
  //     })

  //     it('should close a peer when asked to', done => {
  //       const { aliceId, bobId, roomId } = setup()

  //       const aliceRequest = requestIntroduction(aliceId, roomId)
  //       const _bobRequest = requestIntroduction(bobId, roomId) // need to make request even if we don't use the result

  //       aliceRequest.once('message', d => {
  //         const alice = new WebSocket(`${url}/connection/${aliceId}/${bobId}/${roomId}`)
  //         const bob = new WebSocket(`${url}/connection/${bobId}/${aliceId}/${roomId}`)

  //         alice.once('open', () => {
  //           alice.send('hey bob!')
  //           alice.close()
  //         })

  //         bob.once('message', d => {
  //           expect(d.toString()).toEqual('hey bob!')

  //           bob.send('sup alice')
  //           alice.once('message', () => {
  //             throw new Error('should never get here')
  //           })
  //           done()
  //         })
  //       })
  //     })
  //   })

  //   describe('N-way', () => {
  //     it('Should make introductions between all the peers', done => {
  //       const { roomId } = setup()
  //       let introductions = 0
  //       const peers = ['a', 'b', 'c', 'd', 'e']

  //       const expectedIntroductions = permutationsOfTwo(peers.length)

  //       const peerIds = peers.map(peerId => `peer-${peerId}-${testId}`)

  //       const sockets = peerIds.map(
  //         (peerId: string) => new WebSocket(`${url}/introduction/${peerId}`)
  //       )

  //       sockets.forEach((socket: WebSocket) => {
  //         socket.onmessage = event => {
  //           const { data } = event
  //           const message = JSON.parse(data.toString())
  //           expect(message.type).toBe('Introduction')

  //           introductions += 1
  //           if (introductions === expectedIntroductions) done()
  //         }
  //       })

  //       const joinMessage = { type: 'Join', roomId }
  //       sockets.forEach(async (socket: WebSocket) => {
  //         socket.onopen = () => {
  //           socket.send(JSON.stringify(joinMessage))
  //         }
  //       })
  //     })

  //     it('Should not crash when one peer disconnects mid-introduction', done => {
  //       const { roomId } = setup()
  //       let introductions = 0
  //       const peers = ['a', 'b', 'c', 'd', 'e']

  //       const peerIds = peers.map(peerId => `peer-${peerId}-${testId}`)

  //       const expectedIntroductions = permutationsOfTwo(peers.length - 1) // one will misbehave

  //       const sockets = peerIds.map(peerId => new WebSocket(`${url}/introduction/${peerId}`))

  //       sockets.forEach(socket => {
  //         socket.onmessage = event => {
  //           const { data } = event
  //           const message = JSON.parse(data.toString())
  //           expect(message.type).toBe('Introduction')

  //           introductions += 1
  //           if (introductions === expectedIntroductions) done()
  //         }
  //       })

  //       const joinMessage = { type: 'Join', roomId }
  //       sockets.forEach(async (socket, i) => {
  //         socket.onopen = () => {
  //           socket.send(JSON.stringify(joinMessage))
  //           if (i === 0) socket.close()
  //         }
  //       })
  //     })
  //   })
  // })
})
