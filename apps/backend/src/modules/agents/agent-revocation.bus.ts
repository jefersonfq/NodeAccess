import type { Redis } from 'ioredis'
import { agentRegistry, type AgentRegistry } from './agent.registry.js'
import { logger } from '../../config/logger.js'
const channel = 'nodeaccess:agent-revocation:v1'
export class AgentRevocationBus {
  private subscriber: Redis | undefined
  constructor(private readonly redis: Redis, private readonly registry: AgentRegistry = agentRegistry) {}
  async start() {
    if (this.subscriber) return
    const sub = this.redis.duplicate(); this.subscriber = sub
    sub.on('error', error => logger.warn({ error }, 'Agent revocation subscriber unavailable'))
    sub.on('message', (_channel, raw) => {
      try { const event = JSON.parse(raw); if (Number.isSafeInteger(event.agentId) && event.agentId > 0) this.registry.disconnectById(event.agentId, 'Agent authorization invalidated') } catch {}
    })
    await sub.connect(); await sub.subscribe(channel)
  }
  async invalidate(agentId: number) {
    this.registry.disconnectById(agentId, 'Agent authorization invalidated')
    // Database revalidation closes sockets even if delivery is unavailable/lost.
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([this.redis.publish(channel, JSON.stringify({ agentId })), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Revocation delivery timeout')), 1000) })])
    } catch (error) { logger.warn({ error }, 'Agent revocation delivery failed; database revalidation remains active') }
    finally { clearTimeout(timeout) }
  }
  stop() { this.subscriber?.disconnect(); this.subscriber = undefined }
}
