import { chromiumSiteFill } from './site-fill'
import { injectSiteAssistance } from './site-assistance'
import type { InteractionBrowser } from '../core/site-interactions'
import type { SiteFillBinding } from '../core/site-fill'

interface ScriptingApi {
  executeScript(options: { target: { tabId: number; documentIds: string[] }; world: 'ISOLATED'; func: typeof inspectSiteDocument | typeof injectSiteAssistance; args?: unknown[] }): Promise<Array<{ frameId: number; documentId?: string; result?: unknown }>>
}
/** Identity-only inspection may run while the portal is foreground. Delivery still requires visibility. */
export function inspectSiteDocument(): string | null { return window.top === window && location.protocol === 'https:' ? location.origin : null }
const scripting = (): ScriptingApi => (chrome as unknown as { scripting: ScriptingApi }).scripting
// Only popup windows created by this worker may act as privileged review pages.
const reviewTabs = new Map<number, number>()
let reviewGeneration = 0
export function isSiteReviewTab(id: number | undefined): boolean { return id !== undefined && (reviewTabs.get(id) ?? 0) > Date.now() }
export function clearSiteReviewTabs(): void { reviewGeneration++; reviewTabs.clear() }
export const chromiumSiteInteractions: InteractionBrowser = {
  capture: () => chromiumSiteFill().capture(),
  async inspect(binding): Promise<SiteFillBinding | null> {
    try {
      const replies = await scripting().executeScript({ target: { tabId: binding.tabId, documentIds: [binding.documentId] }, world: 'ISOLATED', func: inspectSiteDocument })
      const reply = replies.length === 1 ? replies[0] : undefined
      return reply?.frameId === 0 && reply.documentId === binding.documentId && reply.result === binding.origin ? { ...binding } : null
    } catch { return null }
  },
  async focus(binding): Promise<void> {
    const tab = await chrome.tabs.get(binding.tabId)
    if (!tab.url || new URL(tab.url).origin !== binding.origin) throw new Error('changed site')
    await chrome.tabs.update(binding.tabId, { active: true })
    await chrome.windows.update(tab.windowId, { focused: true })
  },
  async install(binding, config): Promise<boolean> {
    const replies = await scripting().executeScript({ target: { tabId: binding.tabId, documentIds: [binding.documentId] }, world: 'ISOLATED', func: injectSiteAssistance, args: [config] })
    return replies.length === 1 && replies[0]?.frameId === 0 && replies[0].documentId === binding.documentId && replies[0].result === true
  },
  async openReview(): Promise<void> {
    const generation = reviewGeneration
    const created = await chrome.windows.create({ url: `chrome-extension://${chrome.runtime.id}/popup.html`, type: 'popup', width: 430, height: 680, focused: true })
    if (generation !== reviewGeneration) return
    for (const [id, expiry] of reviewTabs) if (expiry <= Date.now()) reviewTabs.delete(id)
    if (reviewTabs.size >= 8) reviewTabs.delete(reviewTabs.keys().next().value!)
    for (const tab of created.tabs ?? []) if (typeof tab.id === 'number') reviewTabs.set(tab.id, Date.now() + 120_000)
  },
}
