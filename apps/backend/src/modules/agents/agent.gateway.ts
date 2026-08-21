// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WebSocket = any
import { agentRegistry, type ActiveAgent } from './agent.registry.js'
import type { AgentService } from './agent.service.js'
import { logger } from '../../config/logger.js'

export interface AgentConnectionMeta {
  remoteIp?: string
  version?:  string
  hostname?: string
  platform?: string
  arch?:     string
  tlsMode?:  'verified' | 'insecure'
}

export class AgentGateway {
  constructor(
    private readonly agentService: AgentService,
    private readonly registry = agentRegistry,
    private readonly heartbeatIntervalMs = 30_000,
    private readonly heartbeatTimeoutMs = 75_000,
  ) {}

  async handleConnection(ws: WebSocket, rawToken: string, meta: AgentConnectionMeta = {}): Promise<void> {
    // 1. Autenticar pelo token (passado via query param)
    const agent = await this.agentService.authenticate(rawToken)
    if (!agent) {
      ws.send(JSON.stringify({ type: 'error', message: 'Token inválido ou agente desativado' }))
      ws.close(1008)
      return
    }

    // 2. Registrar no registry
    const activeAgent: ActiveAgent = {
      agentId:     agent.id,
      userId:      agent.createdById,
      tenantId:    agent.tenantId,
      name:        agent.name,
      agentType:   agent.agentType,
      agentMode:   agent.agentMode,
      isDefault:   agent.isDefault,
      poolName:    agent.poolName,
      priority:    agent.priority,
      privateAccess: agent.privateAccess,
      ws,
      connectedAt: new Date(),
      ...(meta.version  !== undefined && { version:  meta.version }),
      ...(meta.hostname !== undefined && { hostname: meta.hostname }),
      ...(meta.platform !== undefined && { platform: meta.platform }),
      ...(meta.arch     !== undefined && { arch:     meta.arch }),
      ...(meta.remoteIp !== undefined && { remoteIp: meta.remoteIp }),
      ...(meta.tlsMode !== undefined && { tlsMode: meta.tlsMode }),
      lastPongAt: new Date(),
    }
    this.registry.register(activeAgent)

    // 3. Confirmar registro + enviar heartbeat periódico
    ws.send(JSON.stringify({ type: 'registered', agentId: agent.id, name: agent.name }))
    logger.info({
      agentId: agent.id,
      name: agent.name,
      agentType: agent.agentType,
      remoteIp: meta.remoteIp,
      version: meta.version,
      hostname: meta.hostname,
      platform: meta.platform,
      arch: meta.arch,
    }, 'Agent WebSocket pronto')

    // Auditoria: agente conectado
    await this.agentService.markConnected(agent.id, meta)
    void this.agentService.logConnected(agent.id, agent.name, agent.agentType, agent.agentMode, agent.createdById, meta)

    // Heartbeat a cada 30s para manter conexão viva
    const handlePong = (data: Buffer, isBinary: boolean) => {
      if (isBinary) return
      try {
        const message = JSON.parse(data.toString()) as { type?: string }
        if (message.type !== 'pong') return
        activeAgent.lastPongAt = new Date()
        void this.agentService.touch(agent.id)
      } catch { /* registry reports malformed frames separately when relevant */ }
    }
    ws.on('message', handlePong)

    const heartbeat = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        if (Date.now() - (activeAgent.lastPongAt?.getTime() ?? activeAgent.connectedAt.getTime()) > this.heartbeatTimeoutMs) {
          ws.close(4000, 'heartbeat timeout')
          return
        }
        ws.send(JSON.stringify({ type: 'ping', sentAt: Date.now() }))
      }
    }, this.heartbeatIntervalMs)

    let disconnectReason = 'ws closed'
    ws.on('error', (err: Error) => { disconnectReason = err.message })
    ws.on('close', (code: number) => {
      disconnectReason = `ws closed (${code})`
      clearInterval(heartbeat)
      ws.off?.('message', handlePong)
      void this.agentService.markDisconnected(agent.id, disconnectReason)
      void this.agentService.logDisconnected(agent.id, agent.name, agent.agentType, agent.agentMode, agent.createdById, disconnectReason, meta)
    })
  }
}
