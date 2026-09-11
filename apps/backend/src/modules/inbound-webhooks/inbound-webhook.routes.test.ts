import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { inboundWebhookRoutes } from './inbound-webhook.routes.js'
import { InboundWebhookController } from './inbound-webhook.controller.js'

async function setup() {
  const app = Fastify()
  await app.register(jwt, { secret: 'webhooks-test-only-secret' })
  const service = {
    ingest: vi.fn().mockResolvedValue({ accepted: true, duplicate: false, receiptId: 1, status: 'ACCEPTED' }),
    listReceipts: vi.fn().mockResolvedValue([]), rotateCredentials: vi.fn().mockResolvedValue({ endpointToken: 'new-token', secret: 'new-secret' }),
  }
  await app.register(async scope => inboundWebhookRoutes(scope, new InboundWebhookController(service as never)), { prefix: '/inbound-webhooks' })
  await app.ready()
  const auth = (role = 'admin') => ({ authorization: `Bearer ${app.jwt.sign({ sub: '1', tenantId: 7, role, stage: 'authenticated' })}` })
  return { app, service, auth }
}
describe('inbound HTTP contracts', () => {
  let fixture: Awaited<ReturnType<typeof setup>>
  // Schema compilation is fixture setup, not part of the HTTP contract timeout.
  beforeEach(async () => { fixture = await setup() })
  it('preserves the original JSON bytes in public ingestion only', async () => {
    const { app, service } = fixture
    try {
      const payload = '{ "type": "host.unavailable", "text": "ação" }\n'
      const response = await app.inject({ method: 'POST', url: '/inbound-webhooks/monitoring/token', headers: { 'content-type': 'application/json' }, payload })
      expect(response.statusCode).toBe(202)
      expect(service.ingest).toHaveBeenCalledWith(expect.objectContaining({ rawBody: payload, body: JSON.parse(payload) }))
      expect((await app.inject({ method: 'POST', url: '/inbound-webhooks/monitoring/token', headers: { 'content-type': 'application/json' }, payload: '{bad' })).statusCode).toBe(400)
      expect(service.ingest).toHaveBeenCalledTimes(1)
    } finally { await app.close() }
  })
  it('limits cursor inputs and takes tenant only from authentication', async () => {
    const { app, service, auth } = fixture
    try {
      const res = await app.inject({ url: '/inbound-webhooks/endpoints/8/receipts?beforeId=50&limit=25&tenantId=99', headers: auth() })
      expect(res.statusCode).toBe(200)
      expect(service.listReceipts).toHaveBeenCalledWith(8, 7, expect.objectContaining({ beforeId: 50, limit: 25 }))
      expect((await app.inject({ url: '/inbound-webhooks/endpoints/8/receipts?limit=101', headers: auth() })).statusCode).toBe(400)
    } finally { await app.close() }
  })
  it('allows rotation only to authenticated administrators', async () => {
    const { app, service, auth } = fixture
    try {
      for (const headers of [{}, auth('user')]) {
        const result = await app.inject({ method: 'POST', url: '/inbound-webhooks/endpoints/8/rotate-credentials', headers })
        expect(result.statusCode).toBeGreaterThanOrEqual(400)
      }
      expect(service.rotateCredentials).not.toHaveBeenCalled()
      expect((await app.inject({ method: 'POST', url: '/inbound-webhooks/endpoints/8/rotate-credentials', headers: auth() })).statusCode).toBe(200)
      expect(service.rotateCredentials).toHaveBeenCalledWith(8, 7, 1)
    } finally { await app.close() }
  })
})
