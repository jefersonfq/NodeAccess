import jwt from 'jsonwebtoken'
import type { SignOptions } from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import { env } from '../../config/env.js'
import {
  UnauthorizedError,
  AccountLockedError,
  ForbiddenError,
} from '../../shared/errors.js'
import type { UserRepository } from '../users/user.repository.js'
import type { TotpService } from './totp.service.js'
import type { GoogleService } from './google.service.js'
import type { JwtPayload, TempTokenPayload, RefreshTokenPayload } from '../../shared/guards.js'

const MAX_FAILED_ATTEMPTS = 5
const LOCK_DURATION_MS    = 15 * 60 * 1000 // 15 minutos
const TEMP_TOKEN_TTL      = '5m'
const REFRESH_KEY_PREFIX  = 'refresh:'

function withOptionalMeta(meta: { ip?: string; userAgent?: string }) {
  return {
    ...(meta.ip ? { ip: meta.ip } : {}),
    ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
  }
}

function signOptionsWithExpiry(expiresIn: string): SignOptions {
  return { expiresIn } as unknown as SignOptions
}

export interface LoginResult {
  tempToken: string
  requiresMfaSetup: boolean
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export interface TotpSetupResult {
  qrCode: string
}

export class AuthService {
  constructor(
    private readonly userRepo:       UserRepository,
    private readonly totpService:    TotpService,
    private readonly redis:          Redis,
    private readonly googleService?: GoogleService,
  ) {}

  // ---------------------------------------------------------------------------
  // Login — passo 1: valida e-mail e senha
  // ---------------------------------------------------------------------------

  async login(
    email: string,
    password: string,
    tenantSlug: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<LoginResult> {
    const tenant = await this.userRepo.findTenantBySlug(tenantSlug)
    if (!tenant?.active) throw new UnauthorizedError('Tenant inválido ou inativo')

    const user = await this.userRepo.findByEmail(email, tenant.id)

    // Usuário não encontrado — mesmo erro genérico para não revelar existência
    if (!user || !user.active) {
      await this.userRepo.logAuthEvent({
        eventType: 'LOGIN_FAILED',
        ...withOptionalMeta(meta),
        success: false,
      })
      throw new UnauthorizedError('Credenciais inválidas')
    }

    // Conta bloqueada
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.userRepo.logAuthEvent({
        userId: user.id,
        eventType: 'LOGIN_BLOCKED',
        ...withOptionalMeta(meta),
        success: false,
      })
      throw new AccountLockedError()
    }

    // Senha inválida
    const passwordValid = user.passwordHash
      ? await bcrypt.compare(password, user.passwordHash)
      : false

    if (!passwordValid) {
      const attempts = await this.userRepo.incrementFailedAttempts(user.id)
      if (attempts >= MAX_FAILED_ATTEMPTS) {
        await this.userRepo.lockAccount(user.id, new Date(Date.now() + LOCK_DURATION_MS))
        await this.userRepo.logAuthEvent({
          userId: user.id,
          eventType: 'LOGIN_BLOCKED',
          ...withOptionalMeta(meta),
          success: false,
        })
        throw new AccountLockedError()
      }
      await this.userRepo.logAuthEvent({
        userId: user.id,
        eventType: 'LOGIN_FAILED',
        ...withOptionalMeta(meta),
        success: false,
      })
      throw new UnauthorizedError('Credenciais inválidas')
    }

    await this.userRepo.resetFailedAttempts(user.id)

    const requiresMfaSetup = !user.mfaEnabled

    const stage = requiresMfaSetup ? 'mfa_setup' : 'mfa_pending'
    const tempPayload: TempTokenPayload = { sub: String(user.id), tenantId: tenant.id, stage }
    const tempToken = jwt.sign(tempPayload, env.JWT_SECRET, signOptionsWithExpiry(TEMP_TOKEN_TTL))

    return { tempToken, requiresMfaSetup }
  }

  // ---------------------------------------------------------------------------
  // Setup TOTP — retorna QR code para o frontend exibir
  // ---------------------------------------------------------------------------

  async setupTotp(setupToken: string): Promise<TotpSetupResult> {
    const payload = this.verifyTempToken(setupToken, 'mfa_setup')
    const user = await this.userRepo.findById(Number(payload.sub))
    if (!user) throw new UnauthorizedError()

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
    const payload = this.verifyTempToken(setupToken, 'mfa_setup')
    const user = await this.userRepo.findById(Number(payload.sub))
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

    return this.issueTokens(user.id, user.email, user.role, payload.tenantId, user.canManageHosts, user.forcePasswordChange)
  }

  // ---------------------------------------------------------------------------
  // Verify TOTP — valida código de usuário com MFA já configurado
  // ---------------------------------------------------------------------------

  async verifyTotp(
    token: string,
    tempToken: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<AuthTokens> {
    const payload = this.verifyTempToken(tempToken, 'mfa_pending')
    const user = await this.userRepo.findById(Number(payload.sub))
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

    return this.issueTokens(user.id, user.email, user.role, payload.tenantId, user.canManageHosts, user.forcePasswordChange)
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

    const stored = await this.redis.get(`${REFRESH_KEY_PREFIX}${payload.jti}`)
    if (!stored) throw new UnauthorizedError('Refresh token revogado')

    const user = await this.userRepo.findById(Number(payload.sub))
    if (!user?.active) throw new UnauthorizedError()

    const tenant = await this.userRepo.findTenantBySlug(stored) // stored = tenantId (ver issueTokens)
    // Alternativa: armazenamos tenantId direto no Redis
    const tenantId = Number(stored)

    const accessPayload: JwtPayload = {
      sub: String(user.id),
      email: user.email,
      role: user.role === 'ADMIN' ? 'admin' : 'user',
      tenantId,
      canManageHosts: user.canManageHosts,
      forcePasswordChange: user.forcePasswordChange,
      stage: 'authenticated',
    }

    const accessToken = jwt.sign(accessPayload, env.JWT_SECRET, signOptionsWithExpiry(env.JWT_EXPIRES_IN))
    return { accessToken }
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

  // ---------------------------------------------------------------------------
  // Google OAuth — emite tokens direto (SSO bypassa TOTP)
  // ---------------------------------------------------------------------------

  async getGooglePublicConfig(tenantSlug: string): Promise<{ enabled: boolean; clientId: string | null }> {
    if (!this.googleService) return { enabled: false, clientId: null }
    const tenant = await this.userRepo.findTenantBySlug(tenantSlug)
    if (!tenant) return { enabled: false, clientId: null }
    return this.googleService.getPublicConfig(tenant.id)
  }

  async loginWithGoogle(
    idToken:    string,
    tenantSlug: string,
    meta:       { ip?: string; userAgent?: string },
  ): Promise<AuthTokens> {
    if (!this.googleService) throw new UnauthorizedError('Integração com Google não habilitada')

    const tenant = await this.userRepo.findTenantBySlug(tenantSlug)
    if (!tenant?.active) throw new UnauthorizedError('Tenant inválido ou inativo')

    const config = await this.googleService.getConfig(tenant.id)
    if (!config?.clientId) throw new UnauthorizedError('Integração com Google não configurada para este tenant')

    const tokenInfo = await this.googleService.verifyIdToken(idToken, config.clientId)

    // Domain restriction (G Suite hosted domain)
    if (config.domain && tokenInfo.hd !== config.domain) {
      throw new ForbiddenError(`Apenas contas @${config.domain} são permitidas`)
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
        throw new UnauthorizedError('Usuário não encontrado. Solicite ao administrador que crie sua conta.')
      }
    }

    if (!user.active) {
      await this.userRepo.logAuthEvent({
        userId: user.id, eventType: 'LOGIN_BLOCKED', ...withOptionalMeta(meta), success: false,
      })
      throw new UnauthorizedError('Conta desativada')
    }

    await this.userRepo.logAuthEvent({
      userId: user.id, eventType: 'SSO_LOGIN', ...withOptionalMeta(meta), success: true,
    })

    return this.issueTokens(user.id, user.email, user.role, tenant.id, user.canManageHosts, user.forcePasswordChange)
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

  private async issueTokens(
    userId: number,
    email: string,
    role: 'ADMIN' | 'USER',
    tenantId: number,
    canManageHosts: boolean,
    forcePasswordChange: boolean,
  ): Promise<AuthTokens> {
    const jti = randomUUID()

    const accessPayload: JwtPayload = {
      sub: String(userId),
      email,
      role: role === 'ADMIN' ? 'admin' : 'user',
      tenantId,
      canManageHosts,
      forcePasswordChange,
      stage: 'authenticated',
    }

    const refreshPayload: RefreshTokenPayload = {
      sub: String(userId),
      jti,
      stage: 'refresh',
    }

    const accessToken  = jwt.sign(accessPayload,  env.JWT_SECRET, signOptionsWithExpiry(env.JWT_EXPIRES_IN))
    const refreshToken = jwt.sign(refreshPayload, env.JWT_SECRET, signOptionsWithExpiry(env.JWT_REFRESH_EXPIRES_IN))

    // Persiste o JTI no Redis com TTL em segundos (7d = 604800)
    const ttlSeconds = 7 * 24 * 60 * 60
    await this.redis.set(`${REFRESH_KEY_PREFIX}${jti}`, String(tenantId), 'EX', ttlSeconds)

    return { accessToken, refreshToken }
  }
}
