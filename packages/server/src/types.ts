import WebSocket from 'ws'

export enum RejectCode {
  DuplicatePeerId = 4010,
  RoomFull = 4020,
  RoomNotFound = 4030,
}

export enum CloseCode {
  RoomClosed = 4040,
  TimedOut = 4050,
}

// TODO: consider adding heartbeat type instead of using pong
export namespace Message {
  export type ClientToServer = DataIn

  export interface Join {
    type: 'Join'
    peerId: PeerId
    peers: PeerId[]
  }

  export interface DataIn {
    type: 'Data'
    data: string
  }

  export interface DataOut {
    type: 'Data'
    from: PeerId
    data: string
  }

  export type ServerToClient = Join | DataOut | Leave

  export interface Leave {
    type: 'Leave'
    peerId: PeerId
    peers: PeerId[]
  }
}

export type PeerId = string

export type RoomId = string

export type Peer = { id: PeerId; socket: WebSocket }
