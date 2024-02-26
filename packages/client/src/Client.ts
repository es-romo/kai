import { ClientOptions, Message, Event } from './types'
import { EventEmitter } from 'eventemitter3'
import WebSocket from 'isomorphic-ws'

export class Client extends EventEmitter<Event.Valid> {
  public id: string

  public get mode() {
    return this._mode
  }

  public get state() {
    return this.socket?.readyState
  }

  public peers: string[] = []

  private _mode?: 'host' | 'listen'

  private connectionUrl: URL

  private allocationUrl: URL

  private socket?: WebSocket

  private room?: string

  constructor({ allocationUrl, connectionUrl, id }: ClientOptions) {
    super()
    this.allocationUrl = new URL(allocationUrl)
    this.connectionUrl = new URL(connectionUrl)
    this.id = id
  }

  public async join(room?: string) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.close()

    if (!room) {
      room = await this.createRoom()
      this._mode = 'host'
    } else {
      this._mode = 'listen'
    }

    this.room = room
    try {
      const url = new URL(this.connectionUrl)
      url.pathname = `/${this.id}/${room}`
      this.socket = new WebSocket(url)
      this.socket.onclose = e => this.handleClose(e)
      this.socket.onmessage = e => this.handleMessage(e)
      this.socket.onerror = e => this.handleError(e)

      return this
    } catch (e) {
      throw new Error()
    }
  }

  public leave() {
    if (this.socket?.readyState && this.socket?.readyState < 1) this.socket.close()
  }

  public send(data: string | number | object) {
    const message: Message.ClientToServer = { type: 'Data', data }
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  private async createRoom() {
    const url = new URL(this.allocationUrl)
    url.pathname = '/room'
    const res = await fetch(url.href, { method: 'POST' })
    return (await res.json()).roomId as string
  }

  private handleClose(event: WebSocket.CloseEvent) {
    this.emit(Event.TYPE.CLOSE, event.code)
    delete this.socket
    delete this.room
    this.peers = []
    delete this.room
    delete this._mode
  }

  private handleMessage(event: WebSocket.MessageEvent) {
    const message = JSON.parse(event.data.toString()) as Message.ServerToClient
    switch (message.type) {
      case 'Data':
        this.emit(Event.TYPE.MESSAGE, message.data)
        break

      case 'Join':
        this.peers = message.peers
        if (message.peerId === this.id) this.emit(Event.TYPE.OPEN, this.peers)
        else this.emit(Event.TYPE.JOIN, message.peerId, this.peers)
        break

      case 'Leave':
        this.peers = message.peers
        this.emit(Event.TYPE.LEAVE, message.peers)
        break
    }
  }

  private handleError(event: WebSocket.ErrorEvent) {
    this.emit(Event.TYPE.ERROR, event.message)
  }
}
