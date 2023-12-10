import Fastify, { FastifyInstance, preHandlerHookHandler } from 'fastify'
import FastifyWebsocket from '@fastify/websocket'
import pkg from '../package.json'
import WebSocket from 'ws'
import { Peer, PeerId, RoomId, Message, CloseCode } from './types'

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
    this.fastify.addHook('preClose', () => {
      this.fastify.websocketServer?.clients.forEach(socket => {
        socket.terminate()
      })
    })
  }

  private createRoom(): RoomId {
    //TODO: find a better way to generate room id
    const roomId = Math.random().toString(36).substr(2, 4).toUpperCase()
    this.rooms[roomId] = []

    setTimeout(() => {
      const room = this.rooms[roomId]
      if (room && !room?.length) delete this.rooms[roomId]
    }, this.timeout)

    return roomId
  }

  private closeRoom(roomId: RoomId) {
    this.rooms[roomId]?.forEach(peer => peer.socket.close(CloseCode.RoomClosed))
    delete this.rooms[roomId]
  }

  private getHostId(roomId: RoomId): PeerId | undefined {
    return this.rooms[roomId]?.[0]?.id
  }

  private handleJoin(peerId: PeerId, roomId: RoomId, socket: WebSocket) {
    this.rooms[roomId].push({ id: peerId, socket })
    this.sendToAll(roomId, { type: 'Join', peerId, peers: this.rooms[roomId].map(peer => peer.id) })
  }

  private handleMessage(peerId: PeerId, roomId: RoomId, message: WebSocket.RawData) {
    const msg = this.tryParseMessage(message)
    if (!msg) return
    switch (msg.type) {
      case 'Data':
        if (this.getHostId(roomId) === peerId) {
          this.sendToPeers(roomId, { type: 'Data', data: msg.data, from: peerId })
        } else {
          this.sendToHost(roomId, { type: 'Data', data: msg.data, from: peerId })
        }
        break
    }
  }

  private handleLeave(peerId: PeerId, roomId: RoomId) {
    // If the room does not exist anymore, don't do anything as its all gone
    if (!this.rooms[roomId]) return

    if (this.getHostId(roomId) === peerId) {
      this.closeRoom(roomId)
    } else {
      this.rooms[roomId] = this.rooms[roomId].filter(peer => peer.id !== peerId)
      this.sendToAll(roomId, {
        type: 'Leave',
        peerId,
        peers: this.rooms[roomId].map(peer => peer.id),
      })
    }
  }

  private sendToAll(roomId: RoomId, msg: Message.ServerToClient) {
    for (const peer of this.rooms[roomId]) {
      peer.socket.send(JSON.stringify(msg))
    }
  }

  private sendToHost(roomId: RoomId, msg: Message.ServerToClient) {
    const hostId = this.getHostId(roomId)
    if (hostId) {
      const host = this.rooms[roomId]?.find(peer => peer.id === hostId)
      if (host) host.socket.send(JSON.stringify(msg))
    }
  }

  private sendToPeers(roomId: RoomId, msg: Message.ServerToClient) {
    const hostId = this.getHostId(roomId)
    for (const peer of this.rooms[roomId]) {
      if (hostId !== peer.id) peer.socket.send(JSON.stringify(msg))
    }
  }

  private handleHandshake: preHandlerHookHandler = (req, res, nxt) => {
    const { peerId, roomId } = req.params as { peerId: PeerId; roomId: RoomId }

    if (!this.rooms[roomId]) return res.code(404).send(CloseCode.RoomNotFound)

    if (this.rooms[roomId].some(peer => peer.id === peerId))
      return res.code(409).send(CloseCode.DuplicatePeerId)

    if (this.rooms[roomId].length >= this.capacity) return res.code(403).send(CloseCode.RoomFull)

    nxt()
  }

  private tryParseMessage(message: WebSocket.RawData) {
    try {
      const json = JSON.parse(message.toString()) as Message.ClientToServer
      if (json.type !== 'Data' || typeof json.data !== 'string') return
      return json
    } catch (e) {
      return undefined
    }
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
          cn.socket.on('close', () => this.handleLeave(peerId, roomId))
          cn.socket.on('error', () => this.handleLeave(peerId, roomId))
        }
      )
    })

    return this.fastify.listen({ port: this.port })
  }

  close() {
    return this.fastify.close()
  }
}
