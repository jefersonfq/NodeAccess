import { shallowReactive, readonly, type DeepReadonly } from 'vue'
import { assertVaultEnvelopeContext, createVaultRecipient, openVaultEnvelope } from './vault-envelope'
import { createVaultTransport, VaultClientError, type VaultFailure, type VaultPortalIdentity, type VaultTransport } from './vault-http'
import { VaultAdministrationOverviewSchema, type VaultAdministrationChange, type VaultAdministrationOverview } from '@nodeaccess/shared'

type Action = 'reveal' | 'copy'
interface Deadline { mono: number; wall: number }
interface Clock { mono(): number; wall(): number }
/** NA-0186: `proofUntil` is the tenant's reveal/copy window (absent from older servers = 60 s). */
interface SessionReply { sessionId: string; idleUntil: number; expiresAt: number; serverNow: number; proofUntil?: number }
export type VaultStepUp = 'password_totp' | 'provider'
interface ClientReply { clientId: string; expiresAt: number; serverNow: number; stepUp?: unknown }
type ProviderStart = { kind: 'redirect'; authorizationUrl: string } | { kind: 'google'; clientId: string; nonce: string }
/** UI adapters for NA-0184 provider step-up; they never see vault capabilities. */
export interface VaultProviderConfirmation {
  redirect(authorizationUrl: string, signal: AbortSignal): Promise<{ state: string; code: string }>
  google(clientId: string, nonce: string, signal: AbortSignal): Promise<string>
  totp(signal: AbortSignal): Promise<string>
}
interface Authorization { operationId: string; expiresAt: number; serverNow: number; state: string; context: unknown }
interface DeliveryState {
  phase: 'locked' | 'unlocking' | 'unlocked' | 'delivering' | 'revealed' | 'copy-ready' | 'copying'; value: string; error: VaultFailure | null; copied: boolean
  /** Confirmation the server expects for this session's login method; null until known. */
  stepUp: VaultStepUp | null
  /** True only while waiting on the provider window/Google/TOTP; no plaintext exists in this phase. */
  providerPending: boolean
}
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
/** Public parameters the extension sent to the consent page; the code is bound to them server side. */
export interface ExtensionConsent { extensionId: string; redirectUri: string; state: string; codeChallenge: string; deviceJkt: string }
/** Page-local capabilities and plaintext; never Pinia, browser storage, catalog, or error payloads. */
export interface VaultDelivery {
  state: DeepReadonly<DeliveryState>
  unlock(password: string, token: string): Promise<void>
  prepare(): Promise<void>
  unlockWithProvider(confirm: VaultProviderConfirmation): Promise<void>
  deliver(action: Action, secretId: number): Promise<void>
  /** NA-0183: consent for the browser extension inside the unlocked session; returns the one-time code. */
  authorizeExtension(request: ExtensionConsent): Promise<string | null>
  /** NA-0183 manager screen: users, grants and pending proposals (needs the confirmed session). */
  administrationOverview(): Promise<VaultAdministrationOverview | null>
  /** Proposes a change; another manager approves it. The session stays unlocked within the proof window. */
  proposeChange(change: VaultAdministrationChange): Promise<boolean>
  /** Approves a listed proposal; every approval bumps the policy version, so the session is locked afterwards. */
  approveProposal(reference: string): Promise<boolean>
  confirmCopy(): Promise<void>
  dismiss(): void; lock(): void; tick(): void; dispose(): void
}
export function createVaultDelivery(deps: VaultDeliveryDependencies): VaultDelivery {
  const transport = deps.transport ?? createVaultTransport()
  const clock = deps.clock ?? { mono: (): number => performance.now(), wall: Date.now }
  const recipient = deps.recipient ?? createVaultRecipient, open = deps.open ?? openVaultEnvelope
  const clipboard = deps.clipboard ?? ((value: string): Promise<void> => navigator.clipboard.writeText(value))
  const state = shallowReactive<DeliveryState>({ phase: 'locked', value: '', error: null, copied: false, stepUp: null, providerPending: false })
  let epoch = 0, disposed = false, abort = new AbortController()
  let owner: VaultPortalIdentity | null = null, clientId = '', sessionId = '', operationId = '', pendingCopy = ''
  let clientUntil: Deadline | null = null, sessionUntil: Deadline | null = null, proofUntil: Deadline | null = null, valueUntil: Deadline | null = null
  // Administration and extension consent always need a proof younger than 60 s; the absolute session end bounds idle renewals.
  let strictProofUntil: Deadline | null = null, sessionEnd: Deadline | null = null
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
    invalidate(); owner = null; clientId = ''; sessionId = ''; clientUntil = null; sessionUntil = null; proofUntil = null; strictProofUntil = null; sessionEnd = null
    state.phase = 'locked'; state.error = null; state.stepUp = null; state.providerPending = false
    cleanup(old, client, operation, true)
  }
  function guard(version: number, identity: VaultPortalIdentity): void {
    if (disposed || version !== epoch || !sameIdentity(identity, deps.identity())) fail('locked')
  }
  function requireProof(strict = false): void {
    if (!live(clientUntil) || !live(sessionUntil) || !live(proofUntil) || !sessionId || (strict && !live(strictProofUntil))) fail('locked')
  }
  function opened(at: Deadline, reply: SessionReply): void {
    sessionUntil = deadline(at, reply.serverNow, Math.min(reply.expiresAt, reply.idleUntil), 300000)
    sessionEnd = deadline(at, reply.serverNow, reply.expiresAt, 1800000)
    const window = typeof reply.proofUntil === 'number' ? reply.proofUntil : reply.serverNow + 60000
    proofUntil = deadline(at, reply.serverNow, window, 900000)
    strictProofUntil = deadline(at, reply.serverNow, reply.serverNow + 60000, 60000)
    if (!live(sessionUntil) || !live(clientUntil) || !live(proofUntil)) fail('expired')
  }
  /** The server renews inactivity (5 min) on each authorized operation; mirror it without passing the absolute end. */
  function renewed(at: Deadline): void {
    const idle = { mono: at.mono + 299000, wall: at.wall + 299000 }
    sessionUntil = sessionEnd && (sessionEnd.mono < idle.mono || sessionEnd.wall < idle.wall) ? sessionEnd : idle
  }
  function failure(error: unknown, version: number): void {
    if (version !== epoch || disposed) return
    const reason = error instanceof VaultClientError ? error.reason : 'unavailable'
    lock(); state.error = reason
  }
  async function ensureClient(identity: VaultPortalIdentity, version: number, signal: AbortSignal): Promise<void> {
    if (!clientId) {
      const at = start(), reply = await transport.post<ClientReply>('clients', { refreshToken: identity.refreshToken }, identity, undefined, signal)
      if (!opaque(reply.clientId)) fail()
      try { guard(version, identity) } catch (error) { cleanup(identity, reply.clientId, '', true); throw error }
      clientId = reply.clientId; clientUntil = deadline(at, reply.serverNow, reply.expiresAt, 1800000)
      state.stepUp = reply.stepUp === 'provider' ? 'provider' : 'password_totp'
    }
    guard(version, identity)
  }
  function begin(): { identity: VaultPortalIdentity; version: number; signal: AbortSignal } | null {
    if (disposed || state.phase === 'unlocking' || state.phase === 'delivering' || state.phase === 'copying') return null
    const identity = deps.identity()
    if (!identity) { lock(); state.error = 'unsupported'; return null }
    if (!sameIdentity(identity, owner) || !live(clientUntil)) lock()
    invalidate(); owner = identity
    return { identity, version: epoch, signal: abort.signal }
  }
  /** Registers the client early so the panel renders the confirmation the server expects. */
  async function prepare(): Promise<void> {
    if (state.phase !== 'locked' || (state.stepUp && live(clientUntil))) return
    const ctx = begin(); if (!ctx) return
    try { await ensureClient(ctx.identity, ctx.version, ctx.signal) } catch (error) { failure(error, ctx.version) }
  }
  async function unlockWithProvider(confirm: VaultProviderConfirmation): Promise<void> {
    const ctx = begin(); if (!ctx) return
    const { identity, version, signal } = ctx
    state.phase = 'unlocking'; state.error = null
    try {
      await ensureClient(identity, version, signal)
      if (state.stepUp !== 'provider') fail('unsupported')
      const challenge = await transport.post<{ challengeId: string; stepUp?: unknown }>('sessions/challenges', {}, identity, clientId, signal)
      guard(version, identity); if (!opaque(challenge.challengeId) || challenge.stepUp !== 'provider') fail()
      const challengeId = challenge.challengeId
      const started = await transport.post<ProviderStart>('sessions/provider/begin', { challengeId }, identity, clientId, signal)
      guard(version, identity)
      state.providerPending = true
      const proof: { state: string; code: string } | { idToken: string } =
        started.kind === 'redirect' && typeof started.authorizationUrl === 'string' ? await confirm.redirect(started.authorizationUrl, signal)
          : started.kind === 'google' && typeof started.clientId === 'string' && typeof started.nonce === 'string' ? { idToken: await confirm.google(started.clientId, started.nonce, signal) }
            : fail()
      state.providerPending = false
      guard(version, identity)
      const done = await transport.post<{ totpRequired?: unknown }>('sessions/provider/complete', { challengeId, ...proof }, identity, clientId, signal)
      guard(version, identity)
      let token = ''
      if (done.totpRequired !== false) {
        state.providerPending = true; token = await confirm.totp(signal); state.providerPending = false
        guard(version, identity); if (!/^\d{6}$/.test(token)) fail('reauth')
      }
      const at = start(), reply = await transport.post<SessionReply>('sessions/unlock-provider', token ? { challengeId, token } : { challengeId }, identity, clientId, signal)
      token = ''
      guard(version, identity); if (!opaque(reply.sessionId)) fail()
      opened(at, reply)
      sessionId = reply.sessionId; state.phase = 'unlocked'
    } catch (error) { state.providerPending = false; failure(error, version) }
  }
  async function unlock(password: string, token: string): Promise<void> {
    if (disposed || state.phase === 'unlocking' || state.phase === 'delivering' || state.phase === 'copying') return
    const identity = deps.identity()
    if (!identity) { lock(); state.error = 'unsupported'; return }
    if (!sameIdentity(identity, owner) || !live(clientUntil)) lock()
    invalidate(); const version = epoch, signal = abort.signal
    owner = identity; state.phase = 'unlocking'; state.error = null
    try {
      await ensureClient(identity, version, signal)
      if (state.stepUp === 'provider') fail('unsupported')
      const challenge = await transport.post<{ challengeId: string }>('sessions/challenges', {}, identity, clientId, signal)
      guard(version, identity); if (!opaque(challenge.challengeId)) fail()
      const at = start(), reply = await transport.post<SessionReply>('sessions/unlock', { challengeId: challenge.challengeId, password, token }, identity, clientId, signal)
      password = ''; token = ''
      guard(version, identity); if (!opaque(reply.sessionId)) fail()
      opened(at, reply)
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
      requireProof(); assertVaultEnvelopeContext(reply.context); renewed(at)
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
  async function authorizeExtension(request: ExtensionConsent): Promise<string | null> {
    tick()
    if (disposed || state.phase !== 'unlocked') return null
    const identity = deps.identity()
    if (!identity || !sameIdentity(identity, owner)) { lock(); return null }
    invalidate(); const version = epoch, signal = abort.signal
    state.phase = 'delivering'; state.error = null
    try {
      requireProof(true)
      const reply = await transport.post<{ code?: unknown }>('extension/authorize', { ...request, sessionId }, identity, clientId, signal)
      guard(version, identity)
      const code = reply.code
      if (!opaque(code)) return fail()
      // One consent per unlock: the session is locked again so the page holds no vault capability afterwards.
      lock()
      return code
    } catch (error) { failure(error, version); return null }
  }
  async function administration<T>(path: string, body: object, run: (reply: unknown) => T, lockAfter = false): Promise<T | null> {
    tick()
    if (disposed || state.phase !== 'unlocked') return null
    const identity = deps.identity()
    if (!identity || !sameIdentity(identity, owner)) { lock(); return null }
    invalidate(); const version = epoch, signal = abort.signal
    state.phase = 'delivering'; state.error = null
    try {
      requireProof(true)
      const reply = await transport.post<unknown>(path, { ...body, sessionId }, identity, clientId, signal)
      guard(version, identity)
      const result = run(reply)
      if (lockAfter) lock()
      else state.phase = 'unlocked'
      return result
    } catch (error) {
      // NA-0188: a proposal nobody could approve is a rule, not a broken session; keep the vault open and explain.
      if (error instanceof VaultClientError && error.reason === 'noApprover' && version === epoch && !disposed) {
        state.phase = 'unlocked'; state.error = 'noApprover'; return null
      }
      failure(error, version); return null
    }
  }
  function administrationOverview(): Promise<VaultAdministrationOverview | null> {
    return administration('administration/overview', {}, reply => {
      const parsed = VaultAdministrationOverviewSchema.safeParse(reply)
      return parsed.success ? parsed.data : fail()
    })
  }
  async function proposeChange(change: VaultAdministrationChange): Promise<boolean> {
    return (await administration('administration/proposals', { change }, reply => opaque((reply as { proposalId?: unknown } | null)?.proposalId) || fail())) === true
  }
  async function approveProposal(reference: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(reference)) return false
    return (await administration('administration/approve', { reference }, reply => (reply as { state?: unknown } | null)?.state === 'APPLIED' || fail(), true)) === true
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
  return { state: readonly(state), unlock, prepare, unlockWithProvider, deliver, authorizeExtension, administrationOverview, proposeChange, approveProposal, confirmCopy, dismiss, lock, tick, dispose }
}
