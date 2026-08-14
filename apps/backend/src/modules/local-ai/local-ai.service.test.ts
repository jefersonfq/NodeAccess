import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'mysql://user:pass@127.0.0.1:3306/nodeaccess_test'
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379'
  process.env.JWT_SECRET ||= 'test-jwt-secret-with-at-least-32-chars'
  process.env.PEM_ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  process.env.FEATURE_LOCAL_AI = 'true'
  process.env.NODE_ENV ||= 'test'
})

import { LocalAiService } from './local-ai.service.js'

const user = { sub: '11', tenantId: 7, role: 'admin' as const, email: 'admin@example.test', stage: 'authenticated' as const }

function service(config: Record<string, unknown>) {
  return new LocalAiService(
    { findByProvider: vi.fn().mockResolvedValue({ enabled: true, config: JSON.stringify(config) }) } as never,
    { isFeatureEnabled: vi.fn().mockResolvedValue(true) } as never,
    {} as never,
  )
}

describe('LocalAiService provider routing status', () => {
  const both = {
    localProvider: 'ollama', localBaseUrl: 'http://ollama:11434', localModel: 'qwen',
    networkProvider: 'openai_compatible', networkBaseUrl: 'https://ai.example/v1', networkModel: 'gpt',
    networkApiKeyEncrypted: 'encrypted', networkApiKeyIv: 'iv',
  }

  it('makes provider priority explicit without claiming runtime failover', async () => {
    const status = await service({ ...both, routingPolicy: 'prefer_local' }).getStatus(user)
    expect(status.effectiveProvider).toBe('ollama')
    expect(status.runtimeFailoverEnabled).toBe(false)
    expect(status.routingExplanation).toContain('Nao ha failover automatico')
    expect(status.providerStates).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'ollama', configured: true, selected: true }),
      expect.objectContaining({ key: 'openai_compatible', configured: true, selected: false }),
    ]))
  })

  it('selects network deterministically when network_only is configured', async () => {
    const status = await service({ ...both, routingPolicy: 'network_only' }).getStatus(user)
    expect(status.effectiveProvider).toBe('openai_compatible')
    expect(status.providerStates?.find((item) => item.key === 'openai_compatible')?.selected).toBe(true)
  })

  it('reports an unmet policy instead of silently selecting another provider', async () => {
    const status = await service({
      localProvider: 'ollama', localBaseUrl: 'http://ollama:11434', localModel: 'qwen',
      routingPolicy: 'network_only',
    }).getStatus(user)
    expect(status.available).toBe(false)
    expect(status.effectiveProvider).toBeNull()
    expect(status.routingExplanation).toContain('Nenhum provider')
  })
})
