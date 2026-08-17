import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/database.js', () => ({
  prisma: {
    adminLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}))

vi.mock('../../config/env.js', () => ({
  env: {
    FEATURE_MCP: true,
    MCP_RATE_LIMIT_WINDOW_SECONDS: 60,
    MCP_RATE_LIMIT_MAX_REQUESTS: 120,
    MCP_INTERACTIVE_SSH_REQUIRE_ALLOWED_HOSTS: false,
  },
}))

vi.mock('../../config/redis.js', () => ({
  redis: {
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  },
}))

vi.mock('../../shared/guards.js', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('./mcp-token.repository.js', () => ({
  McpTokenRepository: class {
    authenticate = vi.fn()
    touchLastUsed = vi.fn()
  },
}))

import type { FastifyRequest } from 'fastify'
import { prisma } from '../../config/database.js'
import { env } from '../../config/env.js'
import { ForbiddenError } from '../../shared/errors.js'
import { assertMcpActionModeAuthorized, assertMcpHostAuthorized, assertMcpInteractiveFullAccessAuthorized } from './mcp.guard.js'

function requestWithTokenModes(modes: string[]): FastifyRequest {
  return {
    ip: '127.0.0.1',
    jwtUser: {
      sub: '2',
      email: 'admin@example.com',
      role: 'admin',
      isPlatformAdmin: false,
      tenantId: 1,
      canManageHosts: true,
      forcePasswordChange: false,
      stage: 'authenticated',
    },
    mcpAuth: {
      mode: 'persisted_token',
      principalKey: 'token:1:9',
      tokenId: 9,
      allowedActionModes: modes,
    },
  } as unknown as FastifyRequest
}

function requestWithTokenHosts(hostIds: number[]): FastifyRequest {
  return {
    ip: '127.0.0.1',
    jwtUser: {
      sub: '2',
      email: 'admin@example.com',
      role: 'admin',
      isPlatformAdmin: false,
      tenantId: 1,
      canManageHosts: true,
      forcePasswordChange: false,
      stage: 'authenticated',
    },
    mcpAuth: {
      mode: 'persisted_token',
      principalKey: 'token:1:9',
      tokenId: 9,
      allowedHostIds: hostIds,
    },
  } as unknown as FastifyRequest
}

function interactiveRequest(input: {
  role?: 'admin' | 'user'
  mode?: 'jwt' | 'persisted_token' | 'static_token'
  actionModes?: string[]
  hostIds?: number[]
} = {}): FastifyRequest {
  return {
    ip: '127.0.0.1',
    jwtUser: {
      sub: '2',
      email: 'admin@example.com',
      role: input.role ?? 'admin',
      isPlatformAdmin: false,
      tenantId: 1,
      canManageHosts: true,
      forcePasswordChange: false,
      stage: 'authenticated',
    },
    mcpAuth: {
      mode: input.mode ?? 'persisted_token',
      principalKey: 'token:1:9',
      tokenId: 9,
      allowedActionModes: input.actionModes ?? ['full_operational_access'],
      allowedHostIds: input.hostIds ?? [10],
    },
  } as unknown as FastifyRequest
}

describe('MCP guard governance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    env.MCP_INTERACTIVE_SSH_REQUIRE_ALLOWED_HOSTS = false
  })

  it('allows request_action_run mode when the persisted token permits it', async () => {
    await expect(assertMcpActionModeAuthorized(
      requestWithTokenModes(['diagnostic_only', 'full_operational_access']),
      'full_operational_access',
    )).resolves.toBeUndefined()

    expect(prisma.adminLog.create).not.toHaveBeenCalled()
  })

  it('allows lower-risk modes when the token permits a higher operational mode', async () => {
    const request = requestWithTokenModes(['full_operational_access'])

    await expect(assertMcpActionModeAuthorized(request, 'read_only')).resolves.toBeUndefined()
    await expect(assertMcpActionModeAuthorized(request, 'diagnostic_only')).resolves.toBeUndefined()
    await expect(assertMcpActionModeAuthorized(request, 'approval_required')).resolves.toBeUndefined()
  })

  it('denies request_action_run mode outside the persisted token allowlist and audits it', async () => {
    await expect(assertMcpActionModeAuthorized(
      requestWithTokenModes(['diagnostic_only']),
      'full_operational_access',
    )).rejects.toThrow(ForbiddenError)

    expect(prisma.adminLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: 2,
        action: 'MCP_DENIED',
        targetType: 'MCP',
        targetId: 0,
        details: expect.stringContaining('"mode":"full_operational_access"'),
      }),
    })
  })

  it('allows host access when the persisted token has no host restriction', async () => {
    await expect(assertMcpHostAuthorized(requestWithTokenHosts([]), 10)).resolves.toBeUndefined()
    expect(prisma.adminLog.create).not.toHaveBeenCalled()
  })

  it('denies host access outside the persisted token host allowlist and audits it', async () => {
    await expect(assertMcpHostAuthorized(
      requestWithTokenHosts([10, 11]),
      12,
      'open_interactive_ssh_session',
    )).rejects.toThrow(ForbiddenError)

    expect(prisma.adminLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: 2,
        action: 'MCP_DENIED',
        targetType: 'MCP',
        targetId: 0,
        details: expect.stringContaining('"hostId":12'),
      }),
    })
    expect(prisma.adminLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        details: expect.stringContaining('"capability":"open_interactive_ssh_session"'),
      }),
    })
  })

  it('allows interactive SSH only with persisted token and explicit full access', async () => {
    await expect(assertMcpInteractiveFullAccessAuthorized(
      interactiveRequest(),
      'open_interactive_ssh_session',
    )).resolves.toBeUndefined()

    expect(prisma.adminLog.create).not.toHaveBeenCalled()
  })

  it('denies interactive SSH when full access is not explicit and audits it', async () => {
    await expect(assertMcpInteractiveFullAccessAuthorized(
      interactiveRequest({ actionModes: ['diagnostic_only'] }),
      'open_interactive_ssh_session',
    )).rejects.toThrow(ForbiddenError)

    expect(prisma.adminLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: 2,
        action: 'MCP_DENIED',
        targetType: 'MCP',
        targetId: 0,
        details: expect.stringContaining('"capability":"open_interactive_ssh_session"'),
      }),
    })
  })

  it('can require explicit host allowlist for interactive SSH tokens', async () => {
    env.MCP_INTERACTIVE_SSH_REQUIRE_ALLOWED_HOSTS = true

    await expect(assertMcpInteractiveFullAccessAuthorized(
      interactiveRequest({ hostIds: [] }),
      'open_interactive_ssh_session',
    )).rejects.toThrow(ForbiddenError)

    expect(prisma.adminLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: 2,
        action: 'MCP_DENIED',
        targetType: 'MCP',
        targetId: 0,
        details: expect.stringContaining('hosts permitidos'),
      }),
    })
  })
})
