import { Server } from '@es-romo/relay'
import { Client } from './Client'
import { getPortPromise } from 'portfinder'
import { Event } from './types'
import WebSocket from 'isomorphic-ws'

describe('Client', () => {
  let server: Server
  const capacity = 3
  const timeout = 3e3
  let Kai: Client, Camila: Client, Coco: Client
  beforeAll(async () => {
    const port = await getPortPromise({ port: 3100 }).catch(e => {
      console.error(e)
      throw e
    })

    const wsUrl = `ws://localhost:${port}`
    const httpUrl = `http://localhost:${port}`

    server = new Server({ port, capacity, timeout })
    await server.listen()
    Coco = new Client({ allocationUrl: httpUrl, connectionUrl: wsUrl, id: 'Coco' })
    Camila = new Client({ allocationUrl: httpUrl, connectionUrl: wsUrl, id: 'Camila' })
    Kai = new Client({ allocationUrl: httpUrl, connectionUrl: wsUrl, id: 'Kai' })
  })

  afterAll(async () => server.close())

  describe('Coco hosts a room', () => {
    it('Constructs a new client', () => {
      expect(Coco).toBeInstanceOf(Client)
      expect(Camila).toBeInstanceOf(Client)
      expect(Kai).toBeInstanceOf(Client)
    })
    it('Coco should be in the initial state', () => {
      expect(Coco.id).toBe('Coco')
      expect(Coco.mode).toBeUndefined()
      expect(Coco.state).toBeUndefined()
      expect(Coco.peers).toEqual([])
    })
    it('Coco should receive a single open message', async () => {
      expect.assertions(6)
      let eventCount = 0
      for (const event of Object.values(Event.TYPE)) {
        if (event === Event.TYPE.OPEN) {
          Coco.on(event, peers => {
            eventCount++
            expect(peers).toEqual(['Coco'])
          })
        } else {
          Coco.on(event as Event.TYPE, () => {
            eventCount++
          })
        }
      }
      await Coco.join()
      await sleep(100)
      expect(Coco.state).toBe(WebSocket.OPEN)
      expect(Coco.mode).toBe('host')
      expect(Coco.id).toBe('Coco')
      expect(Coco.peers).toEqual(['Coco'])
      expect(eventCount).toBe(1)
    })
  })
  describe("Kai and Camila join Coco's room", () => {})
  describe('Coco sends a message', () => {})
  describe('Kai sends a message', () => {})
  describe('Camila sends a message', () => {})
  describe('Coco leaves the room', () => {})
  describe('Camila leaves the room', () => {})
  describe('Coco leaves the room', () => {})
  describe('Camila makes a new room', () => {})
  describe('Kai joins Camila room', () => {})
  describe('Coco joins Camila room', () => {})
  describe('Camila sends a message', () => {})
  describe('Kai sends a message', () => {})

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
})
