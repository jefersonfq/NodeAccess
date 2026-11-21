import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { calculateJwkThumbprint, decodeProtectedHeader, EmbeddedJWK, jwtVerify, type JWK } from 'jose'
import { VaultError } from './vault-domain.js'
import type { ReplayGuard } from './vault-extension-domain.js'

/** RFC 9449 DPoP for the extension client: ES256 only, server nonce, single-use jti, access-token hash. */
const NONCE_WINDOW_MS = 300_000
const IAT_SKEW_S = 60
const b64 = (data: Buffer): string => data.toString('base64url')

export const sha256b64 = (value: string): string => b64(createHash('sha256').update(value, 'ascii').digest())
/** RFC 7636 S256: BASE64URL(SHA256(ASCII(code_verifier))), compared in constant time. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  const a = Buffer.from(sha256b64(verifier)), b = Buffer.from(challenge)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Stateless nonce: window + HMAC; accepted for the current and the previous window only. */
export class DpopNonces {
  constructor(private readonly key: string, private readonly now = Date.now) {}
  private mac(window: number): string {
    return b64(createHmac('sha256', this.key).update(`nodeaccess-vault-extension-dpop-nonce:${window}`).digest()).slice(0, 32)
  }
  issue(): string { const w = Math.floor(this.now() / NONCE_WINDOW_MS); return `${w.toString(36)}.${this.mac(w)}` }
  valid(nonce: unknown): boolean {
    if (typeof nonce !== 'string' || !/^[0-9a-z]{1,12}\.[A-Za-z0-9_-]{32}$/.test(nonce)) return false
    const [raw, mac] = nonce.split('.') as [string, string]
    const w = Number.parseInt(raw, 36), current = Math.floor(this.now() / NONCE_WINDOW_MS)
    if (w !== current && w !== current - 1) return false
    const expected = Buffer.from(this.mac(w)), given = Buffer.from(mac)
    return expected.length === given.length && timingSafeEqual(expected, given)
  }
}

export interface DpopExpectation { method: 'GET' | 'POST'; url: string; accessToken?: string }
export class DpopVerifier {
  constructor(private readonly nonces: DpopNonces, private readonly replay: ReplayGuard, private readonly now = Date.now) {}
  /** Returns the RFC 7638 thumbprint of the proof key. Any defect is a uniform 401 with a fresh nonce. */
  async verify(proof: unknown, expected: DpopExpectation): Promise<string> {
    if (typeof proof !== 'string' || proof.length > 4096) throw dpopError()
    let jkt: string
    try {
      const header = decodeProtectedHeader(proof)
      const jwk = header.jwk as JWK | undefined
      if (header.typ !== 'dpop+jwt' || header.alg !== 'ES256' || !jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || 'd' in jwk
        || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') throw new Error('header')
      const { x, y } = jwk
      const { payload } = await jwtVerify(proof, EmbeddedJWK, { typ: 'dpop+jwt', algorithms: ['ES256'], currentDate: new Date(this.now()) })
      const iat = payload.iat, nowS = Math.floor(this.now() / 1000)
      if (payload.htm !== expected.method || payload.htu !== expected.url || typeof payload.jti !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(payload.jti)
        || typeof iat !== 'number' || Math.abs(nowS - iat) > IAT_SKEW_S) throw new Error('claims')
      if (expected.accessToken !== undefined ? payload.ath !== sha256b64(expected.accessToken) : payload.ath !== undefined) throw new Error('ath')
      if (!this.nonces.valid(payload.nonce)) throw new VaultError('EXTENSION_DPOP_NONCE', 401)
      jkt = await calculateJwkThumbprint({ kty: 'EC', crv: 'P-256', x, y }, 'sha256')
      if (!await this.replay.claim(`${jkt}:${payload.jti}`, (IAT_SKEW_S * 2 + 5) * 1000)) throw new Error('replay')
    } catch (error) {
      if (error instanceof VaultError && error.code === 'EXTENSION_DPOP_NONCE') throw error
      throw dpopError()
    }
    return jkt
  }
}
function dpopError(): VaultError { return new VaultError('EXTENSION_DPOP_INVALID', 401) }
