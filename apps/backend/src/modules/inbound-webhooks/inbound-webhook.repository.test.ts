import { describe, expect, it, vi } from 'vitest'
import { InboundWebhookRepository } from './inbound-webhook.repository.js'

describe('inbound receipt identity', () => {
  it('reads the inserted receipt on the same transaction connection, not another matching payload', async () => {
    const row = { id: 42 }
    const tx = { $executeRawUnsafe: vi.fn().mockResolvedValue(1), $queryRawUnsafe: vi.fn().mockResolvedValue([row]) }
    const db = { $transaction: vi.fn(async fn => fn(tx)) }
    const repo = new InboundWebhookRepository(db as never)
    const result = await repo.createReceipt({ tenantId: 7, endpointId: 8, provider: 'monitoring', eventType: 'test', status: 'ACCEPTED', signatureValid: true, payloadHash: 'same-payload', payloadJson: '{}' })
    expect(result.id).toBe(42)
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('WHERE id = LAST_INSERT_ID()'))
  })
  it('propagates insert failure without reading a different receipt', async () => {
    const tx = { $executeRawUnsafe: vi.fn().mockRejectedValue(new Error('duplicate')), $queryRawUnsafe: vi.fn() }
    const db = { $transaction: vi.fn(async fn => fn(tx)) }
    const repo = new InboundWebhookRepository(db as never)
    await expect(repo.createReceipt({ tenantId: 7, endpointId: 8, provider: 'monitoring', eventType: 'test', status: 'ACCEPTED', signatureValid: true, payloadHash: 'same', payloadJson: '{}' })).rejects.toThrow('duplicate')
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled()
  })
})

describe('inbound history pagination and legacy recovery', () => {
  it('scopes cursor and status in SQL with bound parameters', async () => {
    const db = { $queryRawUnsafe: vi.fn().mockResolvedValue([]) }
    const repo = new InboundWebhookRepository(db as never)
    await repo.listReceipts(8, 7, { status: 'FAILED', limit: 25, beforeId: 76 })
    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('endpoint_id = ? AND tenant_id = ? AND status = ? AND id < ? ORDER BY id DESC LIMIT ?'), 8, 7, 'FAILED', 76, 25)
  })
  it('releases only rejected keys and preserves their original value without truncating the error message', async () => {
    const db = { $executeRawUnsafe: vi.fn().mockResolvedValue(1) }
    const repo = new InboundWebhookRepository(db as never)
    await repo.releaseRejectedKey(8, 'event-key')
    expect(db.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining("AND status = 'REJECTED'"), 8, 'event-key')
    expect(db.$executeRawUnsafe.mock.calls[0][0]).toContain('releasedIdempotencyKey')
    expect(db.$executeRawUnsafe.mock.calls[0][0]).not.toContain('error_message =')
  })
})
