import { createApp } from 'vue'
import App from './App.vue'
import { createExtensionClient, type ExtensionFailure } from '../core/client'
import { chromiumAuthFlow, chromiumSession, extensionInfo, indexedDbKeys, openTab, takeFailure } from '../adapters/chromium'
import { createUpdateCheck } from '../core/update'

const client = createExtensionClient({ info: extensionInfo(), keys: indexedDbKeys, session: chromiumSession, flow: chromiumAuthFlow })
const requestConnection = (): Promise<{ ok: boolean; reason?: ExtensionFailure }> => chrome.runtime.sendMessage({ type: 'connect' })
// NA-0190: local builds reload the unpacked extension from disk (dist-local) when the portal announces a new build.
const update = { check: createUpdateCheck(__PORTAL_ORIGIN__, __BUILD_ID__), apply: (): void => chrome.runtime.reload() }
createApp(App, { client, requestConnection, open: openTab, update, lastFailure: takeFailure, browserLanguage: navigator.language }).mount('#app')
