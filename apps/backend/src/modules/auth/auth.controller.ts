import type { FastifyRequest, FastifyReply } from 'fastify'
import type { LoginDto, VerifyTotpDto, GoogleLoginDto } from '@nodeaccess/shared'
import type { AuthService } from './auth.service.js'

function meta(request: FastifyRequest) {
  const userAgent = request.headers['user-agent']
  return {
    ip:        request.ip,
    ...(userAgent ? { userAgent } : {}),
  }
}

function tenantSlug(request: FastifyRequest): string {
  return (request.headers['x-tenant-slug'] as string | undefined) ?? 'default'
}

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  async login(request: FastifyRequest<{ Body: LoginDto }>, reply: FastifyReply) {
    const { email, password } = request.body
    const result = await this.authService.login(email, password, tenantSlug(request), meta(request))
    return reply.send(result)
  }

  async setupTotp(
    request: FastifyRequest<{ Body: { setupToken: string } }>,
    reply: FastifyReply,
  ) {
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
    const result = await this.authService.verifyTotp(token, tempToken, meta(request))
    return reply.send(result)
  }

  async refresh(
    request: FastifyRequest<{ Body: { refreshToken: string } }>,
    reply: FastifyReply,
  ) {
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

  async requestEmailOtp(request: FastifyRequest<{ Body: { tempToken: string } }>, reply: FastifyReply) {
    await this.authService.requestEmailOtp(request.body.tempToken)
    return reply.status(204).send()
  }

  async verifyEmailOtp(
    request: FastifyRequest<{ Body: { code: string; tempToken: string } }>,
    reply: FastifyReply,
  ) {
    const result = await this.authService.verifyEmailOtp(request.body.code, request.body.tempToken, meta(request))
    return reply.send(result)
  }

  async googleConfig(request: FastifyRequest, reply: FastifyReply) {
    const result = await this.authService.getGooglePublicConfig(tenantSlug(request))
    return reply.send(result)
  }

  async googleLogin(request: FastifyRequest<{ Body: GoogleLoginDto }>, reply: FastifyReply) {
    const result = await this.authService.loginWithGoogle(
      request.body.credential,
      tenantSlug(request),
      meta(request),
    )
    return reply.send(result)
  }
}
