import { describe, expect, it, vi } from 'vitest'
import { AiInteractionRepository } from './ai-interaction.repository.js'

describe('AiInteractionRepository', () => {
  it('records sanitized metadata and returns a correlation id', async () => {
    const db = { $executeRaw: vi.fn().mockResolvedValue(1) }
    const correlationId = await new AiInteractionRepository(db as never).record({
      tenantId: 7,
      userId: 11,
      channel: 'terminal',
      purpose: 'terminal_assist',
      provider: 'ollama',
      model: 'qwen',
      routingPolicy: 'local_only',
      status: 'succeeded',
      contextCategories: ['terminal_buffer'],
      contextChars: 1200,
      tools: ['get_host_summary'],
      retentionDays: 14,
    })

    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(db.$executeRaw).toHaveBeenCalledOnce()
    expect(JSON.stringify(db.$executeRaw.mock.calls[0])).not.toContain('prompt')
  })

  it('maps bigint ids, JSON arrays and dates for the public contract', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([{
      id: 9n, correlationId: '00000000-0000-4000-8000-000000000001', channel: 'assistant', purpose: 'assistant_chat',
      provider: 'ollama', model: 'qwen', routingPolicy: 'local_only', status: 'succeeded', hostId: null,
      sessionId: null, ticketKey: null, contextCategories: '["platform_context"]', contextChars: 42,
      tools: '["platform_snapshot"]', redactionCount: 0, latencyMs: 90, inputTokens: 10, outputTokens: 20,
      errorKind: null, estimatedUsdMicros: 1250n, scriptArtifactId: 41, actionRunId: 51,
      retentionUntil: new Date('2026-09-13T00:00:00Z'), createdAt: new Date('2026-08-14T00:00:00Z'),
    }]) }
    const result = await new AiInteractionRepository(db as never).listRecent(7, 999)
    expect(result[0]).toMatchObject({ id: '9', contextCategories: ['platform_context'], tools: ['platform_snapshot'], estimatedUsdMicros: 1250, scriptArtifactId: 41, actionRunId: 51 })
  })

  it('supports physical cleanup of expired metadata', async () => {
    const db = { $executeRaw: vi.fn().mockResolvedValue(3) }
    await expect(new AiInteractionRepository(db as never).purgeExpired(new Date('2026-08-14T00:00:00Z'))).resolves.toBe(3)
  })

  it('links a governed artifact and its action run by tenant-scoped correlation id', async () => {
    const db = { $executeRaw: vi.fn().mockResolvedValue(1) }
    await new AiInteractionRepository(db as never).linkArtifacts({ tenantId: 7, correlationId: '00000000-0000-4000-8000-000000000001', scriptArtifactId: 41, actionRunId: 51 })
    expect(db.$executeRaw).toHaveBeenCalledOnce()
  })
})
