import Fastify, { FastifyInstance, preHandlerHookHandler } from 'fastify'
import FastifyWebsocket from '@fastify/websocket'
import WebSocket from 'ws'
import { Peer, PeerId, RoomCode, Message, CloseCode } from './types'

const DEFAULT_PORT = 8080
const DEFAULT_TIMEOUT = 60e3
const DEFAULT_CAPACITY = 3
const DEFAULT_CODE_LENGTH = 4

export class Server {
  private port: number

  private timeout: number

  private capacity: number

  private codeLength: number

  private fastify: FastifyInstance

  private rooms: Record<RoomCode, Array<Peer>>

  constructor({
    port = DEFAULT_PORT,
    timeout = DEFAULT_TIMEOUT,
    capacity = DEFAULT_CAPACITY,
    codeLength = DEFAULT_CODE_LENGTH,
  }) {
    this.port = port
    this.fastify = Fastify({ logger: true, forceCloseConnections: true })
    this.timeout = timeout
    this.capacity = capacity
    this.codeLength = codeLength
    this.rooms = {}
    this.fastify.addHook('preClose', () => {
      this.fastify.websocketServer?.clients.forEach(socket => {
        socket.terminate()
      })
    })
  }

  private createRoom(): RoomCode {
    let roomCode: string = ''

    let i = 0
    const maxIterations = 1000

    do {
      roomCode = Math.random()
        .toString(36)
        .substring(2, 2 + this.codeLength)
        .toUpperCase()
      if (i++ >= maxIterations) throw new Error('Max attempts at creating a room reached')
    } while (this.rooms[roomCode])

    this.rooms[roomCode] = []

    setTimeout(() => {
      const room = this.rooms[roomCode]
      if (room && !room?.length) delete this.rooms[roomCode]
    }, this.timeout)

    return roomCode
  }

  private closeRoom(roomCode: RoomCode) {
    this.rooms[roomCode]?.forEach(peer => peer.socket.close(CloseCode.RoomClosed))
    delete this.rooms[roomCode]
  }

  private getHostId(roomCode: RoomCode): PeerId | undefined {
    return this.rooms[roomCode]?.[0]?.id
  }

  private handleJoin(peerId: PeerId, roomCode: RoomCode, socket: WebSocket) {
    this.rooms[roomCode].push({ id: peerId, socket })
    this.sendToAll(roomCode, {
      type: 'Join',
      peerId,
      peers: this.rooms[roomCode].map(peer => peer.id),
    })
  }

  private handleMessage(peerId: PeerId, roomCode: RoomCode, message: WebSocket.RawData) {
    const msg = this.tryParseMessage(message)
    if (!msg) return
    switch (msg.type) {
      case 'Data':
        if (this.getHostId(roomCode) === peerId) {
          this.sendToPeers(roomCode, { type: 'Data', data: msg.data, from: peerId })
        } else {
          this.sendToHost(roomCode, { type: 'Data', data: msg.data, from: peerId })
        }
        break
    }
  }

  private handleLeave(peerId: PeerId, roomCode: RoomCode) {
    // If the room does not exist anymore, don't do anything as its all gone
    if (!this.rooms[roomCode]) return

    if (this.getHostId(roomCode) === peerId) {
      this.closeRoom(roomCode)
    } else {
      this.rooms[roomCode] = this.rooms[roomCode].filter(peer => peer.id !== peerId)
      this.sendToAll(roomCode, {
        type: 'Leave',
        peerId,
        peers: this.rooms[roomCode].map(peer => peer.id),
      })
    }
  }

  private sendToAll(roomCode: RoomCode, msg: Message.ServerToClient) {
    for (const peer of this.rooms[roomCode]) {
      peer.socket.send(JSON.stringify(msg))
    }
  }

  private sendToHost(roomCode: RoomCode, msg: Message.ServerToClient) {
    const hostId = this.getHostId(roomCode)
    if (hostId) {
      const host = this.rooms[roomCode]?.find(peer => peer.id === hostId)
      if (host) host.socket.send(JSON.stringify(msg))
    }
  }

  private sendToPeers(roomCode: RoomCode, msg: Message.ServerToClient) {
    const hostId = this.getHostId(roomCode)
    for (const peer of this.rooms[roomCode]) {
      if (hostId !== peer.id) peer.socket.send(JSON.stringify(msg))
    }
  }

  private handleHandshake: preHandlerHookHandler = (req, res, nxt) => {
    const { peerId, roomCode } = req.params as { peerId: PeerId; roomCode: RoomCode }

    if (!this.rooms[roomCode]) return res.code(404).send(CloseCode.RoomNotFound)

    if (this.rooms[roomCode].some(peer => peer.id === peerId))
      return res.code(409).send(CloseCode.DuplicatePeerId)

    if (this.rooms[roomCode].length >= this.capacity) return res.code(403).send(CloseCode.RoomFull)

    nxt()
  }

  private tryParseMessage(message: WebSocket.RawData) {
    try {
      const json = JSON.parse(message.toString()) as Message.ClientToServer
      if (json.type !== 'Data' || !json.data) return
      return json
    } catch (e) {
      return undefined
    }
  }

  listen() {
    this.fastify.register(FastifyWebsocket)

    this.fastify.register(async server => {
      server.post('/room', async (_, res) => {
        try {
          const roomCode = this.createRoom()
          res.send({ roomCode })
        } catch (error) {
          res.code(404).send('Failed to create a room. Try again later.')
        }
      })

      server.get<{ Params: { peerId: PeerId; roomCode: RoomCode } }>(
        '/:peerId/:roomCode',
        {
          websocket: true,
          preHandler: this.handleHandshake,
        },
        async (cn, req) => {
          const { peerId, roomCode } = req.params
          this.handleJoin(peerId, roomCode, cn.socket)
          cn.socket.on('message', message => this.handleMessage(peerId, roomCode, message))
          cn.socket.on('close', () => this.handleLeave(peerId, roomCode))
          cn.socket.on('error', () => this.handleLeave(peerId, roomCode))
        }
      )
    })

    return this.fastify.listen({ port: this.port })
  }

  close() {
    return this.fastify.close()
  }
}
