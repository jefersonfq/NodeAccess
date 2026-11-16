import { createHash } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { createVaultDelivery } from './vault-delivery'
import { type VaultPortalIdentity, type VaultTransport } from './vault-http'

const clientId = 'c'.repeat(43), sessionId = 's'.repeat(43), operationId = 'o'.repeat(43), challengeId = 'h'.repeat(43)
const thumbprint = 't'.repeat(43)
const key = { privateKey: {} as CryptoKey, thumbprint, recipient: { kty: 'RSA' as const, n: 'n'.repeat(342), e: 'AQAB' as const } }
function deferred<T>() { let resolve!: (v: T) => void; let reject!: (e: Error) => void; const promise = new Promise<T>((yes,no) => { resolve = yes; reject = no }); return { resolve, reject, promise } }
function fixture() {
  let mono = 1000, wall = 900000
  let identity: VaultPortalIdentity | null = { userId: 41, tenantId: 7, accessToken: 'bearer-fixture', refreshToken: 'origin-fixture', origin: 'https://vault.example' }
  const serverNow = 2000000
  const context = (action: string, id: number) => ({ version: 1, operationId, tenantId: 7, userId: 41,
    clientId: createHash('sha256').update(clientId).digest('hex'), action, itemRef: `secret:${id}`, recipientThumbprint: thumbprint,
    policyVersion: 2, secretVersion: 'f'.repeat(64), expiresAt: serverNow + 30000, origin: 'https://vault.example' })
  const post = vi.fn(async (path: string, body: Record<string, unknown>) => {
    await Promise.resolve()
    if (path === 'clients') return { clientId, expiresAt: serverNow + 1800000, serverNow }
    if (path === 'sessions/challenges') return { challengeId, expiresAt: serverNow + 120000, serverNow }
    if (path === 'sessions/unlock') return { sessionId, idleUntil: serverNow + 300000, expiresAt: serverNow + 1800000, serverNow }
    if (path === 'operations') return { operationId, expiresAt: serverNow + 30000, serverNow, state: 'AUTHORIZED', context: context(String(body.action), Number(body.secretId)) }
    if (path === 'operations/consume') return { envelope: 'encrypted-fixture' }
    return { state: 'LOCKED' }
  })
  const recipient = vi.fn(() => Promise.resolve(key)), open = vi.fn(() => Promise.resolve('synthetic-value')), clipboard = vi.fn(() => Promise.resolve(undefined))
  const delivery = createVaultDelivery({ identity: () => identity, transport: { post } as unknown as VaultTransport,
    clock: { mono: () => mono, wall: () => wall }, recipient, open, clipboard })
  return { delivery, post, recipient, open, clipboard, context, serverNow,
    advance: (ms: number) => { mono += ms; wall += ms }, wallAdvance: (ms: number) => { wall += ms },
    identity: (next: Partial<VaultPortalIdentity> | null) => { identity = next === null ? null : { ...identity!, ...next } } }
}
const unlock = (f: ReturnType<typeof fixture>) => f.delivery.unlock('synthetic-password', '123456')
async function until(check: () => boolean) { for (let i=0;i<100&&!check();i++) await new Promise(resolve => setTimeout(resolve, 1)); expect(check()).toBe(true) }

describe('Vault page-local delivery lifecycle', () => {
  it('unlocks, reveals temporarily, and copies only from its own operation and confirmation', async () => {
    const f=fixture(); await unlock(f); expect(f.delivery.state.phase).toBe('unlocked')
    await f.delivery.deliver('reveal', 4); expect(f.delivery.state.value).toBe('synthetic-value'); expect(f.clipboard).not.toHaveBeenCalled()
    await f.delivery.deliver('copy', 4); expect(f.delivery.state.value).toBe(''); expect(f.delivery.state.phase).toBe('copy-ready')
    expect(f.post.mock.calls.filter(([p])=>p==='operations').map(([,b])=>b.action)).toEqual(['reveal','copy'])
    expect(f.clipboard).not.toHaveBeenCalled(); await f.delivery.confirmCopy(); expect(f.clipboard).toHaveBeenCalledExactlyOnceWith('synthetic-value')
    expect(f.delivery.state.copied).toBe(true); expect(f.delivery.state.value).toBe('')
  })
  it('hides at 15 seconds and requires a new gesture instead of replaying', async () => {
    const f=fixture(); await unlock(f); await f.delivery.deliver('reveal',4); f.advance(15001); f.delivery.tick()
    expect(f.delivery.state.phase).toBe('unlocked'); expect(f.delivery.state.value).toBe(''); expect(f.post.mock.calls.filter(([p])=>p==='operations/consume')).toHaveLength(1)
  })
  it('keeps an unexpired client for fresh local proof, without minting a new client each minute', async () => {
    const f=fixture(); await unlock(f); f.advance(59000); f.delivery.tick(); expect(f.delivery.state.phase).toBe('locked')
    await unlock(f); expect(f.delivery.state.phase).toBe('unlocked'); expect(f.post.mock.calls.filter(([p])=>p==='clients')).toHaveLength(1)
  })
  it('uses both monotonic elapsed time and forward wall-clock movement; backward wall time cannot extend proof', async () => {
    const f=fixture(); await unlock(f); f.wallAdvance(-1000000); f.advance(60000); f.delivery.tick(); expect(f.delivery.state.phase).toBe('locked')
    const g=fixture(); await unlock(g); g.wallAdvance(60000); g.delivery.tick(); expect(g.delivery.state.phase).toBe('locked')
  })
  it('counts latency against the server-issued expiry instead of trusting the client wall clock', async () => {
    const f=fixture(); await unlock(f); const original=f.post.getMockImplementation()!
    f.post.mockImplementation(async (p,b)=>{const v=await original(p,b); if(p==='operations') f.advance(30000); return v})
    await f.delivery.deliver('reveal',4); expect(f.delivery.state.value).toBe(''); expect(f.post.mock.calls.some(([p])=>p==='operations/consume')).toBe(false)
  })
  it.each(['tenant', 'login', 'logout', 'lock', 'dispose'] as const)('discards a pending key on %s without sending authorization', async cause => {
    const f=fixture(); await unlock(f); const wait=deferred<typeof key>(); f.recipient.mockReturnValueOnce(wait.promise)
    const pending=f.delivery.deliver('reveal',4)
    if(cause==='tenant') f.identity({tenantId:9})
    if(cause==='login') f.identity({refreshToken:'new-origin'})
    if(cause==='logout') f.identity(null)
    if(cause==='lock') f.delivery.lock()
    if(cause==='dispose') f.delivery.dispose()
    wait.resolve(key); await pending; expect(f.delivery.state.value).toBe(''); expect(f.post.mock.calls.some(([p])=>p==='operations')).toBe(false)
  })
  it.each(['operations','operations/consume'] as const)('does not restore a late %s response after lock', async path => {
    const f=fixture(); await unlock(f); const original=f.post.getMockImplementation()!, wait=deferred<Awaited<ReturnType<typeof original>>>()
    f.post.mockImplementation((p,b)=>p===path?wait.promise:original(p,b))
    const pending=f.delivery.deliver('reveal',4); await until(()=>f.post.mock.calls.some(([p])=>p===path)); f.delivery.lock()
    wait.resolve(await original(path,{action:'reveal',secretId:4})); await pending
    expect(f.delivery.state.phase).toBe('locked'); expect(f.delivery.state.value).toBe(''); expect(f.open).not.toHaveBeenCalled()
  })
  it('discards decrypted plaintext returned after context changes', async () => {
    const f=fixture(); await unlock(f); const wait=deferred<string>(); f.open.mockReturnValueOnce(wait.promise)
    const pending=f.delivery.deliver('reveal',4); await until(()=>f.open.mock.calls.length===1)
    f.identity({tenantId:9}); wait.resolve('late-secret'); await pending; expect(f.delivery.state.value).toBe('')
  })
  it('revokes a late client bootstrap using its original identity, never the newly selected tenant', async () => {
    const f=fixture(); const original=f.post.getMockImplementation()!, wait=deferred<Awaited<ReturnType<typeof original>>>()
    f.post.mockImplementation((p,b)=>p==='clients'?wait.promise:original(p,b))
    const pending=unlock(f); f.identity({tenantId:99,accessToken:'new-bearer'}); f.delivery.lock()
    wait.resolve(await original('clients',{})); await pending
    const call=(f.post.mock.calls as unknown[][]).find(([p])=>p==='sessions/lock'); expect(call?.[2]).toMatchObject({tenantId:7,accessToken:'bearer-fixture'})
  })
  it.each(['tenantId','userId','action','itemRef','clientId','recipientThumbprint','origin'] as const)('rejects authorized context with wrong %s before consume', async field => {
    const f=fixture(); await unlock(f); const original=f.post.getMockImplementation()!
    f.post.mockImplementation(async(p,b)=>{const v=await original(p,b); if(p==='operations') return {...v,context:{...f.context('reveal',4),[field]:field.endsWith('Id')&&field!=='clientId'?99:'wrong'}}; return v})
    await f.delivery.deliver('reveal',4); expect(f.delivery.state.value).toBe(''); expect(f.post.mock.calls.some(([p])=>p==='operations/consume')).toBe(false)
  })
  it('never retries a lost consume response and exposes no underlying diagnostic payload', async () => {
    const f=fixture(); await unlock(f); const original=f.post.getMockImplementation()!
    f.post.mockImplementation((p,b)=>p==='operations/consume'?Promise.reject(new Error('private diagnostic')):original(p,b))
    await f.delivery.deliver('reveal',4); expect(f.post.mock.calls.filter(([p])=>p==='operations/consume')).toHaveLength(1)
    expect(f.delivery.state.error).toBe('unavailable'); expect(JSON.stringify(f.delivery.state)).not.toContain('private diagnostic')
  })
  it('rejects clipboard after expiry, clears failed clipboard values, and does not report a late write as success after lock', async () => {
    const f=fixture(); await unlock(f); await f.delivery.deliver('copy',4); f.advance(15000); await f.delivery.confirmCopy(); expect(f.clipboard).not.toHaveBeenCalled()
    await f.delivery.deliver('copy',4); f.clipboard.mockRejectedValueOnce(new Error('denied')); await f.delivery.confirmCopy(); expect(f.delivery.state.error).toBe('clipboard')
    await f.delivery.deliver('copy',4); const wait=deferred<undefined>(); f.clipboard.mockReturnValueOnce(wait.promise)
    const pending=f.delivery.confirmCopy(); f.delivery.lock(); wait.resolve(undefined); await pending
    expect(f.delivery.state.copied).toBe(false); expect(f.delivery.state.phase).toBe('locked')
  })
  it('allows only one in-flight unlock or delivery, and lock works while dependencies fail', async () => {
    const f=fixture(); const wait=deferred<typeof key>(); await unlock(f); f.recipient.mockReturnValueOnce(wait.promise)
    const first=f.delivery.deliver('reveal',4); await f.delivery.deliver('copy',4); expect(f.recipient).toHaveBeenCalledTimes(1)
    f.post.mockRejectedValue(new Error('offline')); f.delivery.lock(); expect(f.delivery.state.phase).toBe('locked'); wait.resolve(key); await first
  })
  it('blocks unsupported identities locally without any bootstrap', async () => {
    const f=fixture(); f.identity(null); await unlock(f); expect(f.delivery.state.error).toBe('unsupported'); expect(f.post).not.toHaveBeenCalled()
  })
})
