import { describe, expect, it, vi } from 'vitest'
import { CompactEncrypt, importJWK } from 'jose'
import { createSiteFillClient, createSitesClient } from './sites-client'
import { thumbprintOf } from './envelope'

function fixture(mode: 'password' | 'both' = 'both') {
  let clock = 1000, changed: Record<string, unknown> = {}, malformed = false
  let recipient: { kty: string; n: string; e: string }
  const request = vi.fn(async (path: string, body: object): Promise<unknown> => {
    if (path.endsWith('/authorize')) { recipient = (body as { recipient: typeof recipient }).recipient; return { operation: 'o'.repeat(43), expiresAt: 31000, serverNow: 1000 } }
    const context = { version: 1, operationId: 'o'.repeat(43), tenantId: 1, userId: 2, clientId: 'c'.repeat(64), action: 'fill',
      itemRef: `site:3:${mode}`, recipientThumbprint: await thumbprintOf(recipient), policyVersion: 1, secretVersion: '1', expiresAt: 31000, origin: 'https://example.test', ...changed }
    const envelope = await new CompactEncrypt(new TextEncoder().encode('synthetic-only')).setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM', typ: 'vaultnaccess+jwe', vault: context })
      .encrypt(await importJWK(recipient, 'RSA-OAEP-256'))
    return { mode, envelope: malformed ? 'invalid' : envelope, context, username: 'synthetic', serverNow: clock }
  })
  const client = createSiteFillClient(request, () => clock)
  const binding = { mode, origin: 'https://example.test', tabId: 1, frameId: 0 as const, documentId: 'doc1' }
  return { client, request, binding, change: (v: Record<string, unknown>) => { changed = v }, expire: () => { clock = 31001 }, corrupt: () => { malformed = true } }
}
describe('site clients', () => {
  it('opens only a release for the selected login and one-time operation', async () => {
    const f = fixture(), grant = await f.client.authorize(3, 1, f.binding)
    expect(grant.recipient.privateKey.extractable).toBe(false)
    expect(await f.client.consume(grant, f.binding)).toEqual({ mode: 'both', username: 'synthetic', password: 'synthetic-only' })
    expect(f.request.mock.calls[0]?.[1]).not.toHaveProperty('password')
  })
  it('password-only returns no username and binds the encrypted context to password mode', async () => {
    const f = fixture('password'), grant = await f.client.authorize(3, 1, f.binding)
    expect(await f.client.consume(grant, f.binding)).toEqual({ mode: 'password', password: 'synthetic-only' })
    f.change({ itemRef: 'site:3:both' })
    await expect(f.client.consume(grant, f.binding)).rejects.toThrow()
  })
  it('does not authorize a binding with no inferred mode', async () => {
    const f = fixture(), document = { origin: f.binding.origin, tabId: f.binding.tabId, frameId: f.binding.frameId, documentId: f.binding.documentId }
    await expect(f.client.authorize(3, 1, document)).rejects.toThrow()
    expect(f.request).not.toHaveBeenCalled()
  })
  it.each([{ action: 'reveal' }, { itemRef: 'site:4' }, { origin: 'https://other.test' }, { operationId: 'x'.repeat(43) }, { secretVersion: '2' }])('rejects wrong signed context %j', async change => {
    const f = fixture(), grant = await f.client.authorize(3, 1, f.binding); f.change(change)
    await expect(f.client.consume(grant, f.binding)).rejects.toThrow()
  })
  it('does not consume after document change or local deadline', async () => {
    const f = fixture(), grant = await f.client.authorize(3, 1, f.binding)
    await expect(f.client.consume(grant, { ...f.binding, documentId: 'doc2' })).rejects.toThrow()
    f.expire(); await expect(f.client.consume(grant, f.binding)).rejects.toThrow()
    expect(f.request).toHaveBeenCalledTimes(1)
  })
  it('rejects a malformed envelope', async () => {
    const f = fixture(), grant = await f.client.authorize(3, 1, f.binding); f.corrupt()
    await expect(f.client.consume(grant, f.binding)).rejects.toThrow()
  })
  it('validates metadata and writes before sending and rejects secret-bearing metadata', async () => {
    const request = vi.fn(() => Promise.resolve({ items: [], next: null })), client = createSitesClient(request)
    expect(await client.list({ after: 0, limit: 50 })).toEqual({ items: [], next: null })
    request.mockResolvedValue({ items: [], next: null, password: 'unexpected' } as never)
    await expect(client.list({ after: 0, limit: 50 })).rejects.toThrow()
    await expect(client.create({ kind: 'login' } as never)).rejects.toThrow()
    expect(request).toHaveBeenCalledTimes(2)
  })
})


describe('strict username-only transport', () => {
  const binding = { mode: 'username' as const, origin: 'https://example.test', tabId: 1, frameId: 0 as const, documentId: 'first' }
  function usernameFixture(extra: object = {}) {
    const request = vi.fn((path: string): Promise<unknown> => Promise.resolve(path.endsWith('/authorize')
      ? { operation: 'o'.repeat(43), expiresAt: 31000, serverNow: 1000 }
      : { mode: 'username', username: 'user', operation: 'o'.repeat(43), binding, expiresAt: 31000, serverNow: 1000, ...extra }))
    return { client: createSiteFillClient(request, () => 1000), request }
  }
  it('accepts only username metadata and does not decrypt an envelope', async () => {
    const f = usernameFixture(), grant = await f.client.authorize(3, 1, binding)
    expect(await f.client.consume(grant, binding)).toEqual({ mode: 'username', username: 'user' })
    expect(f.request).toHaveBeenCalledTimes(2)
  })
  it.each([{ password: 'unexpected' }, { envelope: 'unexpected' }, { mode: 'both' }, { operation: 'x'.repeat(43) },
    { binding: { ...binding, mode: 'password' } }, { binding: { ...binding, documentId: 'second' } }, { expiresAt: 999 }])('rejects substituted or secret-bearing reply %j', async extra => {
    const f = usernameFixture(extra), grant = await f.client.authorize(3, 1, binding)
    await expect(f.client.consume(grant, binding)).rejects.toThrow()
  })
  it('does not consume an operation under a different inferred mode', async () => {
    const f = usernameFixture(), grant = await f.client.authorize(3, 1, binding)
    await expect(f.client.consume(grant, { ...binding, mode: 'password' })).rejects.toThrow()
    expect(f.request).toHaveBeenCalledTimes(1)
  })
})
