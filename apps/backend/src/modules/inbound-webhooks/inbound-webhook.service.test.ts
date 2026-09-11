import { describe, expect, it, vi } from 'vitest'
import { InboundWebhookService } from './inbound-webhook.service.js'
import { InboundWebhookSignatureService } from './inbound-webhook-signature.service.js'
vi.mock('../../shared/crypto.js', () => ({ decrypt: ({ encrypted }: { encrypted: string }) => encrypted === 'encrypted' ? 'test-secret' : encrypted.slice(4), encrypt: (secret: string) => ({ encrypted: `enc:${secret}`, iv: 'iv' }) }))

function fixture() {
  const endpoint = { id: 8, tenantId: 7, provider: 'monitoring', status: 'ACTIVE', secretEncrypted: 'encrypted', secretIv: 'iv', allowedEventTypesJson: '["host.unavailable"]' }
  const receipts: any[] = []
  const repo = {
    findEndpointByTokenHash: vi.fn().mockResolvedValue(endpoint),
    releaseRejectedKey: vi.fn().mockResolvedValue(undefined),
    updateEndpoint: vi.fn().mockResolvedValue(undefined),
    findReceiptByIdempotencyKey: vi.fn(async (_id, key) => receipts.find(row => row.idempotencyKey === key)),
    createReceipt: vi.fn(async data => { const row = { ...data, id: receipts.length + 1 }; receipts.push(row); return row }),
    findEndpointById: vi.fn().mockResolvedValue(null), listReceipts: vi.fn(),
  }
  const signature = new InboundWebhookSignatureService()
  const service = new InboundWebhookService(repo as never, signature, { logAdminEvent: vi.fn() } as never)
  const body = { id: 'evt-1', type: 'host.unavailable' }
  const input = { provider: 'monitoring', endpointToken: 'test-token', body, headers: { 'x-nodeaccess-signature': signature.sign('test-secret', JSON.stringify(body)) } }
  return { endpoint, repo, service, input, receipts, signature }
}

describe('inbound resilience', () => {
  it('accepts a signed event and deduplicates an identical retry', async () => {
    const { service, input, receipts } = fixture()
    expect(await service.ingest(input)).toMatchObject({ accepted: true, duplicate: false })
    expect(await service.ingest(input)).toMatchObject({ accepted: true, duplicate: true, receiptId: 1 })
    expect(receipts).toHaveLength(1)
    expect(receipts[0].tenantId).toBe(7)
  })
  it('does not bypass signature verification for an already accepted key', async () => {
    const { service, input } = fixture()
    await service.ingest(input)
    expect(await service.ingest({ ...input, headers: {} })).toMatchObject({ accepted: false, duplicate: false })
  })
  it('allows a corrected signature after a rejected attempt', async () => {
    const { service, input, receipts } = fixture()
    await service.ingest({ ...input, headers: {} })
    expect(receipts[0]).toMatchObject({ errorCode: 'INVALID_SIGNATURE', idempotencyKey: null })
    expect(await service.ingest(input)).toMatchObject({ accepted: true, duplicate: false })
  })
  it('rejects reuse of a key with another signed payload', async () => {
    const { service, input, signature, receipts } = fixture()
    await service.ingest(input)
    const body = { ...input.body, data: 'changed' }
    expect(await service.ingest({ ...input, body, headers: { 'x-nodeaccess-signature': signature.sign('test-secret', JSON.stringify(body)) } })).toMatchObject({ accepted: false })
    expect(receipts.at(-1).errorCode).toBe('IDEMPOTENCY_CONFLICT')
  })
  it.each(['PAUSED', 'REVOKED'])('rejects events for %s endpoints', async status => {
    const { endpoint, service, input, receipts } = fixture()
    endpoint.status = status
    expect(await service.ingest(input)).toMatchObject({ accepted: false })
    expect(receipts[0].errorCode).toBe('ENDPOINT_NOT_ACTIVE')
  })
  it('rejects events outside the configured allowlist', async () => {
    const { endpoint, service, input, receipts } = fixture()
    endpoint.allowedEventTypesJson = '["host.recovered"]'
    await service.ingest(input)
    expect(receipts[0].errorCode).toBe('EVENT_TYPE_NOT_ALLOWED')
  })
  it('requires an event identity', async () => {
    const { service, input, receipts } = fixture()
    await service.ingest({ ...input, body: { type: 'host.unavailable' } })
    expect(receipts[0].errorCode).toBe('IDEMPOTENCY_KEY_REQUIRED')
  })
  it('does not write receipts for the wrong provider', async () => {
    const { service, input, repo } = fixture()
    await expect(service.ingest({ ...input, provider: 'other' })).rejects.toThrow()
    expect(repo.createReceipt).not.toHaveBeenCalled()
  })
  it('propagates database failure instead of acknowledging an unrecorded event', async () => {
    const { service, input, repo } = fixture()
    repo.createReceipt.mockRejectedValueOnce(new Error('offline'))
    await expect(service.ingest(input)).rejects.toThrow('offline')
  })
  it('acknowledges the winner when simultaneous inserts collide', async () => {
    const { service, input, repo, receipts } = fixture()
    repo.createReceipt.mockImplementationOnce(async data => {
      receipts.push({ ...data, id: 42 })
      throw new Error('duplicate key from competing request')
    })
    expect(await service.ingest(input)).toMatchObject({ accepted: true, duplicate: true, receiptId: 42 })
    expect(receipts).toHaveLength(1)
  })
  it('verifies original whitespace and Unicode bytes, retaining legacy signatures', async () => {
    const { service, input, signature } = fixture()
    const rawBody = '{ "id": "evt-1", "type": "host.unavailable", "text": "ação" }\n'
    const body = JSON.parse(rawBody)
    const headers = { 'x-nodeaccess-signature': signature.sign('test-secret', rawBody) }
    expect(await service.ingest({ ...input, body, rawBody, headers })).toMatchObject({ accepted: true })
    expect(await service.ingest({ ...input, body, rawBody, headers: { 'x-nodeaccess-signature': signature.sign('test-secret', JSON.stringify(body)) } })).toMatchObject({ accepted: true, duplicate: true })
  })
  it('releases historical rejected keys only after authentication and event validation', async () => {
    const { service, input, repo } = fixture()
    await service.ingest({ ...input, headers: {} })
    expect(repo.releaseRejectedKey).not.toHaveBeenCalled()
    await service.ingest(input)
    expect(repo.releaseRejectedKey).toHaveBeenCalledWith(8, 'evt-1')
  })
  it('rotates both credentials without putting them in audit data', async () => {
    const { service, repo, endpoint } = fixture()
    repo.findEndpointById.mockResolvedValue(endpoint)
    const result = await service.rotateCredentials(8, 7, 1)
    expect(result.endpointToken).toMatch(/^inwh_/)
    expect(result.secret).toHaveLength(64)
    expect(repo.updateEndpoint).toHaveBeenCalledWith(8, 7, expect.objectContaining({ endpointTokenHash: expect.any(String), secretEncrypted: `enc:${result.secret}`, secretIv: 'iv' }))
    expect(repo.updateEndpoint.mock.calls[0][2].endpointTokenHash).not.toBe(result.endpointToken)
  })
  it('invalidates the old token and signature after rotation', async () => {
    const { createHash } = await import('node:crypto')
    const { service, repo, endpoint, input, signature } = fixture()
    let currentHash = createHash('sha256').update(input.endpointToken).digest('hex')
    repo.findEndpointById.mockResolvedValue(endpoint)
    repo.findEndpointByTokenHash.mockImplementation(async hash => hash === currentHash ? endpoint : null)
    repo.updateEndpoint.mockImplementation(async (_id, _tenant, data) => {
      if (data.endpointTokenHash) currentHash = data.endpointTokenHash
      Object.assign(endpoint, data)
    })
    const credentials = await service.rotateCredentials(8, 7, 1)
    await expect(service.ingest(input)).rejects.toThrow()
    expect(await service.ingest({ ...input, endpointToken: credentials.endpointToken })).toMatchObject({ accepted: false })
    expect(await service.ingest({ ...input, endpointToken: credentials.endpointToken, headers: { 'x-nodeaccess-signature': signature.sign(credentials.secret, JSON.stringify(input.body)) } })).toMatchObject({ accepted: true })
  })
  it('prevents revoked endpoints from being edited, reactivated or rotated', async () => {
    const { service, repo, endpoint } = fixture()
    endpoint.status = 'REVOKED'
    repo.findEndpointById.mockResolvedValue(endpoint)
    await expect(service.rotateCredentials(8, 7, 1)).rejects.toThrow()
    await expect(service.setEndpointStatus(8, 7, 1, 'ACTIVE')).rejects.toThrow()
    await expect(service.updateEndpoint(8, 7, 1, { name: 'changed' })).rejects.toThrow()
    expect(repo.updateEndpoint).not.toHaveBeenCalled()
  })
  it('checks tenant access before reading receipts', async () => {
    const { service, repo } = fixture()
    await expect(service.listReceipts(8, 99)).rejects.toThrow()
    expect(repo.findEndpointById).toHaveBeenCalledWith(8, 99)
    expect(repo.listReceipts).not.toHaveBeenCalled()
  })
})

describe('inbound signature', () => {
  const signer = new InboundWebhookSignatureService()
  it.each([undefined, '', 'sha256=bad', 'a'.repeat(63), 'g'.repeat(64)])('rejects malformed signature %s', signature => {
    expect(signer.verify('secret', '{}', signature)).toBe(false)
  })
  it('accepts the prefix and rejects a changed payload', () => {
    const signature = `sha256=${signer.sign('secret', '{}')}`
    expect(signer.verify('secret', '{}', signature)).toBe(true)
    expect(signer.verify('secret', '{"changed":true}', signature)).toBe(false)
  })
})
