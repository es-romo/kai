import Fastify, { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify'
import FastifyWebsocket from '@fastify/websocket'
import pkg from '../package.json'
import WebSocket from 'ws'
import { RejectCode, Peer, PeerId, RoomId, Message, CloseCode } from './types'

const { version } = pkg

const DEFAULT_PORT = 8080
const DEFAULT_TIMEOUT = 60e3
const DEFAULT_CAPACITY = 3

export class Server {
  private port: number

  private timeout: number

  private capacity: number

  private fastify: FastifyInstance

  private rooms: Record<RoomId, Array<Peer>>

  constructor({ port = DEFAULT_PORT, timeout = DEFAULT_TIMEOUT, capacity = DEFAULT_CAPACITY }) {
    this.port = port
    this.fastify = Fastify({ logger: true, forceCloseConnections: true })
    this.timeout = timeout
    this.capacity = capacity
    this.rooms = {}
  }

  public createRoom(): RoomId {
    //TODO: find a better way to generate room id
    const roomId = Math.random().toString(36).substr(2, 4).toUpperCase()
    this.rooms[roomId] = []

    // Delete room after timeout if empty
    setTimeout(() => {
      const room = this.rooms[roomId]
      if (room && !room?.length) delete this.rooms[roomId]
    }, this.timeout)

    return roomId
  }

  public closeRoom(roomId: RoomId, code: CloseCode) {
    this.rooms[roomId]?.forEach(peer => peer.socket.close(code))
    delete this.rooms[roomId]
  }

  public getHost(roomId: RoomId): PeerId | undefined {
    return this.rooms[roomId]?.[0]?.id
  }

  private handleJoin(peerId: PeerId, roomId: RoomId, socket: WebSocket) {
    this.rooms[roomId].push({ id: peerId, socket })
    this.sendToAll(roomId, { type: 'Join', peerId, peers: this.rooms[roomId].map(peer => peer.id) })
  }

  private handleMessage(peerId: PeerId, roomId: RoomId, message: WebSocket.RawData) {
    const msg = JSON.parse(message.toString()) as Message.ClientToServer
    switch (msg.type) {
      case 'Data':
        if (this.getHost(roomId) === peerId) {
          this.sendToPeers(roomId, { type: 'Data', data: msg.data, from: peerId })
        } else {
          this.sendToHost(roomId, { type: 'Data', data: msg.data, from: peerId })
        }
        break
    }
  }

  private handleLeave(peerId: PeerId, roomId: RoomId) {
    if (this.getHost(roomId) === peerId) {
      this.closeRoom(roomId, CloseCode.RoomClosed)
    } else {
      this.rooms[roomId] = this.rooms[roomId].filter(peer => peer.id !== peerId)
      this.sendToAll(roomId, {
        type: 'Leave',
        peerId,
        peers: this.rooms[roomId].map(peer => peer.id),
      })
    }
  }

  private handlePong(peerId: PeerId, roomId: RoomId) {}

  public sendToAll(roomId: RoomId, msg: Message.ServerToClient) {
    console.log('sendToAll', roomId, msg)
  }

  public sendToHost(roomId: RoomId, msg: Message.ServerToClient) {
    console.log('sendToHost', roomId, msg)
  }

  public sendToPeers(roomId: RoomId, msg: Message.ServerToClient) {
    console.log('sendToPeers', roomId, msg)
  }

  private handleHandshake: preHandlerHookHandler = (req, res, nxt) => {
    const { peerId, roomId } = req.params as { peerId: PeerId; roomId: RoomId }

    if (!this.rooms[roomId]) return res.code(404).send(RejectCode.RoomNotFound)

    if (this.rooms[roomId].some(peer => peer.id === peerId))
      return res.code(409).send(RejectCode.DuplicatePeerId)

    if (this.rooms[roomId].length >= this.capacity) return res.code(403).send(RejectCode.RoomFull)

    nxt()
  }

  listen() {
    this.fastify.register(FastifyWebsocket)

    this.fastify.register(async server => {
      server.get('/version', async () => {
        return { version }
      })

      server.post('/room', async () => {
        const roomId = this.createRoom()
        return { roomId }
      })

      server.get<{ Params: { peerId: PeerId; roomId: RoomId } }>(
        '/:peerId/:roomId',
        {
          websocket: true,
          preHandler: this.handleHandshake,
        },
        async (cn, req) => {
          const { peerId, roomId } = req.params
          this.handleJoin(peerId, roomId, cn.socket)
          cn.socket.on('message', message => this.handleMessage(peerId, roomId, message))
          cn.socket.on('close', code => {
            // The close event fires even if the connection was closed by the server. Server initated close codes are in the 4000 range.
            if (code < 4000) this.handleLeave(peerId, roomId)
          })
          cn.socket.on('error', () => this.handleLeave(peerId, roomId))
          cn.socket.on('pong', () => this.handlePong(peerId, roomId))
        }
      )
    })

    return this.fastify.listen({ port: this.port })
  }

  close() {
    this.fastify.websocketServer?.clients.forEach(socket => {
      socket.terminate()
    })
    return this.fastify.close()
  }
}
