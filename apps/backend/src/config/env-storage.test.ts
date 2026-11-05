import { describe, expect, it } from 'vitest'
import { envSchema } from './env.js'

const minimum = { DATABASE_URL: 'mysql://test:test@localhost/test', REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'test-jwt-secret-that-is-at-least-32-characters', PEM_ENCRYPTION_KEY: '1'.repeat(64) }

describe('persistent private storage configuration', () => {
  it('uses separate persistent development directories when unconfigured', () => {
    const configured = envSchema.parse(minimum)
    expect(configured.SESSION_AUDIT_STORAGE_DIR).toBe('./data/session-audit')
    expect(configured.USER_AVATAR_STORAGE_DIR).toBe('./data/user-avatars')
  })
  it.each(['SESSION_AUDIT_STORAGE_DIR', 'USER_AVATAR_STORAGE_DIR'])('preserves explicit %s, including legacy locations during migration', key => {
    for (const directory of ['/var/lib/nodeaccess/private', '/tmp/legacy-private', './custom-data', ' ./custom-data ']) {
      expect(envSchema.parse({ ...minimum, [key]: directory })[key as 'SESSION_AUDIT_STORAGE_DIR']).toBe(directory)
    }
  })
  it.each(['', '   '])('rejects empty storage paths %j rather than writing into cwd', directory => {
    for (const key of ['SESSION_AUDIT_STORAGE_DIR', 'USER_AVATAR_STORAGE_DIR']) {
      expect(envSchema.safeParse({ ...minimum, [key]: directory }).success).toBe(false)
    }
  })
})
