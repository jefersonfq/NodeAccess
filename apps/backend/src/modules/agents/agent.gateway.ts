// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WebSocket = any
import { agentRegistry } from './agent.registry.js'
import type { AgentService } from './agent.service.js'
import { logger } from '../../config/logger.js'

export interface AgentConnectionMeta {
  remoteIp?: string
  version?:  string
  hostname?: string
  platform?: string
  arch?:     string
}

export class AgentGateway {
  constructor(private readonly agentService: AgentService) {}

  async handleConnection(ws: WebSocket, rawToken: string, meta: AgentConnectionMeta = {}): Promise<void> {
    // 1. Autenticar pelo token (passado via query param)
    const agent = await this.agentService.authenticate(rawToken)
    if (!agent) {
      ws.send(JSON.stringify({ type: 'error', message: 'Token inválido ou agente desativado' }))
      ws.close(1008)
      return
    }

    // 2. Registrar no registry
    agentRegistry.register({
      agentId:     agent.id,
      userId:      agent.createdById,
      tenantId:    agent.tenantId,
      name:        agent.name,
      agentMode:   agent.agentMode,
      isDefault:   agent.isDefault,
      ws,
      connectedAt: new Date(),
      ...(meta.version  !== undefined && { version:  meta.version }),
      ...(meta.hostname !== undefined && { hostname: meta.hostname }),
      ...(meta.platform !== undefined && { platform: meta.platform }),
      ...(meta.arch     !== undefined && { arch:     meta.arch }),
      ...(meta.remoteIp !== undefined && { remoteIp: meta.remoteIp }),
    })

    // 3. Confirmar registro + enviar heartbeat periódico
    ws.send(JSON.stringify({ type: 'registered', agentId: agent.id, name: agent.name }))
    logger.info({
      agentId: agent.id,
      name: agent.name,
      remoteIp: meta.remoteIp,
      version: meta.version,
      hostname: meta.hostname,
      platform: meta.platform,
      arch: meta.arch,
    }, 'Agent WebSocket pronto')

    // Auditoria: agente conectado
    await this.agentService.markConnected(agent.id, meta)
    void this.agentService.logConnected(agent.id, agent.name, agent.agentMode, agent.createdById, meta)

    // Heartbeat a cada 30s para manter conexão viva
    const heartbeat = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
        void this.agentService.touch(agent.id)
      }
    }, 30_000)

    let disconnectReason = 'ws closed'
    ws.on('error', (err: Error) => { disconnectReason = err.message })
    ws.on('close', (code: number) => {
      disconnectReason = `ws closed (${code})`
      clearInterval(heartbeat)
      void this.agentService.markDisconnected(agent.id, disconnectReason)
      void this.agentService.logDisconnected(agent.id, agent.name, agent.agentMode, agent.createdById, disconnectReason, meta)
    })
  }
}
