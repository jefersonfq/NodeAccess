import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'mysql://user:pass@127.0.0.1:3306/nodeaccess_test'
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379'
  process.env.JWT_SECRET ||= 'test-jwt-secret-with-at-least-32-chars'
  process.env.PEM_ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  process.env.NODE_ENV ||= 'production'
})

import { LOGGER_REDACT_PATHS, opaqueLogId, sanitizeLogUrl } from './logger.js'

describe('authentication log sanitization', () => {
  it('redacts OAuth and session credentials from query strings', () => {
    const sanitized = sanitizeLogUrl('/callback?code=secret-code&state=secret-state&nonce=secret-nonce&refreshToken=secret-refresh')

    expect(sanitized).not.toContain('secret-code')
    expect(sanitized).not.toContain('secret-state')
    expect(sanitized).not.toContain('secret-nonce')
    expect(sanitized).not.toContain('secret-refresh')
    expect(sanitized.match(/\[REDACTED\]/g)).toHaveLength(4)
  })

  it('redacts sensitive nested and top-level authentication fields', () => {
    let output = ''
    const stream = { write(chunk: string) { output += chunk } }
    const testLogger = pino({ redact: { paths: [...LOGGER_REDACT_PATHS], censor: '[REDACTED]' } }, stream)

    testLogger.info({
      req: { body: { password: 'password-value', credential: 'google-credential', code: 'oidc-code' } },
      accessToken: 'access-value',
      refreshToken: 'refresh-value',
      clientSecret: 'client-secret-value',
      claims: { email: 'claim@example.test', groups: ['admin'] },
      identity: { claims: { sub: 'sensitive-subject' } },
    })

    for (const secret of [
      'password-value', 'google-credential', 'oidc-code', 'access-value', 'refresh-value',
      'client-secret-value', 'claim@example.test', 'sensitive-subject',
    ]) expect(output).not.toContain(secret)
    expect(output).toContain('[REDACTED]')
  })

  it('creates a stable opaque reference without logging the provider identifier', () => {
    const value = 'provider-user-id-123'
    const reference = opaqueLogId(value)

    expect(reference).toHaveLength(16)
    expect(reference).not.toContain(value)
    expect(opaqueLogId(value)).toBe(reference)
  })
})
