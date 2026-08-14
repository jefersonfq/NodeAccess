import type { FastifyRequest, FastifyReply } from 'fastify'
import type {
  SettingsService,
  UpdateLicenseEntitlementsInput,
  UpdateSessionLimitsInput,
  UpdatePasswordPolicyInput,
  UpdateTenantSettingsInput,
  UpdateJitAccessSettingsInput,
  UpdateSharedSessionSettingsInput,
  UpdateSftpPolicySettingsInput,
} from './settings.service.js'

export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  async get(request: FastifyRequest, reply: FastifyReply) {
    const settings = await this.settingsService.get(request.jwtUser!.tenantId)
    if (request.jwtUser!.isPlatformAdmin) return reply.send(settings)
    const { environment: _platformOnly, ...tenantSettings } = settings
    return reply.send(tenantSettings)
  }

  async getPlatform(_request: FastifyRequest, reply: FastifyReply) {
    return reply.send(this.settingsService.getPlatformSettings())
  }

  async getTenantLicense(request: FastifyRequest<{ Params: { tenantId: string } }>, reply: FastifyReply) {
    return reply.send(await this.settingsService.getTenantLicense(Number(request.params.tenantId)))
  }

  async updateTenantLicense(request: FastifyRequest<{ Params: { tenantId: string }; Body: UpdateLicenseEntitlementsInput }>, reply: FastifyReply) {
    const settings = await this.settingsService.updateLicenseEntitlements(Number(request.params.tenantId), request.body, Number(request.jwtUser!.sub))
    return reply.send(settings.license)
  }

  async updateLicense(
    request: FastifyRequest<{ Body: UpdateLicenseEntitlementsInput }>,
    reply: FastifyReply,
  ) {
    const settings = await this.settingsService.updateLicenseEntitlements(
      request.jwtUser!.tenantId,
      request.body,
      Number(request.jwtUser!.sub),
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

  async updateJitAccessSettings(
    request: FastifyRequest<{ Body: UpdateJitAccessSettingsInput }>,
    reply: FastifyReply,
  ) {
    const settings = await this.settingsService.updateJitAccessSettings(
      request.jwtUser!.tenantId,
      request.body,
    )
    return reply.send(settings)
  }

  async updateSharedSessionSettings(
    request: FastifyRequest<{ Body: UpdateSharedSessionSettingsInput }>,
    reply: FastifyReply,
  ) {
    const settings = await this.settingsService.updateSharedSessionSettings(
      request.jwtUser!.tenantId,
      request.body,
    )
    return reply.send(settings)
  }

  async updateSftpPolicySettings(
    request: FastifyRequest<{ Body: UpdateSftpPolicySettingsInput }>,
    reply: FastifyReply,
  ) {
    const settings = await this.settingsService.updateSftpPolicySettings(
      request.jwtUser!.tenantId,
      request.body,
    )
    return reply.send(settings)
  }
}
