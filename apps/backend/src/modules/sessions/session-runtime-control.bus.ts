import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import { logger } from '../../config/logger.js'
import type { SshSessionRuntimeRegistry } from '../ssh/ssh-session-runtime.registry.js'
import type { GraphicalSessionRuntimeRegistry } from '../graphical/graphical-session-runtime.registry.js'

const COMMAND_CHANNEL = 'nodeaccess:sessions:runtime-close'
const RESPONSE_CHANNEL = 'nodeaccess:sessions:runtime-close:response'
const DEFAULT_TIMEOUT_MS = 2_000

interface CloseSessionRequest {
  type: 'session_close_request'
  requestId: string
  sessionId: number
  reason: 'admin_closed' | 'acl_revoked'
  requestedAt: string
}

interface CloseSessionResponse {
  type: 'session_close_response'
  requestId: string
  sessionId: number
  closed: boolean
  handledByRuntime: boolean
  respondedAt: string
}

export class SessionRuntimeControlBus {
  private commandSubscriber: Redis | null = null

  constructor(
    private readonly redis: Redis,
    private readonly sshRuntimeRegistry: SshSessionRuntimeRegistry,
    private readonly graphicalRuntimeRegistry: GraphicalSessionRuntimeRegistry,
  ) {}

  async closeSession(
    sessionId: number,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    reason: 'admin_closed' | 'acl_revoked' = 'admin_closed',
  ): Promise<{ closed: boolean; handledByRuntime: boolean }> {
    const requestId = randomUUID()
    const subscriber = this.redis.duplicate()

    return new Promise((resolve) => {
      let settled = false
      const finish = (result: { closed: boolean; handledByRuntime: boolean }) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        subscriber.unsubscribe(RESPONSE_CHANNEL).catch(() => {})
        subscriber.disconnect()
        resolve(result)
      }

      const timer = setTimeout(() => {
        finish({ closed: false, handledByRuntime: false })
      }, timeoutMs)
      timer.unref?.()

      subscriber.on('error', (err) => {
        logger.warn({ err, sessionId, requestId }, 'Falha no subscriber de resposta de encerramento de sessão')
        finish({ closed: false, handledByRuntime: false })
      })
      subscriber.on('message', (_channel, raw) => {
        const response = parseResponse(raw)
        if (!response || response.requestId !== requestId) return
        finish({ closed: response.closed, handledByRuntime: response.handledByRuntime })
      })

      subscriber.connect()
        .then(() => subscriber.subscribe(RESPONSE_CHANNEL))
        .then(() => {
          const request: CloseSessionRequest = {
            type: 'session_close_request',
            requestId,
            sessionId,
            reason,
            requestedAt: new Date().toISOString(),
          }
          return this.redis.publish(COMMAND_CHANNEL, JSON.stringify(request))
        })
        .catch((err) => {
          logger.warn({ err, sessionId, requestId }, 'Falha ao publicar comando de encerramento de sessão')
          finish({ closed: false, handledByRuntime: false })
        })
    })
  }

  async start(): Promise<void> {
    if (this.commandSubscriber) return

    const subscriber = this.redis.duplicate()
    subscriber.on('error', (err) => {
      logger.warn({ err }, 'Falha no subscriber de controle runtime de sessões')
    })
    subscriber.on('message', (_channel, raw) => {
      this.handleCloseRequest(raw)
    })
    await subscriber.connect()
    await subscriber.subscribe(COMMAND_CHANNEL)
    this.commandSubscriber = subscriber
  }

  async stop(): Promise<void> {
    const subscriber = this.commandSubscriber
    this.commandSubscriber = null
    if (!subscriber) return
    await subscriber.unsubscribe(COMMAND_CHANNEL).catch(() => {})
    subscriber.disconnect()
  }

  private handleCloseRequest(raw: string): void {
    const request = parseRequest(raw)
    if (!request) return

    const closed = this.sshRuntimeRegistry.close(request.sessionId, request.reason)
      || this.graphicalRuntimeRegistry.close(request.sessionId, request.reason)
    const response: CloseSessionResponse = {
      type: 'session_close_response',
      requestId: request.requestId,
      sessionId: request.sessionId,
      closed,
      handledByRuntime: closed,
      respondedAt: new Date().toISOString(),
    }
    this.redis.publish(RESPONSE_CHANNEL, JSON.stringify(response)).catch((err) => {
      logger.warn({ err, requestId: request.requestId, sessionId: request.sessionId }, 'Falha ao responder encerramento de sessão')
    })
  }
}

function parseRequest(raw: string): CloseSessionRequest | null {
  try {
    const value = JSON.parse(raw) as Partial<CloseSessionRequest>
    if (value.type !== 'session_close_request') return null
    if (!value.requestId || typeof value.requestId !== 'string') return null
    if (!Number.isInteger(value.sessionId) || Number(value.sessionId) <= 0) return null
    return {
      type: 'session_close_request',
      requestId: value.requestId,
      sessionId: Number(value.sessionId),
      reason: value.reason === 'acl_revoked' ? 'acl_revoked' : 'admin_closed',
      requestedAt: typeof value.requestedAt === 'string' ? value.requestedAt : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

function parseResponse(raw: string): CloseSessionResponse | null {
  try {
    const value = JSON.parse(raw) as Partial<CloseSessionResponse>
    if (value.type !== 'session_close_response') return null
    if (!value.requestId || typeof value.requestId !== 'string') return null
    if (!Number.isInteger(value.sessionId) || Number(value.sessionId) <= 0) return null
    return {
      type: 'session_close_response',
      requestId: value.requestId,
      sessionId: Number(value.sessionId),
      closed: value.closed === true,
      handledByRuntime: value.handledByRuntime === true,
      respondedAt: typeof value.respondedAt === 'string' ? value.respondedAt : new Date().toISOString(),
    }
  } catch {
    return null
  }
}
