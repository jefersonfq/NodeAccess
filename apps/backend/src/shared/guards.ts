import type { FastifyRequest, FastifyReply } from 'fastify'
import { UnauthorizedError, ForbiddenError } from './errors.js'

export interface JwtPayload {
  sub: string           // user id (stringificado)
  email: string
  role: 'admin' | 'user'
  isPlatformAdmin: boolean
  tenantId: number
  canManageHosts: boolean
  forcePasswordChange: boolean
  stage: 'authenticated'
}

export interface TempTokenPayload {
  sub: string
  tenantId: number
  stage: 'mfa_pending' | 'mfa_setup'
}

export interface RefreshTokenPayload {
  sub: string
  jti: string
  stage: 'refresh'
}

declare module 'fastify' {
  interface FastifyRequest {
    jwtUser?: JwtPayload
  }
}

export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  try {
    const payload = await request.jwtVerify<JwtPayload>()
    if (payload.stage !== 'authenticated') throw new Error('Invalid token stage')
    request.jwtUser = payload
  } catch {
    throw new UnauthorizedError()
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply)
  if (request.jwtUser?.role !== 'admin') {
    throw new ForbiddenError('Acesso restrito a administradores')
  }
}

export async function requirePlatformAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply)
  if (!request.jwtUser?.isPlatformAdmin) {
    throw new ForbiddenError('Acesso restrito a administradores da plataforma')
  }
}

export async function requireTenant(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const tenantSlug = request.headers['x-tenant-slug']
  if (!tenantSlug || typeof tenantSlug !== 'string') {
    throw new ForbiddenError('Tenant não identificado')
  }
}
