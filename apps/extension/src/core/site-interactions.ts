import { z } from 'zod'
import { ExtensionError, type ExtensionClient } from './client'
import type { Authorization } from './ports'
import { sameFillBinding, type SiteFillBinding } from './site-fill'
import type { PendingFillIntent, PendingFillStatus, CapturedSiteDraft } from './portal-fill-intent'

const origin = z.string().url().refine(value => { try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value } catch { return false } })
const positive = z.number().int().positive().safe()
const bindingSchema = z.object({ origin, tabId: z.number().int().nonnegative().safe(), frameId: z.literal(0), documentId: z.string().min(1).max(256) }).strict()
const pendingSchema = z.object({ reference: z.string().regex(/^[a-f0-9]{64}$/), siteId: positive, version: positive, origin, expiresAt: z.number().int(),
  action: z.literal('fill'), binding: bindingSchema, identity: z.string(), focused: z.boolean().default(false) }).strict()
type StoredPending = z.infer<typeof pendingSchema>
export interface InteractionSender { id?: string; url?: string; tab?: { id?: number }; frameId?: number; documentId?: string }
export interface AssistanceConfiguration {
  origin: string; capability: string; expiresAt: number; captureOptIn: boolean; locale?: 'pt-BR' | 'en';
  items: Array<{ id: number; version: number; label: string; username: string }>;
}
export interface InteractionBrowser {
  capture(): Promise<SiteFillBinding>
  inspect(binding: SiteFillBinding): Promise<SiteFillBinding | null>
  focus(binding: SiteFillBinding): Promise<void>
  install(binding: SiteFillBinding, config: AssistanceConfiguration): Promise<boolean>
  openReview(): Promise<void>
}
interface InteractionDeps {
  client: ExtensionClient; browser: InteractionBrowser; extensionId: string;
  authorization(): Promise<Authorization | null>; device(): Promise<string>;
  readPending(): Promise<unknown>; writePending(value: StoredPending | null): Promise<void>;
  fill(input: { siteId: number; version: number; origin: string }, binding: SiteFillBinding, current: () => Promise<boolean>): Promise<void>;
  now?: () => number;
}
const nonce = (): string => Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('')
const contentMessage = z.object({ type: z.literal('SITE_ASSISTANCE_INTENT'), capability: z.string().regex(/^[a-f0-9]{64}$/), origin,
  intent: z.discriminatedUnion('kind', [z.object({ kind: z.literal('fill'), id: positive, version: positive }).strict(),
    z.object({ kind: z.literal('review-capture'), username: z.string().max(320), password: z.string().min(1).max(1024), mode: z.enum(['login', 'password-change']) }).strict()]) }).strict()

/** Credential proposals exist only in this worker's memory and expire independently of popup lifetime. */
export function createSiteInteractions(deps: InteractionDeps): {
  enable(capture: boolean): Promise<void>; content(message: unknown, sender: InteractionSender): Promise<boolean>;
  rememberFill(input: { siteId: number; version: number; origin: string }): Promise<void>;
  get(): Promise<PendingFillIntent | null>; beginProof(): Promise<{ url: string }>; check(): Promise<PendingFillStatus>;
  consume(reference: string): Promise<void>; cancel(): Promise<void>; takeDraft(): Promise<CapturedSiteDraft | null>;
  clearDraft(): void; stageDraft(value: CapturedSiteDraft): Promise<void>; invalidate(): void;
} {
  const now = deps.now ?? Date.now
  let epoch = 0
  let consuming = false
  let checking: Promise<PendingFillStatus> | null = null
  let pendingWrites: Promise<unknown> = Promise.resolve()
  const locked = <T>(run: () => Promise<T>): Promise<T> => {
    const result = pendingWrites.then(run, run)
    pendingWrites = result.then(() => undefined, () => undefined)
    return result
  }
  let assistance: { config: AssistanceConfiguration; binding: SiteFillBinding; identity: string; epoch: number } | null = null
  let draft: { value: CapturedSiteDraft; identity: string; expiresAt: number } | null = null
  let draftTimer: ReturnType<typeof setTimeout> | undefined
  const clearDraft = (): void => { clearTimeout(draftTimer); draft = null }
  const snapshot = async (): Promise<{ identity: string; epoch: number }> => {
    const run = epoch, auth = await deps.authorization()
    if (!auth || auth.expiresAt <= now()) throw new ExtensionError('expired')
    const device = await deps.device()
    const bytes = new TextEncoder().encode(JSON.stringify([auth.portalOrigin, auth.accessToken, auth.expiresAt, device]))
    const identity = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('')
    const latest = await deps.authorization()
    if (run !== epoch || latest?.accessToken !== auth.accessToken || latest.portalOrigin !== auth.portalOrigin || latest.expiresAt !== auth.expiresAt || latest.expiresAt <= now()) throw new ExtensionError('expired')
    return { identity, epoch: run }
  }
  const current = async (context: { identity: string; epoch: number }): Promise<void> => {
    const latest = await snapshot()
    if (latest.identity !== context.identity || latest.epoch !== context.epoch) throw new ExtensionError('expired')
  }
  const visiblePending = (pending: StoredPending): PendingFillIntent => ({ reference: pending.reference, siteId: pending.siteId,
    version: pending.version, origin: pending.origin, expiresAt: pending.expiresAt, action: 'fill' })
  const read = async (original?: { identity: string; epoch: number }): Promise<StoredPending | null> => {
    const context = original ?? await snapshot(), parsed = pendingSchema.safeParse(await deps.readPending())
    if (!parsed.success) return null
    const pending = parsed.data
    if (pending.identity !== context.identity || pending.expiresAt <= now() || pending.expiresAt > now() + 120_000 || pending.origin !== pending.binding.origin) {
      return null
    }
    await current(context)
    return pending
  }
  const clearReference = (reference: string): Promise<void> => locked(async () => {
    const latest = pendingSchema.safeParse(await deps.readPending())
    if (latest.success && latest.data.reference === reference) await deps.writePending(null)
  })
  const metadata = async (id: number, version: number, website: string): Promise<void> => {
    if (!deps.client.sites) throw new ExtensionError('itemDenied')
    // The catalog cursor is an ascending numeric ID; request only this authorized position.
    const page = await deps.client.sites.list({ origin: website, after: id - 1, limit: 1 })
    const item = page.items.find(value => value.id === id)
    if (item) {
      if (item.version !== version || item.kind !== 'login' || !item.allowFill || !item.origins.includes(website)) throw new ExtensionError('itemDenied')
      return
    }
    throw new ExtensionError('itemDenied')
  }
  const remember = async (input: { siteId: number; version: number; origin: string }, supplied?: SiteFillBinding, original?: { identity: string; epoch: number }): Promise<void> => {
    const context = original ?? await snapshot(), binding = supplied ?? await deps.browser.capture()
    if (binding.origin !== input.origin) throw new ExtensionError('invalid')
    await metadata(input.siteId, input.version, input.origin)
    await current(context)
    const reference = nonce()
    await locked(async () => {
      await current(context)
      await deps.writePending({ ...input, reference, action: 'fill', expiresAt: now() + 120_000, binding, identity: context.identity, focused: false })
      try { await current(context) }
      catch (error) { await deps.writePending(null); throw error }
    })
  }
  const storeDraft = async (value: CapturedSiteDraft, original?: { identity: string; epoch: number }): Promise<void> => {
    const context = original ?? await snapshot()
    if (!(await deps.client.capabilities()).features.sites) throw new ExtensionError('itemDenied')
    await current(context)
    const expiresAt = Math.min(now() + 120_000, value.expiresAt ?? Number.POSITIVE_INFINITY)
    if (!Number.isFinite(expiresAt) || expiresAt <= now()) throw new ExtensionError('expired')
    clearDraft(); draft = { value: { ...value, expiresAt }, identity: context.identity, expiresAt }
    draftTimer = setTimeout(clearDraft, expiresAt - now())
  }
  return {
    async enable(capture): Promise<void> {
      const context = await snapshot(), binding = await deps.browser.capture(), caps = await deps.client.capabilities()
      if (!caps.features.sites || !deps.client.sites) throw new ExtensionError('itemDenied')
      const page = await deps.client.sites.list({ origin: binding.origin, after: 0, limit: 50 })
      const config: AssistanceConfiguration = { origin: binding.origin, capability: nonce(), expiresAt: now() + 120_000, captureOptIn: capture,
        locale: await deps.client.locale() ?? 'pt-BR', items: caps.features.fill ? page.items.filter(item => item.kind === 'login' && item.allowFill && item.origins.includes(binding.origin))
          .slice(0, 20).map(item => ({ id: item.id, version: item.version, label: item.label, username: item.username ?? '' })) : [] }
      await current(context)
      assistance = { config, binding, identity: context.identity, epoch: context.epoch }
      if (!await deps.browser.install(binding, config)) { assistance = null; throw new ExtensionError('unavailable') }
      await current(context)
    },
    async content(message, sender): Promise<boolean> {
      const parsed = contentMessage.safeParse(message), active = assistance
      if (!parsed.success || !active || sender.id !== deps.extensionId || sender.tab?.id !== active.binding.tabId || sender.frameId !== 0 ||
        sender.documentId !== active.binding.documentId || parsed.data.capability !== active.config.capability || parsed.data.origin !== active.binding.origin || active.config.expiresAt <= now()) return false
      try { if (new URL(sender.url ?? '').origin !== active.binding.origin) return false } catch { return false }
      // Reserve a one-shot capability synchronously; duplicate messages cannot race an await.
      assistance = null
      await current(active)
      const intent = parsed.data.intent
      if (intent.kind === 'fill') {
        if (!active.config.items.some(item => item.id === intent.id && item.version === intent.version)) return false
        const actual = await deps.browser.inspect(active.binding)
        if (!actual || !sameFillBinding(active.binding, actual)) return false
        await remember({ siteId: intent.id, version: intent.version, origin: active.binding.origin }, active.binding, active)
      } else {
        if (!active.config.captureOptIn) return false
        await storeDraft({ id: nonce(), origin: active.binding.origin, username: intent.username, password: intent.password }, active)
      }
      await current(active)
      await deps.browser.openReview()
      return true
    },
    rememberFill: remember,
    async get(): Promise<PendingFillIntent | null> { const pending = await read(); return pending ? visiblePending(pending) : null },
    async beginProof(): Promise<{ url: string }> {
      if (!await read()) throw new ExtensionError('expired')
      return { url: await deps.client.requestPortalProof() }
    },
    check(): Promise<PendingFillStatus> {
      checking ??= (async (): Promise<PendingFillStatus> => {
      const operationEpoch = epoch
      const pending = await read()
      if (!pending) return { state: 'none' }
      await deps.client.claimPortalProof()
      const caps = await deps.client.capabilities()
      if (!caps.features.fill) throw new ExtensionError('itemDenied')
      const actual = await deps.browser.inspect(pending.binding)
      if (!actual || !sameFillBinding(pending.binding, actual)) { await clearReference(pending.reference); return { state: 'none' } }
      await metadata(pending.siteId, pending.version, pending.origin)
      if (!(caps.proofUntil && caps.proofUntil > caps.serverNow)) return { state: 'pending', pending: visiblePending(pending) }
      if ((await read())?.reference !== pending.reference || operationEpoch !== epoch) return { state: 'none' }
      if (!pending.focused) {
        await deps.browser.focus(pending.binding)
        if (operationEpoch !== epoch) return { state: 'none' }
        const retained = await locked(async () => {
          if (operationEpoch !== epoch || (await read())?.reference !== pending.reference) return false
          pending.focused = true; await deps.writePending(pending); return true
        })
        if (!retained) return { state: 'none' }
      }
      return { state: 'ready', pending: visiblePending(pending) }
      })().finally(() => { checking = null })
      return checking
    },
    async consume(reference): Promise<void> {
      if (consuming) throw new ExtensionError('unavailable')
      consuming = true
      const operationEpoch = epoch
      try {
      const context = await snapshot()
      const pending = await locked(async () => {
        const value = await read(context)
        if (!value || value.reference !== reference) throw new ExtensionError('expired')
        await deps.writePending(null); return value
      })
      const actual = await deps.browser.inspect(pending.binding)
      if (!actual || !sameFillBinding(pending.binding, actual)) throw new ExtensionError('invalid')
      await deps.browser.focus(pending.binding)
      if (operationEpoch !== epoch || pending.expiresAt <= now()) throw new ExtensionError('expired')
      await current(context)
      await deps.fill(pending, pending.binding, async () => { try { await current(context); return pending.expiresAt > now() } catch { return false } })
      } finally { consuming = false }
    },
    async cancel(): Promise<void> { epoch++; assistance = null; clearDraft(); await locked(() => deps.writePending(null)); await deps.client.cancelPortalProof() },
    async takeDraft(): Promise<CapturedSiteDraft | null> {
      const context = await snapshot(), value = draft
      clearDraft()
      if (!value || value.expiresAt <= now() || value.identity !== context.identity) return null
      if (!(await deps.client.capabilities()).features.sites) return null
      await current(context); return value.value
    },
    clearDraft,
    stageDraft: storeDraft,
    invalidate(): void { epoch++; assistance = null; clearDraft() },
  }
}
