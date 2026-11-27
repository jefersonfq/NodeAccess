import { describe, expect, it, vi } from 'vitest'
import { VaultSiteFill, type FillAccess } from './vault-site-fill.js'
import type { VaultTransaction } from './vault-ports.js'

function fixture() {
  const records = new Map<string, object>()
  let clock = 100_000, enabled = true, generation: string | null = 'boot-one'
  const audit = vi.fn(), put = vi.fn((_: string, key: string, value: object) => { records.set(key, value); return Promise.resolve() })
  const tx = { now: () => clock, authority: { validUntil: 900_000, policy: { version: 1, confirmationSeconds: 60, tenantQuota: 100 } },
    siteFillGeneration: () => Promise.resolve(generation), limit: vi.fn(), audit, get: vi.fn((_: string, key: string) => Promise.resolve(records.get(key) ?? null)), put } as unknown as VaultTransaction
  const ctx: FillAccess = { identity: { tenantId: 1, userId: 2, sessionVersion: 1 }, jkt: 'device', token: 'authorization',
    access: { sessionVersion: 1, extensionId: 'a'.repeat(32), origin: null, policyVersion: 1, expiresAt: 500_000, proofAt: 95_000 } }
  const granted = vi.fn(() => Promise.resolve(true))
  const read = vi.fn(() => Promise.resolve({ username: 'synthetic', origins: ['https://example.test'], secret: { version: 'v1', encrypted: 'cipher', iv: 'iv' } }))
  const envelope = { validate: vi.fn(() => Promise.resolve('recipient')), seal: vi.fn(() => Promise.resolve('sealed')) }
  const service = new VaultSiteFill(() => enabled, { token: () => 'o'.repeat(43), digest: v => `digest:${v}` }, envelope)
  const binding = { mode: 'both' as 'both' | 'username' | 'password', origin: 'https://example.test', tabId: 1, frameId: 0 as const, documentId: 'doc1' }
  const input = { siteId: 5, siteVersion: 1, binding, recipient: { kty: 'RSA' as const, n: 'a'.repeat(342), e: 'AQAB' as const } }
  const authorize = () => service.authorize(tx, ctx, input, granted, read)
  const consume = () => service.consume(tx, ctx, { operation: 'o'.repeat(43), binding }, granted, read)
  return { tx, audit, put, ctx, granted, read, envelope, binding, input, authorize, consume, records, clock: (v: number) => { clock = v }, disable: () => { enabled = false }, generation: (value: string | null) => { generation = value } }
}
describe('site fill release', () => {
  it('rejects an old operation after persistent generation rotation and permits a fresh authorization', async () => {
    const f = fixture(); await f.authorize(); f.generation('boot-two')
    await expect(f.consume()).rejects.toThrow('SITE_FILL_UNAVAILABLE')
    expect(f.envelope.seal).not.toHaveBeenCalled()
    await f.authorize(); await expect(f.consume()).resolves.toMatchObject({ envelope: 'sealed' })
  })
  it('fails closed when the generation is unavailable or missing from a legacy operation', async () => {
    const f = fixture(); await f.authorize()
    const stored = f.records.get('o'.repeat(43)) as { generation?: string }; delete stored.generation
    await expect(f.consume()).rejects.toThrow('SITE_FILL_UNAVAILABLE')
    f.generation(null)
    await expect(f.authorize()).rejects.toThrow('SITE_FILL_UNAVAILABLE')
    await expect(f.consume()).rejects.toThrow('SITE_FILL_UNAVAILABLE')
    expect(f.envelope.seal).not.toHaveBeenCalled()
  })
  it('binds one encrypted release to item, recipient, document and device', async () => {
    const f = fixture(); await f.authorize(); const reply = await f.consume()
    if (reply.mode === 'username') throw new Error('wrong mode')
    expect(reply.envelope).toBe('sealed'); expect(reply.context).toMatchObject({ action: 'fill', itemRef: 'site:5:both', origin: f.binding.origin })
    expect(f.read).toHaveBeenCalledTimes(2); expect(f.audit).toHaveBeenCalledTimes(2)
    await expect(f.consume()).rejects.toThrow('SITE_FILL_UNAVAILABLE')
    expect(f.envelope.seal).toHaveBeenCalledTimes(1)
  })
  it.each(['documentId', 'tabId', 'origin'] as const)('rejects changed %s', async field => {
    const f = fixture(); await f.authorize()
    if (field === 'tabId') f.binding.tabId = 2
    else f.binding[field] = field === 'origin' ? 'https://other.test' : 'doc2'
    // Persistent store serializes records; detach the fixture object like SQL JSON does.
    const stored = f.records.get('o'.repeat(43)) as { binding: object }
    stored.binding = { mode: 'both', origin: 'https://example.test', tabId: 1, frameId: 0, documentId: 'doc1' }
    await expect(f.consume()).rejects.toThrow('SITE_FILL_UNAVAILABLE'); expect(f.envelope.seal).not.toHaveBeenCalled()
  })
  it.each(['kill', 'grant', 'expiry', 'device', 'authorization', 'policy', 'version', 'origins', 'username', 'acl'] as const)('rechecks %s before consumption', async change => {
    const f = fixture(); await f.authorize()
    if (change === 'kill') f.disable()
    if (change === 'grant') f.granted.mockResolvedValue(false)
    if (change === 'expiry') f.clock(160_001)
    if (change === 'device') f.ctx.jkt = 'other'
    if (change === 'authorization') f.ctx.token = 'other'
    if (change === 'policy') f.tx.authority.policy.version++
    if (change === 'acl') f.read.mockRejectedValue(new Error('denied'))
    if (['version', 'origins', 'username'].includes(change)) f.read.mockResolvedValue({ username: change === 'username' ? 'other' : 'synthetic', origins: change === 'origins' ? [] : ['https://example.test'], secret: { version: change === 'version' ? 'v2' : 'v1', encrypted: 'cipher', iv: 'iv' } })
    await expect(f.consume()).rejects.toThrow(); expect(f.envelope.seal).not.toHaveBeenCalled()
  })
  it('denies disabled pilot and unrelated origins before creating an operation', async () => {
    const f = fixture(); f.input.binding.origin = 'https://other.test'
    await expect(f.authorize()).rejects.toThrow('SITE_FILL_UNAVAILABLE'); expect(f.put).not.toHaveBeenCalled()
    f.disable(); await expect(f.authorize()).rejects.toThrow('SITE_FILL_UNAVAILABLE')
  })
  it('requires a recent nonfuture proof', async () => {
    const f = fixture(); f.ctx.access.proofAt = 100_001
    await expect(f.authorize()).rejects.toThrow('VAULT_STEP_UP_REQUIRED')
    delete f.ctx.access.proofAt; await expect(f.authorize()).rejects.toThrow('VAULT_STEP_UP_REQUIRED')
  })
  it('does not return a release when mandatory audit fails', async () => {
    const f = fixture(); await f.authorize(); f.audit.mockRejectedValue(new Error('audit'))
    await expect(f.consume()).rejects.toThrow('audit')
  })
})


describe('separate document-bound login steps', () => {
  it('releases username without invoking the decrypting sealer and consumes only once', async () => {
    const f = fixture(); f.binding.mode = 'username'
    f.envelope.seal.mockRejectedValue(new Error('password must never be decrypted'))
    await f.authorize()
    const reply = await f.consume()
    expect(reply).toEqual({ mode: 'username', username: 'synthetic', operation: 'o'.repeat(43), binding: f.binding, expiresAt: 130000, serverNow: 100000 })
    expect(f.envelope.seal).not.toHaveBeenCalled()
    expect(JSON.stringify(reply)).not.toMatch(/cipher|sealed|password|encrypted/)
    await expect(f.consume()).rejects.toThrow('SITE_FILL_UNAVAILABLE')
  })
  it('requires a distinct operation for password-only on the next document', async () => {
    const f = fixture(); f.binding.mode = 'username'; await f.authorize(); await f.consume()
    f.binding.mode = 'password'; f.binding.documentId = 'doc2'
    await expect(f.consume()).rejects.toThrow('SITE_FILL_UNAVAILABLE')
    await f.authorize()
    expect(await f.consume()).toMatchObject({ mode: 'password', username: '', context: { itemRef: 'site:5:password' } })
    expect(f.envelope.seal).toHaveBeenCalledOnce()
  })
  it.each(['username', 'password'] as const)('rejects mode substitution to %s before decrypting', async mode => {
    const f = fixture(); await f.authorize()
    const stored = f.records.get('o'.repeat(43)) as { binding: object }; stored.binding = { ...f.binding }
    f.binding.mode = mode
    await expect(f.consume()).rejects.toThrow('SITE_FILL_UNAVAILABLE')
    expect(f.envelope.seal).not.toHaveBeenCalled()
  })
  it.each(['proof', 'grant', 'acl', 'audit'] as const)('username mode still requires %s', async failure => {
    const f = fixture(); f.binding.mode = 'username'; await f.authorize()
    if (failure === 'proof') delete f.ctx.access.proofAt
    if (failure === 'grant') f.granted.mockResolvedValue(false)
    if (failure === 'acl') f.read.mockRejectedValue(new Error('denied'))
    if (failure === 'audit') f.audit.mockRejectedValue(new Error('audit'))
    await expect(f.consume()).rejects.toThrow()
    expect(f.envelope.seal).not.toHaveBeenCalled()
  })
})


describe('release invalidation while sealing is pending', () => {
  it.each(['expiry', 'kill-switch'] as const)('does not commit or return an envelope after %s during seal', async change => {
    const f=fixture();await f.authorize()
    let entered!:()=>void, release!:()=>void
    const started=new Promise<void>(resolve=>{entered=resolve})
    const pendingSeal=new Promise<void>(resolve=>{release=resolve})
    f.envelope.seal.mockImplementation(async()=>{entered();await pendingSeal;return 'sealed'})
    const pending=f.consume()
    await started
    if(change==='expiry')f.clock(130_000)
    else f.disable()
    const rejected=expect(pending).rejects.toThrow('SITE_FILL_UNAVAILABLE')
    release();await rejected
    expect(f.envelope.seal).toHaveBeenCalledOnce()
    expect(f.put).toHaveBeenCalledOnce()
    expect(f.records.get('o'.repeat(43))).toMatchObject({state:'AUTHORIZED'})
    expect(f.audit).toHaveBeenCalledOnce()
    expect(f.audit.mock.calls[0]?.[0]).toMatchObject({type:'SITE_FILL_AUTHORIZED'})
  })
})
