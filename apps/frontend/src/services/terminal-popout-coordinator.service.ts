import type { Router } from 'vue-router'
import { useTerminalStore } from '@/stores/terminals'
import { markHostAsRecent } from '@/services/host-quick-access.service'
import { resetTerminalLayout } from '@/services/terminal-layout.service'
import {
  confirmTerminalPopoutInserted,
  listenTerminalPopoutEvents,
  type TerminalPopoutHost,
} from '@/services/terminal-popout.service'

let stopListening: (() => void) | null = null
const pendingInsertByPopout = new Map<string, {
  requestId: string
  host: TerminalPopoutHost
  timer: number
}>()

function upsertMainTab(host: TerminalPopoutHost) {
  const termStore = useTerminalStore()
  termStore.removeDetachedByHostId(host.id)
  const existingTab = termStore.tabs.find((tab) => tab.hostId === host.id)
  if (existingTab) {
    termStore.activate(existingTab.id)
    return existingTab.id
  }

  markHostAsRecent(host.id)
  return termStore.add({
    id: host.id,
    name: host.name,
    ip: host.ip,
    port: host.port,
    authType: host.authType,
    accessProtocol: host.accessProtocol,
  })
}

function completePendingInsert(popoutId: string, router: Router, delayMs: number) {
  const pendingInsert = pendingInsertByPopout.get(popoutId)
  if (!pendingInsert) return

  window.clearTimeout(pendingInsert.timer)
  pendingInsertByPopout.delete(popoutId)

  window.setTimeout(() => {
    const termStore = useTerminalStore()
    const tabId = upsertMainTab(pendingInsert.host)
    termStore.clearUnread(tabId)
    resetTerminalLayout()
    void router.push({ name: 'terminal' })
  }, delayMs)
}

export function initTerminalPopoutCoordinator(router: Router) {
  if (stopListening) return stopListening

  stopListening = listenTerminalPopoutEvents((event) => {
    const termStore = useTerminalStore()

    if (event.type === 'terminal-popout-connected') {
      termStore.addDetached(event.popoutId, {
        id: event.host.id,
        name: event.host.name,
        ip: event.host.ip,
        port: event.host.port,
        authType: event.host.authType,
        accessProtocol: event.host.accessProtocol,
      })
      if (event.mode === 'move' && event.sourceTabId) {
        termStore.remove(event.sourceTabId)
      }
      return
    }

    if (event.type === 'terminal-popout-closed') {
      termStore.removeDetached(event.popoutId)
      completePendingInsert(event.popoutId, router, 350)
      return
    }

    if (event.type === 'terminal-popout-insert-requested') {
      const existingPending = pendingInsertByPopout.get(event.popoutId)
      if (existingPending) window.clearTimeout(existingPending.timer)

      const timer = window.setTimeout(() => {
        completePendingInsert(event.popoutId, router, 0)
      }, 1_200)

      pendingInsertByPopout.set(event.popoutId, { requestId: event.requestId, host: event.host, timer })
      confirmTerminalPopoutInserted(event.requestId)
    }
  })

  return stopListening
}
