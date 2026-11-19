import { describe, expect, it, vi } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { VaultService } from './vault.service.js'
import { VaultAdministrationService } from './vault-administration.service.js'
import { assertPolicy, VaultError, type VaultAuthMethod, type VaultAuthority, type VaultIdentity, type VaultEvent } from './vault-domain.js'
import type { VaultStore, VaultTransaction, EnvelopeSealer } from './vault-ports.js'

const identity: VaultIdentity = { userId: 1, tenantId: 2, sessionVersion: 3 }
const origin = 'https://vault.example.test'
const key = { kty: 'RSA' as const, n: 'test-only-key', e: 'AQAB' }
const entropy = { token: () => randomBytes(32).toString('base64url'), digest: (s: string) => createHash('sha256').update(s).digest('hex') }
function fixture() {
  let time = 1000, secretVersion = 'v1', originActive = true, auditFails = false, afterCommit: (() => void) | undefined
  let records = new Map<string, unknown>(), counts = new Map<string, number>(), events: VaultEvent[] = []
  let originMethod: VaultAuthMethod = 'local'
  const authority: VaultAuthority = { policy: { version: 1, unlock: true, reveal: true, copy: true, localReauth: true, origin, tenantQuota: 100 },
    validUntil: Number.MAX_SAFE_INTEGER, role: 'USER', passwordHash: 'hashed-password', mfaSecret: 'mfa-test', credentialVersion: 'credentials-v1',
    email: 'user@example.test', methods: { local: true, ldap: true, oidc: true, google: true } }
  const audit = vi.fn((e: VaultEvent) => { if (auditFails) throw new Error('audit unavailable'); events.push(e); return Promise.resolve() })
  const authorizeSecret = vi.fn(() => Promise.resolve({ version: secretVersion, encrypted: 'ciphertext', iv: 'iv' }))
  const reauth = { verify: vi.fn(() => Promise.resolve(true)), verifySecondFactor: vi.fn(() => true) }
  const provider = { begin: vi.fn(() => Promise.resolve({ kind: 'redirect' as const, authorizationUrl: 'https://idp.example.test/authorize' })), complete: vi.fn(() => Promise.resolve({ mfa: true })) }
  const sealer = { validate: vi.fn(() => Promise.resolve('key-thumbprint')), seal: vi.fn<EnvelopeSealer['seal']>(() => Promise.resolve('ciphertext-envelope')) }
  const verifier = { bind: vi.fn(() => Promise.resolve({ jti: 'origin', expiresAt: 2_000_000, authMethod: originMethod })), assert: vi.fn(() => { if (!originActive) throw new VaultError('VAULT_ORIGIN_REVOKED',423); return Promise.resolve() }) }
  const propose = vi.fn(() => Promise.resolve()), approve = vi.fn(() => Promise.resolve({ change: { kind: 'item' as const, secretId: 4, enabled: true }, proposedBy: 9 }))
  let tail = Promise.resolve()
  const store: VaultStore = { transaction: async <T>(_i: VaultIdentity, run: (tx: VaultTransaction) => Promise<T>): Promise<T> => {
    let done!: () => void
    const prior = tail; tail = new Promise<void>(resolve => { done = resolve }); await prior
    const before = structuredClone(records), previousCounts = new Map(counts), previousEvents = [...events]
    try {
      const result = await run({ authority: structuredClone(authority), now: () => time,
        get: <V>(kind: string, token: string) => Promise.resolve(structuredClone(records.get(kind+':'+token) ?? null) as V | null),
        put: (kind, token, value) => { records.set(kind+':'+token, structuredClone(value)); return Promise.resolve() },
        remove: (kind, token) => { records.delete(kind+':'+token); return Promise.resolve() },
        limit: (name, window, max) => { const k=name+Math.floor(time/window); const n=(counts.get(k)??0)+1;counts.set(k,n);if(n>max)throw new VaultError('VAULT_RATE_LIMIT',429);return Promise.resolve() },
        secret: authorizeSecret, audit, propose, approve,
      })
      afterCommit?.(); return result
    } catch (e) { records=before; counts=previousCounts;events=previousEvents;throw e } finally { done() }
  } }
  const service = new VaultService(store, verifier, reauth, sealer, entropy, () => time, provider)
  async function setup() {
    const c = await service.register(identity, 'refresh', origin)
    const challenge = await service.challenge(identity,c.clientId,origin)
    const s = await service.unlock(identity,c.clientId,origin,challenge.challengeId,'password','123456')
    return { c, s, request: () => service.request(identity,c.clientId,origin,s.sessionId,'reveal',4,key) }
  }
  return { service, setup, authority, reauth, provider, useMethod: (m: VaultAuthMethod) => { originMethod = m }, sealer, verifier, audit, authorizeSecret, propose, approve,
    records: () => records, events: () => events, counts: () => counts,
    advance: (ms: number) => { time+=ms }, revoke: () => { originActive=false }, rotate: () => { secretVersion='v2' },
    failAudit: (v: boolean) => { auditFails=v }, onCommit: (fn: () => void) => { afterCommit=fn } }
}

describe('vault lifecycle and release boundaries', () => {
  it('stores no raw client/session capabilities in persisted values and authenticates immutable context', async () => {
    const f=fixture(), {c,s,request}=await f.setup(), op=await request()
    const persisted=JSON.stringify([...f.records().values()])
    expect(persisted).not.toContain(c.clientId); expect(persisted).not.toContain(s.sessionId)
    await expect(f.service.consume(identity,c.clientId,origin,s.sessionId,op.operationId)).resolves.toEqual({envelope:'ciphertext-envelope'})
    expect(op.serverNow).toBe(1000)
    expect(s.serverNow).toBe(1000)
    expect(f.sealer.seal.mock.calls[0]?.[1]).toEqual(op.context)
    expect(f.sealer.seal.mock.calls[0]?.[1]).toMatchObject({ version:1,operationId:op.operationId,clientId:entropy.digest(c.clientId),action:'reveal',itemRef:'secret:4',origin })
    expect(f.events().filter(e=>e.type==='DELIVERY_RELEASE_COMMITTED')).toHaveLength(1)
  })
  it('permits exactly one of twenty concurrent consumers and never reopens a lost response', async () => {
    const f=fixture(),{c,s,request}=await f.setup(),op=await request()
    const results=await Promise.allSettled(Array.from({length:20},()=>f.service.consume(identity,c.clientId,origin,s.sessionId,op.operationId)))
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1)
    expect(f.events().filter(e=>e.type==='DELIVERY_RELEASE_COMMITTED')).toHaveLength(1)
  })
  it('rejects an old client and grant with a newer central session version', async () => {
    const f=fixture(),{c,s,request}=await f.setup(),op=await request()
    const freshIdentity={...identity,sessionVersion:identity.sessionVersion+1}
    await expect(f.service.current(freshIdentity,c.clientId,origin)).rejects.toMatchObject({status:423})
    await expect(f.service.challenge(freshIdentity,c.clientId,origin)).rejects.toMatchObject({status:423})
    await expect(f.service.consume(freshIdentity,c.clientId,origin,s.sessionId,op.operationId)).rejects.toMatchObject({status:423})
    expect(f.sealer.seal).not.toHaveBeenCalled()
    expect(f.events().filter(e=>e.type==='DELIVERY_RELEASE_COMMITTED')).toHaveLength(0)
  })
  it('burns a failed challenge and requires a fresh proof for another attempt', async () => {
    const f=fixture(),c=await f.service.register(identity,'refresh',origin),p=await f.service.challenge(identity,c.clientId,origin)
    f.reauth.verify.mockResolvedValue(false)
    await expect(f.service.unlock(identity,c.clientId,origin,p.challengeId,'wrong','123456')).rejects.toMatchObject({status:403})
    f.reauth.verify.mockResolvedValue(true)
    await expect(f.service.unlock(identity,c.clientId,origin,p.challengeId,'correct','123456')).rejects.toMatchObject({status:403})
    expect(f.reauth.verify).toHaveBeenCalledTimes(1)
  })
  it.each(['credentials', 'deadline'] as const)('rechecks %s after expensive verification', async changed => {
    const f=fixture(),c=await f.service.register(identity,'refresh',origin),p=await f.service.challenge(identity,c.clientId,origin)
    f.reauth.verify.mockImplementation(()=>{ if(changed==='credentials')f.authority.credentialVersion='changed';else f.advance(120001);return Promise.resolve(true) })
    await expect(f.service.unlock(identity,c.clientId,origin,p.challengeId,'password','123456')).rejects.toMatchObject({status:403})
  })
  it('status never refreshes inactivity, lock is idempotent and does not call central logout', async () => {
    const f=fixture(),{c}=await f.setup()
    const initial=await f.service.current(identity,c.clientId,origin)
    f.advance(299000);expect(await f.service.current(identity,c.clientId,origin)).toEqual({ ...initial, serverNow: 300000 })
    f.advance(1001);expect(await f.service.current(identity,c.clientId,origin)).toEqual({state:'LOCKED',serverNow:301001})
    await f.service.lock(identity,c.clientId,origin);await f.service.lock(identity,c.clientId,origin)
    await expect(f.service.current(identity,c.clientId,origin)).rejects.toMatchObject({status:423})
  })
  it.each(['origin','policy','credentials','wrong-session','wrong-client','wrong-origin','rotated','expired','step-up'] as const)('denies release after %s change',async kind=>{
    const f=fixture(),{c,s,request}=await f.setup(),op=await request();let client=c.clientId,session=s.sessionId,o=origin
    if(kind==='origin')f.revoke();if(kind==='policy')f.authority.policy.version++;if(kind==='credentials')f.authority.credentialVersion='new'
    if(kind==='wrong-session')session=entropy.token();if(kind==='wrong-client')client=entropy.token();if(kind==='wrong-origin')o='https://evil.test'
    if(kind==='rotated')f.rotate();if(kind==='expired')f.advance(30000);if(kind==='step-up')f.advance(60000)
    await expect(f.service.consume(identity,client,o,session,op.operationId)).rejects.toBeDefined();expect(f.sealer.seal).not.toHaveBeenCalled()
  })
  it('audit failure rolls consumption back and never returns envelope',async()=>{
    const f=fixture(),{c,s,request}=await f.setup(),op=await request();f.failAudit(true)
    await expect(f.service.consume(identity,c.clientId,origin,s.sessionId,op.operationId)).rejects.toThrow('audit unavailable')
    f.failAudit(false);expect(await f.service.operation(identity,c.clientId,origin,op.operationId)).toEqual({state:'AUTHORIZED'})
    await expect(f.service.consume(identity,c.clientId,origin,s.sessionId,op.operationId)).resolves.toHaveProperty('envelope')
  })
  it('post-commit origin loss denies payload without reopening consumed authorization',async()=>{
    const f=fixture(),{c,s,request}=await f.setup(),op=await request();f.onCommit(()=>f.revoke())
    await expect(f.service.consume(identity,c.clientId,origin,s.sessionId,op.operationId)).rejects.toMatchObject({status:423})
    expect([...f.records().values()]).toContainEqual(expect.objectContaining({state:'CONSUMED'}))
    expect(f.events().filter(e=>e.type==='DELIVERY_RELEASE_COMMITTED')).toHaveLength(1)
  })
  it('expiration after commit withholds the envelope without reopening the grant',async()=>{
    const f=fixture(),{c,s,request}=await f.setup(),op=await request()
    f.onCommit(()=>f.advance(30000))
    await expect(f.service.consume(identity,c.clientId,origin,s.sessionId,op.operationId)).rejects.toMatchObject({status:409})
    expect([...f.records().values()]).toContainEqual(expect.objectContaining({state:'CONSUMED'}))
    expect(f.events().filter(e=>e.type==='DELIVERY_RELEASE_COMMITTED')).toHaveLength(1)
  })
  it('never changes an authorized context when the license deadline becomes shorter', async () => {
    const f=fixture(),{c,s,request}=await f.setup(),op=await request()
    f.authority.validUntil=2000
    await expect(f.service.consume(identity,c.clientId,origin,s.sessionId,op.operationId)).rejects.toMatchObject({status:409})
    expect(f.sealer.seal).not.toHaveBeenCalled()
    expect(await f.service.operation(identity,c.clientId,origin,op.operationId)).toEqual({state:'AUTHORIZED'})
  })
  it('license expiration during sealing denies even while its SQL row remains locked', async () => {
    const f=fixture();f.authority.validUntil=1100
    const {c,s,request}=await f.setup(),op=await request()
    f.sealer.seal.mockImplementation(()=>{f.advance(100);return Promise.resolve('ciphertext')})
    await expect(f.service.consume(identity,c.clientId,origin,s.sessionId,op.operationId)).rejects.toMatchObject({status:409})
    expect(f.events().filter(e=>e.type==='DELIVERY_RELEASE_COMMITTED')).toHaveLength(0)
  })
  it('expiration during sealing aborts consumption and audit',async()=>{
    const f=fixture(),{c,s,request}=await f.setup(),op=await request();f.sealer.seal.mockImplementation(()=>{f.advance(30000);return Promise.resolve('ciphertext')})
    await expect(f.service.consume(identity,c.clientId,origin,s.sessionId,op.operationId)).rejects.toMatchObject({status:409})
    expect(f.events().filter(e=>e.type==='DELIVERY_RELEASE_COMMITTED')).toHaveLength(0)
  })
  it('status never includes key/payload; cancellation cannot reverse consumption',async()=>{
    const f=fixture(),{c,s,request}=await f.setup(),op=await request()
    expect(await f.service.operation(identity,c.clientId,origin,op.operationId)).toEqual({state:'AUTHORIZED'})
    expect(await f.service.operation(identity,c.clientId,origin,op.operationId,true)).toEqual({state:'CANCELLED'})
    await expect(f.service.consume(identity,c.clientId,origin,s.sessionId,op.operationId)).rejects.toMatchObject({status:409})
    const other=await request();await f.service.consume(identity,c.clientId,origin,s.sessionId,other.operationId)
    expect(await f.service.operation(identity,c.clientId,origin,other.operationId,true)).toEqual({state:'CONSUMED'})
  })
  it('denied requests debit shared admission quota',async()=>{
    const f=fixture(),{request}=await f.setup();f.authorizeSecret.mockRejectedValue(new VaultError('VAULT_FORBIDDEN',403))
    for(let n=0;n<30;n++)await expect(request()).rejects.toMatchObject({status:403})
    await expect(request()).rejects.toMatchObject({status:429});expect(f.authorizeSecret).toHaveBeenCalledTimes(30)
  })
  it('limits challenge and client issuance independently from central authentication',async()=>{
    const f=fixture(),c=await f.service.register(identity,'refresh',origin)
    for(let n=0;n<5;n++)await f.service.challenge(identity,c.clientId,origin)
    await expect(f.service.challenge(identity,c.clientId,origin)).rejects.toMatchObject({status:429})
    for(let n=0;n<9;n++)await f.service.register(identity,'refresh',origin)
    await expect(f.service.register(identity,'refresh',origin)).rejects.toMatchObject({status:429})
  })
  it('rejects fifth in-flight request without queuing and releases admission on error',async()=>{
    const f=fixture();let release!:()=>void;const gate=new Promise<void>(r=>{release=r})
    const pending=Array.from({length:4},()=>f.service.admitted(()=>gate))
    await expect(f.service.admitted(()=>Promise.resolve(1))).rejects.toMatchObject({status:503});release();await Promise.all(pending)
    await expect(f.service.admitted(()=>Promise.reject(new Error('failed')))).rejects.toThrow();await expect(f.service.admitted(()=>Promise.resolve(1))).resolves.toBe(1)
  })
  it.each(['before admission', 'before final authorization', 'after final authorization'] as const)('linearizes administrative origin revocation %s',async point=>{
    const f=fixture(),{c,s}=await f.setup(),admin=new VaultAdministrationService(f.service,entropy)
    const proposal=await admin.propose(identity,c.clientId,origin,s.sessionId,{kind:'item',secretId:4,enabled:true})
    if(point==='before admission')f.revoke()
    if(point==='before final authorization'){
      // The first read succeeded; logout then wins before the final read under SQL locks.
      f.verifier.assert.mockImplementationOnce(()=>{f.revoke();return Promise.resolve()})
    }
    if(point==='after final authorization'){
      f.verifier.assert.mockResolvedValueOnce(undefined)
      f.verifier.assert.mockImplementationOnce(()=>{f.revoke();return Promise.resolve()})
    }
    const approval=admin.approve(identity,c.clientId,origin,s.sessionId,proposal.proposalId)
    if(point==='after final authorization'){
      await expect(approval).resolves.toEqual({state:'APPLIED'})
      expect(f.events().filter(e=>e.type==='POLICY_CHANGED')).toHaveLength(1)
    }else{
      await expect(approval).rejects.toMatchObject({status:423})
      expect(f.events().filter(e=>e.type==='POLICY_CHANGED')).toHaveLength(0)
    }
    expect(f.approve).toHaveBeenCalledTimes(point==='before admission'?0:1)
    expect(f.sealer.seal).not.toHaveBeenCalled()
  })
  it('bounds denial audit independently without logging request content', async () => {
    const f=fixture()
    for(let n=0;n<5;n++)await f.service.recordDenial(identity,'VAULT_FORBIDDEN')
    await expect(f.service.recordDenial(identity,'VAULT_FORBIDDEN')).rejects.toMatchObject({status:429})
    expect(f.events()).toHaveLength(5)
    expect(f.events()[0]).toEqual({type:'OPERATION_DENIED',reasonCode:'VAULT_FORBIDDEN',policyVersion:1})
  })
  it('administrative proposal/approval needs fresh own session and durable audit',async()=>{
    const f=fixture(),{c,s}=await f.setup(),admin=new VaultAdministrationService(f.service,entropy)
    const p=await admin.propose(identity,c.clientId,origin,s.sessionId,{kind:'item',secretId:4,enabled:true})
    expect(f.propose).toHaveBeenCalled();await expect(admin.approve(identity,c.clientId,origin,s.sessionId,p.proposalId)).resolves.toEqual({state:'APPLIED'})
    f.advance(60000);await expect(admin.approve(identity,c.clientId,origin,s.sessionId,p.proposalId)).rejects.toMatchObject({status:423})
  })
})
describe('policy fails closed',()=>{
  it.each([{unlock:'false'},{localReauth:1},{reveal:'true'},{copy:undefined},{version:0},{tenantQuota:0},{tenantQuota:301},{origin:'http://vault.test'},{origin:'https://vault.test/path'},{origin:'invalid'}])('rejects malformed policy %j', patch=>{
    const p=fixture().authority.policy;expect(()=>assertPolicy({...p,...patch} as typeof p)).toThrow(VaultError)
  })
})

describe('vault step-up by login method (NA-0184)', () => {
  it.each([['local', 'password_totp'], ['ldap', 'password_totp'], ['oidc', 'provider'], ['google', 'provider']] as const)(
    '%s origin gets %s challenge and the signed method reaches the step-up adapter', async (method, stepUp) => {
      const f = fixture(); f.useMethod(method)
      const c = await f.service.register(identity, 'refresh', origin)
      expect(c.stepUp).toBe(stepUp)
      const p = await f.service.challenge(identity, c.clientId, origin)
      expect(p.stepUp).toBe(stepUp)
      await f.service.unlock(identity, c.clientId, origin, p.challengeId, 'password', '123456')
      expect(f.reauth.verify).toHaveBeenCalledWith('password', '123456', expect.objectContaining({ email: 'user@example.test' }), method, identity)
    })
  it('denies registration for a method the tenant policy does not allow', async () => {
    const f = fixture(); f.useMethod('ldap'); f.authority.methods.ldap = false
    await expect(f.service.register(identity, 'refresh', origin)).rejects.toMatchObject({ status: 403 })
  })
  it('denies an existing client after the tenant disables its login method', async () => {
    const f = fixture(); f.useMethod('ldap')
    const { c, s } = await f.setup()
    f.authority.methods.ldap = false
    await expect(f.service.challenge(identity, c.clientId, origin)).rejects.toMatchObject({ status: 403 })
    await expect(f.service.request(identity, c.clientId, origin, s.sessionId, 'reveal', 4, key)).rejects.toMatchObject({ status: 403 })
  })
})

describe('vault provider step-up flow (NA-0184)', () => {
  async function pending(method: VaultAuthMethod = 'oidc') {
    const f = fixture(); f.useMethod(method)
    const c = await f.service.register(identity, 'refresh', origin)
    const p = await f.service.challenge(identity, c.clientId, origin)
    return { f, c, p }
  }
  it('binds the provider to the challenge digest and unlocks with provider MFA', async () => {
    const { f, c, p } = await pending()
    await expect(f.service.providerBegin(identity, c.clientId, origin, p.challengeId)).resolves.toMatchObject({ kind: 'redirect' })
    const binding = createHash('sha256').update(p.challengeId).digest('hex')
    expect(f.provider.begin).toHaveBeenCalledWith(identity, 'oidc', binding)
    await expect(f.service.providerComplete(identity, c.clientId, origin, p.challengeId, { state: 's', code: 'c' })).resolves.toEqual({ totpRequired: false })
    expect(f.provider.complete).toHaveBeenCalledWith(identity, 'oidc', binding, { state: 's', code: 'c' })
    const s = await f.service.unlockProvider(identity, c.clientId, origin, p.challengeId, undefined)
    expect(s.sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(f.reauth.verifySecondFactor).not.toHaveBeenCalled()
    expect(f.reauth.verify).not.toHaveBeenCalled()
  })
  it('requires NodeAccess TOTP when the provider did not assert MFA', async () => {
    const { f, c, p } = await pending('google')
    f.provider.complete.mockResolvedValue({ mfa: false })
    await expect(f.service.providerComplete(identity, c.clientId, origin, p.challengeId, { idToken: 'token' })).resolves.toEqual({ totpRequired: true })
    f.reauth.verifySecondFactor.mockReturnValue(false)
    await expect(f.service.unlockProvider(identity, c.clientId, origin, p.challengeId, '000000')).rejects.toMatchObject({ status: 403 })
    f.reauth.verifySecondFactor.mockReturnValue(true)
    await expect(f.service.unlockProvider(identity, c.clientId, origin, p.challengeId, '123456')).rejects.toMatchObject({ status: 403 })
  })
  it('burns the challenge and audits when the provider proof is rejected', async () => {
    const { f, c, p } = await pending()
    f.provider.complete.mockRejectedValue(new Error('private provider diagnostic'))
    await expect(f.service.providerComplete(identity, c.clientId, origin, p.challengeId, { state: 's', code: 'c' })).rejects.toMatchObject({ status: 403 })
    expect(f.events().some(e => e.type === 'UNLOCK_DENIED' && e.reasonCode === 'PROVIDER_PROOF_REJECTED')).toBe(true)
    await expect(f.service.providerBegin(identity, c.clientId, origin, p.challengeId)).rejects.toMatchObject({ status: 403 })
  })
  it('denies unlock without a provider proof and burns the challenge', async () => {
    const { f, c, p } = await pending()
    await expect(f.service.unlockProvider(identity, c.clientId, origin, p.challengeId, '123456')).rejects.toMatchObject({ status: 403 })
    await expect(f.service.providerComplete(identity, c.clientId, origin, p.challengeId, { state: 's', code: 'c' })).rejects.toMatchObject({ status: 403 })
  })
  it('does not let one proof unlock twice', async () => {
    const { f, c, p } = await pending()
    await f.service.providerComplete(identity, c.clientId, origin, p.challengeId, { state: 's', code: 'c' })
    await f.service.unlockProvider(identity, c.clientId, origin, p.challengeId, undefined)
    await expect(f.service.unlockProvider(identity, c.clientId, origin, p.challengeId, undefined)).rejects.toMatchObject({ status: 403 })
  })
  it.each(['local', 'ldap'] as const)('rejects provider step-up for %s sessions', async method => {
    const { f, c, p } = await pending(method)
    await expect(f.service.providerBegin(identity, c.clientId, origin, p.challengeId)).rejects.toMatchObject({ status: 403 })
    await expect(f.service.unlockProvider(identity, c.clientId, origin, p.challengeId, '123456')).rejects.toMatchObject({ status: 403 })
    expect(f.provider.begin).not.toHaveBeenCalled()
  })
  it('a provider session cannot unlock with a password form', async () => {
    const { f, c, p } = await pending('oidc')
    f.reauth.verify.mockResolvedValue(false)
    await expect(f.service.unlock(identity, c.clientId, origin, p.challengeId, 'password', '123456')).rejects.toMatchObject({ status: 403 })
  })
})

