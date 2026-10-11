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

  async getManual(request: FastifyRequest, reply: FastifyReply): Promise<never> {
    return reply.send(await this.settingsService.getManual(request.jwtUser!.tenantId))
  }

  async updateManual(request: FastifyRequest<{ Body: { enabled: boolean } }>, reply: FastifyReply): Promise<never> {
    return reply.send(await this.settingsService.updateManual(request.jwtUser!.tenantId, request.body.enabled, Number(request.jwtUser!.sub)))
  }

  async get(request: FastifyRequest, reply: FastifyReply): Promise<never> {
    const settings = await this.settingsService.get(request.jwtUser!.tenantId)
    if (request.jwtUser!.isPlatformAdmin) return reply.send(settings)
    const tenantSettings = { ...settings }
    Reflect.deleteProperty(tenantSettings, 'environment')
    return reply.send(tenantSettings)
  }

  async getPlatform(_request: FastifyRequest, reply: FastifyReply): Promise<never> {
    return reply.send(this.settingsService.getPlatformSettings())
  }

  async getTenantLicense(request: FastifyRequest<{ Params: { tenantId: string } }>, reply: FastifyReply): Promise<never> {
    return reply.send(await this.settingsService.getTenantLicense(Number(request.params.tenantId)))
  }

  async updateTenantLicense(request: FastifyRequest<{ Params: { tenantId: string }; Body: UpdateLicenseEntitlementsInput }>, reply: FastifyReply): Promise<never> {
    const settings = await this.settingsService.updateLicenseEntitlements(Number(request.params.tenantId), request.body, Number(request.jwtUser!.sub))
    return reply.send(settings.license)
  }

  async updateLicense(
    request: FastifyRequest<{ Body: UpdateLicenseEntitlementsInput }>,
    reply: FastifyReply,
  ): Promise<never> {
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
  ): Promise<never> {
    const settings = await this.settingsService.updateSessionLimits(
      request.jwtUser!.tenantId,
      request.body,
    )
    return reply.send(settings)
  }

  async updatePasswordPolicy(
    request: FastifyRequest<{ Body: UpdatePasswordPolicyInput }>,
    reply: FastifyReply,
  ): Promise<never> {
    const settings = await this.settingsService.updatePasswordPolicy(
      request.jwtUser!.tenantId,
      request.body,
    )
    return reply.send(settings)
  }

  async updateTenantSettings(
    request: FastifyRequest<{ Body: UpdateTenantSettingsInput }>,
    reply: FastifyReply,
  ): Promise<never> {
    const settings = await this.settingsService.updateTenantSettings(
      request.jwtUser!.tenantId,
      request.body,
    )
    return reply.send(settings)
  }

  async updateJitAccessSettings(
    request: FastifyRequest<{ Body: UpdateJitAccessSettingsInput }>,
    reply: FastifyReply,
  ): Promise<never> {
    const settings = await this.settingsService.updateJitAccessSettings(
      request.jwtUser!.tenantId,
      request.body,
    )
    return reply.send(settings)
  }

  async updateSharedSessionSettings(
    request: FastifyRequest<{ Body: UpdateSharedSessionSettingsInput }>,
    reply: FastifyReply,
  ): Promise<never> {
    const settings = await this.settingsService.updateSharedSessionSettings(
      request.jwtUser!.tenantId,
      request.body,
    )
    return reply.send(settings)
  }

  async updateSftpPolicySettings(
    request: FastifyRequest<{ Body: UpdateSftpPolicySettingsInput }>,
    reply: FastifyReply,
  ): Promise<never> {
    const settings = await this.settingsService.updateSftpPolicySettings(
      request.jwtUser!.tenantId,
      request.body,
    )
    return reply.send(settings)
  }
}
