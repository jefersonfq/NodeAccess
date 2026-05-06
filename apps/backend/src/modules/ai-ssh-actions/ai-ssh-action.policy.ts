import { ForbiddenError } from '../../shared/errors.js'
import type { CreateAiSshActionRunDto } from '@nodeaccess/shared'
import type { LicenseEntitlementService } from '../license/license-entitlement.service.js'

export class AiSshActionPolicyService {
  constructor(
    private readonly entitlements: LicenseEntitlementService,
  ) {}

  async assertFeatureLicensed(tenantId: number): Promise<void> {
    await this.entitlements.requireFeature(
      tenantId,
      'aiSshActions',
      'Acoes SSH por IA ainda nao estao licenciadas para este tenant',
    )
  }

  async assertCreateAllowed(input: {
    tenantId: number
    role: 'ADMIN' | 'USER'
    dto: CreateAiSshActionRunDto
  }): Promise<void> {
    await this.assertFeatureLicensed(input.tenantId)

    if (input.dto.channel === 'local_ai') {
      await this.entitlements.requireFeature(
        input.tenantId,
        'localAi',
        'Assistente local ainda nao esta licenciado para este tenant',
      )
    }

    if (input.dto.channel === 'mcp') {
      await this.entitlements.requireFeature(
        input.tenantId,
        'mcp',
        'MCP ainda nao esta licenciado para este tenant',
      )
    }

    if (input.dto.mode === 'full_operational_access' && input.role !== 'ADMIN') {
      throw new ForbiddenError('Full operational access por IA exige perfil administrativo')
    }

    // approval_required pode ser solicitado por usuario com acesso ao host,
    // mas a execucao continua travada ate aprovacao administrativa.
  }
}
