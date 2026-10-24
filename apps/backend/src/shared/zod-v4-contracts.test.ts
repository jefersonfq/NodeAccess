import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { z } from 'zod'
import {
  CreateUserSchema, UpdateUserSchema, PatchUserPreferencesSchema, UserPreferencesSchema,
  UpdateWebhookSubscriptionSchema, UpdateBastionSchema, HostImportPreviewRequestSchema,
  HostBulkApplyRowSchema,
} from '@nodeaccess/shared'
import { labSchema } from '../modules/trials/trial-contract.js'
import { zodToJsonSchema } from './zod-json-schema.js'

describe('Zod v4 API compatibility and bounded validation', () => {
  it('rejects an oversized import array before reading any item', () => {
    let reads = 0
    const hosts = new Array<unknown>(5001)
    Object.defineProperty(hosts, '0', { get: () => { reads++; throw new Error('Element must not be read') } })
    const result = HostImportPreviewRequestSchema.safeParse({ source: 'csv', destinationId: 1, hosts, sourceStats: {} })
    expect(result.success).toBe(false)
    expect(reads).toBe(0)
    if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'too_big', path: ['hosts'] })]))
  })

  it('preserves create defaults and nested preference defaults', () => {
    expect(CreateUserSchema.parse({ name: 'Fixture', email: 'fixture@example.test' })).toMatchObject({ role: 'user', canManageHosts: false, canViewLiveSessions: false, groupIds: [] })
    expect(UserPreferencesSchema.parse({ ui: {}, terminal: { fontFamily: 'monospace' }, hosts: {} }).snippets).toEqual({ pickerView: 'flat', pageView: 'flat' })
  })

  it.each([UpdateUserSchema, UpdateWebhookSubscriptionSchema, UpdateBastionSchema])('does not inject omitted PATCH defaults', schema => {
    expect(schema.parse({})).toEqual({})
    expect(schema.parse({ name: 'Renamed fixture' })).toEqual({ name: 'Renamed fixture' })
  })

  it('does not reset other nested preferences when changing one field', () => {
    const patch = { hosts: { homeMaxRecents: 10 }, snippets: { pageView: 'grouped' }, terminal: { fontSize: 16 } }
    expect(PatchUserPreferencesSchema.parse(patch)).toEqual(patch)
    expect(PatchUserPreferencesSchema.parse({ terminal: {}, hosts: {}, snippets: {} })).toEqual({ terminal: {}, hosts: {}, snippets: {} })
  })

  it('retains arbitrary JSON values in record fields', () => {
    const input = { hostId: 1, name: 'Fixture', status: 'updated', message: '', before: { nested: { enabled: false }, count: 2, list: [null, 'x'] }, after: {} }
    expect(HostBulkApplyRowSchema.parse(input)).toEqual(input)
  })

  it.each(['127.0.0.1', '10.206.8.3', '203.0.113.9'])('accepts canonical IPv4 format %s (network policy is separate)', ip => {
    expect(labSchema.shape.hosts.element.shape.ip.safeParse(ip).success).toBe(true)
  })
  it.each(['127.1', '010.206.8.3', '256.1.1.1', '::ffff:127.0.0.1', 'localhost', '1.2.3.4/24'])('rejects malformed/non-IPv4 provider address %s', ip => {
    expect(labSchema.shape.hosts.element.shape.ip.safeParse(ip).success).toBe(false)
  })

  it('preserves Fastify PATCH omissions, rejects invalid enums, and serializes dates', async () => {
    const app = Fastify()
    app.patch('/preferences', { schema: { body: zodToJsonSchema(PatchUserPreferencesSchema) } }, request => request.body)
    app.post('/explicit-record', { schema: { body: zodToJsonSchema(z.object({ data: z.record(z.string(), z.unknown()) }).passthrough()) } }, request => request.body)
    app.patch('/user', { schema: { body: zodToJsonSchema(UpdateUserSchema) } }, request => request.body)
    app.get('/date', { schema: { response: { 200: zodToJsonSchema(z.object({ createdAt: z.coerce.date() })) } } }, () => ({ createdAt: new Date('2026-10-24T12:00:00.000Z'), passwordHash: 'synthetic-never-public' }))
    try {
      const record = { data: { nested: { enabled: false }, list: [1, null] }, extension: 'explicitly-permitted' }
      expect((await app.inject({ method: 'POST', url: '/explicit-record', payload: record })).json<unknown>()).toEqual(record)
      const patch = { hosts: { homeMaxRecents: 10 } }
      expect((await app.inject({ method: 'PATCH', url: '/preferences', payload: patch })).json<unknown>()).toEqual(patch)
      expect((await app.inject({ method: 'PATCH', url: '/user', payload: { name: 'Fixture' } })).json<unknown>()).toEqual({ name: 'Fixture' })
      expect((await app.inject({ method: 'PATCH', url: '/user', payload: { role: 'root' } })).statusCode).toBe(400)
      expect((await app.inject({ method: 'PATCH', url: '/user', payload: { name: 'Fixture', isPlatformAdmin: true } })).json<unknown>()).toEqual({ name: 'Fixture' })
      const response = await app.inject('/date')
      expect(response.statusCode).toBe(200)
      expect(response.json<unknown>()).toEqual({ createdAt: '2026-10-24T12:00:00.000Z' })
    } finally { await app.close() }
  })
})
