import type { FastifyRequest, FastifyReply } from 'fastify'
import type {
  SettingsService,
  UpdateLicenseEntitlementsInput,
  UpdateSessionLimitsInput,
  UpdatePasswordPolicyInput,
  UpdateTenantSettingsInput,
} from './settings.service.js'

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

  async updateSessionLimits(
    request: FastifyRequest<{ Body: UpdateSessionLimitsInput }>,
    reply: FastifyReply,
  ) {
    const settings = await this.settingsService.updateSessionLimits(
      request.jwtUser!.tenantId,
      request.body,
    )
    return reply.send(settings)
  }

  async updatePasswordPolicy(
    request: FastifyRequest<{ Body: UpdatePasswordPolicyInput }>,
    reply: FastifyReply,
  ) {
    const settings = await this.settingsService.updatePasswordPolicy(
      request.jwtUser!.tenantId,
      request.body,
    )
    return reply.send(settings)
  }

  async updateTenantSettings(
    request: FastifyRequest<{ Body: UpdateTenantSettingsInput }>,
    reply: FastifyReply,
  ) {
    const settings = await this.settingsService.updateTenantSettings(
      request.jwtUser!.tenantId,
      request.body,
    )
    return reply.send(settings)
  }
}
