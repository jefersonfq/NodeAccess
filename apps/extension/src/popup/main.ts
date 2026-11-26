import { createApp } from 'vue'
import App from './App.vue'
import { createExtensionClient, ExtensionError, type ExtensionFailure } from '../core/client'
import { chromiumAuthFlow, chromiumSession, extensionInfo, indexedDbKeys, openTab, takeFailure } from '../adapters/chromium'
import { createUpdateCheck } from '../core/update'
import { chromiumSiteFill } from '../adapters/site-fill'
import { chromiumSitePreferences } from '../adapters/site-preferences'
import type { CapturedDraftPort, PendingFillPort, SiteAssistPort } from '../core/portal-fill-intent'

const client = createExtensionClient({ info: extensionInfo(), keys: indexedDbKeys, session: chromiumSession, flow: chromiumAuthFlow })
const requestConnection = (): Promise<{ ok: boolean; reason?: ExtensionFailure }> => chrome.runtime.sendMessage({ type: 'connect' })
// NA-0190: local builds reload the unpacked extension from disk (dist-local) when the portal announces a new build.
const update = { check: createUpdateCheck(__PORTAL_ORIGIN__, __BUILD_ID__), apply: (): void => chrome.runtime.reload() }
const currentSite = async (): Promise<string> => { try { return (await chromiumSiteFill().capture()).origin } catch { return '' } }
const requestSiteFill = (siteId: number, version: number, origin: string): Promise<{ ok: boolean; reason?: ExtensionFailure }> => chrome.runtime.sendMessage({ type: 'fill-site', siteId, version, origin })
async function interaction<T>(message: unknown): Promise<T> {
  const reply = await chrome.runtime.sendMessage<{ ok: boolean; value?: T; reason?: ExtensionFailure }>(message)
  if (!reply?.ok) throw new ExtensionError(reply?.reason ?? 'unavailable')
  return reply.value as T
}
const pendingFill: PendingFillPort = {
  get: () => interaction({ type: 'site-pending-get' }), beginProof: () => interaction({ type: 'site-proof-begin' }),
  check: () => interaction({ type: 'site-proof-check' }), cancel: () => interaction({ type: 'site-interaction-cancel' }),
  async consume(reference) { try { await interaction({ type: 'site-pending-consume', reference }); return { ok: true } }
    catch (error) { return { ok: false, reason: error instanceof ExtensionError ? error.reason : 'unavailable' } } },
}
const capturedDraftPort: CapturedDraftPort = {
  take: () => interaction({ type: 'site-draft-take' }), clear: () => interaction({ type: 'site-draft-clear' }),
  stage: draft => interaction({ type: 'site-draft-stage', draft }),
}
const siteAssist: SiteAssistPort = {
  async enable(options) { try { await interaction({ type: 'site-assist-enable', capture: options.capture }); return { ok: true } } catch { return { ok: false } } },
  cancel: () => interaction({ type: 'site-interaction-cancel' }),
}
createApp(App, { client, requestConnection, requestSiteFill, currentSite, pendingFill, capturedDraftPort, siteAssist,
  preferenceFactory: (scope: string, kind: 'sites' | 'hosts') => chromiumSitePreferences(client, scope, kind),
  close: () => window.close(), open: openTab, update, lastFailure: takeFailure, browserLanguage: navigator.language }).mount('#app')
