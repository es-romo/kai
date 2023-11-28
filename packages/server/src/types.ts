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
  export type ClientToServer = Data

  export interface Join {
    type: 'Join'
    peerId: PeerId
    peers: PeerId[]
  }

  export interface Data {
    type: 'Data'
    data: string
    from: PeerId
  }

  export type ServerToClient = Join | Data | Leave

  export interface Leave {
    type: 'Leave'
    peerId: PeerId
    peers: PeerId[]
  }
}

export type PeerId = string

export type RoomId = string

export type Peer = { id: PeerId; socket: WebSocket }
