import type { Redis } from 'ioredis'
import { logger } from '../../config/logger.js'
import type { SshSessionRuntimeRegistry } from './ssh-session-runtime.registry.js'

const CHANNEL = 'nodeaccess:ssh:jit-link-revoked'

interface JitLinkRevokedMessage {
  type: 'jit_link_revoked'
  tenantId: number
  linkId: number
  revokedAt: string
}

export class JitSessionRevocationBus {
  private subscriber: Redis | null = null

  constructor(
    private readonly redis: Redis,
    private readonly runtimeRegistry: SshSessionRuntimeRegistry,
  ) {}

  async publishRevoked(tenantId: number, linkId: number): Promise<void> {
    const message: JitLinkRevokedMessage = {
      type: 'jit_link_revoked',
      tenantId,
      linkId,
      revokedAt: new Date().toISOString(),
    }
    await this.redis.publish(CHANNEL, JSON.stringify(message))
  }

  async start(): Promise<void> {
    if (this.subscriber) return

    const subscriber = this.redis.duplicate()
    subscriber.on('error', (err) => {
      logger.warn({ err }, 'Falha no subscriber de revogação JIT')
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
      const message = JSON.parse(raw) as Partial<JitLinkRevokedMessage>
      if (message.type !== 'jit_link_revoked') return
      if (!Number.isInteger(message.linkId) || Number(message.linkId) <= 0) return
      const closed = this.runtimeRegistry.closeByJitLink(Number(message.linkId), 'jit_link_revoked')
      if (closed > 0) {
        logger.info({ linkId: message.linkId, closed }, 'Sessões JIT encerradas via Redis')
      }
    } catch (err) {
      logger.warn({ err }, 'Mensagem inválida de revogação JIT')
    }
  }
}
