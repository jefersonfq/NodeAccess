import { createApp } from 'vue'
import App from './App.vue'
import { createExtensionClient, type ExtensionFailure } from '../core/client'
import { chromiumAuthFlow, chromiumSession, extensionInfo, indexedDbKeys, openTab } from '../adapters/chromium'

const client = createExtensionClient({ info: extensionInfo(), keys: indexedDbKeys, session: chromiumSession, flow: chromiumAuthFlow })
const requestConnection = (): Promise<{ ok: boolean; reason?: ExtensionFailure }> => chrome.runtime.sendMessage({ type: 'connect' })
createApp(App, { client, requestConnection, open: openTab }).mount('#app')
