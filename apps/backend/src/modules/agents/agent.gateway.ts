// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WebSocket = any
import { agentRegistry } from './agent.registry.js'
import type { AgentService } from './agent.service.js'
import { logger } from '../../config/logger.js'

export class AgentGateway {
  constructor(private readonly agentService: AgentService) {}

  async handleConnection(ws: WebSocket, rawToken: string): Promise<void> {
    // 1. Autenticar pelo token (passado via query param)
    const agent = await this.agentService.authenticate(rawToken)
    if (!agent) {
      ws.send(JSON.stringify({ type: 'error', message: 'Token inválido ou agente desativado' }))
      ws.close(1008)
      return
    }

    if (!agent) return

    // 2. Registrar no registry
    agentRegistry.register({
      agentId:     agent.id,
      userId:      agent.createdById,
      tenantId:    agent.tenantId,
      name:        agent.name,
      ws,
      connectedAt: new Date(),
    })

    // 3. Confirmar registro + enviar heartbeat periódico
    ws.send(JSON.stringify({ type: 'registered', agentId: agent.id, name: agent.name }))
    logger.info({ agentId: agent.id, name: agent.name }, 'Agent WebSocket pronto')

    // Atualiza lastSeenAt no banco
    await this.agentService.touch(agent.id)

    // Heartbeat a cada 30s para manter conexão viva
    const heartbeat = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
    }, 30_000)

    ws.on('close', () => clearInterval(heartbeat))
  }
}
