import WebSocket from 'ws'

export enum CloseCode {
  DuplicatePeerId = 4010,
  RoomFull = 4020,
  RoomNotFound = 4030,
  RoomClosed = 4040,
}

export namespace Message {
  export type ClientToServer = DataIn

  export interface DataIn {
    type: 'Data'
    data: string
  }

  export type ServerToClient = Join | DataOut | Leave

  export interface Join {
    type: 'Join'
    peerId: PeerId
    peers: PeerId[]
  }

  export interface DataOut {
    type: 'Data'
    from: PeerId
    data: string
  }

  export interface Leave {
    type: 'Leave'
    peerId: PeerId
    peers: PeerId[]
  }
}

export type PeerId = string

export type RoomId = string

export type Peer = { id: PeerId; socket: WebSocket }
