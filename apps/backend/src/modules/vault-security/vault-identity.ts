import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import type { Redis } from 'ioredis'
import type { OriginVerifier, Reauthentication } from './vault-ports.js'
import { VaultError, type VaultAuthority, type VaultIdentity, type VaultOrigin } from './vault-domain.js'
import type { TotpService } from '../auth/totp.service.js'

export class RedisVaultOrigin implements OriginVerifier {
  constructor(private readonly redis: Pick<Redis, 'get'>, private readonly signingKey: string, private readonly now = Date.now, private readonly timeoutMs = 500) {}
  async bind(token: string, identity: VaultIdentity): Promise<VaultOrigin> {
    let origin: VaultOrigin
    try {
      const p = jwt.verify(token, this.signingKey, { algorithms: ['HS256'] })
      if (typeof p === 'string' || p.stage !== 'refresh' || p.sub !== String(identity.userId)
        || (p.sessionVersion ?? 0) !== identity.sessionVersion || p.authMethod !== 'local'
        || typeof p.jti !== 'string' || !/^[a-f0-9-]{36}$/.test(p.jti) || !p.exp) throw new Error('identity')
      origin = { jti: p.jti, expiresAt: p.exp * 1000 }
    } catch { throw new VaultError('VAULT_ORIGIN_INVALID', 423) }
    await this.assert(origin, identity)
    return origin
  }
  async assert(origin: VaultOrigin, identity: VaultIdentity): Promise<void> {
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
export class LocalVaultReauthentication implements Reauthentication {
  constructor(private readonly totp: Pick<TotpService, 'verify'>) {}
  async verify(password: string, otp: string, authority: VaultAuthority): Promise<boolean> {
    return await bcrypt.compare(password, authority.passwordHash) && this.totp.verify(authority.mfaSecret, otp)
  }
}
