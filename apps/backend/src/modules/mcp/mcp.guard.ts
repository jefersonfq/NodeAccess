import type { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '../../config/database.js'
import { env } from '../../config/env.js'
import { redis } from '../../config/redis.js'
import { AppError, ForbiddenError, UnauthorizedError } from '../../shared/errors.js'
import { requireAuth, type JwtPayload } from '../../shared/guards.js'
import { getMcpCapability } from './mcp.capabilities.js'
import { McpTokenRepository } from './mcp-token.repository.js'

type McpAuthMode = 'jwt' | 'persisted_token' | 'static_token'

const mcpTokenRepository = new McpTokenRepository(prisma)

declare module 'fastify' {
  interface FastifyRequest {
    mcpAuth?: {
      mode: McpAuthMode
      principalKey: string
      tokenId?: number
      allowedCapabilities?: string[]
      allowedActionModes?: string[]
      allowedHostIds?: number[]
    }
  }
}

function extractBearerToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.slice('Bearer '.length).trim() || null
}

function parseJsonRecord(value: unknown): Record<string, boolean> {
  if (!value) return {}
  try {
    const parsed = typeof value === 'string'
      ? JSON.parse(value) as Record<string, unknown>
      : value as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed).map(([key, raw]) => [key, raw === true]),
    )
  } catch {
    return {}
  }
}

async function buildStaticTokenPrincipal(): Promise<JwtPayload> {
  if (!env.MCP_STATIC_TENANT_SLUG) {
    throw new UnauthorizedError('Tenant MCP nao configurado')
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug: env.MCP_STATIC_TENANT_SLUG },
    select: { id: true, active: true },
  })

  if (!tenant?.active) {
    throw new UnauthorizedError('Tenant MCP invalido ou inativo')
  }

  const adminUser = await prisma.user.findFirst({
    where: {
      tenantId: tenant.id,
      active: true,
      role: 'ADMIN',
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      email: true,
      canManageHosts: true,
      forcePasswordChange: true,
      isPlatformAdmin: true,
    },
  })

  if (!adminUser) {
    throw new UnauthorizedError('Nenhum admin ativo disponivel para MCP neste tenant')
  }

  return {
    sub: String(adminUser.id),
    email: adminUser.email,
    role: 'admin',
    isPlatformAdmin: adminUser.isPlatformAdmin,
    tenantId: tenant.id,
    canManageHosts: adminUser.canManageHosts,
    canViewLiveSessions: true,
    forcePasswordChange: adminUser.forcePasswordChange,
    stage: 'authenticated',
  }
}

async function assertMcpLicensed(tenantId: number): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ featureEntitlementsJson: unknown }>>`
    SELECT feature_entitlements_json AS featureEntitlementsJson
    FROM licenses
    WHERE tenant_id = ${tenantId}
    LIMIT 1
  `

  const entitlements = parseJsonRecord(rows[0]?.featureEntitlementsJson)
  if (entitlements.mcp !== true) {
    throw new ForbiddenError('MCP nao esta licenciado para este tenant')
  }
}

export async function requireMcpAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!env.FEATURE_MCP) {
    throw new ForbiddenError('MCP desabilitado neste ambiente')
  }

  try {
    await requireAuth(request, reply)
    await assertMcpLicensed(request.jwtUser!.tenantId)
    request.mcpAuth = {
      mode: 'jwt',
      principalKey: `jwt:${request.jwtUser!.tenantId}:${request.jwtUser!.sub}`,
    }
    return
  } catch {
    // fallback para token tecnico
  }

  const bearerToken = extractBearerToken(request)
  const headerToken = typeof request.headers['x-mcp-token'] === 'string'
    ? request.headers['x-mcp-token'].trim()
    : null
  const providedToken = headerToken || bearerToken

  if (!providedToken) {
    throw new UnauthorizedError('Token MCP invalido')
  }

  const persisted = await mcpTokenRepository.authenticate(providedToken)
  if (persisted) {
    if (!persisted.createdBy.active) {
      throw new UnauthorizedError('Usuario do token MCP esta inativo')
    }

    request.jwtUser = {
      sub: String(persisted.createdBy.id),
      email: persisted.createdBy.email,
      role: persisted.createdBy.role,
      isPlatformAdmin: persisted.createdBy.isPlatformAdmin,
      tenantId: persisted.tenantId,
      canManageHosts: persisted.createdBy.canManageHosts,
      canViewLiveSessions: persisted.createdBy.role === 'admin',
      forcePasswordChange: persisted.createdBy.forcePasswordChange,
      stage: 'authenticated',
    }
    request.mcpAuth = {
      mode: 'persisted_token',
      principalKey: `token:${persisted.tenantId}:${persisted.id}`,
      tokenId: persisted.id,
      allowedCapabilities: persisted.allowedCapabilities,
      allowedActionModes: persisted.allowedActionModes,
      allowedHostIds: persisted.allowedHostIds,
    }
    await assertMcpLicensed(persisted.tenantId)
    await mcpTokenRepository.touchLastUsed(persisted.id)
    return
  }

  if (!env.MCP_STATIC_TOKEN || providedToken !== env.MCP_STATIC_TOKEN) {
    throw new UnauthorizedError('Token MCP invalido')
  }

  request.jwtUser = await buildStaticTokenPrincipal()
  await assertMcpLicensed(request.jwtUser.tenantId)
  request.mcpAuth = {
    mode: 'static_token',
    principalKey: `static:${request.jwtUser.tenantId}:${request.jwtUser.sub}`,
  }
}

function parseAllowedCapabilities(): Set<string> | null {
  const raw = env.MCP_ALLOWED_CAPABILITIES?.trim()
  if (!raw) return null
  const items = raw.split(',').map((item) => item.trim()).filter(Boolean)
  return items.length ? new Set(items) : null
}

async function auditMcpDenied(
  request: FastifyRequest,
  details: Record<string, unknown>,
  error: unknown,
): Promise<void> {
  const user = request.jwtUser
  if (!user?.sub) return

  const appError = error instanceof AppError ? error : null
  await prisma.adminLog.create({
    data: {
      adminId: Number(user.sub),
      action: appError?.code === 'MCP_RATE_LIMITED' ? 'MCP_RATE_LIMITED' : 'MCP_DENIED',
      targetType: 'MCP',
      targetId: 0,
      details: JSON.stringify({
        tenantId: user.tenantId,
        role: user.role,
        authMode: request.mcpAuth?.mode ?? 'jwt',
        ...(request.mcpAuth?.tokenId ? { tokenId: request.mcpAuth.tokenId } : {}),
        ip: request.ip,
        statusCode: appError?.statusCode ?? 500,
        code: appError?.code ?? 'MCP_DENIED',
        message: error instanceof Error ? error.message : 'MCP request denied',
        ...details,
      }),
    },
  }).catch(() => {})
}

async function enforceCapabilityAllowed(capability: string): Promise<void> {
  if (!getMcpCapability(capability)) {
    throw new ForbiddenError('Capability MCP desconhecida')
  }

  const allowed = parseAllowedCapabilities()
  if (allowed && !allowed.has(capability)) {
    throw new ForbiddenError(`Capability MCP bloqueada: ${capability}`)
  }
}

async function enforceRateLimit(request: FastifyRequest, capability: string): Promise<void> {
  const principalKey = request.mcpAuth?.principalKey ?? `anon:${request.ip}`
  const key = `mcp:rate:${principalKey}:${capability}`
  try {
    const count = await redis.incr(key)
    if (count === 1) {
      await redis.expire(key, env.MCP_RATE_LIMIT_WINDOW_SECONDS)
    }
    if (count > env.MCP_RATE_LIMIT_MAX_REQUESTS) {
      throw new AppError('Rate limit do MCP excedido', 429, 'MCP_RATE_LIMITED')
    }
  } catch (error) {
    if (error instanceof AppError) throw error
  }
}

export async function assertMcpCapabilityAuthorized(request: FastifyRequest, capability: string): Promise<void> {
  try {
    await enforceCapabilityAllowed(capability)
    const tokenCapabilities = request.mcpAuth?.allowedCapabilities
    if (tokenCapabilities && tokenCapabilities.length > 0 && !tokenCapabilities.includes(capability)) {
      throw new ForbiddenError(`Capability MCP nao permitida para este token: ${capability}`)
    }
    await enforceRateLimit(request, capability)
    request.log.info({
      capability,
      tenantId: request.jwtUser?.tenantId,
      userId: request.jwtUser?.sub,
      authMode: request.mcpAuth?.mode,
    }, 'MCP capability autorizada')
  } catch (error) {
    await auditMcpDenied(request, { capability }, error)
    throw error
  }
}

export async function assertMcpActionModeAuthorized(request: FastifyRequest, mode: string): Promise<void> {
  try {
    const tokenModes = request.mcpAuth?.allowedActionModes
    if (tokenModes && tokenModes.length > 0 && !tokenModes.includes(mode)) {
      throw new ForbiddenError(`Modo de ActionRun nao permitido para este token MCP: ${mode}`)
    }
  } catch (error) {
    await auditMcpDenied(request, { capability: 'request_action_run', mode }, error)
    throw error
  }
}

export async function assertMcpHostAuthorized(request: FastifyRequest, hostId: number, capability = 'request_action_run'): Promise<void> {
  try {
    const tokenHostIds = request.mcpAuth?.allowedHostIds
    if (tokenHostIds && tokenHostIds.length > 0 && !tokenHostIds.includes(hostId)) {
      throw new ForbiddenError(`Host nao permitido para este token MCP: ${hostId}`)
    }
  } catch (error) {
    await auditMcpDenied(request, { capability, hostId }, error)
    throw error
  }
}

export async function assertMcpInteractiveFullAccessAuthorized(request: FastifyRequest, capability: string): Promise<void> {
  try {
    if (request.jwtUser?.role !== 'admin') {
      throw new ForbiddenError('SSH interativo via MCP exige perfil administrativo')
    }
    if (request.mcpAuth?.mode !== 'persisted_token') {
      throw new ForbiddenError('SSH interativo via MCP exige token MCP persistido')
    }
    const tokenModes = request.mcpAuth?.allowedActionModes
    if (!tokenModes?.includes('full_operational_access')) {
      throw new ForbiddenError('SSH interativo via MCP exige full_operational_access explicitamente permitido no token')
    }
    if (env.MCP_INTERACTIVE_SSH_REQUIRE_ALLOWED_HOSTS && !request.mcpAuth.allowedHostIds?.length) {
      throw new ForbiddenError('SSH interativo via MCP exige hosts permitidos explicitamente no token')
    }
  } catch (error) {
    await auditMcpDenied(request, { capability, mode: 'full_operational_access' }, error)
    throw error
  }
}

export function requireMcpCapability(capability: string) {
  return async function mcpCapabilityGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await requireMcpAuth(request, reply)
    await assertMcpCapabilityAuthorized(request, capability)
  }
}
