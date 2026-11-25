/** Metadata already filtered by the worker's current ACL and exact origin. No ciphertext. */
export interface SiteAssistanceItem { id: number; version: number; label: string; username: string }
export interface SiteAssistanceConfig {
  origin: string
  capability: string
  expiresAt: number
  items: SiteAssistanceItem[]
  captureOptIn: boolean
  locale?: 'pt-BR' | 'en'
}
export type SiteAssistanceIntent = { kind: 'fill'; id: number; version: number }
  | { kind: 'review-capture'; username: string; password: string; mode: 'login' | 'password-change' }
export interface SiteAssistanceMessage {
  type: 'SITE_ASSISTANCE_INTENT'
  capability: string
  origin: string
  intent: SiteAssistanceIntent
}

/**
 * Serialize this function into ISOLATED, targeting a captured documentId, after a popup gesture.
 * Worker MUST validate sender extension ID/tab/frame=0/documentId/origin, capability and expiry;
 * recheck ACL and require privileged confirmation. A page intention is NEVER a fill/write grant.
 * Capture is a review proposal, not evidence that the site accepted the login/password change.
 */
export function injectSiteAssistance(config: SiteAssistanceConfig): boolean {
  const now = Date.now()
  if (window.top !== window || location.protocol !== 'https:' || location.origin !== config.origin ||
      document.visibilityState !== 'visible' || !Number.isFinite(config.expiresAt) ||
      config.expiresAt <= now || config.expiresAt - now > 120000 ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(config.capability) || typeof config.captureOptIn !== 'boolean' ||
      !Array.isArray(config.items) || config.items.length > 50 || config.items.some(item =>
        !Number.isSafeInteger(item.id) || item.id < 1 || !Number.isSafeInteger(item.version) || item.version < 1 ||
        typeof item.label !== 'string' || item.label.length > 200 || typeof item.username !== 'string' || item.username.length > 320)) return false
  const runtime = (globalThis as unknown as { chrome?: { runtime?: { sendMessage(message: SiteAssistanceMessage): Promise<unknown> } } }).chrome?.runtime
  if (!runtime?.sendMessage) return false
  // Isolated-world private state; no nonce or credential is placed in DOM, storage or page events.
  const scope = globalThis as unknown as { __vaultSiteAssistanceStop?: () => void }
  scope.__vaultSiteAssistanceStop?.()
  const initialUrl = location.href, controller = new AbortController(), signal = controller.signal
  let stopped = false, selectedForm: HTMLFormElement | null = null, gestureForm: HTMLFormElement | null = null, gestureAt = 0
  let panel: HTMLDivElement | null = null, anchor: HTMLInputElement | null = null, index = -1
  let buttons: HTMLButtonElement[] = []
  const english = config.locale === 'en'
  const hide = (): void => { panel?.remove(); panel = null; buttons = []; index = -1; anchor = null }
  const stop = (): void => {
    if (stopped) return
    stopped = true; clearTimeout(timer); controller.abort(); hide(); selectedForm = null; gestureForm = null
    if (scope.__vaultSiteAssistanceStop === stop) delete scope.__vaultSiteAssistanceStop
  }
  const timer = setTimeout(stop, config.expiresAt - now)
  scope.__vaultSiteAssistanceStop = stop
  const current = (): boolean => {
    if (stopped) return false
    if (Date.now() >= config.expiresAt || location.href !== initialUrl || location.origin !== config.origin || document.visibilityState !== 'visible') { stop(); return false }
    return true
  }
  const editable = (input: HTMLInputElement): boolean => {
    if (!input.isConnected || input.disabled || input.readOnly || input.matches(':disabled') || input.closest('[hidden], [inert], [aria-hidden="true"]')) return false
    for (let node: Element | null = input; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false
    }
    return Array.from(input.getClientRects()).some(rect => rect.width > 0 && rect.height > 0)
  }
  const fields = (form: HTMLFormElement): { username: HTMLInputElement | undefined; passwords: HTMLInputElement[]; mode: 'login' | 'password-change' } | null => {
    if (!form.isConnected) return null
    const inputs = Array.from(form.elements).filter((node): node is HTMLInputElement => node instanceof HTMLInputElement && editable(node))
    if (inputs.some(input => input.autocomplete === 'one-time-code' || /(?:otp|one.?time|verification|totp)/i.test(`${input.name} ${input.id}`))) return null
    const texts = inputs.filter(input => ['text', 'email'].includes(input.type))
    const marked = texts.filter(input => input.autocomplete === 'username')
    const usernames = marked.length ? marked : texts
    if (usernames.length > 1) return null
    const passwords = inputs.filter(input => input.type === 'password')
    if (!passwords.length) return marked.length === 1 ? { username: marked[0], passwords: [], mode: 'login' } : null
    const fresh = passwords.filter(input => input.autocomplete === 'new-password')
    if (fresh.length) {
      // Require an explicit new+confirmation pair; never read the current/old password.
      if (fresh.length !== 2 || passwords.some(input => input.autocomplete !== 'new-password' && input.autocomplete !== 'current-password') || passwords.length > 3) return null
      return { username: usernames[0], passwords: fresh, mode: 'password-change' }
    }
    return passwords.length === 1 ? { username: usernames[0], passwords, mode: 'login' } : null
  }
  const send = async (intent: SiteAssistanceIntent): Promise<void> => {
    if (!current()) return
    stop() // One intention per capability. The worker also consumes it atomically.
    try { await runtime.sendMessage({ type: 'SITE_ASSISTANCE_INTENT', capability: config.capability, origin: config.origin, intent }) }
    catch { /* Synchronous invalidation or rejected message: discard without logging or retry. */ }
  }
  const select = (item: SiteAssistanceItem, event: Event): void => {
    if (!event.isTrusted || !current() || !anchor || !editable(anchor) || anchor.form !== selectedForm || !selectedForm) return
    const found = fields(selectedForm)
    if (!found || found.mode !== 'login') { hide(); return }
    void send({ kind: 'fill', id: item.id, version: item.version })
  }
  const show = (input: HTMLInputElement): void => {
    hide()
    if (!config.items.length) return
    anchor = input
    panel = document.createElement('div')
    const box = input.getBoundingClientRect()
    panel.style.cssText = `position:fixed;z-index:2147483647;left:${Math.max(0, Math.min(box.left, innerWidth - 280))}px;top:${Math.max(0, Math.min(box.bottom + 4, innerHeight - 200))}px;width:280px;`
    const shadow = panel.attachShadow({ mode: 'closed' })
    const container = document.createElement('div')
    container.setAttribute('role', 'group'); container.setAttribute('aria-label', 'VaultNAccess')
    container.style.cssText = 'font:14px system-ui;background:#172033;color:#fff;border:1px solid #77849a;border-radius:8px;padding:8px;max-height:184px;overflow:auto;box-shadow:0 4px 16px #0005'
    const title = document.createElement('div')
    title.textContent = english ? 'Review in VaultNAccess' : 'Revisar no VaultNAccess'
    container.append(title)
    for (const item of config.items) {
      const button = document.createElement('button')
      button.type = 'button'; button.textContent = `${item.label} — ${item.username}`
      button.style.cssText = 'display:block;width:100%;text-align:left;padding:8px;margin-top:4px;background:#263449;color:white;border:1px solid #77849a;border-radius:4px;cursor:pointer'
      button.addEventListener('click', event => select(item, event), { signal })
      button.addEventListener('keydown', event => {
        if (event.isTrusted && event.key === 'Escape') { event.preventDefault(); input.focus(); hide() }
      }, { signal })
      container.append(button); buttons.push(button)
    }
    shadow.append(container); document.documentElement.append(panel)
  }
  document.addEventListener('focusin', event => {
    if (!event.isTrusted || !current()) return
    if (event.target === panel) return
    hide()
    const input = event.target
    if ((input instanceof HTMLButtonElement || input instanceof HTMLInputElement) && input.type === 'submit' && input.form === selectedForm) return
    if (!(input instanceof HTMLInputElement) || !input.form || !editable(input)) { selectedForm = null; return }
    const found = fields(input.form)
    if (!found || (input !== found.username && !found.passwords.includes(input))) { selectedForm = null; return }
    selectedForm = input.form
    if (found.mode === 'login') show(input)
  }, { signal })
  document.addEventListener('keydown', event => {
    if (!event.isTrusted || !current()) return
    if (event.key === 'Escape') { hide(); return }
    if (panel && (event.target === anchor || event.target === panel) && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); index = event.key === 'ArrowDown' ? (index + 1) % buttons.length : (index < 0 ? buttons.length - 1 : (index + buttons.length - 1) % buttons.length)
      buttons[index]?.focus(); return
    }
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.form === selectedForm) { gestureForm = selectedForm; gestureAt = Date.now() }
  }, { signal, capture: true })
  document.addEventListener('click', event => {
    if (!event.isTrusted || !current()) return
    const target = event.target instanceof Element ? event.target.closest('button,input') : null
    if ((target instanceof HTMLButtonElement || target instanceof HTMLInputElement) && target.type === 'submit' && target.form === selectedForm) {
      gestureForm = selectedForm; gestureAt = Date.now(); hide()
    }
  }, { signal, capture: true })
  document.addEventListener('submit', event => {
    if (!event.isTrusted || !current() || !config.captureOptIn || !(event.target instanceof HTMLFormElement) ||
        event.target !== selectedForm || gestureForm !== selectedForm || Date.now() - gestureAt > 1000) return
    gestureForm = null
    const found = fields(event.target)
    if (!found) return
    const username = found.username?.value ?? '', password = found.passwords[0]?.value ?? ''
    if (!password || password.length > 1024 || new TextEncoder().encode(password).length > 4096 || username.length > 320 ||
        (found.mode === 'password-change' && found.passwords[1]?.value !== password)) return
    void send({ kind: 'review-capture', username, password, mode: found.mode })
  }, { signal, capture: true })
  window.addEventListener('pagehide', stop, { signal })
  window.addEventListener('popstate', stop, { signal })
  window.addEventListener('hashchange', stop, { signal })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') stop() }, { signal })
  return true
}
