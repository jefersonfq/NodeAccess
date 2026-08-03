import type { FastifyInstance } from 'fastify'
import type { AppEventBus } from './app-event.bus.js'

export async function appEventRoutes(app: FastifyInstance, bus: AppEventBus): Promise<void> {
  app.get<{ Querystring: { token?: string } }>(
    '/events',
    { websocket: true },
    (socket, request) => {
      bus.subscribe(socket, request.query.token)
    },
  )
}
