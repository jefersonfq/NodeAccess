import type { FastifyInstance } from 'fastify'
import type { AppEventBus } from './app-event.bus.js'

export function appEventRoutes(app: FastifyInstance, bus: AppEventBus): Promise<void> {
  app.get<{ Querystring: { token?: string } }>(
    '/events',
    { websocket: true },
    (socket, request) => {
      void bus.subscribe(socket, request.query.token)
    },
  )
  return Promise.resolve()
}
