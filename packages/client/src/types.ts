export enum CloseCode {
  DuplicatePeerId = 4010,
  RoomFull = 4020,
  RoomNotFound = 4030,
  RoomClosed = 4040,
}

export interface ClientOptions {
  allocationUrl: string | URL
  connectionUrl: string | URL
  id: string
}

export namespace Event {
  export enum TYPE {
    OPEN = 'open',
    CLOSE = 'close',
    ERROR = 'error',
    MESSAGE = 'message',
    JOIN = 'join',
    LEAVE = 'leave',
  }

  export type Valid = {
    [Event.TYPE.OPEN]: (peers: string[]) => void
    [Event.TYPE.CLOSE]: (code: number) => void
    [Event.TYPE.ERROR]: (error: string) => void
    [Event.TYPE.MESSAGE]: (data: string | number | object) => void
    [Event.TYPE.JOIN]: (peer: string, peers: string[]) => void
    [Event.TYPE.LEAVE]: (peers: string[]) => void
  }
}

export namespace Message {
  export type ClientToServer = DataOut

  export interface DataOut {
    type: 'Data'
    data: string | number | object
  }

  export type ServerToClient = Join | DataIn | Leave

  export interface Join {
    type: 'Join'
    peerId: string
    peers: string[]
  }

  export interface DataIn {
    type: 'Data'
    from: string
    data: string | number | object
  }

  export interface Leave {
    type: 'Leave'
    peerId: string
    peers: string[]
  }
}
