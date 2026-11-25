import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSiteInteractions, type AssistanceConfiguration } from './site-interactions'
import type { ExtensionClient } from './client'
import type { Authorization } from './ports'
import type { SiteFillBinding } from './site-fill'

const binding: SiteFillBinding = { origin: 'https://login.test', tabId: 7, frameId: 0, documentId: 'doc1' }
function setup() {
  let clock = 1000, saved: unknown, config: AssistanceConfiguration | undefined
  let auth: Authorization | null = { accessToken: 'disposable', portalOrigin: 'https://vault.test', expiresAt: 500_000 }
  const list = vi.fn().mockResolvedValue({ items: [{ id: 3, version: 1, kind: 'login', allowFill: true, origins: [binding.origin], label: 'Fixture', username: 'fixture' }], next: null })
  const caps = vi.fn().mockResolvedValue({ features: { sites: true, fill: true }, serverNow: clock, proofUntil: 300_000 })
  const fill = vi.fn().mockResolvedValue(undefined), openReview = vi.fn().mockResolvedValue(undefined), focus = vi.fn().mockResolvedValue(undefined)
  const inspect = vi.fn().mockResolvedValue(binding)
  const controller = createSiteInteractions({ extensionId: 'extension', now: () => clock, authorization: () => Promise.resolve(auth),
    device: () => Promise.resolve('device'), readPending: () => Promise.resolve(saved), writePending: value => { saved = value; return Promise.resolve() }, fill,
    client: { sites: { list }, capabilities: caps, locale: () => Promise.resolve('en'), claimPortalProof: () => Promise.resolve({ state: 'none' }),
      requestPortalProof: () => Promise.resolve('https://vault.test/confirm'), cancelPortalProof: () => Promise.resolve() } as unknown as ExtensionClient,
    browser: { capture: () => Promise.resolve(binding), inspect, focus, openReview, install: (_target, value) => { config = value; return Promise.resolve(true) } },
  })
  const sender = { id: 'extension', tab: { id: 7 }, frameId: 0, documentId: 'doc1', url: 'https://login.test/signin' }
  return { controller, list, caps, fill, focus, openReview, inspect, sender,
    config: () => config!, saved: () => saved, time: (value: number) => { clock = value }, auth: (value: Authorization | null) => { auth = value },
    intent: (intent: unknown) => ({ type: 'SITE_ASSISTANCE_INTENT', origin: binding.origin, capability: config!.capability, intent }),
  }
}
afterEach(() => { vi.useRealTimers() })
describe('site assistance worker authority boundary', () => {
  it('requires privileged confirmation after an inline selection and consumes only once', async () => {
    const s = setup(); await s.controller.enable(false)
    expect(await s.controller.content(s.intent({ kind: 'fill', id: 3, version: 1 }), s.sender)).toBe(true)
    expect(s.fill).not.toHaveBeenCalled(); expect(s.openReview).toHaveBeenCalledOnce()
    const pending = await s.controller.get(); expect(pending).toMatchObject({ siteId: 3, origin: binding.origin })
    expect(await s.controller.check()).toMatchObject({ state: 'ready' })
    expect(s.fill).not.toHaveBeenCalled()
    await s.controller.consume(pending!.reference)
    expect(s.fill).toHaveBeenCalledWith(expect.objectContaining({ siteId: 3 }), binding, expect.any(Function))
    await expect(s.controller.consume(pending!.reference)).rejects.toThrow()
    expect(s.fill).toHaveBeenCalledOnce()
  })
  it.each(['id', 'tab', 'frame', 'document', 'origin', 'capability'])('rejects forged %s before opening privileged UI', async field => {
    const s = setup(); await s.controller.enable(true)
    const sender = { ...s.sender }, msg = s.intent({ kind: 'review-capture', username: 'u', password: 'p', mode: 'login' })
    if (field === 'id') sender.id = 'other'
    if (field === 'tab') sender.tab = { id: 8 }
    if (field === 'frame') sender.frameId = 1
    if (field === 'document') sender.documentId = 'doc2'
    if (field === 'origin') sender.url = 'https://evil.test'
    if (field === 'capability') msg.capability = 'forged'
    expect(await s.controller.content(msg, sender)).toBe(false)
    expect(s.openReview).not.toHaveBeenCalled(); expect(await s.controller.takeDraft()).toBeNull()
  })
  it('never captures without opt-in, stores passwords only in memory and delivers a draft once', async () => {
    vi.useFakeTimers()
    const s = setup(); await s.controller.enable(false)
    const intent = { kind: 'review-capture', username: 'u', password: 'disposable-value', mode: 'login' }
    expect(await s.controller.content(s.intent(intent), s.sender)).toBe(false)
    await s.controller.enable(true)
    expect(await s.controller.content(s.intent(intent), s.sender)).toBe(true)
    expect(s.saved()).toBeUndefined()
    expect(await s.controller.takeDraft()).toMatchObject({ username: 'u', password: 'disposable-value', origin: binding.origin })
    expect(await s.controller.takeDraft()).toBeNull()
  })
  it('rejects an item revoked after suggestions were installed', async () => {
    const s = setup(); await s.controller.enable(false)
    s.list.mockResolvedValue({ items: [], next: null })
    await expect(s.controller.content(s.intent({ kind: 'fill', id: 3, version: 1 }), s.sender)).rejects.toThrow()
    expect(s.fill).not.toHaveBeenCalled(); expect(s.openReview).not.toHaveBeenCalled()
  })
  it('expires pending references and clears in-memory drafts on identity replacement', async () => {
    vi.useFakeTimers()
    const s = setup(); await s.controller.rememberFill({ siteId: 3, version: 1, origin: binding.origin })
    await s.controller.stageDraft({ id: 'draft', username: 'u', password: 'p', origin: binding.origin })
    s.time(121_001)
    expect(await s.controller.get()).toBeNull(); expect(await s.controller.takeDraft()).toBeNull()
    await s.controller.stageDraft({ id: 'draft2', username: 'u', password: 'p', origin: binding.origin })
    s.controller.invalidate()
    expect(await s.controller.takeDraft()).toBeNull()
  })
  it('refuses a navigated document and does not silently reuse another target', async () => {
    const s = setup(); await s.controller.rememberFill({ siteId: 3, version: 1, origin: binding.origin })
    const pending = await s.controller.get()
    s.inspect.mockResolvedValue({ ...binding, documentId: 'new-document' })
    await expect(s.controller.consume(pending!.reference)).rejects.toThrow()
    expect(s.fill).not.toHaveBeenCalled()
  })
  it('denies concurrent consumption and does not persist a password during Hello', async () => {
    vi.useFakeTimers()
    const s = setup(); await s.controller.stageDraft({ id: 'draft', username: 'u', password: 'p', origin: binding.origin })
    await s.controller.rememberFill({ siteId: 3, version: 1, origin: binding.origin })
    expect(JSON.stringify(s.saved())).not.toContain('password')
    const pending = await s.controller.get()
    await Promise.allSettled([s.controller.consume(pending!.reference), s.controller.consume(pending!.reference)])
    expect(s.fill).toHaveBeenCalledOnce()
  })
  it('does not rebind a captured credential when identity changes during capabilities lookup', async () => {
    vi.useFakeTimers()
    const s = setup(); await s.controller.enable(true)
    s.caps.mockImplementation(() => {
      s.auth({ accessToken: 'new-identity', portalOrigin: 'https://vault.test', expiresAt: 500_000 })
      return Promise.resolve({ features: { sites: true, fill: true } })
    })
    await expect(s.controller.content(s.intent({ kind: 'review-capture', username: 'old-user', password: 'old-secret', mode: 'login' }), s.sender)).rejects.toThrow()
    expect(await s.controller.takeDraft()).toBeNull(); expect(s.openReview).not.toHaveBeenCalled()
  })
  it('does not rebind an inline fill to identity changed during ACL lookup', async () => {
    const s = setup(); await s.controller.enable(false)
    s.list.mockImplementation(() => {
      s.auth({ accessToken: 'new-identity', portalOrigin: 'https://vault.test', expiresAt: 500_000 })
      return Promise.resolve({ items: [{ id: 3, version: 1, kind: 'login', allowFill: true, origins: [binding.origin] }], next: null })
    })
    await expect(s.controller.content(s.intent({ kind: 'fill', id: 3, version: 1 }), s.sender)).rejects.toThrow()
    expect(await s.controller.get()).toBeNull(); expect(s.fill).not.toHaveBeenCalled()
  })
  it('checks the original identity after focus even when no storage event was observed', async () => {
    const s = setup(); await s.controller.rememberFill({ siteId: 3, version: 1, origin: binding.origin })
    const pending = await s.controller.get()
    s.focus.mockImplementation(() => { s.auth({ accessToken: 'new-identity', portalOrigin: 'https://vault.test', expiresAt: 500_000 }); return Promise.resolve() })
    await expect(s.controller.consume(pending!.reference)).rejects.toThrow()
    expect(s.fill).not.toHaveBeenCalled()
  })
  it('does not overwrite a newer reference when an older check completes focusing', async () => {
    const s = setup(); await s.controller.rememberFill({ siteId: 3, version: 1, origin: binding.origin })
    let release!: () => void
    s.focus.mockImplementation(() => new Promise<void>(resolve => { release = resolve }))
    const check = s.controller.check()
    await vi.waitFor(() => expect(s.focus).toHaveBeenCalledOnce())
    await s.controller.rememberFill({ siteId: 3, version: 1, origin: binding.origin })
    const newer = await s.controller.get()
    release(); expect(await check).toEqual({ state: 'none' })
    expect(await s.controller.get()).toEqual(newer)
  })
  it('reserves a content capability before the first await', async () => {
    vi.useFakeTimers()
    const s = setup(); await s.controller.enable(true)
    const msg = s.intent({ kind: 'review-capture', username: 'u', password: 'p', mode: 'login' })
    const replies = await Promise.all([s.controller.content(msg, s.sender), s.controller.content(msg, s.sender)])
    expect(replies).toEqual([true, false]); expect(s.openReview).toHaveBeenCalledOnce()
  })
  it('keeps a staged editor deadline when restored and staged again', async () => {
    vi.useFakeTimers()
    const s = setup(); await s.controller.stageDraft({ id: 'draft', username: 'u', password: 'p', origin: binding.origin })
    const draft = await s.controller.takeDraft(); s.time(100_000)
    await s.controller.stageDraft(draft!); s.time(121_001)
    expect(await s.controller.takeDraft()).toBeNull()
  })
  it('refuses consumption expiring while the target tab is focused', async () => {
    const s = setup(); await s.controller.rememberFill({ siteId: 3, version: 1, origin: binding.origin })
    const pending = await s.controller.get()
    s.focus.mockImplementation(() => { s.time(121_001); return Promise.resolve() })
    await expect(s.controller.consume(pending!.reference)).rejects.toThrow()
    expect(s.fill).not.toHaveBeenCalled()
  })
  it('keeps expiry in the guard used after the server reply awaits', async () => {
    const s = setup(); await s.controller.rememberFill({ siteId: 3, version: 1, origin: binding.origin })
    const pending = await s.controller.get()
    let checked = false
    s.fill.mockImplementation(async (_input, _binding, current: () => Promise<boolean>) => {
      s.time(121_001); checked = await current()
    })
    await s.controller.consume(pending!.reference); expect(checked).toBe(false)
  })
  it('does not enable assistance when sites are disabled and rejects unauthenticated reads', async () => {
    const s = setup(); s.caps.mockResolvedValue({ features: { sites: false, fill: false } })
    await expect(s.controller.enable(true)).rejects.toThrow()
    s.auth(null); await expect(s.controller.get()).rejects.toThrow()
  })
  it('waits for proof without focusing or filling, then focuses the ready reference once', async () => {
    const s = setup(); await s.controller.rememberFill({ siteId: 3, version: 1, origin: binding.origin })
    expect(await s.controller.beginProof()).toEqual({ url: 'https://vault.test/confirm' })
    s.caps.mockResolvedValue({ features: { fill: true }, serverNow: 1000, proofUntil: 999 })
    expect(await s.controller.check()).toMatchObject({ state: 'pending' }); expect(s.focus).not.toHaveBeenCalled()
    s.caps.mockResolvedValue({ features: { fill: true }, serverNow: 1000, proofUntil: 10_000 })
    await s.controller.check(); await s.controller.check()
    expect(s.focus).toHaveBeenCalledOnce(); expect(s.fill).not.toHaveBeenCalled()
  })
  it('removes a navigated pending reference and refuses proof after cancellation', async () => {
    const s = setup(); await s.controller.rememberFill({ siteId: 3, version: 1, origin: binding.origin })
    s.inspect.mockResolvedValue(null)
    expect(await s.controller.check()).toEqual({ state: 'none' }); expect(await s.controller.get()).toBeNull()
    await s.controller.cancel(); await expect(s.controller.beginProof()).rejects.toThrow()
  })
  it('discards a draft on its actual timer and refuses stale capabilities', async () => {
    vi.useFakeTimers()
    const s = setup(); await s.controller.stageDraft({ id: 'draft', username: 'u', password: 'p', origin: binding.origin })
    vi.advanceTimersByTime(120_001); expect(await s.controller.takeDraft()).toBeNull()
    await s.controller.enable(true); s.time(121_001)
    expect(await s.controller.content(s.intent({ kind: 'review-capture', username: 'u', password: 'p', mode: 'login' }), s.sender)).toBe(false)
    expect(s.openReview).not.toHaveBeenCalled()
  })
})
