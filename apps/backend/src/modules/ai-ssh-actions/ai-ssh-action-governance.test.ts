import { describe, expect, it, vi } from 'vitest'

vi.mock('../../config/env.js', () => ({
  env: {
    AI_SSH_ACTION_SAFE_COMMAND_PATTERNS: undefined,
    AI_SSH_ACTION_APPROVAL_COMMAND_PATTERNS: undefined,
    AI_SSH_ACTION_BLOCKED_COMMAND_PATTERNS: undefined,
    PEM_ENCRYPTION_KEY: '0'.repeat(64),
  },
}))

import type { AiSshActionRunDetail, CreateAiSshActionRunDto } from '@nodeaccess/shared'
import { ForbiddenError } from '../../shared/errors.js'
import type { LicenseEntitlementService } from '../license/license-entitlement.service.js'
import { AiSshActionPolicyService } from './ai-ssh-action.policy.js'
import { AiSshActionService } from './ai-ssh-action.service.js'

function actionRunDto(overrides: Partial<CreateAiSshActionRunDto> = {}): CreateAiSshActionRunDto {
  return {
    hostId: 10,
    mode: 'diagnostic_only',
    channel: 'mcp',
    summary: 'Governed MCP action',
    steps: [
      {
        id: 'step-1',
        label: 'Check service',
        command: 'systemctl status nginx',
        timeoutSeconds: 30,
      },
    ],
    ...overrides,
  }
}

function actionRunDetail(dto: CreateAiSshActionRunDto): AiSshActionRunDetail {
  return {
    id: 100,
    tenantId: 1,
    hostId: dto.hostId,
    requestedById: 2,
    approvedById: null,
    channel: dto.channel,
    mode: dto.mode,
    status: 'pending_approval',
    summary: dto.summary,
    approvalReason: dto.approvalReason ?? null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date('2026-04-23T00:00:00.000Z'),
    updatedAt: new Date('2026-04-23T00:00:00.000Z'),
    steps: dto.steps.map((step, index) => ({
      id: index + 1,
      stepId: step.id,
      label: step.label,
      command: step.command,
      timeoutSeconds: step.timeoutSeconds,
      status: 'pending',
      exitCode: null,
      outputPreview: null,
      redactionApplied: false,
      startedAt: null,
      finishedAt: null,
    })),
  }
}

function createEntitlementsMock() {
  return {
    requireFeature: vi.fn().mockResolvedValue(undefined),
  } as unknown as LicenseEntitlementService & { requireFeature: ReturnType<typeof vi.fn> }
}

function createActionService(
  repositoryOverrides: Record<string, unknown> = {},
  sshRepoOverrides: Record<string, unknown> = {},
) {
  const repository = {
    createRequestedRun: vi.fn(async (input: { dto: CreateAiSshActionRunDto }) => actionRunDetail(input.dto)),
    ...repositoryOverrides,
  }
  const sshRepo = {
    hasEffectiveHostPermission: vi.fn().mockResolvedValue(true),
    ...sshRepoOverrides,
  }

  const service = new AiSshActionService(
    repository as never,
    {
      assertFeatureLicensed: vi.fn().mockResolvedValue(undefined),
      assertCreateAllowed: vi.fn().mockResolvedValue(undefined),
    } as never,
    sshRepo as never,
    {} as never,
    {
      logAdminEvent: vi.fn().mockResolvedValue(undefined),
    } as never,
    {
      findByTenant: vi.fn().mockResolvedValue(null),
    } as never,
    { publishEvent: vi.fn().mockResolvedValue(undefined) } as never,
  )

  return { service, repository, sshRepo }
}

describe('AI SSH action governance', () => {
  it('blocks full operational access for non-admin users', async () => {
    const policy = new AiSshActionPolicyService(createEntitlementsMock())

    await expect(policy.assertCreateAllowed({
      tenantId: 1,
      role: 'USER',
      dto: actionRunDto({ mode: 'full_operational_access' }),
    })).rejects.toThrow(ForbiddenError)
  })

  it('allows admins to request full operational access when licensed', async () => {
    const entitlements = createEntitlementsMock()
    const policy = new AiSshActionPolicyService(entitlements)

    await expect(policy.assertCreateAllowed({
      tenantId: 1,
      role: 'ADMIN',
      dto: actionRunDto({ mode: 'full_operational_access' }),
    })).resolves.toBeUndefined()

    expect(entitlements.requireFeature).toHaveBeenCalledWith(1, 'aiSshActions', expect.any(String))
    expect(entitlements.requireFeature).toHaveBeenCalledWith(1, 'mcp', expect.any(String))
  })

  it('allows full operational access to include approval-required commands', async () => {
    const { service, repository } = createActionService()
    const dto = actionRunDto({
      mode: 'full_operational_access',
      steps: [
        {
          id: 'restart-nginx',
          label: 'Restart nginx',
          command: 'systemctl restart nginx',
          timeoutSeconds: 60,
        },
      ],
    })

    await expect(service.createRequestedRun({
      tenantId: 1,
      userId: 2,
      role: 'ADMIN',
      dto,
    })).resolves.toMatchObject({ mode: 'full_operational_access' })

    expect(repository.createRequestedRun).toHaveBeenCalled()
  })

  it('blocks creating a run when Connect permission was revoked', async () => {
    const { service, repository, sshRepo } = createActionService({}, {
      hasEffectiveHostPermission: vi.fn().mockResolvedValue(false),
    })
    const dto = actionRunDto()

    await expect(service.createRequestedRun({
      tenantId: 1,
      userId: 2,
      role: 'USER',
      dto,
    })).rejects.toBeInstanceOf(ForbiddenError)

    expect(sshRepo.hasEffectiveHostPermission).toHaveBeenCalledWith(10, 1, 2, 'connect', 'USER')
    expect(repository.createRequestedRun).not.toHaveBeenCalled()
  })

  it('keeps blocked commands denied even with full operational access', async () => {
    const { service, repository } = createActionService()

    await expect(service.createRequestedRun({
      tenantId: 1,
      userId: 2,
      role: 'ADMIN',
      dto: actionRunDto({
        mode: 'full_operational_access',
        steps: [
          {
            id: 'wipe',
            label: 'Wipe data',
            command: 'rm -rf /var/lib/mysql',
            timeoutSeconds: 60,
          },
        ],
      }),
    })).rejects.toThrow(ForbiddenError)

    expect(repository.createRequestedRun).not.toHaveBeenCalled()
  })
})
