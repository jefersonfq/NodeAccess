import { createExtensionClient, ExtensionError } from './core/client'
import { chromiumAuthFlow, chromiumSession, extensionInfo, indexedDbKeys, rememberFailure, restrictSession } from './adapters/chromium'

/**
 * Service worker: runs the interactive connection, which outlives the popup (the popup closes when the
 * consent window takes focus). Only messages from this extension are accepted.
 */
const client = createExtensionClient({ info: extensionInfo(), keys: indexedDbKeys, session: chromiumSession, flow: chromiumAuthFlow })
void restrictSession()
let pending: Promise<void> | null = null
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || typeof message !== 'object' || message === null || (message as { type?: unknown }).type !== 'connect') return undefined
  pending ??= client.connect().finally(() => { pending = null })
  // NA-0190: the reason is also kept briefly, for a popup that closed while the connection was tried.
  pending.then(async () => { await rememberFailure(null); respond({ ok: true }) }, async (error: unknown) => {
    const reason = error instanceof ExtensionError ? error.reason : 'unavailable'
    await rememberFailure(reason).catch(() => undefined)
    respond({ ok: false, reason })
  })
  return true
})
