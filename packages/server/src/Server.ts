import Fastify, { FastifyInstance, preHandlerHookHandler } from 'fastify'
import FastifyWebsocket from '@fastify/websocket'
import pkg from '../package.json'

const { version } = pkg

export class Server {
  private port: number

  private fastify: FastifyInstance

  constructor(port: number) {
    this.port = port
    this.fastify = Fastify({
      logger: true,
    })
  }

  listen() {
    this.fastify.register(FastifyWebsocket)

    this.fastify.register(async server => {
      server.get('/version', async (req, res) => {
        return { version }
      })

      server.post('/room', async function handler(req, res) {
        return
      })

      server.get(
        '/:peerId/:roomId',
        {
          websocket: true,
          preHandler: this.handleHandshake,
        },
        async (cn, req) => {
          cn.socket.on('message', message => {})
          cn.socket.on('close', () => {})
          cn.socket.on('error', () => {})
          cn.socket.on('open', () => {})
        }
      )
    })

    return this.fastify.listen({ port: this.port })
  }

  private handleHandshake: preHandlerHookHandler = async (req, res, nxt) => {
    nxt()
  }
}
