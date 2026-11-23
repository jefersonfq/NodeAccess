import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import type { Redis } from 'ioredis'
import type { OriginVerifier, Reauthentication } from './vault-ports.js'
import { VaultError, type VaultAuthMethod, type VaultAuthority, type VaultIdentity, type VaultOrigin } from './vault-domain.js'
import type { TotpService } from '../auth/totp.service.js'

/** External methods stay behind a flag; break-glass and unknown methods are never accepted. */
export function vaultAuthMethod(value: unknown, external: boolean): VaultAuthMethod | null {
  if (value === 'local') return 'local'
  return external && (value === 'ldap' || value === 'oidc' || value === 'google') ? value : null
}
export class RedisVaultOrigin implements OriginVerifier {
  constructor(private readonly redis: Pick<Redis, 'get'>, private readonly signingKey: string, private readonly now = Date.now,
    private readonly timeoutMs = 500, private readonly external = false) {}
  async bind(token: string, identity: VaultIdentity): Promise<VaultOrigin> {
    let origin: VaultOrigin
    try {
      const p = jwt.verify(token, this.signingKey, { algorithms: ['HS256'] })
      const authMethod = typeof p === 'string' ? null : vaultAuthMethod(p.authMethod, this.external)
      if (typeof p === 'string' || p.stage !== 'refresh' || p.sub !== String(identity.userId)
        || (p.sessionVersion ?? 0) !== identity.sessionVersion || !authMethod
        || typeof p.jti !== 'string' || !/^[a-f0-9-]{36}$/.test(p.jti) || !p.exp) throw new Error('identity')
      origin = { jti: p.jti, expiresAt: p.exp * 1000, authMethod }
    } catch { throw new VaultError('VAULT_ORIGIN_INVALID', 423) }
    await this.assert(origin, identity)
    return origin
  }
  allows(method: VaultAuthMethod): boolean { return vaultAuthMethod(method, this.external) === method }
  async assert(origin: VaultOrigin, identity: VaultIdentity): Promise<void> {
    // Re-evaluated on every use: turning the external flag off stops already registered clients too.
    if (vaultAuthMethod(origin.authMethod, this.external) !== origin.authMethod) throw new VaultError('VAULT_ORIGIN_INVALID', 423)
    let tenant: string | null
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      tenant = await Promise.race([
        this.redis.get(`refresh:${origin.jti}`),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('origin deadline')), this.timeoutMs) }),
      ])
    } catch { throw new VaultError('VAULT_DEPENDENCY_UNAVAILABLE', 503) }
    finally { if (timer) clearTimeout(timer) }
    if (tenant !== String(identity.tenantId) || this.now() >= origin.expiresAt) throw new VaultError('VAULT_ORIGIN_REVOKED', 423)
  }
}
/** Directory password check of the central LDAP provider; no directory details leave this adapter. */
export interface DirectoryPasswordCheck {
  authenticate(input: { tenantId: number; email: string; password: string }): Promise<{ user: { id: number } | null; passwordValid: boolean }>
}
/**
 * Same bar for every method: a fresh first factor verified by the server plus NodeAccess TOTP.
 * Provider re-authentication for OIDC/Google is a separate flow; until then those methods are denied here.
 */
export class MethodVaultReauthentication implements Reauthentication {
  constructor(private readonly totp: Pick<TotpService, 'verify'>, private readonly directory?: DirectoryPasswordCheck) {}
  async verify(password: string, otp: string, authority: VaultAuthority, method: VaultAuthMethod, identity: VaultIdentity): Promise<boolean> {
    if (authority.methods[method] !== true) return false
    let firstFactor = false
    if (method === 'local') firstFactor = authority.passwordHash !== null && await bcrypt.compare(password, authority.passwordHash)
    else if (method === 'ldap' && this.directory) {
      try {
        const result = await this.directory.authenticate({ tenantId: identity.tenantId, email: authority.email, password })
        firstFactor = result.passwordValid && result.user?.id === identity.userId
      } catch { firstFactor = false }
    }
    return firstFactor && this.totp.verify(authority.mfaSecret, otp)
  }
  verifySecondFactor(otp: string, authority: VaultAuthority): boolean {
    return /^\d{6}$/.test(otp) && this.totp.verify(authority.mfaSecret, otp)
  }
}
