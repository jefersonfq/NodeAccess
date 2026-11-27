import { createExtensionClient, ExtensionError } from './core/client'
import { chromiumAuthFlow, chromiumSession, extensionInfo, indexedDbKeys, rememberFailure, restrictSession } from './adapters/chromium'
import { z } from 'zod'
import { VaultSiteOriginSchema } from '@nodeaccess/shared'
import { chromiumSiteFill } from './adapters/site-fill'
import { fillSite, sameFillBinding, type SiteFillBinding } from './core/site-fill'
import { createSiteInteractions } from './core/site-interactions'
import { chromiumSiteInteractions, clearSiteReviewTabs, isSiteReviewTab } from './adapters/site-interactions'
import type { CapturedSiteDraft } from './core/portal-fill-intent'

/**
 * Service worker: runs the interactive connection, which outlives the popup (the popup closes when the
 * consent window takes focus). Only messages from this extension are accepted.
 */
const client = createExtensionClient({ info: extensionInfo(), keys: indexedDbKeys, session: chromiumSession, flow: chromiumAuthFlow })
void restrictSession()
let pending: Promise<void> | null = null
let filling = false
let proofPoll: ReturnType<typeof setTimeout> | undefined
function stopProofPoll(): void { clearTimeout(proofPoll); proofPoll = undefined }
// A reply authorized by an earlier local login must never reach the page after logout/switch.
let authorizationEpoch = 0
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && Object.hasOwn(changes, 'authorization')) { authorizationEpoch++; stopProofPoll(); clearSiteReviewTabs(); interactions.invalidate() }
})
const fillMessage = z.object({ type: z.literal('fill-site'), siteId: z.number().int().positive(), version: z.number().int().positive(), origin: VaultSiteOriginSchema }).strict()
const trustedUi = (sender: chrome.runtime.MessageSender): boolean => sender.id === chrome.runtime.id && (sender.tab === undefined || isSiteReviewTab(sender.tab.id)) && sender.url === `chrome-extension://${chrome.runtime.id}/popup.html`
async function runFill(input: { siteId: number; version: number; origin: string }, expected?: SiteFillBinding, originalCurrent?: () => Promise<boolean>): Promise<void> {
  if (filling) throw new ExtensionError('unavailable')
  filling = true
  const epoch = authorizationEpoch
  try {
    const authorization = await chromiumSession.get()
    if (!authorization || authorization.expiresAt <= Date.now()) throw new ExtensionError('expired')
    // Epoch catches removal/replace/restore even with equal tokens; snapshot catches delayed events.
    // Authorization is the session's identity/device-bound token. No credential values/keys are read.
    const current = async (): Promise<boolean> => {
      if (epoch !== authorizationEpoch) return false
      if (originalCurrent && !await originalCurrent()) return false
      const latest = await chromiumSession.get()
      return epoch === authorizationEpoch && latest !== null && latest.accessToken === authorization.accessToken
        && latest.portalOrigin === authorization.portalOrigin && latest.expiresAt === authorization.expiresAt
        && latest.expiresAt > Date.now()
    }
    const caps = await client.capabilities(), api = client.siteFill
    if (!api || caps.features.fill !== true) throw new ExtensionError('itemDenied')
    const browser = chromiumSiteFill(undefined, current)
    const capture = browser.capture.bind(browser)
    browser.capture = async (): Promise<SiteFillBinding> => {
      const actual = await capture()
      if (expected && !sameFillBinding(expected, actual)) throw new ExtensionError('invalid')
      return actual
    }
    await fillSite({ enabled: () => caps.features.fill === true && epoch === authorizationEpoch, origin: input.origin, browser,
      authorize: binding => api.authorize(input.siteId, input.version, binding),
      deliver: (operation, binding) => api.consume(operation, binding) })
  } finally { filling = false }
}
const interactions = createSiteInteractions({ client, browser: chromiumSiteInteractions, extensionId: chrome.runtime.id,
  authorization: () => chromiumSession.get(), device: async () => { const key = await indexedDbKeys.load(); if (!key) throw new ExtensionError('expired'); return key.jkt },
  readPending: async () => (await chrome.storage.session.get('siteFillIntent')).siteFillIntent,
  writePending: async value => { if (value) await chrome.storage.session.set({ siteFillIntent: value }); else await chrome.storage.session.remove('siteFillIntent') },
  fill: runFill,
})
/** Explicit portal confirmation may close the popup. Return its pending selection, never fill. */
function pollProofReturn(): void {
  stopProofPoll()
  const epoch = authorizationEpoch, deadline = Date.now() + 120_000
  const poll = async (): Promise<void> => {
    if (epoch !== authorizationEpoch || Date.now() >= deadline) return
    try {
      const state = await interactions.check()
      if (epoch !== authorizationEpoch || state.state === 'none') return
      if (state.state === 'ready') { await chromiumSiteInteractions.openReview(); return }
    } catch { if (epoch !== authorizationEpoch) return }
    proofPoll = setTimeout(() => { void poll() }, 2000)
  }
  proofPoll = setTimeout(() => { void poll() }, 2000)
}
function handleSiteFill(message: unknown, sender: chrome.runtime.MessageSender, respond: (reply: unknown) => void): boolean | undefined {
  if (!trustedUi(sender)) return undefined
  const input = fillMessage.safeParse(message)
  if (!input.success) return undefined
  void runFill(input.data).then(() => respond({ ok: true }), async (error: unknown) => {
    if (error instanceof ExtensionError && error.reason === 'proofRequired') await interactions.rememberFill(input.data).catch(() => undefined)
    respond({ ok: false, reason: error instanceof ExtensionError ? error.reason : 'unavailable' })
  })
  return true
}
const editorDraft = z.object({ mode: z.enum(['create', 'update']), siteId: z.number().int().positive().optional(), version: z.number().int().positive().optional(),
  kind: z.enum(['login', 'url']), label: z.string().max(160), origins: z.array(VaultSiteOriginSchema).max(20), url: z.string().max(2048).optional(),
  scope: z.enum(['PERSONAL', 'GROUP', 'TENANT']), groupId: z.number().int().positive().optional(), hostId: z.number().int().positive().nullable().optional(), allowFill: z.boolean() }).strict()
const draftSchema = z.object({ id: z.string().min(1).max(128), username: z.string().max(320), password: z.string().max(16384), origin: VaultSiteOriginSchema, expiresAt: z.number().int().optional(), editor: editorDraft.optional() }).strict()
function cleanDraft(value: z.infer<typeof draftSchema>): CapturedSiteDraft {
  const editor = value.editor
  return { id: value.id, username: value.username, password: value.password, origin: value.origin,
    ...(value.expiresAt !== undefined ? { expiresAt: value.expiresAt } : {}),
    ...(editor ? { editor: { mode: editor.mode, kind: editor.kind, label: editor.label, origins: editor.origins,
      scope: editor.scope, allowFill: editor.allowFill,
      ...(editor.siteId !== undefined ? { siteId: editor.siteId } : {}), ...(editor.version !== undefined ? { version: editor.version } : {}),
      ...(editor.url !== undefined ? { url: editor.url } : {}), ...(editor.groupId !== undefined ? { groupId: editor.groupId } : {}),
      ...(editor.hostId !== undefined ? { hostId: editor.hostId } : {}),
    } } : {}),
  }
}
const interactionMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('site-assist-enable'), capture: z.boolean() }).strict(),
  z.object({ type: z.literal('site-interaction-cancel') }).strict(), z.object({ type: z.literal('site-pending-get') }).strict(),
  z.object({ type: z.literal('site-proof-begin') }).strict(), z.object({ type: z.literal('site-proof-check') }).strict(),
  z.object({ type: z.literal('site-pending-consume'), reference: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ type: z.literal('site-draft-take') }).strict(), z.object({ type: z.literal('site-draft-clear') }).strict(),
  z.object({ type: z.literal('site-draft-stage'), draft: draftSchema }).strict(),
])
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'fill-site') return handleSiteFill(message, sender, respond)
  if (typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'SITE_ASSISTANCE_INTENT') {
    void interactions.content(message, sender).then(ok => respond({ ok }), () => respond({ ok: false }))
    return true
  }
  if (!trustedUi(sender)) return undefined
  const input = interactionMessage.safeParse(message)
  if (input.success) {
    const action = async (): Promise<unknown> => {
      switch (input.data.type) {
        case 'site-assist-enable': await interactions.enable(input.data.capture); return undefined
        case 'site-interaction-cancel': authorizationEpoch++; stopProofPoll(); await interactions.cancel(); return undefined
        case 'site-pending-get': return interactions.get()
        case 'site-proof-begin': { const reply = await interactions.beginProof(); pollProofReturn(); return reply }
        case 'site-proof-check': return interactions.check()
        case 'site-pending-consume': stopProofPoll(); await interactions.consume(input.data.reference); return undefined
        case 'site-draft-take': return interactions.takeDraft()
        case 'site-draft-clear': interactions.clearDraft(); return undefined
        case 'site-draft-stage': await interactions.stageDraft(cleanDraft(input.data.draft)); return undefined
      }
    }
    void action().then(value => respond({ ok: true, value }), (error: unknown) => respond({ ok: false, reason: error instanceof ExtensionError ? error.reason : 'unavailable' }))
    return true
  }
  if (typeof message !== 'object' || message === null || (message as { type?: unknown }).type !== 'connect') return undefined
  pending ??= client.connect().finally(() => { pending = null })
  // NA-0190: the reason is also kept briefly, for a popup that closed while the connection was tried.
  pending.then(async () => { await rememberFailure(null); respond({ ok: true }) }, async (error: unknown) => {
    const reason = error instanceof ExtensionError ? error.reason : 'unavailable'
    await rememberFailure(reason).catch(() => undefined)
    respond({ ok: false, reason })
  })
  return true
})
