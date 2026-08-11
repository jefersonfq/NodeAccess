import type { FastifyRequest, FastifyReply } from 'fastify'
import type { LoginDto, VerifyTotpDto, GoogleLoginDto } from '@nodeaccess/shared'
import type { AuthService } from './auth.service.js'
import type { AuthRateLimitService } from './auth-rate-limit.service.js'
import { env } from '../../config/env.js'

function meta(request: FastifyRequest) {
  const userAgent = request.headers['user-agent']
  return {
    ip:        request.ip,
    ...(userAgent ? { userAgent } : {}),
  }
}

export function normalizeSlug(raw: string): string {
  return raw.trim().toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '') || 'default'
}

function hostnameToSlug(host: string): string {
  const h = host.trim().toLowerCase().split(':')[0] ?? ''
  const base = env.TENANT_BASE_DOMAIN?.trim().toLowerCase()

  // With TENANT_BASE_DOMAIN=nodeaccess.com.br:
  //   jeferson.nodeaccess.com.br → "jeferson"
  //   marcos.nodeaccess.com.br   → "marcos"
  //   nodeaccess.com.br          → "nodeaccess-com-br" (root, no subdomain)
  if (base && h !== base && h.endsWith('.' + base)) {
    const sub = h.slice(0, -(base.length + 1))
    if (sub && !sub.includes('.')) {
      return normalizeSlug(sub)
    }
  }

  return normalizeSlug(h)
}

export function tenantSlug(request: FastifyRequest): string {
  // Body slug (selected by user in picker or typed) takes priority over nginx header
  const bodySlug = (request.body as Record<string, unknown> | undefined)?.tenantSlug
  if (typeof bodySlug === 'string' && bodySlug.trim()) {
    return normalizeSlug(bodySlug)
  }
  const querySlug = (request.query as Record<string, unknown> | undefined)?.tenantSlug
  if (typeof querySlug === 'string' && querySlug.trim()) {
    return normalizeSlug(querySlug)
  }
  const headerHost = request.headers['x-tenant-slug'] as string | undefined
  return headerHost ? hostnameToSlug(headerHost) : 'default'
}

export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly rateLimit: AuthRateLimitService,
  ) {}

  async lookupTenant(request: FastifyRequest<{ Body: { email: string } }>, reply: FastifyReply) {
    await this.rateLimit.check({ action: 'lookup', ip: request.ip, identity: request.body.email })
    const tenants = await this.authService.lookupTenantsByEmail(request.body.email)
    return reply.send({ tenants })
  }

  async login(request: FastifyRequest<{ Body: LoginDto }>, reply: FastifyReply) {
    const { email, password } = request.body
    const slug = tenantSlug(request)
    await this.rateLimit.check({ action: 'login', ip: request.ip, tenant: slug, identity: email })
    const result = await this.authService.login(email, password, slug, meta(request))
    return reply.send(result)
  }

  async setupTotp(
    request: FastifyRequest<{ Body: { setupToken: string } }>,
    reply: FastifyReply,
  ) {
    await this.rateLimit.check({ action: 'mfa', ip: request.ip, identity: request.body.setupToken })
    const result = await this.authService.setupTotp(request.body.setupToken)
    return reply.send(result)
  }

  async confirmTotp(
    request: FastifyRequest<{ Body: VerifyTotpDto }>,
    reply: FastifyReply,
  ) {
    const { token, setupToken } = request.body
    if (!setupToken) {
      return reply.status(400).send({ code: 'MISSING_SETUP_TOKEN', message: 'setupToken obrigatório' })
    }
    await this.rateLimit.check({ action: 'mfa', ip: request.ip, identity: setupToken })
    const result = await this.authService.confirmTotp(token, setupToken, meta(request))
    return reply.send(result)
  }

  async verifyTotp(
    request: FastifyRequest<{ Body: VerifyTotpDto & { tempToken: string } }>,
    reply: FastifyReply,
  ) {
    const { token, setupToken: tempToken } = request.body
    if (!tempToken) {
      return reply.status(400).send({ code: 'MISSING_TEMP_TOKEN', message: 'tempToken obrigatório' })
    }
    await this.rateLimit.check({ action: 'mfa', ip: request.ip, identity: tempToken })
    const result = await this.authService.verifyTotp(token, tempToken, meta(request))
    return reply.send(result)
  }

  async refresh(
    request: FastifyRequest<{ Body: { refreshToken: string } }>,
    reply: FastifyReply,
  ) {
    await this.rateLimit.check({ action: 'refresh', ip: request.ip, identity: request.body.refreshToken })
    const result = await this.authService.refresh(request.body.refreshToken)
    return reply.send(result)
  }

  async logout(
    request: FastifyRequest<{ Body: { refreshToken: string } }>,
    reply: FastifyReply,
  ) {
    await this.authService.logout(request.body.refreshToken)
    return reply.status(204).send()
  }

  async logoutAll(request: FastifyRequest, reply: FastifyReply) {
    const user = request.jwtUser!
    await this.authService.logoutAll(Number(user.sub), user.tenantId, user.sessionVersion ?? 0)
    return reply.status(204).send()
  }

  async requestEmailOtp(request: FastifyRequest<{ Body: { tempToken: string } }>, reply: FastifyReply) {
    await this.rateLimit.check({ action: 'email_otp', ip: request.ip, identity: request.body.tempToken })
    await this.authService.requestEmailOtp(request.body.tempToken)
    return reply.status(204).send()
  }

  async verifyEmailOtp(
    request: FastifyRequest<{ Body: { code: string; tempToken: string } }>,
    reply: FastifyReply,
  ) {
    await this.rateLimit.check({ action: 'email_otp', ip: request.ip, identity: request.body.tempToken })
    const result = await this.authService.verifyEmailOtp(request.body.code, request.body.tempToken, meta(request))
    return reply.send(result)
  }

  async googleConfig(request: FastifyRequest, reply: FastifyReply) {
    const querySlug = (request.query as { tenantSlug?: unknown } | undefined)?.tenantSlug
    const slug = typeof querySlug === 'string' && querySlug.trim()
      ? normalizeSlug(querySlug)
      : tenantSlug(request)
    const result = await this.authService.getGooglePublicConfig(slug)
    return reply.send(result)
  }

  async googleLogin(request: FastifyRequest<{ Body: GoogleLoginDto }>, reply: FastifyReply) {
    const slug = tenantSlug(request)
    await this.rateLimit.check({ action: 'google', ip: request.ip, tenant: slug })
    const result = await this.authService.loginWithGoogle(
      request.body.credential,
      slug,
      meta(request),
    )
    return reply.send(result)
  }

  async enterTenant(
    request: FastifyRequest<{ Body: { tenantId: number } }>,
    reply: FastifyReply,
  ) {
    const user = request.jwtUser!
    const result = await this.authService.enterTenantAsPlatformAdmin(
      Number(user.sub),
      user.tenantId,
      request.body.tenantId,
    )
    return reply.send(result)
  }

  async exitTenant(
    request: FastifyRequest<{ Body: { tenantId: number } }>,
    reply: FastifyReply,
  ) {
    await this.authService.exitTenantAsPlatformAdmin(Number(request.jwtUser!.sub), request.body.tenantId)
    return reply.status(204).send()
  }
}
