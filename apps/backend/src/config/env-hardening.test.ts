import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('DATABASE_URL', 'mysql://test:test@localhost/test')
  vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
  vi.stubEnv('JWT_SECRET', 'test-jwt-secret-that-is-at-least-32-characters')
  vi.stubEnv('PEM_ENCRYPTION_KEY', '1'.repeat(64))
})

describe('environment boolean safety', () => {
  it.each(['false', '0', 'off', 'no', ' FALSE ', ''])('disables security and feature flags for %j', async value => {
    for (const key of ['TRUST_PROXY', 'FEATURE_MCP', 'AUTH_OIDC_ALLOW_JIT', 'AUTH_OIDC_ALLOW_AUTOMATIC_LINKING', 'FEATURE_SESSION_AUDIT_AI_SUMMARY', 'PRISMA_LOG_QUERIES']) vi.stubEnv(key, value)
    const { env } = await import('./env.js')
    expect(env.TRUST_PROXY).toBe(false)
    expect(env.FEATURE_MCP).toBe(false)
    expect(env.AUTH_OIDC_ALLOW_JIT).toBe(false)
    expect(env.AUTH_OIDC_ALLOW_AUTOMATIC_LINKING).toBe(false)
    expect(env.FEATURE_SESSION_AUDIT_AI_SUMMARY).toBe(false)
    expect(env.PRISMA_LOG_QUERIES).toBe(false)
  })
  it.each(['true', '1', 'yes', 'on', ' TRUE '])('enables an explicit %j', async value => {
    vi.stubEnv('FEATURE_MCP', value)
    const { env } = await import('./env.js')
    expect(env.FEATURE_MCP).toBe(true)
  })
})

 it('rejects invalid booleans instead of enabling an optional capability', async () => {
  const { env, envSchema } = await import('./env.js')
  expect(envSchema.safeParse({ ...env, TRUST_PROXY: 'invalid' }).success).toBe(false)
  expect(envSchema.safeParse({ ...env, FEATURE_MCP: '2' }).success).toBe(false)
 })
 it('disables every declared boolean using an explicit false string', async () => {
  const { env, envSchema } = await import('./env.js')
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'boolean') continue
    const result = envSchema.safeParse({ ...env, [key]: 'false' })
    expect(result.success, key).toBe(true)
    if (result.success) expect(result.data[key as keyof typeof env], key).toBe(false)
  }
 })
 it('does not trust forged proxy IP headers when TRUST_PROXY=false', async () => {
  vi.stubEnv('TRUST_PROXY', 'false')
  const { env } = await import('./env.js')
  const { default: Fastify } = await import('fastify')
  const app = Fastify({ trustProxy: env.TRUST_PROXY })
  app.get('/', request => ({ ip: request.ip }))
  try {
    const response = await app.inject({ method: 'GET', url: '/', remoteAddress: '192.0.2.10', headers: { 'x-forwarded-for': '203.0.113.99' } })
    expect(response.json<{ ip: string }>().ip).toBe('192.0.2.10')
  } finally { await app.close() }
 })
