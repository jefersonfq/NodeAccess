import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chromiumSiteInteractions, clearSiteReviewTabs, isSiteReviewTab } from './site-interactions'

const binding = { origin: 'https://login.test', tabId: 3, frameId: 0 as const, documentId: 'doc1' }
beforeEach(() => { clearSiteReviewTabs() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); clearSiteReviewTabs() })
describe('privileged site review windows', () => {
  it('accepts only tabs created by this worker, until expiry or identity invalidation', async () => {
    vi.useFakeTimers()
    const create = vi.fn().mockResolvedValue({ tabs: [{ id: 19 }] })
    vi.stubGlobal('chrome', { runtime: { id: 'extension' }, windows: { create } })
    expect(isSiteReviewTab(19)).toBe(false)
    await chromiumSiteInteractions.openReview()
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ url: 'chrome-extension://extension/popup.html', type: 'popup' }))
    expect(isSiteReviewTab(19)).toBe(true); expect(isSiteReviewTab(20)).toBe(false)
    vi.advanceTimersByTime(120_001); expect(isSiteReviewTab(19)).toBe(false)
    await chromiumSiteInteractions.openReview(); clearSiteReviewTabs(); expect(isSiteReviewTab(19)).toBe(false)
  })
  it('inspects only the bound document and refuses a different frame/document', async () => {
    const executeScript = vi.fn().mockResolvedValue([{ frameId: 0, documentId: 'doc1', result: binding.origin }])
    vi.stubGlobal('chrome', { scripting: { executeScript } })
    expect(await chromiumSiteInteractions.inspect(binding)).toEqual(binding)
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 3, documentIds: ['doc1'] }, world: 'ISOLATED' }))
    executeScript.mockResolvedValue([{ frameId: 0, documentId: 'doc2', result: binding.origin }])
    expect(await chromiumSiteInteractions.inspect(binding)).toBeNull()
    executeScript.mockResolvedValue([{ frameId: 1, documentId: 'doc1', result: binding.origin }])
    expect(await chromiumSiteInteractions.inspect(binding)).toBeNull()
  })
  it('does not focus a tab that has moved to another origin', async () => {
    const update = vi.fn()
    vi.stubGlobal('chrome', { tabs: { get: () => Promise.resolve({ url: 'https://other.test', windowId: 1 }), update }, windows: { update } })
    await expect(chromiumSiteInteractions.focus(binding)).rejects.toThrow('changed site')
    expect(update).not.toHaveBeenCalled()
  })
  it('does not register a review window created after identity invalidation', async () => {
    let resolve!: (value: { tabs: Array<{ id: number }> }) => void
    vi.stubGlobal('chrome', { runtime: { id: 'extension' }, windows: { create: () => new Promise(done => { resolve = done }) } })
    const opening = chromiumSiteInteractions.openReview()
    clearSiteReviewTabs(); resolve({ tabs: [{ id: 19 }] }); await opening
    expect(isSiteReviewTab(19)).toBe(false)
  })
  it('installs only in the bound document and requires its successful acknowledgement', async () => {
    const executeScript = vi.fn().mockResolvedValue([{ frameId: 0, documentId: 'doc1', result: true }])
    vi.stubGlobal('chrome', { scripting: { executeScript } })
    const config = { origin: binding.origin, capability: 'a'.repeat(64), expiresAt: Date.now() + 120_000, captureOptIn: false, items: [] }
    expect(await chromiumSiteInteractions.install(binding, config)).toBe(true)
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 3, documentIds: ['doc1'] }, args: [config] }))
    executeScript.mockResolvedValue([{ frameId: 0, documentId: 'doc2', result: true }])
    expect(await chromiumSiteInteractions.install(binding, config)).toBe(false)
    executeScript.mockRejectedValue(new Error('gone'))
    expect(await chromiumSiteInteractions.inspect(binding)).toBeNull()
  })
  it('restores the authorized source tab and its window before delivery', async () => {
    const updateTab = vi.fn().mockResolvedValue({}), updateWindow = vi.fn().mockResolvedValue({})
    vi.stubGlobal('chrome', { tabs: { get: () => Promise.resolve({ url: `${binding.origin}/login`, windowId: 9 }), update: updateTab }, windows: { update: updateWindow } })
    await chromiumSiteInteractions.focus(binding)
    expect(updateTab).toHaveBeenCalledWith(3, { active: true }); expect(updateWindow).toHaveBeenCalledWith(9, { focused: true })
  })
})
