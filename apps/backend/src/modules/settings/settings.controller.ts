import type { FastifyRequest, FastifyReply } from 'fastify'
import type { SettingsService, UpdateLicenseEntitlementsInput } from './settings.service.js'

export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  async get(request: FastifyRequest, reply: FastifyReply) {
    const settings = await this.settingsService.get(request.jwtUser!.tenantId)
    return reply.send(settings)
  }

  async updateLicense(
    request: FastifyRequest<{ Body: UpdateLicenseEntitlementsInput }>,
    reply: FastifyReply,
  ) {
    const settings = await this.settingsService.updateLicenseEntitlements(
      request.jwtUser!.tenantId,
      request.body,
    )
    return reply.send(settings)
  }
}
