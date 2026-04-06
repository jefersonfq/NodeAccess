import { defineStore } from 'pinia'
import { ref }         from 'vue'

export interface TerminalTab {
  id:           string
  hostId:       number
  hostName:     string
  hostIp?:      string
  hostPort?:    number
  hostAuthType?: string
  connectedAt?: Date
  unreadCount:  number
}

export interface HostInfo {
  id:        number
  name?:     string
  ip?:       string
  port?:     number
  authType?: string
}

export const useTerminalStore = defineStore('terminals', () => {
  const tabs     = ref<TerminalTab[]>([])
  const activeId = ref<string | null>(null)

  function add(host: HostInfo): string {
    const id = crypto.randomUUID()
    tabs.value.push({
      id,
      hostId:       host.id,
      hostName:     host.name ?? `Host #${host.id}`,
      hostIp:       host.ip,
      hostPort:     host.port,
      hostAuthType: host.authType,
      unreadCount:  0,
    })
    activeId.value = id
    return id
  }

  function remove(id: string) {
    const idx = tabs.value.findIndex((t) => t.id === id)
    if (idx === -1) return
    tabs.value.splice(idx, 1)
    if (activeId.value === id) {
      activeId.value = tabs.value[Math.max(0, idx - 1)]?.id ?? null
    }
  }

  function setName(id: string, name: string) {
    const tab = tabs.value.find((t) => t.id === id)
    if (tab) tab.hostName = name
  }

  function setConnectedAt(id: string) {
    const tab = tabs.value.find((t) => t.id === id)
    if (tab) tab.connectedAt = new Date()
  }

  function activate(id: string) {
    activeId.value = id
    clearUnread(id)
  }

  function markActivity(id: string) {
    const tab = tabs.value.find((t) => t.id === id)
    if (tab) tab.unreadCount += 1
  }

  function clearUnread(id: string) {
    const tab = tabs.value.find((t) => t.id === id)
    if (tab) tab.unreadCount = 0
  }

  function clear() {
    tabs.value     = []
    activeId.value = null
  }

  return { tabs, activeId, add, remove, setName, setConnectedAt, activate, markActivity, clearUnread, clear }
})
