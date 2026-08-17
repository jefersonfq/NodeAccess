import { defineStore } from 'pinia'
import { ref }         from 'vue'
import type { HostAccessProtocol, HostPublic } from '@nodeaccess/shared'
import { useAuthStore } from '@/stores/auth'

export interface TerminalTab {
  id:           string
  sessionId?:   number | null
  tenantId?:     number | null
  hostId:       number
  hostName:     string
  hostIp?:      string
  hostPort?:    number
  hostAuthType?: string
  hostAccessProtocol?: HostAccessProtocol
  startupSnippetId?: number | null
  startupSnippetMode?: HostPublic['startupSnippetMode']
  connectedAt?: Date
  unreadCount:  number
  jiraTicketKey?: string | null
  jiraInteractionId?: string | null
  jiraSessionGrant?: string | null
  jiraTicketSummary?: string | null
  jiraTicketStatus?: string | null
  jiraTicketUrl?: string | null
}

export interface DetachedTerminalSession {
  id:           string
  sessionId?:   number | null
  tenantId?:     number | null
  hostId:       number
  hostName:     string
  hostIp?:      string
  hostPort?:    number
  hostAuthType?: string
  hostAccessProtocol?: HostAccessProtocol
  connectedAt:  Date
}

export interface HostInfo {
  id:        number
  tenantId?:  number | null
  name?:     string
  ip?:       string
  port?:     number
  authType?: string
  accessProtocol?: HostAccessProtocol
  startupSnippetId?: number | null
  startupSnippetMode?: HostPublic['startupSnippetMode']
}

export const useTerminalStore = defineStore('terminals', () => {
  const tabs     = ref<TerminalTab[]>([])
  const detached = ref<DetachedTerminalSession[]>([])
  const activeId = ref<string | null>(null)

  function currentTenantId() {
    return useAuthStore().user?.tenantId ?? null
  }

  function resolveTenantId(host: HostInfo) {
    return host.tenantId ?? currentTenantId()
  }

  function add(host: HostInfo): string {
    const id = crypto.randomUUID()
    tabs.value.push({
      id,
      tenantId:     resolveTenantId(host),
      hostId:       host.id,
      hostName:     host.name ?? `Host #${host.id}`,
      hostIp:       host.ip,
      hostPort:     host.port,
      hostAuthType: host.authType,
      hostAccessProtocol: host.accessProtocol ?? 'ssh',
      startupSnippetId: host.startupSnippetId ?? null,
      startupSnippetMode: host.startupSnippetMode ?? 'disabled',
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

  function setSessionId(id: string, sessionId: number | null) {
    const tab = tabs.value.find((t) => t.id === id)
    if (tab) {
      tab.sessionId = sessionId
      return
    }
    const detachedSession = detached.value.find((item) => item.id === id)
    if (detachedSession) detachedSession.sessionId = sessionId
  }

  function setJiraAuthorization(id: string, value: { ticketKey: string | null; interactionId: string; sessionGrant: string; ticketSummary?: string | null; ticketStatus?: string | null; ticketUrl?: string | null }) {
    const tab = tabs.value.find((item) => item.id === id)
    if (!tab) return
    tab.jiraTicketKey = value.ticketKey
    tab.jiraInteractionId = value.interactionId
    tab.jiraSessionGrant = value.sessionGrant
    tab.jiraTicketSummary = value.ticketSummary ?? tab.jiraTicketSummary ?? null
    tab.jiraTicketStatus = value.ticketStatus ?? tab.jiraTicketStatus ?? null
    tab.jiraTicketUrl = value.ticketUrl ?? tab.jiraTicketUrl ?? null
  }

  function clearJiraAuthorization(id: string) {
    const tab = tabs.value.find((item) => item.id === id)
    if (!tab) return
    tab.jiraTicketKey = null
    tab.jiraInteractionId = null
    tab.jiraSessionGrant = null
    tab.jiraTicketSummary = null
    tab.jiraTicketStatus = null
    tab.jiraTicketUrl = null
  }

  function updateHostInfo(id: string, host: HostInfo) {
    const tab = tabs.value.find((t) => t.id === id)
    if (!tab) return
    tab.tenantId = resolveTenantId(host)
    tab.hostId = host.id
    tab.hostName = host.name ?? tab.hostName
    tab.hostIp = host.ip ?? tab.hostIp
    tab.hostPort = host.port ?? tab.hostPort
    tab.hostAuthType = host.authType ?? tab.hostAuthType
    tab.hostAccessProtocol = host.accessProtocol ?? tab.hostAccessProtocol ?? 'ssh'
    tab.startupSnippetId = host.startupSnippetId ?? tab.startupSnippetId ?? null
    tab.startupSnippetMode = host.startupSnippetMode ?? tab.startupSnippetMode ?? 'disabled'
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

  function addDetached(id: string, host: HostInfo) {
    const existing = detached.value.find((item) => item.id === id)
    if (existing) {
      existing.tenantId = resolveTenantId(host)
      existing.hostId = host.id
      existing.hostName = host.name ?? existing.hostName
      existing.hostIp = host.ip ?? existing.hostIp
      existing.hostPort = host.port ?? existing.hostPort
      existing.hostAuthType = host.authType ?? existing.hostAuthType
      existing.hostAccessProtocol = host.accessProtocol ?? existing.hostAccessProtocol ?? 'ssh'
      return
    }
    detached.value.push({
      id,
      tenantId:     resolveTenantId(host),
      hostId:       host.id,
      hostName:     host.name ?? `Host #${host.id}`,
      hostIp:       host.ip,
      hostPort:     host.port,
      hostAuthType: host.authType,
      hostAccessProtocol: host.accessProtocol ?? 'ssh',
      connectedAt:  new Date(),
    })
  }

  function removeDetached(id: string) {
    const idx = detached.value.findIndex((item) => item.id === id)
    if (idx >= 0) detached.value.splice(idx, 1)
  }

  function removeDetachedByHostId(hostId: number) {
    detached.value = detached.value.filter((item) => item.hostId !== hostId)
  }

  function removeBySessionId(sessionId: number) {
    const removedActive = tabs.value.some((tab) => tab.sessionId === sessionId && tab.id === activeId.value)
    tabs.value = tabs.value.filter((tab) => tab.sessionId !== sessionId)
    detached.value = detached.value.filter((item) => item.sessionId !== sessionId)
    if (removedActive) activeId.value = tabs.value[0]?.id ?? null
  }

  function clear() {
    tabs.value     = []
    detached.value = []
    activeId.value = null
  }

  return { tabs, detached, activeId, add, remove, setName, setConnectedAt, setSessionId, setJiraAuthorization, clearJiraAuthorization, updateHostInfo, activate, markActivity, clearUnread, addDetached, removeDetached, removeDetachedByHostId, removeBySessionId, clear }
})
