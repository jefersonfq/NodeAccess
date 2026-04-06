import type { FastifyInstance } from 'fastify'
import type { SharedSessionGateway } from './shared-session.gateway.js'

export async function sharedSessionWsRoutes(app: FastifyInstance, gateway: SharedSessionGateway): Promise<void> {
  app.get<{
    Params: { sharedSessionId: string }
    Querystring: { token?: string }
  }>(
    '/shared-sessions/:sharedSessionId',
    { websocket: true },
    (socket, request) => {
      const sharedSessionId = Number(request.params.sharedSessionId)
      const token = request.query.token

      if (isNaN(sharedSessionId)) {
        socket.send(JSON.stringify({ type: 'error', message: 'sharedSessionId inválido' }))
        socket.close(1008)
        return
      }

      gateway.handleConnection(socket, token, sharedSessionId).catch((err) => {
        app.log.error(err, 'Unhandled error in Shared Session gateway')
        socket.close(1011)
      })
    },
  )
}
