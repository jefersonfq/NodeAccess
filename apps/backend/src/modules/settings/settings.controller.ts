import type { FastifyRequest, FastifyReply } from 'fastify'
import type { SettingsService } from './settings.service.js'

export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  async get(request: FastifyRequest, reply: FastifyReply) {
    const settings = await this.settingsService.get(request.jwtUser!.tenantId)
    return reply.send(settings)
  }
}
