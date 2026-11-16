import { shallowReactive, readonly, type DeepReadonly } from 'vue'
import { assertVaultEnvelopeContext, createVaultRecipient, openVaultEnvelope } from './vault-envelope'
import { createVaultTransport, VaultClientError, type VaultFailure, type VaultPortalIdentity, type VaultTransport } from './vault-http'

type Action = 'reveal' | 'copy'
interface Deadline { mono: number; wall: number }
interface Clock { mono(): number; wall(): number }
interface SessionReply { sessionId: string; idleUntil: number; expiresAt: number; serverNow: number }
interface ClientReply { clientId: string; expiresAt: number; serverNow: number }
interface Authorization { operationId: string; expiresAt: number; serverNow: number; state: string; context: unknown }
interface DeliveryState { phase: 'locked' | 'unlocking' | 'unlocked' | 'delivering' | 'revealed' | 'copy-ready' | 'copying'; value: string; error: VaultFailure | null; copied: boolean }
export interface VaultDeliveryDependencies {
  identity(): VaultPortalIdentity | null
  transport?: VaultTransport
  clock?: Clock
  recipient?: typeof createVaultRecipient
  open?: typeof openVaultEnvelope
  clipboard?: (value: string) => Promise<void>
}
const opaque = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v)
const fail = (reason: VaultFailure = 'unavailable'): never => { throw new VaultClientError(reason) }
function sameIdentity(a: VaultPortalIdentity | null, b: VaultPortalIdentity | null): boolean {
  return !!a && !!b && a.userId === b.userId && a.tenantId === b.tenantId && a.refreshToken === b.refreshToken && a.origin === b.origin
}
/** Page-local capabilities and plaintext; never Pinia, browser storage, catalog, or error payloads. */
export interface VaultDelivery {
  state: DeepReadonly<DeliveryState>
  unlock(password: string, token: string): Promise<void>
  deliver(action: Action, secretId: number): Promise<void>
  confirmCopy(): Promise<void>
  dismiss(): void; lock(): void; tick(): void; dispose(): void
}
export function createVaultDelivery(deps: VaultDeliveryDependencies): VaultDelivery {
  const transport = deps.transport ?? createVaultTransport()
  const clock = deps.clock ?? { mono: (): number => performance.now(), wall: Date.now }
  const recipient = deps.recipient ?? createVaultRecipient, open = deps.open ?? openVaultEnvelope
  const clipboard = deps.clipboard ?? ((value: string): Promise<void> => navigator.clipboard.writeText(value))
  const state = shallowReactive<DeliveryState>({ phase: 'locked', value: '', error: null, copied: false })
  let epoch = 0, disposed = false, abort = new AbortController()
  let owner: VaultPortalIdentity | null = null, clientId = '', sessionId = '', operationId = '', pendingCopy = ''
  let clientUntil: Deadline | null = null, sessionUntil: Deadline | null = null, proofUntil: Deadline | null = null, valueUntil: Deadline | null = null
  const start = (): Deadline => ({ mono: clock.mono(), wall: clock.wall() })
  const live = (d: Deadline | null): boolean => !!d && clock.mono() < d.mono && clock.wall() < d.wall
  function deadline(at: Deadline, serverNow: number, expiresAt: number, cap: number): Deadline {
    if (!Number.isSafeInteger(serverNow) || !Number.isSafeInteger(expiresAt) || expiresAt <= serverNow) fail('expired')
    const ttl = Math.max(0, Math.min(cap, expiresAt - serverNow) - 1000)
    return { mono: at.mono + ttl, wall: at.wall + ttl }
  }
  function clearValue(): void { state.value = ''; pendingCopy = ''; valueUntil = null; state.copied = false }
  function invalidate(): void { ++epoch; abort.abort(); abort = new AbortController(); clearValue(); operationId = '' }
  function cleanup(identity: VaultPortalIdentity | null, client: string, operation = '', removeClient = false): void {
    if (!identity || !client) return
    if (operation) void transport.post('operations/cancel', { operationId: operation }, identity, client).catch(() => undefined)
    if (removeClient) void transport.post('sessions/lock', {}, identity, client).catch(() => undefined)
  }
  function lock(): void {
    const old = owner, client = clientId, operation = operationId
    invalidate(); owner = null; clientId = ''; sessionId = ''; clientUntil = null; sessionUntil = null; proofUntil = null
    state.phase = 'locked'; state.error = null
    cleanup(old, client, operation, true)
  }
  function guard(version: number, identity: VaultPortalIdentity): void {
    if (disposed || version !== epoch || !sameIdentity(identity, deps.identity())) fail('locked')
  }
  function requireProof(): void {
    if (!live(clientUntil) || !live(sessionUntil) || !live(proofUntil) || !sessionId) fail('locked')
  }
  function failure(error: unknown, version: number): void {
    if (version !== epoch || disposed) return
    const reason = error instanceof VaultClientError ? error.reason : 'unavailable'
    lock(); state.error = reason
  }
  async function unlock(password: string, token: string): Promise<void> {
    if (disposed || state.phase === 'unlocking' || state.phase === 'delivering' || state.phase === 'copying') return
    const identity = deps.identity()
    if (!identity) { lock(); state.error = 'unsupported'; return }
    if (!sameIdentity(identity, owner) || !live(clientUntil)) lock()
    invalidate(); const version = epoch, signal = abort.signal
    owner = identity; state.phase = 'unlocking'; state.error = null
    try {
      if (!clientId) {
        const at = start(), reply = await transport.post<ClientReply>('clients', { refreshToken: identity.refreshToken }, identity, undefined, signal)
        if (!opaque(reply.clientId)) fail()
        try { guard(version, identity) } catch (error) { cleanup(identity, reply.clientId, '', true); throw error }
        clientId = reply.clientId; clientUntil = deadline(at, reply.serverNow, reply.expiresAt, 1800000)
      }
      guard(version, identity)
      const challenge = await transport.post<{ challengeId: string }>('sessions/challenges', {}, identity, clientId, signal)
      guard(version, identity); if (!opaque(challenge.challengeId)) fail()
      const at = start(), reply = await transport.post<SessionReply>('sessions/unlock', { challengeId: challenge.challengeId, password, token }, identity, clientId, signal)
      password = ''; token = ''
      guard(version, identity); if (!opaque(reply.sessionId)) fail()
      sessionUntil = deadline(at, reply.serverNow, Math.min(reply.expiresAt, reply.idleUntil), 300000)
      proofUntil = deadline(at, reply.serverNow, reply.serverNow + 60000, 60000)
      if (!live(sessionUntil) || !live(clientUntil) || !live(proofUntil)) fail('expired')
      sessionId = reply.sessionId; state.phase = 'unlocked'
    } catch (error) { failure(error, version) } finally { password = ''; token = '' }
  }
  async function deliver(action: Action, secretId: number): Promise<void> {
    tick()
    if (disposed || !['unlocked', 'revealed', 'copy-ready'].includes(state.phase)) return
    const identity = deps.identity()
    if (!sameIdentity(identity, owner) || !identity) { lock(); return }
    invalidate(); const version = epoch, signal = abort.signal
    state.phase = 'delivering'; state.error = null
    try {
      requireProof()
      const key = await recipient()
      guard(version, identity); requireProof()
      const digestBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clientId))
      guard(version, identity); requireProof()
      const clientDigest = Array.from(new Uint8Array(digestBytes), b => b.toString(16).padStart(2, '0')).join('')
      const client = clientId, at = start()
      const reply = await transport.post<Authorization>('operations', { sessionId, action, secretId, recipient: key.recipient }, identity, client, signal)
      try { guard(version, identity) } catch (error) { if (opaque(reply.operationId)) cleanup(identity, client, reply.operationId); throw error }
      requireProof(); assertVaultEnvelopeContext(reply.context)
      const context = reply.context
      if (!opaque(reply.operationId) || reply.state !== 'AUTHORIZED' || context.operationId !== reply.operationId || context.expiresAt !== reply.expiresAt
        || context.tenantId !== identity.tenantId || context.userId !== identity.userId || context.clientId !== clientDigest || context.action !== action
        || context.itemRef !== `secret:${secretId}` || context.origin !== identity.origin || context.recipientThumbprint !== key.thumbprint) fail()
      operationId = reply.operationId
      const authorizedUntil = deadline(at, reply.serverNow, reply.expiresAt, 30000)
      if (!live(authorizedUntil)) fail('expired')
      const consumed = await transport.post<{ envelope: string }>('operations/consume', { sessionId, operationId }, identity, client, signal)
      guard(version, identity); requireProof(); if (!live(authorizedUntil)) fail('expired')
      const value = await open(consumed.envelope, key.privateKey, context)
      guard(version, identity); requireProof(); if (!live(authorizedUntil)) fail('expired')
      operationId = ''
      const now = start(); valueUntil = { mono: Math.min(now.mono + 15000, authorizedUntil.mono), wall: Math.min(now.wall + 15000, authorizedUntil.wall) }
      if (action === 'reveal') { state.value = value; state.phase = 'revealed' } else { pendingCopy = value; state.phase = 'copy-ready' }
    } catch (error) { failure(error, version) }
  }
  async function confirmCopy(): Promise<void> {
    tick()
    if (disposed || state.phase !== 'copy-ready') return
    const identity = deps.identity(), version = epoch
    if (!identity || !sameIdentity(identity, owner) || !live(valueUntil)) { lock(); return }
    try {
      guard(version, identity); requireProof()
      const value = pendingCopy; pendingCopy = ''; state.phase = 'copying'
      // This invocation is synchronous with the explicit confirmation gesture. OS clipboard cannot be revoked afterward.
      await clipboard(value)
      guard(version, identity); requireProof()
      clearValue(); state.phase = 'unlocked'; state.copied = true
    } catch (error) {
      if (version !== epoch || disposed) return
      clearValue(); state.phase = 'unlocked'; state.error = error instanceof VaultClientError ? error.reason : 'clipboard'
    }
  }
  function dismiss(): void {
    const op = operationId; invalidate(); cleanup(owner, clientId, op)
    state.phase = live(proofUntil) && live(sessionUntil) ? 'unlocked' : 'locked'; state.error = null
  }
  function tick(): void {
    if (disposed) return
    if (owner && !sameIdentity(owner, deps.identity())) { lock(); return }
    if (clientId && (!live(clientUntil) || (sessionUntil && !live(sessionUntil)))) { lock(); return }
    if (proofUntil && !live(proofUntil)) {
      invalidate(); sessionId = ''; proofUntil = null; state.phase = 'locked'; state.error = 'locked'; return
    }
    if (valueUntil && !live(valueUntil)) dismiss()
  }
  function dispose(): void { lock(); disposed = true }
  return { state: readonly(state), unlock, deliver, confirmCopy, dismiss, lock, tick, dispose }
}
