import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../../shared/guards.js'
import type { SettingsController } from './settings.controller.js'

export async function settingsRoutes(app: FastifyInstance, controller: SettingsController): Promise<void> {
  /** GET /api/v1/settings — configurações do tenant (admin) */
  app.get('/', {
    preHandler: [requireAdmin],
    schema: {
      tags:     ['Settings'],
      summary:  'Configurações do sistema (admin)',
      security: [{ bearerAuth: [] }],
    },
    handler: controller.get.bind(controller),
  })
}
