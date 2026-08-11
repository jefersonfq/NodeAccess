import jwt from 'jsonwebtoken'
import type { SignOptions } from 'jsonwebtoken'
import { randomUUID, randomInt, timingSafeEqual } from 'node:crypto'
import type { Redis } from 'ioredis'
import { env } from '../../config/env.js'
import {
  UnauthorizedError,
  AccountLockedError,
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
} from '../../shared/errors.js'
import type { UserRepository } from '../users/user.repository.js'
import type { User } from '@prisma/client'
import { avatarUrlFor } from '../users/avatar-url.js'
import type { TotpService } from './totp.service.js'
import type { GoogleService } from './google.service.js'
import type { IdentityProvider } from './identity-provider.js'
import type { AuthMethod, JwtPayload, TempTokenPayload, RefreshTokenPayload } from '../../shared/guards.js'
import type { EmailConfigService } from '../email/email-config.service.js'
import type { EmailService } from '../email/email.service.js'
import { LOGIN_REJECTED_MESSAGE, SSO_REJECTED_MESSAGE } from './auth-public-errors.js'

const MAX_FAILED_ATTEMPTS = 5
const LOCK_DURATION_MS    = 15 * 60 * 1000 // 15 minutos
const TEMP_TOKEN_TTL      = '5m'
const REFRESH_KEY_PREFIX  = 'refresh:'
const OTP_KEY_PREFIX           = 'otp:email:'
const OTP_RATE_KEY_PREFIX      = 'otp:rate:'
const OTP_TTL_SECONDS          = 10 * 60  // 10 minutos
const OTP_MAX_ATTEMPTS         = 3
const OTP_RESEND_COOLDOWN_SECS = 60       // cooldown entre reenvios
const OTP_RATE_MAX             = 5        // máximo de envios por janela
const OTP_RATE_WINDOW_SECS     = 15 * 60  // janela de 15 minutos

function withOptionalMeta(meta: { ip?: string; userAgent?: string }) {
  return {
    ...(meta.ip ? { ip: meta.ip } : {}),
    ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
  }
}

function signOptionsWithExpiry(expiresIn: string | number): SignOptions {
  return { expiresIn } as unknown as SignOptions
}

export interface LoginResult {
  tempToken:         string
  requiresMfaSetup:  boolean
  emailOtpAvailable: boolean
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export interface TenantDelegationToken {
  accessToken: string
  tenant: {
    id: number
    name: string
    slug: string
  }
}

export interface PasswordLoginPolicyProvider {
  getPasswordLoginMode(tenantId: number, email: string): Promise<'standard' | 'break_glass' | 'ldap_only' | 'blocked'>
  isEmailTenantDiscoveryEnabled?(tenantId: number): Promise<boolean>
  getPasswordLockoutPolicy?(tenantId: number): Promise<{ maxAttempts: number; durationMinutes: number }>
  getTokenLifetimePolicy?(tenantId: number): Promise<{
    accessTokenSeconds: number
    refreshTokenSeconds: number
  }>
  canRefreshSession?(tenantId: number, email: string, authMethod?: AuthMethod): Promise<boolean>
}

export interface TotpSetupResult {
  qrCode: string
}

export class AuthService {
  constructor(
    private readonly userRepo:            UserRepository,
    private readonly totpService:         TotpService,
    private readonly redis:               Redis,
    private readonly googleService?:      GoogleService,
    private readonly emailConfigService?: EmailConfigService,
    private readonly emailService?:       EmailService,
    private readonly localIdentityProvider?: IdentityProvider,
    private readonly ldapIdentityProvider?:  IdentityProvider,
    private readonly passwordLoginPolicy?: PasswordLoginPolicyProvider,
  ) {}

  // ---------------------------------------------------------------------------
  // Tenant lookup por e-mail — usado no fluxo email-first do login
  // ---------------------------------------------------------------------------

  async lookupTenantsByEmail(email: string): Promise<{ name: string; slug: string }[]> {
    const tenants = await this.userRepo.findTenantsByEmail(email)
    const policy = this.passwordLoginPolicy
    if (!policy?.isEmailTenantDiscoveryEnabled) return tenants.map(({ name, slug }) => ({ name, slug }))

    const visibility = await Promise.all(tenants.map(async (tenant) => ({
      tenant,
      visible: await policy.isEmailTenantDiscoveryEnabled!(tenant.id).catch(() => false),
    })))
    return visibility
      .filter(({ visible }) => visible)
      .map(({ tenant: { name, slug } }) => ({ name, slug }))
  }

  // ---------------------------------------------------------------------------
  // Tenant resolution — sempre exata para evitar autenticar no contexto errado
  // ---------------------------------------------------------------------------

  private async resolveTenant(slug: string) {
    return this.userRepo.findTenantBySlug(slug)
  }

  // ---------------------------------------------------------------------------
  // Login — passo 1: valida e-mail e senha
  // ---------------------------------------------------------------------------

  async login(
    email: string,
    password: string,
    tenantSlug: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<LoginResult> {
    const tenant = await this.resolveTenant(tenantSlug)
    if (!tenant?.active) throw new UnauthorizedError(LOGIN_REJECTED_MESSAGE)

    const passwordLoginMode = this.passwordLoginPolicy
      ? await this.passwordLoginPolicy.getPasswordLoginMode(tenant.id, email)
      : 'standard'
    if (passwordLoginMode === 'blocked') {
      await this.userRepo.logAuthEvent({ eventType: 'LOGIN_FAILED', ...withOptionalMeta(meta), success: false })
      throw new UnauthorizedError(LOGIN_REJECTED_MESSAGE)
    }

    let authn
    let authMethod: AuthMethod
    if (passwordLoginMode === 'ldap_only') {
      if (!this.ldapIdentityProvider) {
        await this.userRepo.logAuthEvent({ eventType: 'LOGIN_FAILED', ...withOptionalMeta(meta), success: false })
        throw new UnauthorizedError(LOGIN_REJECTED_MESSAGE)
      }
      authn = await this.ldapIdentityProvider.authenticate({ tenantId: tenant.id, email, password })
      authMethod = 'ldap'
    } else {
      const localIdentityProvider = this.localIdentityProvider
      authn = localIdentityProvider
        ? await localIdentityProvider.authenticate({ tenantId: tenant.id, email, password })
        : await this.authenticateLocalFallback(tenant.id, email, password)
      authMethod = passwordLoginMode === 'break_glass' ? 'break_glass' : 'local'

      if (!authn.passwordValid && this.ldapIdentityProvider && passwordLoginMode === 'standard') {
        const ldapAuthn = await this.ldapIdentityProvider.authenticate({ tenantId: tenant.id, email, password })
        if (ldapAuthn.passwordValid || !authn.user) {
          authn = ldapAuthn
          authMethod = 'ldap'
        }
      }
    }

    const user = authn.user

    // Usuário não encontrado — mesmo erro genérico para não revelar existência
    if (!user || !user.active || user.deletedAt || user.tenantId !== tenant.id) {
      await this.userRepo.logAuthEvent({
        eventType: 'LOGIN_FAILED',
        ...withOptionalMeta(meta),
        success: false,
      })
      throw new UnauthorizedError(LOGIN_REJECTED_MESSAGE)
    }

    // Senha inválida
    if (!authn.passwordValid) {
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        await this.userRepo.logAuthEvent({
          userId: user.id,
          eventType: 'LOGIN_BLOCKED',
          ...withOptionalMeta(meta),
          success: false,
        })
        throw new UnauthorizedError(LOGIN_REJECTED_MESSAGE)
      }
      const lockoutPolicy = await this.passwordLoginPolicy?.getPasswordLockoutPolicy?.(tenant.id)
        .catch(() => null)
      const maxAttempts = lockoutPolicy?.maxAttempts ?? MAX_FAILED_ATTEMPTS
      const durationMs = (lockoutPolicy?.durationMinutes ?? (LOCK_DURATION_MS / 60_000)) * 60_000
      const attempts = await this.userRepo.incrementFailedAttempts(user.id)
      if (attempts >= maxAttempts) {
        await this.userRepo.lockAccount(user.id, new Date(Date.now() + durationMs))
        await this.userRepo.logAuthEvent({
          userId: user.id,
          eventType: 'LOGIN_BLOCKED',
          ...withOptionalMeta(meta),
          success: false,
        })
        throw new UnauthorizedError(LOGIN_REJECTED_MESSAGE)
      }
      await this.userRepo.logAuthEvent({
        userId: user.id,
        eventType: 'LOGIN_FAILED',
        ...withOptionalMeta(meta),
        success: false,
      })
      throw new UnauthorizedError(LOGIN_REJECTED_MESSAGE)
    }

    // Somente credenciais corretas recebem o diagnóstico de conta bloqueada.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.userRepo.logAuthEvent({
        userId: user.id,
        eventType: 'LOGIN_BLOCKED',
        ...withOptionalMeta(meta),
        success: false,
      })
      throw new AccountLockedError()
    }

    await this.userRepo.resetFailedAttempts(user.id)

    return this.beginMfaForUser(user, tenant.id, authMethod)
  }

  async beginMfaForUser(user: User, tenantId: number, authMethod: AuthMethod): Promise<LoginResult> {
    if (!user.active || user.deletedAt || user.tenantId !== tenantId) throw new UnauthorizedError()
    const requiresMfaSetup = !user.mfaEnabled
    const stage = requiresMfaSetup ? 'mfa_setup' : 'mfa_pending'
    const tempPayload: TempTokenPayload = { sub: String(user.id), tenantId, authMethod, stage }
    const tempToken = jwt.sign(tempPayload, env.JWT_SECRET, signOptionsWithExpiry(TEMP_TOKEN_TTL))
    const emailOtpAvailable = this.emailConfigService
      ? (await this.emailConfigService.getTransportConfig(tenantId)) !== null
      : false
    return { tempToken, requiresMfaSetup, emailOtpAvailable }
  }

  // ---------------------------------------------------------------------------
  // Setup TOTP — retorna QR code para o frontend exibir
  // ---------------------------------------------------------------------------

  async setupTotp(setupToken: string): Promise<TotpSetupResult> {
    const { user } = await this.resolveTempTokenUser(setupToken, 'mfa_setup')

    const { secret, qrCode: otpauth } = this.totpService.generateSetup(user.email)
    await this.userRepo.saveMfaSecret(user.id, secret)
    const qrCode = await this.totpService.toQrDataUrl(otpauth)

    return { qrCode }
  }

  // ---------------------------------------------------------------------------
  // Confirm TOTP setup — ativa MFA e emite tokens definitivos
  // ---------------------------------------------------------------------------

  async confirmTotp(
    token: string,
    setupToken: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<AuthTokens> {
    const { payload, user } = await this.resolveTempTokenUser(setupToken, 'mfa_setup')
    if (!user?.mfaSecret) throw new UnauthorizedError()

    const valid = this.totpService.verify(user.mfaSecret, token)
    if (!valid) {
      await this.userRepo.logAuthEvent({
        userId: user.id,
        eventType: 'MFA_FAILED',
        ...withOptionalMeta(meta),
        success: false,
      })
      throw new ForbiddenError('Código TOTP inválido')
    }

    await this.userRepo.enableMfa(user.id, user.mfaSecret)
    await this.userRepo.logAuthEvent({
      userId: user.id,
      eventType: 'MFA_VERIFIED',
      ...withOptionalMeta(meta),
      success: true,
    })

    const isPlatformAdmin = await this.userRepo.isPlatformAdmin(user.id)
    const canViewLiveSessions = await this.userRepo.canViewLiveSessions(user.id)
    return this.issueTokens(user.id, user.email, user.role, isPlatformAdmin, payload.tenantId, user.canManageHosts, canViewLiveSessions, user.forcePasswordChange, payload.authMethod ?? 'local')
  }

  // ---------------------------------------------------------------------------
  // Verify TOTP — valida código de usuário com MFA já configurado
  // ---------------------------------------------------------------------------

  async verifyTotp(
    token: string,
    tempToken: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<AuthTokens> {
    const { payload, user } = await this.resolveTempTokenUser(tempToken, 'mfa_pending')
    if (!user?.mfaSecret || !user.mfaEnabled) throw new UnauthorizedError()

    const valid = this.totpService.verify(user.mfaSecret, token)
    if (!valid) {
      await this.userRepo.logAuthEvent({
        userId: user.id,
        eventType: 'MFA_FAILED',
        ...withOptionalMeta(meta),
        success: false,
      })
      throw new ForbiddenError('Código TOTP inválido')
    }

    await this.userRepo.logAuthEvent({
      userId: user.id,
      eventType: 'LOGIN',
      ...withOptionalMeta(meta),
      success: true,
    })

    const isPlatformAdmin = await this.userRepo.isPlatformAdmin(user.id)
    const canViewLiveSessions = await this.userRepo.canViewLiveSessions(user.id)
    return this.issueTokens(user.id, user.email, user.role, isPlatformAdmin, payload.tenantId, user.canManageHosts, canViewLiveSessions, user.forcePasswordChange, payload.authMethod ?? 'local')
  }

  // ---------------------------------------------------------------------------
  // Refresh — emite novo access token a partir do refresh token
  // ---------------------------------------------------------------------------

  async refresh(refreshToken: string): Promise<Pick<AuthTokens, 'accessToken'>> {
    let payload: RefreshTokenPayload
    try {
      payload = jwt.verify(refreshToken, env.JWT_SECRET) as RefreshTokenPayload
    } catch {
      throw new UnauthorizedError('Refresh token inválido ou expirado')
    }

    if (payload.stage !== 'refresh') throw new UnauthorizedError()

    const refreshKey = `${REFRESH_KEY_PREFIX}${payload.jti}`
    const stored = await this.redis.get(refreshKey)
    if (!stored) throw new UnauthorizedError('Refresh token revogado')

    const tenantId = Number(stored)
    const revokeAndReject = async (): Promise<never> => {
      await this.redis.del(refreshKey).catch(() => {})
      throw new UnauthorizedError('Refresh token revogado')
    }

    if (!Number.isSafeInteger(tenantId) || tenantId <= 0) return revokeAndReject()

    const userId = Number(payload.sub)
    if (!Number.isSafeInteger(userId) || userId <= 0) return revokeAndReject()

    const tenant = await this.userRepo.findTenantById(tenantId)
    if (!tenant?.active) return revokeAndReject()

    const user = await this.userRepo.findByIdInTenant(userId, tenantId)
    if (!user?.active) return revokeAndReject()
    const sessionVersion = await this.userRepo.findSessionVersion(userId, tenantId)
    if (sessionVersion === null || (payload.sessionVersion ?? 0) !== sessionVersion) return revokeAndReject()

    const canRefresh = await this.passwordLoginPolicy?.canRefreshSession?.(
      tenantId,
      user.email,
      payload.authMethod,
    ).catch(() => false)
    if (canRefresh === false) return revokeAndReject()

    const isPlatformAdmin = await this.userRepo.isPlatformAdmin(user.id)
    const canViewLiveSessions = await this.userRepo.canViewLiveSessions(user.id)
    const avatar = await this.userRepo.findAvatarMetadata(user.id, tenantId)

    const accessPayload: JwtPayload = {
      sub: String(user.id),
      email: user.email,
      role: user.role === 'ADMIN' ? 'admin' : 'user',
      isPlatformAdmin,
      tenantId,
      canManageHosts: user.canManageHosts,
      canViewLiveSessions,
      avatarUrl: avatarUrlFor(user.id, avatar?.avatarUpdatedAt),
      avatarVersion: avatar?.avatarUpdatedAt ? String(avatar.avatarUpdatedAt.getTime()) : null,
      forcePasswordChange: user.forcePasswordChange,
      sessionVersion,
      stage: 'authenticated',
    }

    const tokenLifetime = await this.getTokenLifetimePolicy(tenantId)
    const accessToken = jwt.sign(
      accessPayload,
      env.JWT_SECRET,
      signOptionsWithExpiry(tokenLifetime.accessTokenExpiresIn),
    )
    return { accessToken }
  }

  async enterTenantAsPlatformAdmin(
    platformAdminId: number,
    currentTenantId: number,
    targetTenantId: number,
  ): Promise<TenantDelegationToken> {
    const user = await this.userRepo.findById(platformAdminId)
    if (!user?.active) throw new UnauthorizedError()

    const isPlatformAdmin = await this.userRepo.isPlatformAdmin(platformAdminId)
    if (!isPlatformAdmin) throw new ForbiddenError('Acesso restrito a administradores da plataforma')

    const tenant = await this.userRepo.findTenantById(targetTenantId)
    if (!tenant?.active) throw new NotFoundError('Tenant')

    await this.userRepo.logAdminEvent({
      adminId: platformAdminId,
      action: 'ENTER_TENANT_AS_PLATFORM_ADMIN',
      targetType: 'Tenant',
      targetId: tenant.id,
      details: JSON.stringify({ tenantSlug: tenant.slug, fromTenantId: currentTenantId }),
    }).catch(() => {})

    const accessPayload: JwtPayload = {
      sub: String(user.id),
      email: user.email,
      role: 'admin',
      isPlatformAdmin: true,
      tenantId: tenant.id,
      platformTenantId: currentTenantId,
      actingTenantId: tenant.id,
      impersonatedByUserId: user.id,
      canManageHosts: true,
      canViewLiveSessions: true,
      forcePasswordChange: false,
      stage: 'authenticated',
    }

    const tokenLifetime = await this.getTokenLifetimePolicy(tenant.id)
    const accessToken = jwt.sign(
      accessPayload,
      env.JWT_SECRET,
      signOptionsWithExpiry(tokenLifetime.accessTokenExpiresIn),
    )
    return {
      accessToken,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
      },
    }
  }

  async exitTenantAsPlatformAdmin(platformAdminId: number, targetTenantId: number): Promise<void> {
    const user = await this.userRepo.findById(platformAdminId)
    if (!user?.active) throw new UnauthorizedError()

    const isPlatformAdmin = await this.userRepo.isPlatformAdmin(platformAdminId)
    if (!isPlatformAdmin) throw new ForbiddenError('Acesso restrito a administradores da plataforma')

    await this.userRepo.logAdminEvent({
      adminId: platformAdminId,
      action: 'EXIT_TENANT_AS_PLATFORM_ADMIN',
      targetType: 'Tenant',
      targetId: targetTenantId,
    }).catch(() => {})
  }

  // ---------------------------------------------------------------------------
  // Logout — revoga o refresh token no Redis
  // ---------------------------------------------------------------------------

  async logout(refreshToken: string): Promise<void> {
    try {
      const payload = jwt.verify(refreshToken, env.JWT_SECRET) as RefreshTokenPayload
      if (payload.stage === 'refresh') {
        await this.redis.del(`${REFRESH_KEY_PREFIX}${payload.jti}`)
      }
    } catch {
      // Token já expirado ou inválido — não é erro de negócio
    }
  }

  async logoutAll(userId: number, tenantId: number, expectedSessionVersion: number): Promise<void> {
    const currentSessionVersion = await this.userRepo.findSessionVersion(userId, tenantId)
    if (currentSessionVersion === null || currentSessionVersion !== expectedSessionVersion) {
      throw new UnauthorizedError()
    }
    const sessionVersion = await this.userRepo.incrementSessionVersion(userId, tenantId)
    if (sessionVersion === null) throw new UnauthorizedError()
  }

  async issueTokensForUser(user: User, tenantId: number, authMethod: AuthMethod): Promise<AuthTokens> {
    if (!user.active || user.deletedAt || user.tenantId !== tenantId) throw new UnauthorizedError()
    const [isPlatformAdmin, canViewLiveSessions] = await Promise.all([
      this.userRepo.isPlatformAdmin(user.id),
      this.userRepo.canViewLiveSessions(user.id),
    ])
    return this.issueTokens(
      user.id,
      user.email,
      user.role,
      isPlatformAdmin,
      tenantId,
      user.canManageHosts,
      canViewLiveSessions,
      user.forcePasswordChange,
      authMethod,
    )
  }

  // ---------------------------------------------------------------------------
  // Google OAuth — emite tokens direto (SSO bypassa TOTP)
  // ---------------------------------------------------------------------------

  async getGooglePublicConfig(tenantSlug: string): Promise<{ enabled: boolean; clientId: string | null }> {
    if (!this.googleService) return { enabled: false, clientId: null }
    const tenant = await this.resolveTenant(tenantSlug)
    if (!tenant) return { enabled: false, clientId: null }
    return this.googleService.getPublicConfig(tenant.id)
  }

  async loginWithGoogle(
    idToken:    string,
    tenantSlug: string,
    meta:       { ip?: string; userAgent?: string },
  ): Promise<AuthTokens> {
    if (!this.googleService) throw new UnauthorizedError(SSO_REJECTED_MESSAGE)

    const tenant = await this.resolveTenant(tenantSlug)
    if (!tenant?.active) throw new UnauthorizedError(SSO_REJECTED_MESSAGE)

    const config = await this.googleService.getConfig(tenant.id)
    if (!config?.clientId) throw new UnauthorizedError(SSO_REJECTED_MESSAGE)

    const tokenInfo = await this.googleService.verifyIdToken(idToken, config.clientId)

    // Domain restriction (G Suite hosted domain)
    if (config.domain && tokenInfo.hd !== config.domain) {
      throw new UnauthorizedError(SSO_REJECTED_MESSAGE)
    }

    // Find by googleId → then try link by email → then auto-provision
    let user = await this.userRepo.findByGoogleId(tokenInfo.sub, tenant.id)

    if (!user) {
      const byEmail = await this.userRepo.findByEmail(tokenInfo.email, tenant.id)
      if (byEmail) {
        await this.userRepo.linkGoogleId(byEmail.id, tokenInfo.sub)
        user = { ...byEmail, googleId: tokenInfo.sub }
      } else if (config.autoProvision) {
        user = await this.userRepo.createGoogleUser({
          name:     tokenInfo.name ?? tokenInfo.email,
          email:    tokenInfo.email,
          googleId: tokenInfo.sub,
          tenantId: tenant.id,
        })
      } else {
        await this.userRepo.logAuthEvent({
          eventType: 'LOGIN_FAILED', ...withOptionalMeta(meta), success: false,
        })
        throw new UnauthorizedError(SSO_REJECTED_MESSAGE)
      }
    }

    if (!user.active) {
      await this.userRepo.logAuthEvent({
        userId: user.id, eventType: 'LOGIN_BLOCKED', ...withOptionalMeta(meta), success: false,
      })
      throw new UnauthorizedError(SSO_REJECTED_MESSAGE)
    }

    await this.userRepo.logAuthEvent({
      userId: user.id, eventType: 'SSO_LOGIN', ...withOptionalMeta(meta), success: true,
    })

    const isPlatformAdmin = await this.userRepo.isPlatformAdmin(user.id)
    const canViewLiveSessions = await this.userRepo.canViewLiveSessions(user.id)
    return this.issueTokens(user.id, user.email, user.role, isPlatformAdmin, tenant.id, user.canManageHosts, canViewLiveSessions, user.forcePasswordChange, 'google')
  }

  // ---------------------------------------------------------------------------
  // Email OTP — recuperação MFA
  // ---------------------------------------------------------------------------

  async requestEmailOtp(tempToken: string): Promise<void> {
    if (!this.emailConfigService || !this.emailService) {
      throw new ForbiddenError('Serviço de email não configurado')
    }

    const { payload, user } = await this.resolveTempTokenUser(tempToken, 'mfa_pending')

    // Rate limit: máximo OTP_RATE_MAX envios por OTP_RATE_WINDOW_SECS por usuário
    const rateKey = `${OTP_RATE_KEY_PREFIX}${user.id}`
    const count   = await this.redis.incr(rateKey)
    if (count === 1) await this.redis.expire(rateKey, OTP_RATE_WINDOW_SECS)
    if (count > OTP_RATE_MAX) {
      throw new TooManyRequestsError('Muitas solicitações de código. Tente novamente em 15 minutos.')
    }

    // Cooldown: rejeita novo envio se OTP anterior ainda tiver mais de (TTL - cooldown) segundos
    const existingTtl = await this.redis.ttl(`${OTP_KEY_PREFIX}${user.id}`)
    if (existingTtl > OTP_TTL_SECONDS - OTP_RESEND_COOLDOWN_SECS) {
      throw new TooManyRequestsError('Aguarde 60 segundos antes de solicitar um novo código.')
    }

    const transport = await this.emailConfigService.getTransportConfig(payload.tenantId)
    if (!transport) throw new NotFoundError('Configuração de email do tenant')

    const code = String(randomInt(100000, 1000000))

    await this.redis.set(
      `${OTP_KEY_PREFIX}${user.id}`,
      JSON.stringify({ code, attempts: OTP_MAX_ATTEMPTS }),
      'EX',
      OTP_TTL_SECONDS,
    )

    await this.emailService.send(transport, {
      to:      user.email,
      subject: 'Seu código de acesso — NodeAccess',
      text:    `Seu código de verificação é: ${code}\n\nEle expira em 10 minutos. Não compartilhe com ninguém.`,
    })
  }

  async verifyEmailOtp(
    code: string,
    tempToken: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<AuthTokens> {
    const { payload, user } = await this.resolveTempTokenUser(tempToken, 'mfa_pending')
    const userId = user.id

    const raw = await this.redis.get(`${OTP_KEY_PREFIX}${userId}`)
    if (!raw) {
      throw new ForbiddenError('Código expirado ou não solicitado')
    }

    const stored = JSON.parse(raw) as { code: string; attempts: number }

    // timing-safe compare
    const inputBuf  = Buffer.from(code.padEnd(6))
    const storedBuf = Buffer.from(stored.code.padEnd(6))
    const match = inputBuf.length === storedBuf.length && timingSafeEqual(inputBuf, storedBuf)

    if (!match) {
      stored.attempts -= 1
      if (stored.attempts <= 0) {
        await this.redis.del(`${OTP_KEY_PREFIX}${userId}`)
        await this.userRepo.logAuthEvent({ userId, eventType: 'MFA_FAILED', ...withOptionalMeta(meta), success: false })
        throw new ForbiddenError('Código inválido. Solicite um novo código.')
      }
      await this.redis.set(`${OTP_KEY_PREFIX}${userId}`, JSON.stringify(stored), 'EX', OTP_TTL_SECONDS)
      await this.userRepo.logAuthEvent({ userId, eventType: 'MFA_FAILED', ...withOptionalMeta(meta), success: false })
      throw new ForbiddenError(`Código inválido. ${stored.attempts} tentativa(s) restante(s).`)
    }

    await this.redis.del(`${OTP_KEY_PREFIX}${userId}`)
    await this.userRepo.logAuthEvent({ userId, eventType: 'LOGIN', ...withOptionalMeta(meta), success: true })

    const isPlatformAdmin = await this.userRepo.isPlatformAdmin(userId)
    const canViewLiveSessions = await this.userRepo.canViewLiveSessions(user.id)
    return this.issueTokens(user.id, user.email, user.role, isPlatformAdmin, payload.tenantId, user.canManageHosts, canViewLiveSessions, user.forcePasswordChange, payload.authMethod ?? 'local')
  }

  // ---------------------------------------------------------------------------
  // Helpers privados
  // ---------------------------------------------------------------------------

  private verifyTempToken(token: string, expectedStage: TempTokenPayload['stage']): TempTokenPayload {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as TempTokenPayload
      if (payload.stage !== expectedStage) throw new Error('Invalid stage')
      return payload
    } catch {
      throw new UnauthorizedError('Token temporário inválido ou expirado')
    }
  }

  private async resolveTempTokenUser(
    token: string,
    expectedStage: TempTokenPayload['stage'],
  ): Promise<{ payload: TempTokenPayload; user: User }> {
    const payload = this.verifyTempToken(token, expectedStage)
    const tenantId = Number(payload.tenantId)
    const userId = Number(payload.sub)
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0 || !Number.isSafeInteger(userId) || userId <= 0) {
      throw new UnauthorizedError('Token temporário inválido ou expirado')
    }

    const tenant = await this.userRepo.findTenantById(tenantId)
    if (!tenant?.active) throw new UnauthorizedError('Token temporário inválido ou expirado')

    const user = await this.userRepo.findByIdInTenant(userId, tenantId)
    if (!user?.active) throw new UnauthorizedError('Token temporário inválido ou expirado')

    return { payload, user }
  }

  private async authenticateLocalFallback(
    tenantId: number,
    email: string,
    password: string,
  ): Promise<{ user: Awaited<ReturnType<UserRepository['findByEmail']>>; passwordValid: boolean }> {
    const user = await this.userRepo.findByEmail(email, tenantId)
    if (!user) return { user: null, passwordValid: false }

    const bcrypt = await import('bcrypt')
    const passwordValid = user.passwordHash
      ? await bcrypt.default.compare(password, user.passwordHash)
      : false

    return { user, passwordValid }
  }

  private async issueTokens(
    userId: number,
    email: string,
    role: 'ADMIN' | 'USER',
    isPlatformAdmin: boolean,
    tenantId: number,
    canManageHosts: boolean,
    canViewLiveSessions: boolean,
    forcePasswordChange: boolean,
    authMethod: AuthMethod,
  ): Promise<AuthTokens> {
    const jti = randomUUID()
    const [avatar, sessionVersion] = await Promise.all([
      this.userRepo.findAvatarMetadata(userId, tenantId),
      this.userRepo.findSessionVersion(userId, tenantId),
    ])
    if (sessionVersion === null) throw new UnauthorizedError()

    const accessPayload: JwtPayload = {
      sub: String(userId),
      email,
      role: role === 'ADMIN' ? 'admin' : 'user',
      isPlatformAdmin,
      tenantId,
      canManageHosts,
      canViewLiveSessions,
      avatarUrl: avatarUrlFor(userId, avatar?.avatarUpdatedAt),
      avatarVersion: avatar?.avatarUpdatedAt ? String(avatar.avatarUpdatedAt.getTime()) : null,
      forcePasswordChange,
      sessionVersion,
      stage: 'authenticated',
    }

    const refreshPayload: RefreshTokenPayload = {
      sub: String(userId),
      jti,
      authMethod,
      sessionVersion,
      stage: 'refresh',
    }

    const canIssue = await this.passwordLoginPolicy?.canRefreshSession?.(tenantId, email, authMethod)
      .catch(() => false)
    if (canIssue === false) throw new UnauthorizedError('Política de autenticação alterada; autentique-se novamente')

    const tokenLifetime = await this.getTokenLifetimePolicy(tenantId)
    const accessToken = jwt.sign(
      accessPayload,
      env.JWT_SECRET,
      signOptionsWithExpiry(tokenLifetime.accessTokenExpiresIn),
    )
    const refreshToken = jwt.sign(
      refreshPayload,
      env.JWT_SECRET,
      signOptionsWithExpiry(tokenLifetime.refreshTokenExpiresIn),
    )

    await this.redis.set(
      `${REFRESH_KEY_PREFIX}${jti}`,
      String(tenantId),
      'EX',
      tokenLifetime.refreshTokenTtlSeconds,
    )

    return { accessToken, refreshToken }
  }

  private async getTokenLifetimePolicy(tenantId: number): Promise<{
    accessTokenExpiresIn: string | number
    refreshTokenExpiresIn: string | number
    refreshTokenTtlSeconds: number
  }> {
    const policy = await this.passwordLoginPolicy?.getTokenLifetimePolicy?.(tenantId).catch(() => null)
    if (!policy) {
      return {
        accessTokenExpiresIn: env.JWT_EXPIRES_IN,
        refreshTokenExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
        refreshTokenTtlSeconds: durationToSeconds(env.JWT_REFRESH_EXPIRES_IN, 7 * 24 * 60 * 60),
      }
    }
    return {
      accessTokenExpiresIn: policy.accessTokenSeconds,
      refreshTokenExpiresIn: policy.refreshTokenSeconds,
      refreshTokenTtlSeconds: policy.refreshTokenSeconds,
    }
  }
}

function durationToSeconds(value: string, fallback: number): number {
  const match = value.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/)
  if (!match) return fallback
  const amount = Number(match[1])
  const unit = match[2]
  const multiplier = unit === 'ms' ? 0.001
    : unit === 's' ? 1
      : unit === 'm' ? 60
        : unit === 'h' ? 3_600
          : 86_400
  return Math.max(1, Math.floor(amount * multiplier))
}
