import type { FastifyInstance } from 'fastify'
import type { SshGateway } from './ssh.gateway.js'
import type { AgentGateway } from '../agents/agent.gateway.js'

export async function sshRoutes(app: FastifyInstance, gateway: SshGateway, agentGateway: AgentGateway): Promise<void> {
  /**
   * GET /ws/ssh/:hostId?token=<accessToken>
   *
   * O token JWT vai na query string porque o browser WebSocket API
   * não suporta headers customizados no upgrade request.
   */
  app.get<{
    Params:      { hostId: string }
    Querystring: { token?: string; cols?: string; rows?: string }
  }>(
    '/ssh/:hostId',
    { websocket: true },
    (socket, request) => {
      const hostId = Number(request.params.hostId)
      const token  = request.query.token
      const cols   = Number(request.query.cols)  || 80
      const rows   = Number(request.query.rows)  || 24

      if (isNaN(hostId)) {
        socket.send(JSON.stringify({ type: 'error', message: 'hostId inválido' }))
        socket.close(1008)
        return
      }

      gateway.handleConnection(socket, token, hostId, cols, rows).catch((err) => {
        app.log.error(err, 'Unhandled error in SSH gateway')
        socket.close(1011)
      })
    },
  )

  /**
   * GET /ws/agent?token=<agentToken>
   * WebSocket endpoint para o agente NodeAccess se registrar.
   */
  app.get<{ Querystring: { token?: string } }>(
    '/agent',
    { websocket: true },
    (socket, request) => {
      const token = request.query.token
      if (!token) {
        socket.send(JSON.stringify({ type: 'error', message: 'Token obrigatório' }))
        socket.close(1008)
        return
      }
      // Injetar token na primeira mensagem — ou aceitar via query param diretamente
      // Enviar mensagem inicial para que o gateway processe o token da query
      agentGateway.handleConnection(socket, token).catch((err) => {
        app.log.error(err, 'Unhandled error in Agent gateway')
        socket.close(1011)
      })
    },
  )
}
