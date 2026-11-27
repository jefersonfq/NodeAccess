import { SiteFillError, sameFillBinding, validFillBinding } from '../core/site-fill'
import type { SiteFillBinding, SiteFillBrowser, SiteFillCredentials, SiteFillMode } from '../core/site-fill'

type ScriptResult = { frameId: number; documentId?: string; result?: unknown }
export interface SiteFillChromiumApi {
  tabs: { query(query: { active: true; lastFocusedWindow: true }): Promise<{ id?: number }[]> }
  scripting: { executeScript(options: {
    target: { tabId: number; frameIds?: number[]; documentIds?: string[] }
    world: 'ISOLATED'
    func: typeof captureSiteDocument | typeof injectSiteCredentials
    args?: unknown[]
  }): Promise<ScriptResult[]> }
}
/** Serialized into the isolated world: never reads field values. */
export function captureSiteDocument(): string | null {
  return window.top === window && location.protocol === 'https:' && document.visibilityState === 'visible'
    ? location.origin : null
}
/** Self-contained because Chromium serializes this function, without its closure. */
export function injectSiteCredentials(origin: string, username: string, password: string, inspectOnly = false, expectedMode?: SiteFillMode): boolean | SiteFillMode {
  if (window.top !== window || location.protocol !== 'https:' || location.origin !== origin ||
      document.visibilityState !== 'visible' || typeof username !== 'string' || typeof password !== 'string') return false
  const editable = (input: HTMLInputElement): boolean => {
    if (!input.isConnected || input.disabled || input.readOnly || input.matches(':disabled') ||
        input.closest('[hidden], [inert], [aria-hidden="true"]')) return false
    for (let element: Element | null = input; element; element = element.parentElement) {
      const style = getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false
    }
    return Array.from(input.getClientRects()).some(rect => rect.width > 0 && rect.height > 0)
  }
  const select = (): { mode: SiteFillMode; user?: HTMLInputElement; password?: HTMLInputElement } | null => {
    const inputs = Array.from(document.querySelectorAll('input'))
    const passwords = inputs.filter(input => input.type === 'password' && editable(input))
    if (passwords.length > 1 || passwords.some(input => ['new-password', 'username'].includes(input.autocomplete))) return null
    const target = passwords[0]
    const candidates = inputs.filter(input => ['text', 'email', 'tel'].includes(input.type) &&
      (!target || input.form === target.form) && editable(input))
    const marked = candidates.filter(input => input.autocomplete === 'username')
    const usernames = marked.length ? marked : candidates
    if (usernames.length > 1) return null
    if (!target) {
      // A search box is not a login step. Require an explicitly marked username and no
      // hidden/disabled password field that could turn an incomplete form into a first step.
      if (marked.length !== 1 || inputs.some(input => input.type === 'password')) return null
      return { mode: 'username', user: marked[0]! }
    }
    return usernames[0] ? { mode: 'both', user: usernames[0], password: target } : { mode: 'password', password: target }
  }
  const selected = select()
  if (!selected || (expectedMode !== undefined && selected.mode !== expectedMode)) return false
  if (inspectOnly) return selected.mode
  if ((selected.mode !== 'username' && !password) || (selected.mode === 'username' && password)) return false
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  if (!descriptor?.set) return false
  // Validate all targets before touching either. No submit, focus, click, or keyboard simulation.
  const fields: Array<[HTMLInputElement, string]> = []
  if (selected.user) fields.push([selected.user, username])
  if (selected.password) fields.push([selected.password, password])
  for (const [input, value] of fields) {
    // Event handlers may replace targets or alter the form. Revalidate the complete
    // structure before each native set, never write to a detached original node.
    const latest = select()
    if (!latest || latest.mode !== selected.mode || latest.user !== selected.user || latest.password !== selected.password || !editable(input)) return false
    descriptor.set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  return true
}
export function chromiumSiteFill(api: SiteFillChromiumApi = (globalThis as unknown as { chrome: SiteFillChromiumApi }).chrome,
  isCurrent: () => boolean | Promise<boolean> = () => true): SiteFillBrowser {
  const current = async (): Promise<void> => { if (!await isCurrent()) throw new SiteFillError('changed') }
  const activeTab = async (): Promise<number> => {
    const tabs = await api.tabs.query({ active: true, lastFocusedWindow: true })
    const id = tabs.length === 1 ? tabs[0]?.id : undefined
    if (id === undefined || !Number.isSafeInteger(id) || id < 0) throw new SiteFillError('target')
    return id
  }
  const capture = async (): Promise<SiteFillBinding> => {
    await current()
    const tabId = await activeTab()
    const results = await api.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', func: captureSiteDocument })
    const result = results.length === 1 ? results[0] : undefined
    const binding = { tabId, frameId: result?.frameId, documentId: result?.documentId, origin: result?.result } as SiteFillBinding
    if (!validFillBinding(binding)) throw new SiteFillError('target')
    if (await activeTab() !== tabId) throw new SiteFillError('changed')
    await current()
    return binding
  }
  return {
    capture,
    async preflight(binding: SiteFillBinding): Promise<SiteFillMode> {
      if (!validFillBinding(binding) || !sameFillBinding(binding, await capture())) throw new SiteFillError('changed')
      await current()
      const results = await api.scripting.executeScript({ target: { tabId: binding.tabId, documentIds: [binding.documentId] },
        world: 'ISOLATED', func: injectSiteCredentials, args: binding.mode === undefined ? [binding.origin, '', '', true] : [binding.origin, '', '', true, binding.mode] })
      await current()
      const result = results.length === 1 ? results[0] : undefined
      if (result?.frameId !== 0 || result.documentId !== binding.documentId || !['username', 'password', 'both'].includes(result.result as string)) throw new SiteFillError('fields')
      return result.result as SiteFillMode
    },
    async fill(binding: SiteFillBinding, credentials: SiteFillCredentials): Promise<void> {
      if (!binding.mode || credentials.mode !== binding.mode) throw new SiteFillError('fields')
      if (!validFillBinding(binding) || !sameFillBinding(binding, await capture())) throw new SiteFillError('changed')
      await current()
      const results = await api.scripting.executeScript({
        target: { tabId: binding.tabId, documentIds: [binding.documentId] }, world: 'ISOLATED',
        func: injectSiteCredentials, args: [binding.origin, 'username' in credentials ? credentials.username : '', 'password' in credentials ? credentials.password : '', false, binding.mode],
      })
      await current()
      const result = results.length === 1 ? results[0] : undefined
      if (result?.frameId !== 0 || result.documentId !== binding.documentId || result.result !== true) throw new SiteFillError('fields')
    },
  }
}
