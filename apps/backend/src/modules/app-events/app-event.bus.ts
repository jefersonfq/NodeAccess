import type { Redis } from 'ioredis'
import type { WebSocket } from 'ws'
import jwt from 'jsonwebtoken'
import { env } from '../../config/env.js'
import { logger } from '../../config/logger.js'
import type { JwtPayload } from '../../shared/guards.js'

const CHANNEL = 'nodeaccess:app-events'

export interface InventoryAclChangedEvent {
  type: 'inventory_acl_changed'
  tenantId: number
  inventoryNodeId: number
  hostId: number | null
  actorId: number
  principalType: 'USER' | 'GROUP' | 'ROLE'
  principalId: number
  action: 'upsert' | 'delete' | 'move' | 'repair'
  changedAt: string
}

export interface UserAclMembershipChangedEvent {
  type: 'user_acl_membership_changed'
  tenantId: number
  userId: number
  actorId: number
  previousGroupIds: number[]
  nextGroupIds: number[]
  changedAt: string
}

export interface SessionPresenceChangedEvent {
  type: 'session_presence_changed'
  tenantId: number
  hostId: number
  sessionId: number | null
  userId: number | null
  action: 'started' | 'ended' | 'timeout' | 'cleanup' | 'reconnected'
  changedAt: string
}

export type AppEvent = InventoryAclChangedEvent | UserAclMembershipChangedEvent | SessionPresenceChangedEvent
type AppEventHandler = (event: AppEvent) => void | Promise<void>

interface Client {
  ws: WebSocket
  tenantId: number
  userId: number
}

function sendJson(ws: WebSocket, message: object): boolean {
  if (ws.readyState !== 1) return false
  try {
    ws.send(JSON.stringify(message))
    return true
  } catch (err) {
    logger.warn({ err }, 'Falha ao enviar evento para cliente websocket')
    return false
  }
}

function parseAuthenticatedToken(token: string | undefined): { tenantId: number; userId: number } | null {
  if (!token) return null
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload
    if (payload.stage !== 'authenticated') return null
    return { tenantId: payload.tenantId, userId: Number(payload.sub) }
  } catch {
    return null
  }
}

function shouldSendToClient(client: Client, event: AppEvent): boolean {
  if (client.tenantId !== event.tenantId) return false
  if (event.type === 'user_acl_membership_changed') return client.userId === event.userId
  return true
}

function isIntegerArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => Number.isInteger(item))
}

function isValidAppEvent(event: Partial<AppEvent>): event is AppEvent {
  if (!Number.isInteger(event.tenantId) || typeof event.changedAt !== 'string') {
    return false
  }

  if (event.type === 'inventory_acl_changed') {
    return Number.isInteger(event.actorId)
      && Number.isInteger(event.inventoryNodeId)
      && (event.hostId === null || Number.isInteger(event.hostId))
      && ['USER', 'GROUP', 'ROLE'].includes(String(event.principalType))
      && Number.isInteger(event.principalId)
      && ['upsert', 'delete', 'move', 'repair'].includes(String(event.action))
  }

  if (event.type === 'user_acl_membership_changed') {
    return Number.isInteger(event.actorId)
      && Number.isInteger(event.userId)
      && isIntegerArray(event.previousGroupIds)
      && isIntegerArray(event.nextGroupIds)
  }

  if (event.type === 'session_presence_changed') {
    return Number.isInteger(event.hostId)
      && (event.sessionId === null || Number.isInteger(event.sessionId))
      && (event.userId === null || Number.isInteger(event.userId))
      && ['started', 'ended', 'timeout', 'cleanup', 'reconnected'].includes(String(event.action))
  }

  return false
}

export class AppEventBus {
  private subscriber: Redis | null = null
  private readonly clients = new Set<Client>()
  private readonly handlers = new Set<AppEventHandler>()

  constructor(private readonly redis: Redis) {}

  async publish(event: AppEvent): Promise<void> {
    await this.redis.publish(CHANNEL, JSON.stringify(event))
  }

  onEvent(handler: AppEventHandler): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  subscribe(ws: WebSocket, token: string | undefined): void {
    const principal = parseAuthenticatedToken(token)
    if (!principal) {
      sendJson(ws, { type: 'error', message: 'Token inválido' })
      ws.close(1008)
      return
    }

    const client: Client = { ws, tenantId: principal.tenantId, userId: principal.userId }
    this.clients.add(client)
    sendJson(ws, { type: 'connected' })
    ws.once('close', () => {
      this.clients.delete(client)
    })
  }

  async start(): Promise<void> {
    if (this.subscriber) return
    const subscriber = this.redis.duplicate()
    subscriber.on('error', (err) => {
      logger.warn({ err }, 'Falha no subscriber de eventos do app')
    })
    subscriber.on('message', (_channel, raw) => {
      this.handleMessage(raw)
    })
    await subscriber.connect()
    await subscriber.subscribe(CHANNEL)
    this.subscriber = subscriber
  }

  async stop(): Promise<void> {
    const subscriber = this.subscriber
    this.subscriber = null
    if (!subscriber) return
    await subscriber.unsubscribe(CHANNEL).catch(() => {})
    subscriber.disconnect()
  }

  private handleMessage(raw: string): void {
    try {
      const event = JSON.parse(raw) as Partial<AppEvent>
      if (!isValidAppEvent(event)) return

      for (const client of this.clients) {
        if (!shouldSendToClient(client, event)) continue
        if (!sendJson(client.ws, event)) {
          this.clients.delete(client)
        }
      }
      for (const handler of this.handlers) {
        Promise.resolve(handler(event)).catch((err) => {
          logger.warn({ err, eventType: event.type }, 'Falha ao processar evento interno do app')
        })
      }
    } catch (err) {
      logger.warn({ err }, 'Mensagem inválida de eventos do app')
    }
  }
}
