<script setup lang="ts">
import { h, ref, onMounted, onBeforeUnmount, computed, nextTick, watch, defineAsyncComponent } from 'vue'
import { watchDebounced } from '@vueuse/core'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NSpace, NInput, NInputNumber, NSelect, NButton, NCard, NTag, NSpin, NSwitch,
  NEmpty, NGrid, NGridItem, NText, NAlert, NModal, NForm, NFormItem,
  NScrollbar, NTooltip, NDropdown, NPagination, NCheckbox, NCollapse, NCollapseItem, NTree, NTreeSelect, useMessage, useDialog,
} from 'naive-ui'
import type { VNodeChild } from 'vue'
import type { DropdownOption, SelectOption, TreeOption } from 'naive-ui'
import {
  type BastionPublic,
  type HostAssociatedLink,
  type HostPublic,
  type CreateHostDto,
  type HostKeyTrustEvent,
  type HostLinkCreated,
  type PemKeyPublic,
  type TestConnectionResult,
  type TagPublic,
  type HostBulkFilter,
  type HostBulkSelection,
  type HostOperatingSystem,
  type InventoryNodePublic,
  canOpenInWebTerminal,
  canTestHostConnectivity,
  getHostAccessProtocolCapabilities,
  usesSshCredentials,
} from '@nodeaccess/shared'
import {
  validateHostLinkTemplate,
  findUnknownHostLinkVariables,
  listHostLinkVariables,
  resolveHostLinkTemplate,
} from '@nodeaccess/shared/types/host-associated-link'
import { hostService, type HostSidebarSummary } from '@/services/host.service'
import { sessionsService, type AccessMapHost } from '@/services/sessions.service'
import { agentService, type AgentInfo, type AgentStatusInfo } from '@/services/agent.service'
import { folderService, type FolderPublic } from '@/services/folder.service'
import { inventoryService } from '@/services/inventory.service'
import { bastionService }     from '@/services/bastion.service'
import { pemKeyService }      from '@/services/pem-key.service'
import { integrationService } from '@/services/integration.service'
import { tagService }         from '@/services/tag.service'
import { portForwardingService, type PortForwardingWithHost } from '@/services/portForwarding.service'
import { webAccessService } from '@/services/webAccess.service'
import { hostLinkService, type HostLinkListItem } from '@/services/host-link.service'
import { snippetService, type Snippet } from '@/services/snippet.service'
import {
  hostDisplayMode,
  hostsDefaultView,
  hostsSidebarWidth,
  homeMaxFavorites,
  homeMaxRecents,
  HOSTS_SIDEBAR_DEFAULT_WIDTH,
  HOSTS_SIDEBAR_MAX_WIDTH,
  HOSTS_SIDEBAR_MIN_WIDTH,
  quickAccessCollapsed,
  corporateFoldersPanelExpandedPreference,
  inventoryTreeExpandedKeysPreference,
  foldersPanelExpandedPreference,
  groupsPanelExpandedPreference,
  tagsPanelExpandedPreference,
  setCorporateFoldersPanelExpandedPreference,
  setInventoryTreeExpandedKeysPreference,
  setFoldersPanelExpandedPreference,
  setGroupsPanelExpandedPreference,
  setHostDisplayMode,
  setQuickAccessCollapsed,
  setHostsSidebarWidth,
  setTagsPanelExpandedPreference,
  type HostDisplayMode,
} from '@/services/host-view-preferences.service'
import { favoriteHostIds, isFavoriteHost, markHostAsRecent, recentHostIds, toggleFavoriteHost } from '@/services/host-quick-access.service'
import { resetTerminalLayout } from '@/services/terminal-layout.service'
import { featuresService } from '@/services/features.service'
import { INVENTORY_ACL_CHANGED_EVENT, SESSION_PRESENCE_CHANGED_EVENT, USER_ACL_MEMBERSHIP_CHANGED_EVENT, type SessionPresenceChangedEventDetail } from '@/services/app-events.service'
import { useAuthStore }       from '@/stores/auth'
import { useTerminalStore }   from '@/stores/terminals'
import { termSettings } from '@/composables/useTerminal'
import HostOsIcon from '@/components/HostOsIcon.vue'
import HostPresencePill from '@/components/HostPresencePill.vue'
import UserAvatar from '@/components/UserAvatar.vue'

const ImportHostsModal = defineAsyncComponent(() => import('@/components/ImportHostsModal.vue'))
const CollapsibleSection = defineAsyncComponent(() => import('@/components/CollapsibleSection.vue'))
const HostBulkActionModal = defineAsyncComponent(() => import('@/components/HostBulkActionModal.vue'))
const HostBulkActionHistoryDrawer = defineAsyncComponent(() => import('@/components/HostBulkActionHistoryDrawer.vue'))
const InventoryAclDrawer = defineAsyncComponent(() => import('@/components/InventoryAclDrawer.vue'))

const router    = useRouter()
const route     = useRoute()
const auth      = useAuthStore()
const termStore = useTerminalStore()
const msg       = useMessage()
const dialog    = useDialog()
const { t }     = useI18n()
type HostsPerfMode = 'normal' | 'list-minimal' | 'no-presence'

const sidebarWidth = ref(hostsSidebarWidth.value)
const isSidebarResizing = ref(false)
const sidebarResizeStartX = ref(0)
const sidebarResizeStartWidth = ref(HOSTS_SIDEBAR_DEFAULT_WIDTH)
const sidebarStyle = computed(() => ({
  width: `${sidebarWidth.value}px`,
  minWidth: `${HOSTS_SIDEBAR_MIN_WIDTH}px`,
  maxWidth: `${HOSTS_SIDEBAR_MAX_WIDTH}px`,
}))

function clampSidebarWidth(value: number) {
  return Math.min(HOSTS_SIDEBAR_MAX_WIDTH, Math.max(HOSTS_SIDEBAR_MIN_WIDTH, Math.round(value)))
}

function onSidebarResizePointerMove(event: PointerEvent) {
  if (!isSidebarResizing.value) return
  const delta = event.clientX - sidebarResizeStartX.value
  sidebarWidth.value = clampSidebarWidth(sidebarResizeStartWidth.value + delta)
}

function stopSidebarResize() {
  if (!isSidebarResizing.value) return
  isSidebarResizing.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('pointermove', onSidebarResizePointerMove)
  window.removeEventListener('pointerup', stopSidebarResize)
  setHostsSidebarWidth(sidebarWidth.value)
}

function startSidebarResize(event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault()
  isSidebarResizing.value = true
  sidebarResizeStartX.value = event.clientX
  sidebarResizeStartWidth.value = sidebarWidth.value
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', onSidebarResizePointerMove)
  window.addEventListener('pointerup', stopSidebarResize)
}

watch(hostsSidebarWidth, (value) => {
  if (!isSidebarResizing.value) sidebarWidth.value = value
})
const hostsPerfMode = computed<HostsPerfMode>(() => {
  if (!import.meta.env.DEV) return 'normal'
  const routeValue = Array.isArray(route.query.perfMode) ? route.query.perfMode[0] : route.query.perfMode
  const searchValue = typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search).get('perfMode')
  const value = String(routeValue ?? searchValue ?? 'normal')
  return value === 'list-minimal' || value === 'no-presence' ? value : 'normal'
})
const useMinimalHostList = computed(() => hostsPerfMode.value === 'list-minimal')
const disableAccessPresenceForPerf = computed(() => hostsPerfMode.value === 'no-presence')
const canManage = computed(() => auth.isAdmin || !!auth.user?.canManageHosts)
const canViewAccessMap = computed(() => !disableAccessPresenceForPerf.value && (auth.isAdmin || !!auth.user?.canViewLiveSessions))
const canBulkUpdateHosts = computed(() => auth.isAdmin)
const canManageForwardings = computed(() => auth.isAdmin)
const TENANT_CONTEXT_CHANGED_EVENT = 'nodeaccess:tenant-context-changed'
const multiConnect = ref(false)
const sidebarSearch = ref('')
const quickAccessHosts = ref<HostPublic[]>([])
const viewportWidth = ref(typeof window === 'undefined' ? 1440 : window.innerWidth)
const isLargeViewport = computed(() => viewportWidth.value >= 1024)

const hostById = computed(() => {
  const map = new Map<number, HostPublic>()
  for (const host of pageHosts.value) map.set(host.id, host)
  for (const host of quickAccessHosts.value) map.set(host.id, host)
  return map
})

const favoriteHostIdSet = computed(() => new Set(favoriteHostIds.value))
const recentHostIdSet = computed(() => new Set(recentHostIds.value))

// ─── Dados ───────────────────────────────────────────────────────────────────

const pageHosts    = ref<HostPublic[]>([])
const folders      = ref<FolderPublic[]>([])
const inventoryNodes = ref<InventoryNodePublic[]>([])
const groupOptions = ref<{ label: string; value: number }[]>([])
const bastions     = ref<BastionPublic[]>([])
const pemKeys      = ref<PemKeyPublic[]>([])
const allTags      = ref<TagPublic[]>([])
const snippets     = ref<Snippet[]>([])
const forwardings  = ref<PortForwardingWithHost[]>([])
const total        = ref(0)
const loading      = ref(false)
const aclRealtimeRefreshing = ref(false)
const error        = ref<string | null>(null)
const hostPanelRefreshKey = ref(0)
const sidebarSummary = ref<HostSidebarSummary | null>(null)
const maxHostsLicensed = computed(() => sidebarSummary.value?.maxHosts ?? null)
const agentStatus  = ref<AgentStatusInfo | null>(null)
const agents       = ref<AgentInfo[]>([])
const accessPresenceHosts = ref<AccessMapHost[]>([])
const currentTenantId = computed(() => auth.user?.tenantId ?? null)
const openSessionItems = computed(() => {
  const tenantId = currentTenantId.value
  return [
    ...termStore.tabs.map((tab) => ({ ...tab, kind: 'local' as const })),
    ...termStore.detached.map((session) => ({ ...session, unreadCount: 0, kind: 'detached' as const })),
  ].filter((item) =>
    tenantId === null
    || item.tenantId === tenantId
    || (item.tenantId == null && hostById.value.has(item.hostId)),
  )
})
const hasOpenSessions = computed(() => openSessionItems.value.length > 0)
const openSessionHostIds = computed(() => new Set(openSessionItems.value.map((item) => item.hostId)))
const openSessionPresenceHosts = computed(() =>
  accessPresenceHosts.value.filter((entry) => openSessionHostIds.value.has(entry.host.id)),
)
const openSessionPresenceTotals = computed(() => openSessionPresenceHosts.value.reduce(
  (totals, entry) => ({
    activeSessions: totals.activeSessions + entry.activeSessions,
    uniqueUsers: totals.uniqueUsers + entry.uniqueUsers,
    activeHosts: totals.activeHosts + 1,
  }),
  { activeSessions: 0, uniqueUsers: 0, activeHosts: 0 },
))
const showHelp             = ref(false)
const folderMoveHost       = ref<HostPublic | null>(null)
const folderMoveSelectedId = ref<number | null>(null)
const permissionsHost = ref<HostPublic | null>(null)
const permissionsInventoryNode = ref<InventoryNodePublic | null>(null)
let agentStatusTimer: ReturnType<typeof setInterval> | null = null
let deferredSidebarTimer: ReturnType<typeof setTimeout> | null = null
let aclRealtimeRefreshTimer: ReturnType<typeof setTimeout> | null = null
let deferredSidebarLoadPromise: Promise<void> | null = null
let quickAccessLoadPromise: Promise<void> | null = null
let accessPresenceLoadPromise: Promise<void> | null = null
let accessPresenceTimer: ReturnType<typeof setInterval> | null = null
let lastAccessPresenceRefreshAt = 0
let lastQuickAccessIdsKey = ''
let accessPresenceGeneration = 0
let accessPresenceRequestId = 0
const deferredSidebarLoaded = ref(false)
const ACCESS_PRESENCE_REFRESH_MS = 5_000

const helpQuickItems = computed(() => ['permissions', 'route', 'access'])
const helpFields = computed(() => ['sidebar', 'quickAccess', 'permissions', 'auth', 'route', 'links', 'forwardings', 'tags'])
const helpPermissionItems = computed(() => ['view', 'connect', 'edit', 'admin'])
const helpRoutes = computed(() => ['direct', 'auto', 'agent_user', 'agent_tenant'])

function openSession(tabId?: string) {
  if (tabId) termStore.activate(tabId)
  resetTerminalLayout()
  router.push({ name: 'terminal' })
}

function openSessionItem(item: (typeof openSessionItems.value)[number]) {
  if (item.kind === 'local') {
    openSession(item.id)
    return
  }
  openSession()
}

function openFirstSessionItem() {
  const first = openSessionItems.value[0]
  if (first) openSessionItem(first)
}

function openActiveSessionsReport() {
  if (!auth.isAdmin) {
    openFirstSessionItem()
    return
  }
  router.push({ name: 'admin-reports-sessions', query: { active: 'true' } })
}

function closeSession(tabId: string) {
  const tab = termStore.tabs.find((item) => item.id === tabId)
  if (tab) {
    accessPresenceHosts.value = accessPresenceHosts.value.filter((entry) => entry.host.id !== tab.hostId)
    sessionsService.clearAccessMapCache('local-session-close')
    lastAccessPresenceRefreshAt = 0
    window.setTimeout(() => {
      lastAccessPresenceRefreshAt = 0
      void refreshAccessPresence()
    }, 1200)
  }
  termStore.remove(tabId)
}

function toggleQuickAccessCollapsed() {
  setQuickAccessCollapsed(!quickAccessCollapsed.value)
}

function toggleFoldersPanelExpanded() {
  setFoldersPanelExpandedPreference(!foldersPanelExpandedPreference.value)
}

function toggleCorporateFoldersPanelExpanded() {
  setCorporateFoldersPanelExpandedPreference(!corporateFoldersPanelExpandedPreference.value)
}

function toggleGroupsPanelExpanded() {
  setGroupsPanelExpandedPreference(!groupsPanelExpandedPreference.value)
}

function toggleTagsPanelExpanded() {
  setTagsPanelExpandedPreference(!tagsPanelExpandedPreference.value)
}

function openHostForwardings(hostId: number, hostName: string) {
  void router.push({
    name: 'forwardings',
    query: {
      hostId: String(hostId),
      hostName,
      ...(canManageForwardings.value && {
        createHostId: String(hostId),
        createHostName: hostName,
      }),
    },
  })
}

function openHostDashboard(hostId: number) {
  void router.push({ name: 'host-dashboard', params: { hostId } })
}

function canConnectHost(host: HostPublic): boolean {
  return auth.isAdmin || host.accessPermissions?.connect === true
}

function connectBlockedMessage(host: HostPublic): string {
  const folderName = host.inventoryParentName?.trim()
  if (folderName) {
    return t('hosts.inventoryAcl.connectRequiredWithFolder', { folder: folderName })
  }
  return t('hosts.inventoryAcl.connectRequired')
}

function canEditHost(host: HostPublic): boolean {
  return auth.isAdmin || host.accessPermissions?.edit === true
}

function canAdminHost(host: HostPublic): boolean {
  return auth.isAdmin || (canManage.value && host.accessPermissions?.admin === true)
}

function openHostPermissions(host: HostPublic) {
  if (!canAdminHost(host)) {
    msg.warning(t('hosts.inventoryAcl.adminRequired'))
    return
  }
  permissionsHost.value = host
  permissionsInventoryNode.value = null
}

function formatElapsed(from: Date | undefined): string {
  if (!from) return ''
  const secs = Math.floor((Date.now() - from.getTime()) / 1000)
  if (secs < 60) return 'agora'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  return rem > 0 ? `${hours}h${rem}m` : `${hours}h`
}

// ─── Seleção na sidebar ───────────────────────────────────────────────────────

// key: 'all' | 'folder-{id}' | 'inventory-{id}' | 'group-{id}' | 'global' | 'unfiled' | 'tag-{id}'
const selectedKey = ref<string>(hostsDefaultView.value === 'home' ? 'home' : 'all')

const normalizedSearch = computed(() => search.value.trim().toLowerCase())
const isClientOnlySelection = computed(() =>
  selectedKey.value === 'home' || selectedKey.value === 'favorites' || selectedKey.value === 'recent',
)

function buildHostListQuery(page = visiblePage.value, limit = currentPageSize.value) {
  const query: {
    page: number
    limit: number
    search?: string
    scope?: string
    groupId?: number
    folderId?: number
    inventoryNodeId?: number
    tagId?: number
    unfiled?: boolean
    bastionId?: number | null
    pemKeyId?: number | null
    authType?: string
    connectionMode?: string
  } = {
    page,
    limit,
    ...(search.value.trim() ? { search: search.value.trim() } : {}),
  }

  if (selectedKey.value === 'global') {
    query.scope = 'global'
  } else if (selectedKey.value === 'unfiled') {
    query.unfiled = true
  } else if (selectedKey.value.startsWith('folder-')) {
    query.folderId = Number(selectedKey.value.replace('folder-', ''))
  } else if (selectedKey.value.startsWith('inventory-')) {
    query.inventoryNodeId = Number(selectedKey.value.replace('inventory-', ''))
  } else if (selectedKey.value.startsWith('group-')) {
    query.groupId = Number(selectedKey.value.replace('group-', ''))
  } else if (selectedKey.value.startsWith('tag-')) {
    query.tagId = Number(selectedKey.value.replace('tag-', ''))
  }

  if (bulkSelectionMode.value) {
    if (bulkFilterBastionId.value !== null) query.bastionId = bulkFilterBastionId.value === 0 ? null : bulkFilterBastionId.value
    if (bulkFilterPemKeyId.value !== null) query.pemKeyId = bulkFilterPemKeyId.value === 0 ? null : bulkFilterPemKeyId.value
    if (bulkFilterAuthType.value !== null) query.authType = bulkFilterAuthType.value
    if (bulkFilterConnectionMode.value !== null) query.connectionMode = bulkFilterConnectionMode.value
  }

  return query
}

const knownHosts = computed(() => Array.from(hostById.value.values()))

const filteredHosts = computed(() => {
  if (!isClientOnlySelection.value) {
    return pageHosts.value
  }

  let baseHosts: HostPublic[]
  if (selectedKey.value === 'favorites') {
    baseHosts = favoriteHostIds.value
      .map((id) => hostById.value.get(id))
      .filter((host): host is HostPublic => !!host)
  } else {
    baseHosts = recentHostIds.value
      .map((id) => hostById.value.get(id))
      .filter((host): host is HostPublic => !!host)
  }

  if (!normalizedSearch.value) return baseHosts

  return baseHosts.filter((host) => hostSearchIndexById.value.get(host.id)?.includes(normalizedSearch.value))
})

const hostDisplayModeOptions = computed(() => [
  { label: t('hosts.view.cards'), value: 'cards' as HostDisplayMode },
  { label: t('hosts.view.list'), value: 'list' as HostDisplayMode },
])

function updateHostDisplayPreference(value: HostDisplayMode) {
  setHostDisplayMode(value)
}

// Contadores por seção — alimentam os badges da sidebar
const counts = computed(() => {
  const c: Record<string, number> = {
    all: sidebarSummary.value?.all ?? 0,
    favorites: 0,
    recent: 0,
    unfiled: sidebarSummary.value?.unfiled ?? 0,
    global: sidebarSummary.value?.global ?? 0,
  }

  for (const folder of folders.value) c[`folder-${folder.id}`] = sidebarSummary.value?.folders[String(folder.id)] ?? 0
  for (const group of groupOptions.value) c[`group-${group.value}`] = sidebarSummary.value?.groups[String(group.value)] ?? 0
  for (const tag of allTags.value) c[`tag-${tag.id}`] = sidebarSummary.value?.tags[String(tag.id)] ?? 0

  const hostsById = hostById.value
  for (const id of favoriteHostIds.value) {
    if (hostsById.has(id)) c.favorites++
  }
  for (const id of recentHostIds.value) {
    if (hostsById.has(id)) c.recent++
  }

  return c
})

const selectedLabel = computed(() => {
  if (selectedKey.value === 'all')     return t('hosts.allHosts')
  if (selectedKey.value === 'favorites') return t('hosts.favorites')
  if (selectedKey.value === 'recent') return t('hosts.recent')
  if (selectedKey.value === 'global')  return t('hosts.legacyGlobal.title')
  if (selectedKey.value === 'unfiled') return t('hosts.unfiled')
  if (selectedKey.value.startsWith('folder-')) {
    const id = Number(selectedKey.value.replace('folder-', ''))
    return folders.value.find((f) => f.id === id)?.name ?? 'Pasta'
  }
  if (selectedKey.value.startsWith('inventory-')) {
    const id = Number(selectedKey.value.replace('inventory-', ''))
    const node = inventoryNodes.value.find((item) => item.id === id)
    return node?.type === 'ROOT' ? t('hosts.inventoryFolders.root') : (node?.name ?? t('hosts.inventoryFolders.title'))
  }
  if (selectedKey.value.startsWith('group-')) {
    const id = Number(selectedKey.value.replace('group-', ''))
    return groupOptions.value.find((g) => g.value === id)?.label ?? 'Grupo'
  }
  if (selectedKey.value.startsWith('tag-')) {
    const id = Number(selectedKey.value.replace('tag-', ''))
    return `#${allTags.value.find((tag) => tag.id === id)?.name ?? 'Tag'}`
  }
  return ''
})

const favoriteHosts = computed(() =>
  favoriteHostIds.value
    .map((id) => hostById.value.get(id))
    .filter((host): host is HostPublic => !!host)
    .slice(0, homeMaxFavorites.value),
)

const recentHosts = computed(() =>
  recentHostIds.value
    .map((id) => hostById.value.get(id))
    .filter((host): host is HostPublic => !!host)
    .slice(0, homeMaxRecents.value),
)

const normalizedSidebarSearch = computed(() => sidebarSearch.value.trim().toLowerCase())

const filteredFolders = computed(() => {
  if (!normalizedSidebarSearch.value) return folders.value
  return folders.value.filter((folder) => folder.name.toLowerCase().includes(normalizedSidebarSearch.value))
})

const inventoryFolderNodes = computed(() =>
  inventoryNodes.value.filter((node) => node.type === 'ROOT' || node.type === 'FOLDER'),
)

const sidebarInventoryFolderNodes = computed(() =>
  inventoryFolderNodes.value.filter((node) => node.type === 'FOLDER'),
)

const inventoryHostCountByFolderId = computed(() => {
  const counts = new Map<number, number>()
  const byId = new Map(inventoryNodes.value.map((node) => [node.id, node]))
  for (const node of inventoryNodes.value) {
    if (node.type !== 'HOST' || node.parentId === null) continue
    let current = byId.get(node.parentId)
    while (current) {
      if (current.type === 'FOLDER' || current.type === 'ROOT') {
        counts.set(current.id, (counts.get(current.id) ?? 0) + 1)
      }
      current = current.parentId === null ? undefined : byId.get(current.parentId)
    }
  }
  return counts
})

const corporateInventoryHostTotal = computed(() => {
  const root = inventoryFolderNodes.value.find((node) => node.type === 'ROOT')
  return root ? inventoryHostCountByFolderId.value.get(root.id) ?? 0 : 0
})

const corporateInventoryRootId = computed(() =>
  inventoryFolderNodes.value.find((node) => node.type === 'ROOT')?.id ?? null,
)

const visibleInventoryNodes = computed(() => {
  const byId = new Map(inventoryNodes.value.map((node) => [node.id, node]))
  const treeNodes = inventoryNodes.value.filter((node) => {
    if (node.type === 'FOLDER') return true
    if (node.type !== 'HOST' || node.parentId === null) return false
    return byId.get(node.parentId)?.type === 'FOLDER'
  })
  if (!normalizedSidebarSearch.value) return treeNodes
  const matches = new Set<number>()
  const treeNodeIds = new Set(treeNodes.map((node) => node.id))
  for (const node of treeNodes) {
    if (!node.name.toLowerCase().includes(normalizedSidebarSearch.value)) continue
    matches.add(node.id)
    let current: InventoryNodePublic | undefined = node
    while (current) {
      if (treeNodeIds.has(current.id)) matches.add(current.id)
      current = current.parentId === null ? undefined : byId.get(current.parentId)
    }
  }
  return treeNodes.filter((node) => matches.has(node.id))
})

const inventoryTreeData = computed<TreeOption[]>(() => {
  const allowed = visibleInventoryNodes.value
  const byParent = new Map<number | null, InventoryNodePublic[]>()
  const allowedIds = new Set(allowed.map((node) => node.id))
  for (const node of allowed) {
    const parent = node.parentId === null ? null : inventoryNodes.value.find((item) => item.id === node.parentId)
    const parentId = node.parentId !== null && allowedIds.has(node.parentId) && parent?.type !== 'ROOT' ? node.parentId : null
    const siblings = byParent.get(parentId) ?? []
    siblings.push(node)
    byParent.set(parentId, siblings)
  }

  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => {
      if (a.type !== b.type) {
        if (a.type === 'FOLDER') return -1
        if (b.type === 'FOLDER') return 1
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })
  }

  const build = (parentId: number | null): TreeOption[] =>
    (byParent.get(parentId) ?? []).map((node) => {
      const children = build(node.id)
      return {
        key: node.type === 'HOST' ? `host-${node.hostId ?? node.id}` : `inventory-folder-${node.id}`,
        label: node.name,
        disabled: node.type === 'HOST' && node.hostId === null,
        children,
        hasChildren: children.length > 0,
      }
    })

  return build(null)
})

function renderInventoryTreeSwitcherIcon({ expanded, option }: { expanded: boolean; option: TreeOption }): VNodeChild {
  const key = String(option.key)
  if (key.startsWith('inventory-folder-') && option.hasChildren) {
    return h('span', { class: 'inventory-tree-switcher-icon', 'aria-hidden': 'true' }, expanded ? '▾' : '▸')
  }
  return h('span', { class: 'inventory-tree-switcher-placeholder', 'aria-hidden': 'true' })
}

function renderInventoryTreeLabel({ option }: { option: TreeOption }): VNodeChild {
  const key = String(option.key)
  const isHost = key.startsWith('host-')
  const hostId = isHost ? Number(key.replace('host-', '')) : null
  const folderId = isHost ? null : Number(key.replace('inventory-folder-', ''))
  const dropKey = folderId === null ? null : `inventory-${folderId}`
  const isDropTarget = dropKey !== null && dropTargetKey.value === dropKey
  const hostCount = folderId === null ? 0 : inventoryHostCountByFolderId.value.get(folderId) ?? 0
  const label = String(option.label ?? '')
  const tooltipLines = isHost
    ? [label, hostId !== null && !Number.isNaN(hostId) ? `Host #${hostId}` : null].filter(Boolean)
    : [label, `Pasta ACL #${folderId}`, hostCount > 0 ? `${hostCount} host(s)` : null].filter(Boolean)
  const labelNode = h('span', {
    class: 'inventory-folder-node-text',
    title: label,
    style: {
      minWidth: '0',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
  }, label)
  return h('span', {
    class: isHost ? 'inventory-host-node-label' : 'inventory-folder-node-label',
    title: label,
    style: isHost
      ? {
          display: 'grid',
          gridTemplateColumns: 'auto minmax(0, 1fr)',
          minWidth: '0',
          width: '100%',
          alignItems: 'center',
          gap: '6px',
          color: '#a1a1aa',
          fontSize: '11px',
        }
      : {
          display: 'grid',
          gridTemplateColumns: 'auto minmax(0, 1fr) auto',
          minWidth: '0',
          width: '100%',
          alignItems: 'center',
          gap: '6px',
          borderRadius: '6px',
          padding: '1px 3px',
          background: isDropTarget ? 'rgba(59, 130, 246, 0.16)' : undefined,
          outline: isDropTarget ? '1px solid rgba(96, 165, 250, 0.45)' : undefined,
        },
    onContextmenu: isHost
      ? (event: MouseEvent) => openInventoryHostContext(event, hostId)
      : (event: MouseEvent) => openInventoryFolderContext(event, Number(key.replace('inventory-folder-', ''))),
    draggable: canManage.value && (isHost ? hostId !== null : folderId !== null),
    onDragstart: isHost && hostId !== null
      ? (event: DragEvent) => onInventoryHostDragStart(event, hostId)
      : !isHost && folderId !== null
        ? (event: DragEvent) => onInventoryFolderDragStart(event, folderId)
        : undefined,
    onDragend: onDragEnd,
    onDragover: !isHost && dropKey
      ? (event: DragEvent) => onInventoryDropZoneDragOver(event, dropKey, folderId)
      : undefined,
    onDragleave: !isHost && dropKey
      ? (event: DragEvent) => onDropZoneDragLeave(event, dropKey)
      : undefined,
    onDrop: !isHost && folderId !== null
      ? (event: DragEvent) => onInventoryDropZoneDrop(event, folderId)
      : undefined,
  }, [
    h('span', {
      class: isHost ? 'inventory-host-node-icon' : 'inventory-folder-node-icon',
      'aria-hidden': 'true',
      style: {
        fontSize: isHost ? '12px' : '13px',
        lineHeight: '1',
        flexShrink: '0',
        opacity: isHost ? '0.82' : undefined,
      },
    }, isHost ? '🖥' : '📁'),
    h(NTooltip, { trigger: 'hover', placement: 'right', delay: 450 }, {
      trigger: () => labelNode,
      default: () => h('div', { class: 'inventory-node-tooltip' }, tooltipLines.map((line) =>
        h('div', { class: 'inventory-node-tooltip-line' }, String(line)),
      )),
    }),
    ...(!isHost && hostCount > 0
      ? [h('span', {
          class: 'inventory-folder-node-count',
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: '18px',
            height: '16px',
            padding: '0 5px',
            borderRadius: '999px',
            background: '#27272a',
            color: '#a1a1aa',
            fontSize: '10px',
            fontWeight: '600',
            lineHeight: '1',
            flexShrink: '0',
          },
        }, String(hostCount))]
      : []),
  ])
}

async function openInventoryHostContext(event: MouseEvent, hostId: number | null) {
  event.preventDefault()
  event.stopPropagation()
  if (hostId === null || Number.isNaN(hostId)) return
  const cachedHost = hostById.value.get(hostId)
  if (cachedHost) {
    onHostContextMenu(event, cachedHost)
    return
  }

  try {
    const { data } = await hostService.get(hostId)
    onHostContextMenu(event, data)
  } catch {
    msg.error(t('hosts.inventoryFolders.hostContextLoadError'))
  }
}

const inventoryFolderContextVisible = ref(false)
const inventoryFolderContextX = ref(0)
const inventoryFolderContextY = ref(0)
const inventoryFolderContextNodeId = ref<number | null>(null)
const inventoryFolderContextIsRoot = ref(false)
const inventoryFolderContextOptions = ref<DropdownOption[]>([])

function inventoryFolderMenuOptions(): DropdownOption[] {
  return [
    { key: 'rename-folder', label: t('hosts.inventoryFolders.renameAction') },
    { key: 'create-folder', label: t('hosts.inventoryFolders.createAction') },
    { key: 'create-host', label: t('hosts.inventoryFolders.createHostAction') },
    { key: 'manage-acl', label: t('hosts.inventoryFolders.manageSelected') },
    { key: 'delete-folder', label: t('hosts.inventoryFolders.deleteAction') },
  ]
}

function openInventoryFolderContext(event: MouseEvent, nodeId: number) {
  if (!canManage.value) return
  event.preventDefault()
  event.stopPropagation()
  ctxVisible.value = false
  ctxHost.value = null
  inventoryFolderContextNodeId.value = nodeId
  inventoryFolderContextIsRoot.value = false
  inventoryFolderContextOptions.value = inventoryFolderMenuOptions()
  inventoryFolderContextVisible.value = false
  setTimeout(() => {
    inventoryFolderContextX.value = event.clientX
    inventoryFolderContextY.value = event.clientY
    inventoryFolderContextVisible.value = true
  }, 0)
}

function openCorporateFoldersContext(event: MouseEvent) {
  if (!canManage.value) return
  event.preventDefault()
  event.stopPropagation()
  ctxVisible.value = false
  ctxHost.value = null
  inventoryFolderContextNodeId.value = null
  inventoryFolderContextIsRoot.value = true
  inventoryFolderContextOptions.value = [{ key: 'create-root-folder', label: t('hosts.inventoryFolders.createRootAction') }]
  inventoryFolderContextVisible.value = false
  setTimeout(() => {
    inventoryFolderContextX.value = event.clientX
    inventoryFolderContextY.value = event.clientY
    inventoryFolderContextVisible.value = true
  }, 0)
}

function closeInventoryFolderContext() {
  inventoryFolderContextVisible.value = false
  window.setTimeout(() => {
    if (inventoryFolderContextVisible.value) return
    inventoryFolderContextNodeId.value = null
    inventoryFolderContextIsRoot.value = false
    inventoryFolderContextOptions.value = []
  }, 120)
}

function openInventoryFolderPermissions(node: InventoryNodePublic) {
  permissionsInventoryNode.value = node
  permissionsHost.value = null
}

function openCreateInventoryHost(parentId: number) {
  openCreate(parentId)
}

function onInventoryFolderContextSelect(key: string) {
  const nodeId = inventoryFolderContextNodeId.value
  const isRootContext = inventoryFolderContextIsRoot.value
  closeInventoryFolderContext()
  if (isRootContext) {
    if (key === 'create-root-folder') openCreateRootInventoryFolder()
    return
  }
  if (nodeId === null) return
  const node = inventoryFolderNodes.value.find((item) => item.id === nodeId)
  if (!node) return

  if (key === 'manage-acl') {
    openInventoryFolderPermissions(node)
    return
  }
  if (key === 'create-folder') {
    openCreateInventoryFolder(nodeId)
    return
  }
  if (key === 'create-host') {
    openCreateInventoryHost(nodeId)
    return
  }
  if (key === 'rename-folder') {
    openRenameInventoryFolder(node)
    return
  }
  if (key === 'delete-folder') {
    confirmDeleteInventoryFolder(node)
  }
}

function inventoryFolderLabel(node: InventoryNodePublic) {
  return node.type === 'ROOT' ? t('hosts.inventoryFolders.root') : node.name
}

const inventoryFolderTreeSelectOptions = computed<TreeOption[]>(() => {
  const byParent = new Map<number | null, InventoryNodePublic[]>()
  const folderIds = new Set(inventoryFolderNodes.value.map((node) => node.id))
  for (const node of inventoryFolderNodes.value) {
    const parentId = node.parentId !== null && folderIds.has(node.parentId) ? node.parentId : null
    const siblings = byParent.get(parentId) ?? []
    siblings.push(node)
    byParent.set(parentId, siblings)
  }

  const build = (parentId: number | null): TreeOption[] =>
    (byParent.get(parentId) ?? []).map((node) => ({
      key: node.id,
      label: inventoryFolderLabel(node),
      children: build(node.id),
    }))

  return build(null)
})

function inventoryFolderPathLabel(id?: number | null) {
  if (!id) return ''
  const byId = new Map(inventoryFolderNodes.value.map((node) => [node.id, node]))
  const labels: string[] = []
  let current = byId.get(id)
  while (current) {
    labels.unshift(inventoryFolderLabel(current))
    current = current.parentId === null ? undefined : byId.get(current.parentId)
  }
  return labels.join(' / ')
}

const selectedInventoryFolderPath = computed(() => inventoryFolderPathLabel(form.value.inventoryParentId))

const selectedInventoryTreeKeys = computed<Array<string | number>>(() => {
  if (!selectedKey.value.startsWith('inventory-')) return []
  return [`inventory-folder-${selectedKey.value.replace('inventory-', '')}`]
})

const expandedInventoryTreeKeys = ref<Array<string | number>>([...inventoryTreeExpandedKeysPreference.value])

function collectInventoryTreeKeys(nodes: TreeOption[]) {
  const keys = new Set<string>()
  const visit = (items: TreeOption[]) => {
    for (const item of items) {
      keys.add(String(item.key))
      if (item.children?.length) visit(item.children as TreeOption[])
    }
  }
  visit(nodes)
  return keys
}

function selectedInventoryAncestorKeys() {
  if (!selectedKey.value.startsWith('inventory-')) return []
  const selectedId = Number(selectedKey.value.replace('inventory-', ''))
  if (!Number.isInteger(selectedId)) return []

  const byId = new Map(inventoryFolderNodes.value.map((node) => [node.id, node]))
  const keys: string[] = []
  let current = byId.get(selectedId)
  while (current && current.parentId !== null) {
    const parent = byId.get(current.parentId)
    if (!parent || parent.type === 'ROOT') break
    keys.unshift(`inventory-folder-${parent.id}`)
    current = parent
  }
  return keys
}

function expandedKeysForSidebarSearch() {
  const search = normalizedSidebarSearch.value
  if (!search) return []

  const byId = new Map(inventoryNodes.value.map((node) => [node.id, node]))
  const keys = new Set<string>()
  for (const node of inventoryNodes.value) {
    if ((node.type !== 'FOLDER' && node.type !== 'HOST') || !node.name.toLowerCase().includes(search)) continue
    let current = node.parentId === null ? undefined : byId.get(node.parentId)
    while (current) {
      if (current.type === 'FOLDER') keys.add(`inventory-folder-${current.id}`)
      current = current.parentId === null ? undefined : byId.get(current.parentId)
    }
  }
  return [...keys]
}

function applyExpandedInventoryTreeKeys(nextKeys: Array<string | number>, options: { persist?: boolean } = {}) {
  if (inventoryTreeData.value.length === 0) return
  const existing = collectInventoryTreeKeys(inventoryTreeData.value)
  const normalized = [...new Set(nextKeys.map((key) => String(key)).filter((key) => existing.has(key)))]
  expandedInventoryTreeKeys.value = normalized
  if (options.persist) {
    setInventoryTreeExpandedKeysPreference(normalized)
  }
}

watch(inventoryTreeData, (nodes) => {
  if (nodes.length === 0) return
  const nextKeys = normalizedSidebarSearch.value
    ? expandedKeysForSidebarSearch()
    : [
        ...expandedInventoryTreeKeys.value,
        ...selectedInventoryAncestorKeys(),
      ]
  applyExpandedInventoryTreeKeys(nextKeys)
}, { immediate: true })

watch(selectedInventoryTreeKeys, () => {
  applyExpandedInventoryTreeKeys([
    ...expandedInventoryTreeKeys.value,
    ...selectedInventoryAncestorKeys(),
  ])
})

function onInventoryTreeExpanded(keys: Array<string | number>) {
  applyExpandedInventoryTreeKeys(keys, { persist: !normalizedSidebarSearch.value })
}

function onInventoryTreeSelected(keys: Array<string | number>) {
  if (keys.length === 0) return
  const key = String(keys[0])
  if (key.startsWith('inventory-folder-')) {
    search.value = ''
    selectedKey.value = `inventory-${key.replace('inventory-folder-', '')}`
    return
  }
  if (!key.startsWith('host-')) return
  const hostId = Number(key.replace('host-', ''))
  const hostNode = inventoryNodes.value.find((node) => node.type === 'HOST' && node.hostId === hostId)
  if (!hostNode) return
  if (hostNode.parentId !== null) selectedKey.value = `inventory-${hostNode.parentId}`
  search.value = hostNode.name
  void nextTick(() => triggerSearchLoad())
}

const filteredGroupOptions = computed(() => {
  if (!normalizedSidebarSearch.value) return groupOptions.value
  return groupOptions.value.filter((group) => group.label.toLowerCase().includes(normalizedSidebarSearch.value))
})

const filteredTags = computed(() => {
  if (!normalizedSidebarSearch.value) return allTags.value
  return allTags.value.filter((tag) => tag.name.toLowerCase().includes(normalizedSidebarSearch.value))
})

const foldersPanelExpanded = computed(() =>
  foldersPanelExpandedPreference.value
  || normalizedSidebarSearch.value.length > 0
  || selectedKey.value === 'unfiled'
  || selectedKey.value.startsWith('folder-'),
)

const corporateFoldersPanelExpanded = computed(() =>
  corporateFoldersPanelExpandedPreference.value
  || normalizedSidebarSearch.value.length > 0
  || selectedKey.value.startsWith('inventory-'),
)

const groupsPanelExpanded = computed(() =>
  groupsPanelExpandedPreference.value
  || normalizedSidebarSearch.value.length > 0
  || selectedKey.value === 'global'
  || selectedKey.value.startsWith('group-'),
)

const hasLegacyFilters = computed(() =>
  counts.value.global > 0
  || filteredGroupOptions.value.length > 0
  || selectedKey.value === 'global'
  || selectedKey.value.startsWith('group-'),
)

const tagsPanelExpanded = computed(() =>
  tagsPanelExpandedPreference.value
  || normalizedSidebarSearch.value.length > 0
  || selectedKey.value.startsWith('tag-'),
)

const hasSidebarSearchResults = computed(() => (
  !normalizedSidebarSearch.value
  || filteredFolders.value.length > 0
  || visibleInventoryNodes.value.length > 0
  || filteredGroupOptions.value.length > 0
  || filteredTags.value.length > 0
))

const emptyStateDescription = computed(() => {
  if (selectedKey.value === 'favorites') return t('hosts.empty.favorites')
  if (selectedKey.value === 'recent') return t('hosts.empty.recent')
  if (selectedKey.value.startsWith('inventory-')) return t('hosts.empty.inventory')
  if (selectedKey.value === 'all' && total.value === 0) {
    return canManage.value ? t('hosts.empty.admin') : t('hosts.empty.user')
  }
  return t('hosts.empty.section')
})

const hostLimitReached = computed(() =>
  maxHostsLicensed.value !== null && (sidebarSummary.value?.all ?? total.value) >= maxHostsLicensed.value,
)

const hostLimitMessage = computed(() => {
  if (maxHostsLicensed.value === null) return ''
  return t('hosts.license.maxHostsReached', { count: maxHostsLicensed.value })
})

// ─── Drag and drop ────────────────────────────────────────────────────────────

const draggingHost  = ref<HostPublic | null>(null)
const draggingHostId = ref<number | null>(null)
const draggingInventoryFolderId = ref<number | null>(null)
const dropTargetKey = ref<string | null>(null)

function onDragStart(e: DragEvent, host: HostPublic) {
  draggingHost.value = host
  draggingHostId.value = host.id
  draggingInventoryFolderId.value = null
  e.dataTransfer?.setData('application/x-nodeaccess-host-id', String(host.id))
  e.dataTransfer?.setData('text/plain', String(host.id))
  e.dataTransfer!.effectAllowed = 'move'
  // small delay so the card renders dimmed before browser captures the ghost
  setTimeout(() => { /* noop — reactivity handles opacity */ }, 0)
}

function onInventoryHostDragStart(e: DragEvent, hostId: number) {
  e.stopPropagation()
  draggingHost.value = hostById.value.get(hostId) ?? null
  draggingHostId.value = hostId
  draggingInventoryFolderId.value = null
  e.dataTransfer?.setData('application/x-nodeaccess-host-id', String(hostId))
  e.dataTransfer?.setData('text/plain', String(hostId))
  e.dataTransfer!.effectAllowed = 'move'
}

function onInventoryFolderDragStart(e: DragEvent, folderId: number) {
  e.stopPropagation()
  draggingHost.value = null
  draggingHostId.value = null
  draggingInventoryFolderId.value = folderId
  e.dataTransfer?.setData('application/x-nodeaccess-inventory-folder-id', String(folderId))
  e.dataTransfer!.effectAllowed = 'move'
}

function onDragEnd() {
  draggingHost.value  = null
  draggingHostId.value = null
  draggingInventoryFolderId.value = null
  dropTargetKey.value = null
}

function draggedHostIdFromEvent(e: DragEvent): number | null {
  const raw = e.dataTransfer?.getData('application/x-nodeaccess-host-id') || e.dataTransfer?.getData('text/plain')
  const id = Number(raw)
  return Number.isFinite(id) && id > 0 ? id : null
}

function hasDraggedHost(e?: DragEvent): boolean {
  return !!draggingHost.value || draggingHostId.value !== null || (e ? draggedHostIdFromEvent(e) !== null : false)
}

function draggedInventoryFolderIdFromEvent(e: DragEvent): number | null {
  const raw = e.dataTransfer?.getData('application/x-nodeaccess-inventory-folder-id')
  const id = Number(raw)
  return Number.isFinite(id) && id > 0 ? id : null
}

function hasDraggedInventoryFolder(e?: DragEvent): boolean {
  return draggingInventoryFolderId.value !== null || (e ? draggedInventoryFolderIdFromEvent(e) !== null : false)
}

function draggedInventoryFolderId(e: DragEvent): number | null {
  return draggingInventoryFolderId.value ?? draggedInventoryFolderIdFromEvent(e)
}

async function resolveDraggedHost(e: DragEvent): Promise<HostPublic | null> {
  if (draggingHost.value) return draggingHost.value
  const hostId = draggingHostId.value ?? draggedHostIdFromEvent(e)
  if (!hostId) return null
  const cached = hostById.value.get(hostId)
  if (cached) return cached
  try {
    const { data } = await hostService.get(hostId)
    return data
  } catch {
    msg.error(t('hosts.inventoryFolders.hostContextLoadError'))
    return null
  }
}

function inventoryParentIdForHost(host: HostPublic): number | null {
  const hostNode = inventoryNodes.value.find((node) => node.type === 'HOST' && node.hostId === host.id)
  if (hostNode) return hostNode.parentId
  return host.inventoryParentId ?? null
}

function inventoryNodeById(id: number): InventoryNodePublic | null {
  return inventoryNodes.value.find((node) => node.id === id) ?? null
}

function isInventoryFolderDropInsideItself(folderId: number, targetFolderId: number): boolean {
  const source = inventoryNodeById(folderId)
  const target = inventoryNodeById(targetFolderId)
  return !!source && !!target && target.path.startsWith(source.path)
}

function onDropZoneDragOver(e: DragEvent, key: string) {
  if (!hasDraggedHost(e)) return
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'move'
  dropTargetKey.value = key
}

function onInventoryDropZoneDragOver(e: DragEvent, key: string, targetFolderId: number | null) {
  if (!hasDraggedHost(e) && !hasDraggedInventoryFolder(e)) return
  e.preventDefault()
  const sourceFolderId = targetFolderId === null ? null : draggedInventoryFolderId(e)
  if (sourceFolderId !== null && targetFolderId !== null && isInventoryFolderDropInsideItself(sourceFolderId, targetFolderId)) {
    e.dataTransfer!.dropEffect = 'none'
    if (dropTargetKey.value === key) dropTargetKey.value = null
    return
  }
  e.dataTransfer!.dropEffect = 'move'
  dropTargetKey.value = key
}

function onInventoryRootDragOver(e: DragEvent) {
  const rootId = corporateInventoryRootId.value
  if (rootId === null || !hasDraggedInventoryFolder(e)) return
  onInventoryDropZoneDragOver(e, 'inventory-root', rootId)
}

async function onInventoryRootDrop(e: DragEvent) {
  const rootId = corporateInventoryRootId.value
  if (rootId === null || !hasDraggedInventoryFolder(e)) return
  await onInventoryDropZoneDrop(e, rootId)
}

function onDropZoneDragLeave(e: DragEvent, key: string) {
  // only clear if the mouse truly left this element (not just moved to a child)
  if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return
  if (dropTargetKey.value === key) dropTargetKey.value = null
}

async function onDropZoneDrop(e: DragEvent, folderId: number | null) {
  e.preventDefault()
  e.stopPropagation()
  dropTargetKey.value = null
  const host = await resolveDraggedHost(e)
  draggingHost.value = null
  draggingHostId.value = null
  if (!host) return
  if (host.folderId === folderId) {
    msg.info(t('hosts.inventoryFolders.hostAlreadyInFolder'))
    return
  }
  await moveToFolder(host, folderId)
}

async function onInventoryDropZoneDrop(e: DragEvent, inventoryParentId: number) {
  e.preventDefault()
  e.stopPropagation()
  dropTargetKey.value = null
  const sourceFolderId = draggedInventoryFolderId(e)
  if (sourceFolderId !== null) {
    draggingHost.value = null
    draggingHostId.value = null
    draggingInventoryFolderId.value = null
    if (sourceFolderId === inventoryParentId) {
      msg.info(t('hosts.inventoryFolders.folderAlreadyInFolder'))
      return
    }
    if (isInventoryFolderDropInsideItself(sourceFolderId, inventoryParentId)) {
      msg.warning(t('hosts.inventoryFolders.folderMoveInvalidDescendant'))
      return
    }
    await moveInventoryFolder(sourceFolderId, inventoryParentId)
    return
  }
  const host = await resolveDraggedHost(e)
  draggingHost.value = null
  draggingHostId.value = null
  draggingInventoryFolderId.value = null
  if (!host) return
  if (inventoryParentIdForHost(host) === inventoryParentId) {
    msg.info(t('hosts.inventoryFolders.hostAlreadyInFolder'))
    return
  }
  await moveToInventoryFolder(host, inventoryParentId)
}

// ─── Carregamento ────────────────────────────────────────────────────────────

const search = ref('')
watchDebounced(search, () => {
  if (selectedKey.value === 'home' && search.value.trim() !== '') {
    selectedKey.value = 'all'
    void load({ background: true })
  } else if (!isClientOnlySelection.value) {
    void load({ background: true })
  }
}, { debounce: 500, maxWait: 1500 })

const visiblePage = ref(1)
const listPageSize = ref(40)
// Cards têm uma árvore visual rica; 12 reduz o custo do primeiro paint sem
// remover informações e o usuário ainda pode escolher 24 ou 48 por página.
const cardPageSize = ref(12)
let latestLoadRequestId = 0
const isDocumentVisible = ref(typeof document === 'undefined' ? true : document.visibilityState === 'visible')

function applyHostPage(nextHosts: HostPublic[], nextTotal: number) {
  const samePage = total.value === nextTotal
    && pageHosts.value.length === nextHosts.length
    && pageHosts.value.every((host, index) => host === nextHosts[index])
  if (samePage) return
  pageHosts.value = nextHosts
  total.value = nextTotal
}

async function load(options: { background?: boolean } = {}) {
  const requestId = ++latestLoadRequestId
  const params = buildHostListQuery()
  if (options.background) {
    const cached = await hostService.peekList(params)
    if (cached && requestId === latestLoadRequestId) {
      applyHostPage(cached.data.data, cached.data.total)
    }
  }

  if (!options.background || pageHosts.value.length === 0) loading.value = true
  error.value   = null
  try {
    const { data } = await hostService.list(params)
    if (requestId !== latestLoadRequestId) return
    applyHostPage(data.data, data.total)
    await maybeOpenHostFromRoute()
  } catch {
    if (requestId !== latestLoadRequestId) return
    error.value = 'Erro ao carregar hosts'
  } finally {
    if (requestId === latestLoadRequestId) loading.value = false
  }
}

async function loadQuickAccessHosts(options: { force?: boolean } = {}) {
  const ids = [...new Set([...favoriteHostIds.value, ...recentHostIds.value])]
  const idsKey = ids.join(',')
  if (ids.length === 0) {
    quickAccessHosts.value = []
    lastQuickAccessIdsKey = ''
    return
  }
  if (!options.force && idsKey === lastQuickAccessIdsKey && quickAccessHosts.value.length > 0) {
    return
  }
  if (quickAccessLoadPromise) {
    return quickAccessLoadPromise
  }
  quickAccessLoadPromise = (async () => {
    try {
      const { data } = await hostService.listVisibleByIds(ids)
      quickAccessHosts.value = data
      lastQuickAccessIdsKey = idsKey
    } catch {
      quickAccessHosts.value = []
    } finally {
      quickAccessLoadPromise = null
    }
  })()
  return quickAccessLoadPromise
}

async function refreshHostData() {
  await Promise.all([
    load(),
    loadQuickAccessHosts({ force: true }),
    loadSidebarBootstrap(),
    refreshAccessPresence(),
  ])
}

function replaceKnownHost(next: HostPublic) {
  pageHosts.value = pageHosts.value.map((host) => host.id === next.id ? next : host)
  quickAccessHosts.value = quickAccessHosts.value.map((host) => host.id === next.id ? next : host)
}

function hostMatchesCurrentServerSelection(host: HostPublic): boolean {
  const term = search.value.trim().toLowerCase()
  if (term && !host.name.toLowerCase().includes(term) && !host.ip.toLowerCase().includes(term)) return false
  if (selectedKey.value === 'global') return host.scope === 'global'
  if (selectedKey.value === 'unfiled') return host.folderId == null
  if (selectedKey.value.startsWith('folder-')) return host.folderId === Number(selectedKey.value.replace('folder-', ''))
  if (selectedKey.value.startsWith('inventory-')) return true
  if (selectedKey.value.startsWith('group-')) return host.groupId === Number(selectedKey.value.replace('group-', ''))
  if (selectedKey.value.startsWith('tag-')) {
    const tagId = Number(selectedKey.value.replace('tag-', ''))
    return host.tags.some((tag) => tag.id === tagId)
  }
  return selectedKey.value === 'all'
}

function sortHostsByName(hosts: HostPublic[]): HostPublic[] {
  return [...hosts].sort((a, b) => a.name.localeCompare(b.name))
}

function hostSidebarDependenciesChanged(previous: HostPublic | null, next: HostPublic): boolean {
  if (!previous) return true
  const previousTagIds = previous.tags.map((tag) => tag.id).sort((a, b) => a - b).join(',')
  const nextTagIds = next.tags.map((tag) => tag.id).sort((a, b) => a - b).join(',')
  return previous.scope !== next.scope
    || previous.groupId !== next.groupId
    || previous.folderId !== next.folderId
    || previousTagIds !== nextTagIds
}

function applyUpdatedHost(next: HostPublic, previous: HostPublic | null = hostById.value.get(next.id) ?? null) {
  const sidebarChanged = hostSidebarDependenciesChanged(previous, next)
  quickAccessHosts.value = quickAccessHosts.value.map((host) => host.id === next.id ? next : host)

  const index = pageHosts.value.findIndex((host) => host.id === next.id)
  if (index === -1) {
    if (sidebarChanged) void loadSidebarBootstrap()
    return
  }

  if (!isClientOnlySelection.value && !hostMatchesCurrentServerSelection(next)) {
    pageHosts.value = pageHosts.value.filter((host) => host.id !== next.id)
    total.value = Math.max(0, total.value - 1)
    if (sidebarChanged) void loadSidebarBootstrap()
    return
  }

  pageHosts.value = sortHostsByName(pageHosts.value.map((host) => host.id === next.id ? next : host))
  if (sidebarChanged) {
    void loadSidebarBootstrap()
  }
}

function triggerSearchLoad() {
  if (!isClientOnlySelection.value) {
    void load()
  }
}

const opActive = ref(false)

async function loadSidebarEssential() {
  await loadSidebarBootstrap()
}

async function loadSidebarBootstrap() {
  try {
    const [{ data }, inventoryResult] = await Promise.all([
      hostService.getSidebarBootstrap(),
      inventoryService.list().catch(() => ({ data: [] as InventoryNodePublic[] })),
    ])
    folders.value = data.folders
    inventoryNodes.value = inventoryResult.data
    groupOptions.value = data.groups.map((group) => ({ label: group.name, value: group.id }))
    allTags.value = data.tags
    sidebarSummary.value = data.summary
  } catch {
    folders.value = []
    inventoryNodes.value = []
    groupOptions.value = []
    allTags.value = []
    sidebarSummary.value = null
  }
}

async function loadForwardings(options: { force?: boolean } = {}) {
  if (options.force) {
    portForwardingService.clear()
  }
  try {
    const { data } = await portForwardingService.listAll()
    forwardings.value = data
  } catch {
    forwardings.value = []
  }
}

async function loadSidebarDeferred(options: { force?: boolean } = {}) {
  if (!options.force && deferredSidebarLoaded.value) return
  if (deferredSidebarLoadPromise) return deferredSidebarLoadPromise

  deferredSidebarLoadPromise = (async () => {
    const [bRes, pkRes, fwRes, agentRes, agentsRes, snippetsRes] = await Promise.allSettled([
    bastionService.list(),
    pemKeyService.list(),
    portForwardingService.listAll(),
    agentService.status(),
    agentService.list(),
    snippetService.list(),
  ])
    if (bRes.status      === 'fulfilled') bastions.value     = bRes.value.data
    if (pkRes.status     === 'fulfilled') pemKeys.value      = pkRes.value.data
    if (fwRes.status     === 'fulfilled') forwardings.value  = fwRes.value.data
    if (agentRes.status  === 'fulfilled') agentStatus.value  = agentRes.value.data
    if (agentsRes.status === 'fulfilled') agents.value       = agentsRes.value.data
    if (snippetsRes.status === 'fulfilled') snippets.value   = snippetsRes.value.data
    deferredSidebarLoaded.value = true
  })().finally(() => {
    deferredSidebarLoadPromise = null
  })

  return deferredSidebarLoadPromise
}

async function loadSidebar(includeDeferred = true) {
  await loadSidebarEssential()
  if (includeDeferred) {
    await loadSidebarDeferred()
  }
}

function scheduleDeferredSidebarLoad() {
  if (deferredSidebarTimer !== null) clearTimeout(deferredSidebarTimer)
  deferredSidebarTimer = setTimeout(() => {
    void loadSidebarDeferred()
    deferredSidebarTimer = null
  }, 150)
}

async function refreshAgentStatus() {
  if (!shouldPollAgentStatus.value) return
  try {
    const { data } = await agentService.status()
    agentStatus.value = data
  } catch {
    // Status de agente é informativo; a conexão SSH ainda valida no backend.
  }
}

function startAgentStatusRefresh() {
  if (!shouldPollAgentStatus.value) return
  stopAgentStatusRefresh()
  agentStatusTimer = setInterval(refreshAgentStatus, 15000)
}

function stopAgentStatusRefresh() {
  if (agentStatusTimer !== null) {
    clearInterval(agentStatusTimer)
    agentStatusTimer = null
  }
}

const hostAccessPresenceByHostId = computed(() => {
  const map = new Map<number, AccessMapHost>()
  for (const host of accessPresenceHosts.value) map.set(host.host.id, host)
  return map
})

function hostAccessPresence(hostId: number) {
  return hostAccessPresenceByHostId.value.get(hostId) ?? null
}

async function refreshAccessPresence() {
  if (!canViewAccessMap.value || document.visibilityState !== 'visible') {
    accessPresenceHosts.value = []
    return
  }
  const generation = accessPresenceGeneration
  const now = Date.now()
  if (now - lastAccessPresenceRefreshAt < 1000) return
  if (accessPresenceLoadPromise) return accessPresenceLoadPromise
  const requestId = ++accessPresenceRequestId
  accessPresenceLoadPromise = (async () => {
    try {
      const { data } = await sessionsService.accessMap()
      if (generation === accessPresenceGeneration) {
        accessPresenceHosts.value = data.hosts
      }
    } catch {
      if (generation === accessPresenceGeneration) {
        accessPresenceHosts.value = []
      }
    } finally {
      if (generation === accessPresenceGeneration) {
        lastAccessPresenceRefreshAt = Date.now()
      }
      if (requestId === accessPresenceRequestId) {
        accessPresenceLoadPromise = null
      }
    }
  })()
  return accessPresenceLoadPromise
}

function startAccessPresenceRefresh() {
  stopAccessPresenceRefresh()
  if (!canViewAccessMap.value) return
  void refreshAccessPresence()
  accessPresenceTimer = setInterval(() => {
    void refreshAccessPresence()
  }, ACCESS_PRESENCE_REFRESH_MS)
}

function stopAccessPresenceRefresh() {
  if (accessPresenceTimer !== null) {
    clearInterval(accessPresenceTimer)
    accessPresenceTimer = null
  }
}

function canInstallHostsPerfHooks() {
  if (typeof window === 'undefined') return false
  if (import.meta.env.DEV) return true
  const isLocalHarness = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    && new URLSearchParams(window.location.search).has('cdp_perf')
  return isLocalHarness
}

function installHostsPerfHooks() {
  if (!canInstallHostsPerfHooks()) return
  ;(window as any).__nodeAccessHostsPerf = {
    hostCount() {
      return hostById.value.size
    },
    setCardPageSize(value: number) {
      if (value === 12 || value === 24 || value === 48) {
        cardPageSize.value = value
        visiblePage.value = 1
      }
      return cardPageSize.value
    },
    async addOpenSession(hostId?: number) {
      const firstKnownHost = hostById.value.values().next().value as HostPublic | undefined
      let host = (hostId ? hostById.value.get(hostId) : firstKnownHost) ?? firstKnownHost
      if (!host) {
        try {
          const { data } = await hostService.list({ page: 1, limit: 1 })
          host = data.data[0]
        } catch {
          host = undefined
        }
      }
      host ??= {
        id: 900_001,
        tenantId: auth.user?.tenantId ?? null,
        name: 'Host harness',
        ip: '127.0.0.1',
        port: 22,
        authType: 'password',
        accessProtocol: 'ssh',
      } as HostPublic
      if (!host) return null
      const tabId = termStore.add({
        id: host.id,
        tenantId: host.tenantId,
        name: host.name,
        ip: host.ip,
        port: host.port,
        authType: host.authType,
        accessProtocol: host.accessProtocol,
        startupSnippetId: host.startupSnippetId ?? null,
        startupSnippetMode: host.startupSnippetMode ?? 'disabled',
      })
      termStore.setConnectedAt(tabId)
      return { tabId, hostId: host.id, hostName: host.name }
    },
    clearOpenSessions() {
      termStore.clear()
      accessPresenceHosts.value = []
      sessionsService.clearAccessMapCache('hosts-perf-clear-open-sessions')
    },
    async openCreateHostForm() {
      openCreate()
      hostFormExpandedSections.value = ['organization']
      await nextTick()
      return {
        visible: showHostModal.value,
        editingHostId: editingHostId.value,
        expandedSections: hostFormExpandedSections.value,
      }
    },
    async setCreateHostProtocol(protocol: HostPublic['accessProtocol']) {
      form.value.accessProtocol = protocol
      onAccessProtocolChange(protocol)
      await nextTick()
      return {
        accessProtocol: form.value.accessProtocol,
        startupSnippetAvailable: startupSnippetAvailable.value,
        startupSnippetMode: form.value.startupSnippetMode ?? 'disabled',
        startupSnippetId: form.value.startupSnippetId ?? null,
      }
    },
    async setStartupSnippetFormValue(startupSnippetId: number | null, startupSnippetMode: HostPublic['startupSnippetMode']) {
      form.value.startupSnippetId = startupSnippetId
      form.value.startupSnippetMode = startupSnippetMode
      await nextTick()
      return {
        accessProtocol: form.value.accessProtocol,
        startupSnippetAvailable: startupSnippetAvailable.value,
        startupSnippetMode: form.value.startupSnippetMode ?? 'disabled',
        startupSnippetId: form.value.startupSnippetId ?? null,
      }
    },
    startupSnippetFormState() {
      return {
        accessProtocol: form.value.accessProtocol,
        startupSnippetAvailable: startupSnippetAvailable.value,
        startupSnippetMode: form.value.startupSnippetMode ?? 'disabled',
        startupSnippetId: form.value.startupSnippetId ?? null,
      }
    },
    async refreshAccessPresence() {
      sessionsService.clearAccessMapCache('hosts-perf-refresh-access-presence')
      lastAccessPresenceRefreshAt = 0
      await refreshAccessPresence()
      return accessPresenceHosts.value.map((entry) => ({
        hostId: entry.host.id,
        activeSessions: entry.activeSessions,
        uniqueUsers: entry.uniqueUsers,
      }))
    },
  }
}

function uninstallHostsPerfHooks() {
  if (!canInstallHostsPerfHooks()) return
  delete (window as any).__nodeAccessHostsPerf
}

function syncAgentStatusRefresh() {
  if (shouldPollAgentStatus.value) {
    if (agentStatusTimer === null) {
      void refreshAgentStatus()
      startAgentStatusRefresh()
    }
    return
  }
  stopAgentStatusRefresh()
}

function onVisibilityChange() {
  isDocumentVisible.value = document.visibilityState === 'visible'
  if (isDocumentVisible.value) {
    void refreshAccessPresence()
    startAccessPresenceRefresh()
  } else {
    stopAccessPresenceRefresh()
  }
}

function refreshHostsAfterRealtimeAclChange() {
  if (aclRealtimeRefreshTimer !== null) clearTimeout(aclRealtimeRefreshTimer)
  aclRealtimeRefreshTimer = setTimeout(() => {
    aclRealtimeRefreshTimer = null
    hostPanelRefreshKey.value += 1
    aclRealtimeRefreshing.value = true
    const finish = () => {
      aclRealtimeRefreshing.value = false
    }
    if (selectedKey.value === 'home') {
      void Promise.all([
        loadQuickAccessHosts({ force: true }),
        loadSidebarBootstrap(),
        refreshAccessPresence(),
      ]).finally(finish)
    } else {
      void refreshHostData().finally(finish)
      scheduleDeferredSidebarLoad()
    }
  }, 150)
}

function onInventoryAclChanged() {
  refreshHostsAfterRealtimeAclChange()
}

function onUserAclMembershipChanged() {
  refreshHostsAfterRealtimeAclChange()
}

function onSessionPresenceChanged(event: Event) {
  const detail = (event as CustomEvent<SessionPresenceChangedEventDetail>).detail
  if (!detail) return
  if (currentTenantId.value !== null && detail.tenantId !== currentTenantId.value) return
  const affectsVisibleHost = hostById.value.has(detail.hostId)
  const affectsOpenSession = openSessionHostIds.value.has(detail.hostId)
  if (!affectsVisibleHost && !affectsOpenSession) return
  lastAccessPresenceRefreshAt = 0
  accessPresenceLoadPromise = null
  void refreshAccessPresence()
}

function onTenantContextChanged() {
  if (!auth.isAuthenticated) return
  accessPresenceGeneration += 1
  accessPresenceRequestId += 1
  accessPresenceHosts.value = []
  sessionsService.clearAccessMapCache('tenant-context-change')
  accessPresenceLoadPromise = null
  lastAccessPresenceRefreshAt = 0
  quickAccessHosts.value = []
  lastQuickAccessIdsKey = ''
  stopAccessPresenceRefresh()
  hostPanelRefreshKey.value += 1

  if (selectedKey.value === 'home') {
    void Promise.all([
      loadQuickAccessHosts({ force: true }),
      loadSidebarBootstrap(),
      refreshAccessPresence(),
    ])
  } else {
    void refreshHostData()
    scheduleDeferredSidebarLoad()
  }

  startAccessPresenceRefresh()
  syncAgentStatusRefresh()
}

function updateViewportWidth() {
  viewportWidth.value = window.innerWidth
}

async function loadOnePasswordStatus() {
  try {
    const { data } = await integrationService.list()
    const op = data.find((i) => i.provider === 'onepassword')
    opActive.value = !!(op?.enabled && op?.hasToken)
  } catch {
    opActive.value = false
  }
}

async function loadHostLinkOptions() {
  try {
    const { data } = await hostLinkService.options()
    hostLinkJitEnabled.value = data.jitAccess.enabled !== false
    const options = data.jitAccess.expiryMinutes
      .filter((minutes) => Number.isInteger(minutes) && minutes > 0)
      .sort((a, b) => a - b)
    if (options.length > 0) {
      hostLinkExpiryOptions.value = options
      if (!options.includes(hostLinkExpiryMinutes.value)) {
        hostLinkExpiryMinutes.value = options.includes(10) ? 10 : options[0]
      }
    }
  } catch {
    hostLinkJitEnabled.value = true
    hostLinkExpiryOptions.value = [5, 10, 30]
  }
}

onMounted(() => {
  updateViewportWidth()
  void loadHostLinkOptions()
  if (selectedKey.value === 'home') {
    void refreshAccessPresence()
    void loadQuickAccessHosts()
    void loadSidebarBootstrap()
    scheduleDeferredSidebarLoad()
  } else {
    refreshHostData()
    scheduleDeferredSidebarLoad()
  }
  startAccessPresenceRefresh()
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('resize', updateViewportWidth, { passive: true })
  window.addEventListener(TENANT_CONTEXT_CHANGED_EVENT, onTenantContextChanged)
  window.addEventListener(INVENTORY_ACL_CHANGED_EVENT, onInventoryAclChanged)
  window.addEventListener(USER_ACL_MEMBERSHIP_CHANGED_EVENT, onUserAclMembershipChanged)
  window.addEventListener(SESSION_PRESENCE_CHANGED_EVENT, onSessionPresenceChanged)
  installHostsPerfHooks()
  syncAgentStatusRefresh()
})

onBeforeUnmount(() => {
  stopAgentStatusRefresh()
  stopAccessPresenceRefresh()
  detachHostActionMenuOutsideClick()
  uninstallHostsPerfHooks()
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('resize', updateViewportWidth)
  window.removeEventListener(TENANT_CONTEXT_CHANGED_EVENT, onTenantContextChanged)
  window.removeEventListener(INVENTORY_ACL_CHANGED_EVENT, onInventoryAclChanged)
  window.removeEventListener(USER_ACL_MEMBERSHIP_CHANGED_EVENT, onUserAclMembershipChanged)
  window.removeEventListener(SESSION_PRESENCE_CHANGED_EVENT, onSessionPresenceChanged)
  if (deferredSidebarTimer !== null) {
    clearTimeout(deferredSidebarTimer)
    deferredSidebarTimer = null
  }
  if (aclRealtimeRefreshTimer !== null) {
    clearTimeout(aclRealtimeRefreshTimer)
    aclRealtimeRefreshTimer = null
  }
  stopSidebarResize()
})

watch(() => route.query.editHostId, async () => {
  await maybeOpenHostFromRoute()
})

const currentPageSize = computed(() =>
  hostDisplayMode.value === 'list' ? listPageSize.value : cardPageSize.value,
)

const pageSizeModel = computed({
  get: () => currentPageSize.value,
  set: (value: number) => {
    if (hostDisplayMode.value === 'list') listPageSize.value = value
    else cardPageSize.value = value
  },
})

watch([selectedKey, search, hostDisplayMode], ([key]) => {
  visiblePage.value = 1
  if (!isClientOnlySelection.value) {
    void load({ background: true })
  }
  if (key === 'home') {
    void loadQuickAccessHosts()
  }
})

watch([visiblePage, currentPageSize], () => {
  if (!isClientOnlySelection.value) {
    void load({ background: true })
  }
})

watch([favoriteHostIds, recentHostIds], () => {
  void loadQuickAccessHosts({ force: true })
}, { deep: true })

const paginatedFilteredHosts = computed(() => {
  if (!isClientOnlySelection.value) return filteredHosts.value
  const start = (visiblePage.value - 1) * currentPageSize.value
  return filteredHosts.value.slice(start, start + currentPageSize.value)
})

const selectedBulkHostIds = ref<number[]>([])
const bulkSelectionSource = ref<'ids' | 'filter'>('ids')
const bulkFilterBastionId = ref<number | null>(null)
const bulkFilterPemKeyId = ref<number | null>(null)
const bulkFilterAuthType = ref<HostPublic['authType'] | null>(null)
const bulkFilterConnectionMode = ref<HostPublic['connectionMode'] | null>(null)
const selectedBulkHostIdSet = computed(() => new Set(selectedBulkHostIds.value))
const visibleBulkHostIds = computed(() => paginatedFilteredHosts.value.map((host) => host.id))
const hasBulkSelection = computed(() => bulkSelectionSource.value === 'filter' || selectedBulkHostIds.value.length > 0)
const bulkSelectedCount = computed(() => bulkSelectionSource.value === 'filter' ? totalVisibleHosts.value : selectedBulkHostIds.value.length)
const allVisibleBulkHostsSelected = computed(() =>
  visibleBulkHostIds.value.length > 0
  && visibleBulkHostIds.value.every((id) => selectedBulkHostIdSet.value.has(id)),
)
const bulkSelectionMode = ref(false)
const showBulkActionHistory = ref(false)
const showBulkActionModal = ref(false)
const canSelectFilteredBulkHosts = computed(() => !isClientOnlySelection.value && totalVisibleHosts.value > visibleBulkHostIds.value.length)
const bulkSelectionDescription = computed(() =>
  bulkSelectionSource.value === 'filter'
    ? t('hosts.bulk.filteredSelectedSummary', { count: totalVisibleHosts.value })
    : t('hosts.bulk.selectedSummary', { count: selectedBulkHostIds.value.length }),
)
const bulkActionSelection = computed<HostBulkSelection>(() => {
  if (bulkSelectionSource.value === 'filter') {
    const query = buildHostListQuery(1, currentPageSize.value)
    const { page: _page, limit: _limit, ...filter } = query
    return { mode: 'filter', filter: filter as HostBulkFilter }
  }
  return { mode: 'ids', hostIds: selectedBulkHostIds.value }
})

const bulkBastionFilterOptions = computed(() => [
  { label: t('hosts.bulk.filters.withoutBastion'), value: 0 },
  ...bastions.value.map((item) => ({ label: item.name, value: item.id })),
])

const bulkPemKeyFilterOptions = computed(() => [
  { label: t('hosts.bulk.filters.withoutPemKey'), value: 0 },
  ...pemKeys.value.map((item) => ({ label: item.name, value: item.id })),
])

const bulkAuthTypeFilterOptions = computed(() => [
  { label: t('hosts.form.authPassword'), value: 'password' },
  { label: t('hosts.form.authPem'), value: 'pem' },
  { label: t('hosts.form.authPemPassword'), value: 'pem_password' },
])

const bulkConnectionModeFilterOptions = computed(() =>
  connectionModeOptions.value.map((item) => ({ label: item.label, value: item.value })),
)

const hasBulkOperationalFilters = computed(() =>
  bulkFilterBastionId.value !== null
  || bulkFilterPemKeyId.value !== null
  || bulkFilterAuthType.value !== null
  || bulkFilterConnectionMode.value !== null
)

function clearBulkOperationalFilters() {
  bulkFilterBastionId.value = null
  bulkFilterPemKeyId.value = null
  bulkFilterAuthType.value = null
  bulkFilterConnectionMode.value = null
}

watch([bulkFilterBastionId, bulkFilterPemKeyId, bulkFilterAuthType, bulkFilterConnectionMode], () => {
  if (!bulkSelectionMode.value) return
  visiblePage.value = 1
  clearBulkSelection()
  void load({ background: true })
})

function toggleBulkHost(hostId: number, checked: boolean) {
  bulkSelectionSource.value = 'ids'
  selectedBulkHostIds.value = checked
    ? [...new Set([...selectedBulkHostIds.value, hostId])]
    : selectedBulkHostIds.value.filter((id) => id !== hostId)
}

function toggleVisibleBulkHosts(checked: boolean) {
  bulkSelectionSource.value = 'ids'
  if (checked) {
    selectedBulkHostIds.value = [...new Set([...selectedBulkHostIds.value, ...visibleBulkHostIds.value])]
  } else {
    const visible = new Set(visibleBulkHostIds.value)
    selectedBulkHostIds.value = selectedBulkHostIds.value.filter((id) => !visible.has(id))
  }
}

function selectFilteredBulkHosts() {
  bulkSelectionSource.value = 'filter'
  selectedBulkHostIds.value = []
}

function clearBulkSelection() {
  bulkSelectionSource.value = 'ids'
  selectedBulkHostIds.value = []
}

function startBulkSelection() {
  bulkSelectionMode.value = true
}

function stopBulkSelection() {
  bulkSelectionMode.value = false
  clearBulkOperationalFilters()
  clearBulkSelection()
}

function closeBulkActionModal() {
  showBulkActionModal.value = false
  stopBulkSelection()
}

function onBulkApplied() {
  void refreshHostData()
}

watch(visibleBulkHostIds, () => {
  const visible = new Set(visibleBulkHostIds.value)
  selectedBulkHostIds.value = selectedBulkHostIds.value.filter((id) => visible.has(id))
})

watch(bulkSelectionMode, (enabled) => {
  if (!enabled) clearBulkSelection()
})

const totalVisibleHosts = computed(() =>
  isClientOnlySelection.value ? filteredHosts.value.length : total.value,
)

const visibleRangeStart = computed(() => (
  totalVisibleHosts.value === 0 ? 0 : (visiblePage.value - 1) * currentPageSize.value + 1
))

const visibleRangeEnd = computed(() => (
  Math.min(visiblePage.value * currentPageSize.value, totalVisibleHosts.value)
))

const shouldPaginateHosts = computed(() => totalVisibleHosts.value > currentPageSize.value)

const hasVisibleHostsNeedingAgentStatus = computed(() =>
  paginatedFilteredHosts.value.some((host) => host.connectionMode !== 'direct'),
)

const shouldPollAgentStatus = computed(() =>
  isDocumentVisible.value && hasVisibleHostsNeedingAgentStatus.value,
)

watch(shouldPollAgentStatus, () => {
  syncAgentStatusRefresh()
}, { immediate: true })

watch(canViewAccessMap, (allowed) => {
  if (!allowed) {
    accessPresenceHosts.value = []
    stopAccessPresenceRefresh()
    return
  }
  void refreshAccessPresence()
  startAccessPresenceRefresh()
})

const hostSearchIndexById = computed(() => {
  const map = new Map<number, string>()
  for (const host of knownHosts.value) {
    map.set(host.id, [
      host.name,
      host.ip,
      host.sshUser,
      host.scope,
      host.effectiveBastionName ?? '',
      ...host.tags.map((tag) => tag.name),
    ].join(' ').toLowerCase())
  }
  return map
})

const hostForwardingsByHostId = computed(() => {
  const map = new Map<number, PortForwardingWithHost[]>()
  for (const forwarding of forwardings.value) {
    const current = map.get(forwarding.hostId)
    if (current) current.push(forwarding)
    else map.set(forwarding.hostId, [forwarding])
  }
  return map
})

const forwardingCountByHost = computed(() => {
  const counts = new Map<number, number>()
  for (const [hostId, hostForwardings] of hostForwardingsByHostId.value) {
    counts.set(hostId, hostForwardings.length)
  }
  return counts
})

const agentRouteStatusByHostId = computed(() => {
  const map = new Map<number, HostAgentRouteStatus>()
  for (const host of knownHosts.value) {
    map.set(host.id, agentRouteStatusForConnectionMode(host.connectionMode))
  }
  return map
})

type HostRenderMeta = {
  visibleTags: HostPublic['tags']
  hiddenTagCount: number
  hiddenTagNames: string
  visibleCardTags: HostPublic['tags']
  hiddenCardTagCount: number
  hiddenCardTagNames: string
  visibleForwardings: PortForwardingWithHost[]
  hiddenForwardingCount: number
  hiddenForwardingNames: string
  forwardingTooltipItems: string[]
  visibleAssociatedLinks: HostAssociatedLink[]
  visibleAssociatedLinkItems: HostAssociatedLinkViewItem[]
  hiddenAssociatedLinkCount: number
}

type HostAssociatedLinkViewItem = {
  link: HostAssociatedLink
  key: string
  resolvedUrl: string
}

function forwardingLabel(forwarding: PortForwardingWithHost): string {
  const description = forwarding.description?.trim()
  if (description) return description
  return `${forwarding.localPort} → ${forwarding.remoteHost}:${forwarding.remotePort}`
}

function forwardingRouteLabel(forwarding: PortForwardingWithHost): string {
  return `${forwarding.bindAddress}:${forwarding.localPort} → ${forwarding.remoteHost}:${forwarding.remotePort}`
}

function forwardingTooltipLabel(forwarding: PortForwardingWithHost): string {
  const description = forwarding.description?.trim()
  return description ? `${description} · ${forwardingRouteLabel(forwarding)}` : forwardingRouteLabel(forwarding)
}

function hostForwardingTooltipItems(host: HostPublic): string[] {
  return getHostRenderMeta(host).forwardingTooltipItems
}

function buildHostRenderMeta(host: HostPublic): HostRenderMeta {
  const visibleTags = host.tags.slice(0, 1)
  const hiddenTags = host.tags.slice(1)
  const visibleCardTags = host.tags.slice(0, 3)
  const hiddenCardTags = host.tags.slice(3)
  const enabledLinks = (host.associatedLinks ?? []).filter((link) => link.enabled)
  const visibleAssociatedLinks = enabledLinks.slice(0, 2)
  const hostForwardings = hostForwardingsByHostId.value.get(host.id) ?? []
  return {
    visibleTags,
    hiddenTagCount: hiddenTags.length,
    hiddenTagNames: hiddenTags.map((tag) => tag.name).join(', '),
    visibleCardTags,
    hiddenCardTagCount: hiddenCardTags.length,
    hiddenCardTagNames: hiddenCardTags.map((tag) => tag.name).join(', '),
    visibleForwardings: hostForwardings.slice(0, 2),
    hiddenForwardingCount: Math.max(0, hostForwardings.length - 2),
    hiddenForwardingNames: hostForwardings.slice(2).map(forwardingLabel).join(', '),
    forwardingTooltipItems: hostForwardings.map(forwardingTooltipLabel),
    visibleAssociatedLinks,
    visibleAssociatedLinkItems: visibleAssociatedLinks.map((link) => ({
      link,
      key: `host-link-${host.id}-${link.label}-${link.position}`,
      resolvedUrl: resolveHostLinkTemplate(link.urlTemplate, {
        id: host.id,
        name: host.name,
        ip: host.ip,
        port: host.port,
        sshUser: host.sshUser,
      }),
    })),
    hiddenAssociatedLinkCount: Math.max(0, enabledLinks.length - 2),
  }
}

const hostRenderMetaById = computed(() => {
  const map = new Map<number, HostRenderMeta>()
  for (const host of paginatedFilteredHosts.value) {
    map.set(host.id, buildHostRenderMeta(host))
  }
  return map
})

function getHostRenderMeta(host: HostPublic): HostRenderMeta {
  return hostRenderMetaById.value.get(host.id) ?? buildHostRenderMeta(host)
}

type VisibleHostViewItem = {
  host: HostPublic
  meta: HostRenderMeta
  presence: AccessMapHost | null
  agentRouteStatus: HostAgentRouteStatus
  forwardingCount: number
  isFavorite: boolean
  favoriteActionLabel: string
  showOperatingSystemIcon: boolean
  operatingSystemDisplayLabel: string
  accessProtocolDisplayLabel: string
  authTypeDisplayLabel: string
  connectionModeDisplayLabel: string
  connectionModeDisplayTooltip: string
  bastionDisplayTooltip: string
  hasActions: boolean
  canConnect: boolean
  connectBlockedTitle: string | undefined
  connectActionTitle: string
}

const visibleHostViewItems = computed<VisibleHostViewItem[]>(() =>
  paginatedFilteredHosts.value.map((host) => {
    const canConnect = canConnectHost(host)
    const blockedMessage = canConnect ? undefined : connectBlockedMessage(host)
    const isFavorite = favoriteHostIdSet.value.has(host.id)
    const operatingSystemDisplayLabel = operatingSystemLabel(host.operatingSystem)
    return {
      host,
      meta: getHostRenderMeta(host),
      presence: hostAccessPresence(host.id) ?? null,
      agentRouteStatus: agentRouteStatusByHostId.value.get(host.id) ?? null,
      forwardingCount: forwardingCountByHost.value.get(host.id) ?? 0,
      isFavorite,
      favoriteActionLabel: isFavorite ? t('hosts.removeFavorite') : t('hosts.addFavorite'),
      showOperatingSystemIcon: shouldShowOperatingSystemIcon(host),
      operatingSystemDisplayLabel,
      accessProtocolDisplayLabel: accessProtocolLabel(host.accessProtocol),
      authTypeDisplayLabel: authTypeLabel(host.authType),
      connectionModeDisplayLabel: connectionModeShortLabel(host.connectionMode),
      connectionModeDisplayTooltip: connectionModeTooltip(host.connectionMode),
      bastionDisplayTooltip: bastionTooltip(host),
      hasActions: hasHostCardActions(host),
      canConnect,
      connectBlockedTitle: blockedMessage,
      connectActionTitle: canConnect ? t('hosts.connect') : (blockedMessage ?? t('hosts.connect')),
    }
  }),
)

const editingHostForwardings = computed(() => {
  if (editingHostId.value === null) return []
  return forwardings.value.filter((forwarding) => forwarding.hostId === editingHostId.value)
})

const hostLinkExpiryMinutes = ref(10)
const hostLinkExpiryOptions = ref([5, 10, 30])
const hostLinkJitEnabled = ref(true)
const hostLinkExpirySelectOptions = computed(() =>
  hostLinkExpiryOptions.value.map((minutes) => ({
    label: t('hostLinks.expiryOption', { minutes }),
    value: minutes,
  })),
)
const hostLinkLoading = ref(false)
const hostLinksLoading = ref(false)
const hostLinks = ref<HostLinkListItem[]>([])
const revokingHostLinkId = ref<number | null>(null)
const latestHostLink = ref<HostLinkCreated | null>(null)
const associatedLinksOnePasswordRef = ref('')
const associatedLinksOnePasswordPreview = ref<HostAssociatedLink[]>([])
const associatedLinksOnePasswordPreviewError = ref<string | null>(null)
const associatedLinksOnePasswordPreviewLoading = ref(false)
const associatedLinksOnePasswordLoading = ref(false)
const showHostLinkTemplateVariables = ref(false)
let hostLinkTemplateVariablesBlurTimer: ReturnType<typeof setTimeout> | null = null

watch(associatedLinksOnePasswordRef, () => {
  associatedLinksOnePasswordPreview.value = []
  associatedLinksOnePasswordPreviewError.value = null
  showHostLinkTemplateVariables.value = false
})

function showHostLinkVariables() {
  if (hostLinkTemplateVariablesBlurTimer) {
    window.clearTimeout(hostLinkTemplateVariablesBlurTimer)
    hostLinkTemplateVariablesBlurTimer = null
  }
  showHostLinkTemplateVariables.value = true
}

function hideHostLinkVariablesSoon() {
  if (hostLinkTemplateVariablesBlurTimer) window.clearTimeout(hostLinkTemplateVariablesBlurTimer)
  hostLinkTemplateVariablesBlurTimer = setTimeout(() => {
    showHostLinkTemplateVariables.value = false
    hostLinkTemplateVariablesBlurTimer = null
  }, 120)
}

const showForwardingModal = ref(false)
const forwardingModalLoading = ref(false)
const editingForwardingId = ref<number | null>(null)
const showForwardingAdvancedOptions = ref(false)
const forwardingForm = ref({
  description: '',
  bindAddress: '127.0.0.1' as '127.0.0.1' | '0.0.0.0',
  webEnabled: false,
  webProtocol: 'http' as 'http' | 'https',
  localPort: 3306,
  remoteHost: '127.0.0.1',
  remotePort: 3306,
  autoStart: false,
})

// ─── Pastas ──────────────────────────────────────────────────────────────────

const showFolderModal   = ref(false)
const folderModalTitle  = ref('')
const folderName        = ref('')
const editingFolderId   = ref<number | null>(null)
const folderLoading     = ref(false)
const showInventoryFolderModal = ref(false)
const inventoryFolderModalTitle = ref('')
const inventoryFolderName = ref('')
const editingInventoryFolderId = ref<number | null>(null)
const inventoryFolderParentId = ref<number | null>(null)
const inventoryFolderLoading = ref(false)
const showHostFolderCreate = ref(false)
const hostFolderName = ref('')
const hostFolderLoading = ref(false)
const showHostTagCreate = ref(false)
const hostTagName = ref('')
const hostTagLoading = ref(false)
const showHostPemKeyCreate = ref(false)
const hostPemKeyName = ref('')
const hostPemKeyContent = ref('')
const hostPemKeyLoading = ref(false)
const hostPemKeyFileInput = ref<HTMLInputElement | null>(null)
const hostPemKeyDragOver = ref(false)

function resetHostFolderCreate() {
  showHostFolderCreate.value = false
  hostFolderName.value = ''
}

function resetHostTagCreate() {
  showHostTagCreate.value = false
  hostTagName.value = ''
}

function resetHostPemKeyCreate() {
  showHostPemKeyCreate.value = false
  hostPemKeyName.value = ''
  hostPemKeyContent.value = ''
  hostPemKeyDragOver.value = false
  if (hostPemKeyFileInput.value) hostPemKeyFileInput.value.value = ''
}

function openCreateFolder() {
  editingFolderId.value = null
  folderName.value      = ''
  folderModalTitle.value = t('hosts.folder.newTitle')
  showFolderModal.value  = true
}

function openRenameFolder(folder: FolderPublic) {
  editingFolderId.value  = folder.id
  folderName.value       = folder.name
  folderModalTitle.value = t('hosts.folder.renameTitle')
  showFolderModal.value  = true
}

async function saveFolder() {
  if (!folderName.value.trim()) return
  folderLoading.value = true
  try {
    if (editingFolderId.value !== null) {
      await folderService.update(editingFolderId.value, folderName.value.trim())
      msg.success(t('hosts.messages.folderRenamed'))
    } else {
      await folderService.create(folderName.value.trim())
      msg.success(t('hosts.messages.folderCreated'))
    }
    showFolderModal.value = false
    hostService.clearSidebarCaches('folder:save')
    void loadSidebarBootstrap()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('hosts.messages.folderSaveError'))
  } finally {
    folderLoading.value = false
  }
}

function openCreateInventoryFolder(parentId: number) {
  editingInventoryFolderId.value = null
  inventoryFolderParentId.value = parentId
  inventoryFolderName.value = ''
  inventoryFolderModalTitle.value = t('hosts.inventoryFolders.createTitle')
  showInventoryFolderModal.value = true
}

function openCreateRootInventoryFolder() {
  const root = inventoryFolderNodes.value.find((node) => node.type === 'ROOT')
  if (!root) {
    msg.error(t('hosts.inventoryFolders.loadError'))
    return
  }
  openCreateInventoryFolder(root.id)
}

function openRenameInventoryFolder(node: InventoryNodePublic) {
  editingInventoryFolderId.value = node.id
  inventoryFolderParentId.value = node.parentId
  inventoryFolderName.value = node.name
  inventoryFolderModalTitle.value = t('hosts.inventoryFolders.renameTitle')
  showInventoryFolderModal.value = true
}

async function saveInventoryFolder() {
  const name = inventoryFolderName.value.trim()
  if (!name) return
  inventoryFolderLoading.value = true
  try {
    if (editingInventoryFolderId.value !== null) {
      await inventoryService.updateFolder(editingInventoryFolderId.value, name)
      msg.success(t('hosts.inventoryFolders.renameSuccess'))
    } else if (inventoryFolderParentId.value !== null) {
      await inventoryService.createFolder(inventoryFolderParentId.value, name)
      msg.success(t('hosts.inventoryFolders.createSuccess'))
    }
    showInventoryFolderModal.value = false
    hostService.clearSidebarCaches('inventory-folder:save')
    void loadSidebarBootstrap()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? (
      editingInventoryFolderId.value !== null
        ? t('hosts.inventoryFolders.renameError')
        : t('hosts.inventoryFolders.createError')
    ))
  } finally {
    inventoryFolderLoading.value = false
  }
}

function confirmDeleteInventoryFolder(node: InventoryNodePublic) {
  dialog.warning({
    title: t('hosts.inventoryFolders.deleteTitle'),
    content: t('hosts.inventoryFolders.deleteConfirm', { name: node.name }),
    positiveText: t('hosts.inventoryFolders.deleteAction'),
    negativeText: t('common.cancel'),
    async onPositiveClick() {
      try {
        await inventoryService.deleteFolder(node.id)
        msg.success(t('hosts.inventoryFolders.deleteSuccess'))
        if (selectedKey.value === `inventory-${node.id}`) selectedKey.value = 'all'
        hostService.clearSidebarCaches('inventory-folder:delete')
        void loadSidebarBootstrap()
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } }
        msg.error(e.response?.data?.message ?? t('hosts.inventoryFolders.deleteError'))
      }
    },
  })
}

async function createFolderFromHostForm() {
  const name = hostFolderName.value.trim()
  if (!name) return

  hostFolderLoading.value = true
  try {
    const { data } = await folderService.create(name)
    folders.value = [
      ...folders.value.filter((folder) => folder.id !== data.id),
      data,
    ].sort((a, b) => a.name.localeCompare(b.name))
    form.value.folderId = data.id
    resetHostFolderCreate()
    hostService.clearSidebarCaches('folder:create-from-host')
    void loadSidebarBootstrap()
    msg.success(t('hosts.messages.folderCreated'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('hosts.messages.folderSaveError'))
  } finally {
    hostFolderLoading.value = false
  }
}

async function createTagFromHostForm() {
  const name = hostTagName.value.trim()
  if (!name) return

  hostTagLoading.value = true
  try {
    const { data } = await tagService.create(name)
    allTags.value = [
      ...allTags.value.filter((tag) => tag.id !== data.id),
      data,
    ].sort((a, b) => a.name.localeCompare(b.name))
    const currentTagNames = new Set(form.value.tagNames ?? [])
    currentTagNames.add(data.name)
    form.value.tagNames = Array.from(currentTagNames)
    resetHostTagCreate()
    hostService.clearSidebarCaches('tag:create-from-host')
    void loadSidebarBootstrap()
    msg.success(t('hosts.messages.tagCreated'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('hosts.messages.tagSaveError'))
  } finally {
    hostTagLoading.value = false
  }
}

async function createPemKeyFromHostForm() {
  const name = hostPemKeyName.value.trim()
  const key = hostPemKeyContent.value.trim()
  if (!name || !key) {
    msg.warning(t('pemKeys.messages.fillRequired'))
    return
  }

  hostPemKeyLoading.value = true
  try {
    const { data } = await pemKeyService.create({ name, key })
    pemKeys.value = [
      ...pemKeys.value.filter((pemKey) => pemKey.id !== data.id),
      data,
    ].sort((a, b) => a.name.localeCompare(b.name))
    form.value.pemKeyId = data.id
    resetHostPemKeyCreate()
    hostService.clearSidebarCaches('pem-key:create-from-host')
    void loadSidebarDeferred({ force: true })
    msg.success(t('pemKeys.messages.saved'))
    resetTestResult()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('pemKeys.messages.saveError'))
  } finally {
    hostPemKeyLoading.value = false
  }
}

function triggerHostPemKeyFileSelect() {
  hostPemKeyFileInput.value?.click()
}

function nameFromPemFile(file: File): string {
  return file.name.replace(/\.(pem|key|ppk|txt)$/i, '').trim() || file.name
}

async function readHostPemKeyFile(file: File) {
  try {
    const content = await file.text()
    hostPemKeyContent.value = content.trim()
    if (!hostPemKeyName.value.trim()) hostPemKeyName.value = nameFromPemFile(file)
  } catch {
    msg.error(t('hosts.messages.pemFileReadError'))
  }
}

async function onHostPemKeyFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) await readHostPemKeyFile(file)
  input.value = ''
}

async function onHostPemKeyFileDrop(event: DragEvent) {
  hostPemKeyDragOver.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) await readHostPemKeyFile(file)
}

function confirmDeleteFolder(folder: FolderPublic) {
  dialog.warning({
    title:        t('hosts.deleteFolder.title'),
    content:      t('hosts.deleteFolder.content', { name: folder.name }),
    positiveText: t('hosts.deleteFolder.confirm'),
    negativeText: t('hosts.deleteFolder.cancel'),
    onPositiveClick: async () => {
      await folderService.delete(folder.id)
      hostService.clear('folder:delete')
      msg.success(t('hosts.messages.folderDeleted'))
      if (selectedKey.value === `folder-${folder.id}`) selectedKey.value = 'all'
      void loadSidebarBootstrap()
      void load()
    },
  })
}

function confirmDeleteTag(tag: TagPublic) {
  dialog.warning({
    title: `Excluir tag ${tag.name}`,
    content: 'A tag sera removida apenas se nao estiver associada a nenhum host.',
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        await tagService.delete(tag.id)
        hostService.clearSidebarCaches('tag:delete')
        allTags.value = allTags.value.filter((item) => item.id !== tag.id)
        if (selectedKey.value === `tag-${tag.id}`) selectedKey.value = 'all'
        void loadSidebarBootstrap()
        msg.success('Tag excluida')
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } }
        msg.error(e.response?.data?.message ?? 'Erro ao excluir tag')
      }
    },
  })
}

// ─── Modal host (criar / editar) ─────────────────────────────────────────────

const showHostModal  = ref(false)
const hostModalLoading = ref(false)
const editingHostId  = ref<number | null>(null)
const editingHostKeyHistory = ref<HostKeyTrustEvent[]>([])
const hostKeyHistoryLoading = ref(false)
const showOpImportInstructions = ref(false)
const hostFormExpandedSections = ref<string[]>([])
const hostFormScrollRef = ref<HTMLElement | null>(null)

function scrollHostFormSectionIntoView(sectionName: string) {
  window.setTimeout(() => {
    const container = hostFormScrollRef.value
    const target = container?.querySelector(`[data-host-form-section="${sectionName}"]`) as HTMLElement | null
    if (!container || !target) return
    const containerRect = container.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const targetTop = container.scrollTop + targetRect.top - containerRect.top - 12
    container.scrollTo({
      top: Math.max(0, Math.min(targetTop, container.scrollHeight - container.clientHeight)),
      behavior: 'smooth',
    })
  }, 180)
}

function updateHostFormExpandedSections(next: string[] | string | null) {
  const previous = [...hostFormExpandedSections.value]
  const nextSections = Array.isArray(next) ? next : next ? [next] : []
  hostFormExpandedSections.value = nextSections
  if (!showHostModal.value || nextSections.length <= previous.length) return
  const opened = nextSections.find((name) => !previous.includes(name))
  if (!opened) return
  void nextTick(() => scrollHostFormSectionIntoView(opened))
}

const authTypeOptions = computed(() => [
  { label: t('hosts.form.authPassword'), value: 'password' },
  { label: t('hosts.form.authPem'),      value: 'pem' },
  { label: t('hosts.form.authPemPassword'), value: 'pem_password' },
])

const accessProtocolFallbackLabels: Record<HostPublic['accessProtocol'], string> = {
  ssh: 'SSH',
  rdp: 'RDP',
  telnet: 'Telnet',
  vnc: 'VNC',
  serial: 'Serial',
}

function translateOr(key: string, fallback: string) {
  const translated = t(key)
  return translated === key ? fallback : translated
}

const accessProtocolFieldLabel = computed(() => translateOr('hosts.form.accessProtocol', 'Protocolo'))

const accessProtocolOptions = computed(() => [
  { label: accessProtocolLabel('ssh'), value: 'ssh' },
  { label: accessProtocolLabel('rdp'), value: 'rdp' },
  { label: accessProtocolLabel('telnet'), value: 'telnet' },
  { label: accessProtocolLabel('vnc'), value: 'vnc' },
])

const hostOperatingSystemOptions = computed(() => [
  { label: operatingSystemLabel('unknown'), value: 'unknown' },
  { label: operatingSystemLabel('linux'), value: 'linux' },
  { label: operatingSystemLabel('ubuntu'), value: 'ubuntu' },
  { label: operatingSystemLabel('debian'), value: 'debian' },
  { label: operatingSystemLabel('centos'), value: 'centos' },
  { label: operatingSystemLabel('rhel'), value: 'rhel' },
  { label: operatingSystemLabel('rocky'), value: 'rocky' },
  { label: operatingSystemLabel('almalinux'), value: 'almalinux' },
  { label: operatingSystemLabel('suse'), value: 'suse' },
  { label: operatingSystemLabel('windows'), value: 'windows' },
  { label: operatingSystemLabel('windows_server'), value: 'windows_server' },
  { label: operatingSystemLabel('macos'), value: 'macos' },
  { label: operatingSystemLabel('freebsd'), value: 'freebsd' },
  { label: operatingSystemLabel('other'), value: 'other' },
])
const connectionModeOptions = computed(() => [
  { label: t('hosts.form.connectionDirect'), value: 'direct', description: t('hosts.form.connectionDirectHint') },
  { label: t('hosts.form.connectionAgentUser'), value: 'agent_user', description: t('hosts.form.connectionAgentUserHint') },
  { label: t('hosts.form.connectionAgentTenantFallback'), value: 'agent_tenant_fallback', description: t('hosts.form.connectionAgentTenantFallbackHint') },
  { label: t('hosts.form.connectionPrivateAccess'), value: 'private_access_connector', description: t('hosts.form.connectionPrivateAccessHint') },
  { label: t('hosts.form.connectionAuto'), value: 'auto', description: t('hosts.form.connectionAutoHint') },
])

function defaultPortForProtocol(protocol: HostPublic['accessProtocol']) {
  if (protocol === 'rdp') return 3389
  if (protocol === 'telnet') return 23
  if (protocol === 'vnc') return 5900
  return 22
}

function onAccessProtocolChange(next: HostPublic['accessProtocol']) {
  const knownDefaultPorts = new Set([22, 23, 3389, 5900])
  if (!editingHostId.value && knownDefaultPorts.has(form.value.port)) {
    form.value.port = defaultPortForProtocol(next)
  }
  resetTestResult()
}

function expandedSectionsForHostForm(host?: HostPublic): string[] {
  if (!host) {
    return []
  }

  const sections: string[] = []
  if (editableConnectionMode(host.connectionMode) !== 'direct' || host.bastionId) {
    sections.push('routing')
  }
  if (host.onePasswordRef) {
    sections.push('advanced')
  }
  return sections
}

const folderSelectOptions = computed(() =>
  folders.value.map((f) => ({ label: f.name, value: f.id })),
)

const pemKeyOptions = computed(() =>
  pemKeys.value.map((k) => ({ label: k.name, value: k.id })),
)
const privateAccessConnectorOptions = computed(() =>
  agents.value
    .filter((agent) => agent.agentType === 'PRIVATE_ACCESS_CONNECTOR' && agent.active && !agent.revokedAt)
    .map((agent) => ({
      label: agent.siteName ? `${agent.name} - ${agent.siteName}` : agent.name,
      value: agent.id,
    })),
)

const bastionOptions = computed(() =>
  bastions.value.map((bastion) => ({ label: bastion.name, value: bastion.id })),
)

function normalizeHostNameIpSeparators(value: string): string {
  return value.replace(
    /(^|[^A-Za-z0-9_.,])((?:\d{1,3},){3}\d{1,3})(\/\d{1,2})?(?=$|[^A-Za-z0-9_.,])/g,
    (match: string, prefix: string, ip: string, mask: string | undefined) => {
      const octets = ip.split(',').map((part) => Number(part))
      const validIp = octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
      const maskValue = mask ? Number(mask.slice(1)) : null
      const validMask = maskValue === null || (Number.isInteger(maskValue) && maskValue >= 0 && maskValue <= 32)
      if (!validIp || !validMask) return match
      return `${prefix}${octets.join('.')}${mask ?? ''}`
    },
  )
}

function normalizeHostNameField() {
  form.value.name = normalizeHostNameIpSeparators(form.value.name)
}

const ipValidationError = ref<string | null>(null)
const ipFieldBlurred = ref(false)

function validateAsIPv4(val: string): string | null {
  const [ipPart, maskPart, ...extra] = val.split('/')
  if (extra.length > 0) return 'IP inválido'

  const octets = ipPart.split('.')

  if (octets.length < 4) {
    // Still typing — only silent if all partial segments are pure digits (0–3 chars)
    return octets.every((o) => /^\d{0,3}$/.test(o)) ? null : 'IP inválido — formato esperado: 192.168.1.1'
  }

  if (octets.length > 4) return 'IP inválido — formato esperado: 192.168.1.1'

  // Allow trailing empty last octet: user just typed the 3rd dot ("192.168.1.")
  if (octets[3] === '' && maskPart === undefined) return null

  const validOctets = octets.every((o) => o !== '' && /^\d+$/.test(o) && Number(o) >= 0 && Number(o) <= 255)
  if (!validOctets) return 'IP inválido — cada octeto deve ser 0–255'

  if (maskPart !== undefined) {
    if (maskPart === '') return null // still typing mask
    if (!/^\d+$/.test(maskPart) || Number(maskPart) > 32) return 'Máscara CIDR inválida — deve ser 0–32'
  }

  return null
}

function validateAsIPv6(val: string): string | null {
  const [addrPart, maskPart, ...extra] = val.split('/')
  if (extra.length > 0) return 'IPv6 inválido'
  if (maskPart !== undefined && maskPart !== '' && (!/^\d+$/.test(maskPart) || Number(maskPart) > 128)) {
    return 'Máscara IPv6 inválida — deve ser 0–128'
  }
  // Basic structural check: only hex digits and colons, with at most one "::"
  const clean = addrPart.replace('::', '\x00')
  if ((clean.match(/\x00/g) ?? []).length > 1) return 'IPv6 inválido'
  if (!/^[\da-fA-F:]*$/.test(addrPart)) return 'IPv6 inválido — use apenas hex e ":"'
  return null
}

function validateAsHostname(val: string): string | null {
  if (val.length > 253) return 'Hostname inválido — máximo 253 caracteres'
  const normalized = val.endsWith('.') ? val.slice(0, -1) : val
  const labels = normalized.split('.')
  const valid = labels.every(
    (label) =>
      label.length >= 1 &&
      label.length <= 63 &&
      /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label),
  )
  return valid ? null : 'Hostname inválido — use letras, dígitos e hífens; cada parte não pode começar ou terminar com hífen'
}

function normalizeHostIpField() {
  // Commas are never valid in IPs or hostnames
  form.value.ip = form.value.ip.replace(/,/g, '.')

  const val = form.value.ip.trim()
  if (!val) {
    ipValidationError.value = null
    return
  }

  // Detect intent by first character(s):
  // starts with digit(s) followed by a dot → user is typing an IPv4 address
  if (/^\d+\./.test(val) || /^[\d.]+$/.test(val)) {
    ipValidationError.value = validateAsIPv4(val)
    return
  }

  // Has colon → IPv6
  if (val.includes(':')) {
    ipValidationError.value = validateAsIPv6(val)
    return
  }

  // Otherwise treat as hostname / FQDN
  ipValidationError.value = validateAsHostname(val)
}

const hostEndpointResolutionHint = computed(() => {
  if (!ipFieldBlurred.value || ipValidationError.value || !form.value.ip.trim()) return null
  const value = form.value.ip.trim()
  if (/^\d+\./.test(value) || /^[\d.]+$/.test(value) || value.includes(':')) return null
  return t('hosts.form.hostnameResolutionHint')
})

type HostForm = Omit<CreateHostDto, 'inventoryParentId'> & {
  inventoryParentId?: number
  folderId?: number
  bastionId?: number | null
  startupSnippetId?: number | null
  startupSnippetMode?: HostPublic['startupSnippetMode']
}
type HostAssociatedLinkForm = HostAssociatedLink
type HostAssociatedLinkOpenMode = HostAssociatedLink['openMode']

const emptyForm = (): HostForm => ({
  name: '', description: '', ip: '', port: 22, accessProtocol: 'ssh', operatingSystem: 'unknown', sshUser: '', authType: 'password',
  connectionMode: 'direct',
  privateAccessConnectorId: null,
  scope: 'personal', groupId: undefined, folderId: undefined, password: '', pemKeyId: undefined,
  bastionId: undefined, onePasswordRef: undefined, startupSnippetId: null, startupSnippetMode: 'disabled', tagNames: [], associatedLinks: [],
})

const form = ref<HostForm>(emptyForm())

function defaultInventoryParentId(): number | undefined {
  if (selectedKey.value.startsWith('inventory-')) {
    const selectedId = Number(selectedKey.value.replace('inventory-', ''))
    if (inventoryFolderNodes.value.some((node) => node.id === selectedId)) return selectedId
  }
  return inventoryFolderNodes.value.find((node) => node.type === 'ROOT')?.id
}

watch(inventoryFolderNodes, () => {
  if (!showHostModal.value || form.value.inventoryParentId) return
  form.value.inventoryParentId = defaultInventoryParentId()
})

const tagSelectOptions = computed(() =>
  allTags.value.map((t) => ({ label: t.name, value: t.name })),
)

function renderTagSelectLabel(option: SelectOption) {
  const value = String(option.value ?? option.label ?? '').trim()
  const label = String(option.label ?? value)
  const exists = allTags.value.some((tag) => tag.name.trim().toLowerCase() === value.toLowerCase())
  if (!value || exists) return label

  return h('div', { class: 'leading-tight' }, [
    h('div', { class: 'text-sm text-gray-100' }, value),
    h('div', { class: 'text-[11px] text-blue-300' }, t('hosts.form.tagCreateOptionHint')),
  ])
}

const pendingTagNames = computed(() => {
  const existing = new Set(allTags.value.map((tag) => tag.name.trim().toLowerCase()))
  return (form.value.tagNames ?? [])
    .map((name) => name.trim())
    .filter((name) => name && !existing.has(name.toLowerCase()))
})

const associatedLinkOpenModeOptions = computed(() => [
  { label: t('hosts.associatedLinks.openModeNewTab'), value: 'new_tab' },
  { label: t('hosts.associatedLinks.openModeSameTab'), value: 'same_tab' },
])

const startupSnippetModeOptions = computed(() => [
  { label: t('hosts.form.startupSnippetDisabled'), value: 'disabled' },
  { label: t('hosts.form.startupSnippetSuggest'), value: 'suggest' },
  { label: t('hosts.form.startupSnippetAuto'), value: 'auto' },
])

const startupSnippetOptions = computed(() =>
  snippets.value.map((snippet) => ({
    label: snippet.name,
    value: snippet.id,
  })),
)

const startupSnippetSelected = computed(() =>
  snippets.value.find((snippet) => snippet.id === form.value.startupSnippetId) ?? null,
)
const startupSnippetAvailable = computed(() => canOpenInWebTerminal(form.value.accessProtocol))

watch(() => form.value.startupSnippetMode, (mode) => {
  if ((mode ?? 'disabled') === 'disabled') form.value.startupSnippetId = null
})
watch(() => form.value.accessProtocol, (protocol) => {
  if (canOpenInWebTerminal(protocol)) return
  form.value.startupSnippetMode = 'disabled'
  form.value.startupSnippetId = null
})

const hostLinkTemplateVariables = computed(() => listHostLinkVariables())

function createEmptyAssociatedLink(position = 0): HostAssociatedLinkForm {
  return {
    label: '',
    urlTemplate: '',
    position,
    enabled: true,
    openMode: 'new_tab',
    sourceType: 'manual',
    sourceStatus: 'manual',
  }
}

function normalizeAssociatedLinkOpenMode(value: unknown): HostAssociatedLinkOpenMode {
  const normalized = String(value ?? '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase()
    .replace(/^_+/, '')

  if (normalized === 'same_tab' || normalized === 'self' || normalized === '_self') return 'same_tab'
  if (
    normalized === 'new_tab'
    || normalized === 'blank'
    || normalized === '_blank'
    || normalized === 'new_window'
  ) return 'new_tab'
  return 'new_tab'
}

function hostLinkPreview(link: Pick<HostAssociatedLink, 'urlTemplate'>): string {
  return resolveHostLinkTemplate(link.urlTemplate, {
    id: editingHostId.value ?? 0,
    name: form.value.name || 'host',
    ip: form.value.ip || '127.0.0.1',
    port: form.value.port || 22,
    sshUser: form.value.sshUser || 'root',
  })
}

function linkVariableErrors(link: Pick<HostAssociatedLink, 'urlTemplate'>): string[] {
  return findUnknownHostLinkVariables(link.urlTemplate)
}

function linkValidation(link: Pick<HostAssociatedLink, 'urlTemplate'>) {
  return validateHostLinkTemplate(link.urlTemplate, {
    id: editingHostId.value ?? 0,
    name: form.value.name || 'host',
    ip: form.value.ip || '127.0.0.1',
    port: form.value.port || 22,
    sshUser: form.value.sshUser || 'root',
  })
}

function addAssociatedLink() {
  const links = form.value.associatedLinks ?? []
  if (links.length >= 20) return
  form.value.associatedLinks = [...links, createEmptyAssociatedLink(links.length)]
}

function removeAssociatedLink(index: number) {
  const links = [...(form.value.associatedLinks ?? [])]
  links.splice(index, 1)
  form.value.associatedLinks = links.map((link, position) => ({ ...link, position }))
}

function moveAssociatedLink(index: number, direction: -1 | 1) {
  const links = [...(form.value.associatedLinks ?? [])]
  const target = index + direction
  if (target < 0 || target >= links.length) return
  const [current] = links.splice(index, 1)
  links.splice(target, 0, current)
  form.value.associatedLinks = links.map((link, position) => ({ ...link, position }))
}

function normalizeAssociatedLinks(links: HostAssociatedLinkForm[] | undefined): HostAssociatedLink[] {
  return (links ?? [])
    .map((link, position) => ({
      ...link,
      label: link.label.trim(),
      urlTemplate: link.urlTemplate.trim(),
      openMode: normalizeAssociatedLinkOpenMode(link.openMode),
      position,
    }))
    .filter((link) => link.label || link.urlTemplate)
}

function openCreate(inventoryParentId?: number) {
  if (hostLimitReached.value) {
    msg.warning(hostLimitMessage.value)
    return
  }
  editingHostId.value = null
  editingHostKeyHistory.value = []
  latestHostLink.value = null
  hostLinks.value = []
  associatedLinksOnePasswordRef.value = ''
  associatedLinksOnePasswordPreview.value = []
  associatedLinksOnePasswordPreviewError.value = null
  showHostLinkTemplateVariables.value = false
  showOpImportInstructions.value = false
  resetHostFolderCreate()
  resetHostTagCreate()
  resetHostPemKeyCreate()
  form.value = emptyForm()
  testResult.value = null
  ipValidationError.value = null
  ipFieldBlurred.value = false
  form.value.inventoryParentId = inventoryParentId ?? defaultInventoryParentId()
  // Pré-seleciona apenas organização visual/pessoal conforme nó ativo na árvore.
  const key = selectedKey.value
  if (key.startsWith('folder-')) form.value.folderId = Number(key.replace('folder-', ''))
  if (key === 'global')          form.value.scope    = 'global'
  hostFormExpandedSections.value = []
  if (!bastions.value.length || !pemKeys.value.length) void loadSidebarDeferred()
  if (opActive.value === false) void loadOnePasswordStatus()
  showHostModal.value = true
}

function openEditHostForwarding(forwarding: PortForwardingWithHost) {
  if (!canManageForwardings.value) return
  editingForwardingId.value = forwarding.id
  showForwardingAdvancedOptions.value = forwarding.bindAddress !== '127.0.0.1'
  forwardingForm.value = {
    description: forwarding.description ?? '',
    bindAddress: forwarding.bindAddress,
    webEnabled: forwarding.webEnabled,
    webProtocol: forwarding.webProtocol,
    localPort: forwarding.localPort,
    remoteHost: forwarding.remoteHost,
    remotePort: forwarding.remotePort,
    autoStart: forwarding.autoStart,
  }
  showForwardingModal.value = true
}

async function submitHostForwarding() {
  if (!canManageForwardings.value) return
  if (editingHostId.value === null || editingForwardingId.value === null) return
  forwardingModalLoading.value = true
  try {
    await portForwardingService.update(editingHostId.value, editingForwardingId.value, {
      description: forwardingForm.value.description.trim() || undefined,
      bindAddress: forwardingForm.value.bindAddress,
      webEnabled: forwardingForm.value.webEnabled,
      webProtocol: forwardingForm.value.webProtocol,
      localPort: forwardingForm.value.localPort,
      remoteHost: forwardingForm.value.remoteHost,
      remotePort: forwardingForm.value.remotePort,
      autoStart: forwardingForm.value.autoStart,
    })
    showForwardingModal.value = false
    await loadForwardings({ force: true })
    msg.success(t('tunnels.templateSaved'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('tunnels.templateError'))
  } finally {
    forwardingModalLoading.value = false
  }
}

async function toggleHostForwardingAutoStart(forwarding: PortForwardingWithHost) {
  if (!canManageForwardings.value) return
  try {
    await portForwardingService.update(forwarding.hostId, forwarding.id, {
      autoStart: !forwarding.autoStart,
    })
    await loadForwardings({ force: true })
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('tunnels.templateError'))
  }
}

async function openHostForwardingWebAccess(forwarding: PortForwardingWithHost) {
  try {
    const { data } = await webAccessService.createLink(forwarding.id)
    if (data.usedPortFallback) {
      msg.info(t('tunnels.webOpenReadyWithFallback', {
        assigned: data.assignedLocalPort,
        requested: data.requestedLocalPort,
      }))
    } else {
      msg.success(t('tunnels.webOpenReady', { port: data.assignedLocalPort }))
    }
    window.open(data.url, '_blank', 'noopener,noreferrer')
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('tunnels.webOpenError'))
  }
}

function confirmDeleteHostForwarding(forwarding: PortForwardingWithHost) {
  if (!canManageForwardings.value) return
  dialog.warning({
    title: t('forwardingsPage.editTitle'),
    content: t('forwardingsPage.deleteConfirm', { port: forwarding.localPort }),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        await portForwardingService.remove(forwarding.hostId, forwarding.id)
        await loadForwardings({ force: true })
        msg.success(t('tunnels.templateRemoved'))
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } }
        msg.error(e.response?.data?.message ?? t('tunnels.templateError'))
      }
    },
  })
}

function openEdit(host: HostPublic) {
  if (!canEditHost(host)) {
    msg.warning(t('hosts.inventoryAcl.editRequired'))
    return
  }
  editingHostId.value = host.id
  editingHostKeyHistory.value = []
  latestHostLink.value = null
  hostLinks.value = []
  associatedLinksOnePasswordRef.value = ''
  associatedLinksOnePasswordPreview.value = []
  associatedLinksOnePasswordPreviewError.value = null
  showOpImportInstructions.value = false
  resetHostFolderCreate()
  resetHostTagCreate()
  resetHostPemKeyCreate()
  form.value = {
    name: host.name, description: host.description ?? '', ip: host.ip, port: host.port, sshUser: host.sshUser,
    accessProtocol: host.accessProtocol ?? 'ssh',
    operatingSystem: host.operatingSystem ?? 'unknown',
    authType: host.authType, connectionMode: editableConnectionMode(host.connectionMode), scope: host.scope,
    privateAccessConnectorId: host.privateAccessConnectorId ?? null,
    groupId:  host.groupId  ?? undefined,
    folderId: host.folderId ?? undefined,
    inventoryParentId: host.inventoryParentId ?? defaultInventoryParentId(),
    bastionId: host.bastionId ?? undefined,
    pemKeyId: host.pemKeyId ?? undefined,
    onePasswordRef: host.onePasswordRef ?? undefined,
    startupSnippetId: host.startupSnippetId ?? null,
    startupSnippetMode: host.startupSnippetMode ?? 'disabled',
    tagNames:       host.tags.map((t) => t.name),
    associatedLinks: normalizeAssociatedLinks(host.associatedLinks ?? []),
    password: '',
  }
  hostFormExpandedSections.value = expandedSectionsForHostForm(host)
  ipFieldBlurred.value = false
  testResult.value = null
  if (!bastions.value.length || !pemKeys.value.length) void loadSidebarDeferred()
  if (opActive.value === false) void loadOnePasswordStatus()
  showHostModal.value = true
  void refreshEditingHost(host.id)
  void loadHostLinks(host.id)
  void loadHostKeyHistory(host.id)
}

async function previewAssociatedLinksFromOnePassword() {
  if (editingHostId.value === null || !associatedLinksOnePasswordRef.value.trim()) return
  associatedLinksOnePasswordPreviewLoading.value = true
  try {
    const { data } = await hostService.previewAssociatedLinksFromOnePassword(editingHostId.value, {
      ref: associatedLinksOnePasswordRef.value.trim(),
    })
    associatedLinksOnePasswordPreview.value = normalizeAssociatedLinks(data.links ?? [])
    associatedLinksOnePasswordPreviewError.value = null
    msg.success(t('hosts.associatedLinks.importPreviewSuccess', { count: data.links?.length ?? 0 }))
  } catch (err: unknown) {
    associatedLinksOnePasswordPreview.value = []
    const e = err as { response?: { data?: { message?: string } } }
    associatedLinksOnePasswordPreviewError.value = e.response?.data?.message ?? null
    msg.error(e.response?.data?.message ?? t('hosts.associatedLinks.importPreviewError'))
  } finally {
    associatedLinksOnePasswordPreviewLoading.value = false
  }
}

async function importAssociatedLinksFromOnePassword() {
  if (editingHostId.value === null || !associatedLinksOnePasswordRef.value.trim()) return
  associatedLinksOnePasswordLoading.value = true
  try {
    const { data } = await hostService.importAssociatedLinksFromOnePassword(editingHostId.value, {
      ref: associatedLinksOnePasswordRef.value.trim(),
    })
    replaceKnownHost(data)
    form.value.associatedLinks = normalizeAssociatedLinks(data.associatedLinks ?? [])
    associatedLinksOnePasswordRef.value = ''
    associatedLinksOnePasswordPreview.value = []
    associatedLinksOnePasswordPreviewError.value = null
    msg.success(t('hosts.associatedLinks.importSuccess'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('hosts.associatedLinks.importError'))
  } finally {
    associatedLinksOnePasswordLoading.value = false
  }
}

async function generateHostLink() {
  if (editingHostId.value === null) return
  hostLinkLoading.value = true
  try {
    const { data } = await hostLinkService.create({
      hostId: editingHostId.value,
      expiresInMinutes: hostLinkExpiryMinutes.value,
    })
    latestHostLink.value = data
    await loadHostLinks(editingHostId.value)
    await navigator.clipboard.writeText(data.url)
    msg.success(t('hostLinks.createdAndCopied'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('hostLinks.createError'))
  } finally {
    hostLinkLoading.value = false
  }
}

async function generateJitHostLink() {
  if (editingHostId.value === null) return
  if (!hostLinkJitEnabled.value) {
    msg.warning(t('hostLinks.jitDisabled'))
    return
  }
  hostLinkLoading.value = true
  try {
    const { data } = await hostLinkService.create({
      hostId: editingHostId.value,
      expiresInMinutes: hostLinkExpiryMinutes.value,
      type: 'public_once',
    })
    latestHostLink.value = data
    await loadHostLinks(editingHostId.value)
    await navigator.clipboard.writeText(data.url)
    msg.success(data.pin
      ? t('hostLinks.jitCreatedWithPin', { pin: data.pin })
      : t('hostLinks.jitCreatedAndCopied'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('hostLinks.createError'))
  } finally {
    hostLinkLoading.value = false
  }
}

async function loadHostLinks(hostId: number) {
  hostLinksLoading.value = true
  try {
    const { data } = await hostLinkService.list(hostId)
    hostLinks.value = data
  } catch {
    hostLinks.value = []
  } finally {
    hostLinksLoading.value = false
  }
}

async function revokeHostLink(link: HostLinkListItem) {
  revokingHostLinkId.value = link.id
  try {
    await hostLinkService.revoke(link.id)
    if (editingHostId.value !== null) await loadHostLinks(editingHostId.value)
    msg.success(t('hostLinks.revoked'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('hostLinks.revokeError'))
  } finally {
    revokingHostLinkId.value = null
  }
}

async function copyLatestHostLink() {
  if (!latestHostLink.value) return
  await navigator.clipboard.writeText(latestHostLink.value.url)
  msg.success(t('hostLinks.copied'))
}

async function refreshEditingHost(hostId: number) {
  try {
    const { data } = await hostService.get(hostId)
    replaceKnownHost(data)
  } catch {
    // Keep the existing cached card data if the refresh fails.
  }
}

async function loadHostKeyHistory(hostId: number) {
  hostKeyHistoryLoading.value = true
  try {
    const { data } = await hostService.listHostKeyHistory(hostId)
    editingHostKeyHistory.value = data
  } catch {
    editingHostKeyHistory.value = []
  } finally {
    hostKeyHistoryLoading.value = false
  }
}

async function maybeOpenHostFromRoute() {
  const raw = route.query.editHostId
  if (!raw) return

  const id = Number(Array.isArray(raw) ? raw[0] : raw)
  if (!Number.isFinite(id)) return

  const host = pageHosts.value.find((item) => item.id === id)
    ?? quickAccessHosts.value.find((item) => item.id === id)
  if (!host) return

  await nextTick()
  const element = document.querySelector(`[data-host-id="${id}"]`) as HTMLElement | null
  element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  openEdit(host)
  const query = { ...route.query }
  delete query.editHostId
  router.replace({ query })
}

// ─── Testar conexão ──────────────────────────────────────────────────────────

const testLoading = ref(false)
const testResult  = ref<TestConnectionResult | null>(null)

async function runTestConnection() {
  if (!canTestHostConnectivity(form.value.accessProtocol)) {
    testResult.value = {
      success: false,
      latencyMs: null,
      message: t('hosts.protocols.testPending', { protocol: accessProtocolLabel(form.value.accessProtocol) }),
    }
    return
  }
  testLoading.value = true
  testResult.value  = null
  try {
    const { data } = await hostService.testConnection({
      ...(editingHostId.value !== null && { hostId: editingHostId.value }),
      ip:        form.value.ip,
      port:      form.value.port,
      accessProtocol: form.value.accessProtocol,
      sshUser:   form.value.sshUser,
      authType:  form.value.authType,
      connectionMode: form.value.connectionMode,
      privateAccessConnectorId: form.value.connectionMode === 'private_access_connector'
        ? form.value.privateAccessConnectorId ?? undefined
        : undefined,
      password:  form.value.authType === 'password' || form.value.authType === 'pem_password' ? form.value.password : undefined,
      pemKeyId:  form.value.authType === 'pem' || form.value.authType === 'pem_password' ? form.value.pemKeyId : undefined,
      bastionId: form.value.bastionId,
      groupId:   form.value.groupId,
    })
    testResult.value = data
  } catch {
    testResult.value = { success: false, latencyMs: null, message: 'Erro ao comunicar com o servidor' }
  } finally {
    testLoading.value = false
  }
}

// Reset test result whenever form fields that affect connection change
function resetTestResult() { testResult.value = null }

function sanitizeHostPayloadRelations(payload: HostForm) {
  const validFolderIds = new Set(folders.value.map((folder) => folder.id))
  const validInventoryFolderIds = new Set(inventoryFolderNodes.value.map((node) => node.id))
  const validGroupIds = new Set(groupOptions.value.map((group) => Number(group.value)))
  const validBastionIds = new Set(bastions.value.map((bastion) => bastion.id))
  const validPemKeyIds = new Set(pemKeys.value.map((pemKey) => pemKey.id))
  const validPrivateAccessConnectorIds = new Set(privateAccessConnectorOptions.value.map((connector) => Number(connector.value)))

  if (payload.folderId !== undefined && payload.folderId !== null && !validFolderIds.has(payload.folderId)) {
    delete payload.folderId
  }
  if (payload.inventoryParentId !== undefined && payload.inventoryParentId !== null && !validInventoryFolderIds.has(payload.inventoryParentId)) {
    delete payload.inventoryParentId
  }
  if (payload.groupId !== undefined && payload.groupId !== null && !validGroupIds.has(payload.groupId)) {
    delete payload.groupId
  }
  if (payload.bastionId !== undefined && payload.bastionId !== null && !validBastionIds.has(payload.bastionId)) {
    delete payload.bastionId
  }
  if (payload.pemKeyId !== undefined && payload.pemKeyId !== null && !validPemKeyIds.has(payload.pemKeyId)) {
    delete payload.pemKeyId
  }
  if (payload.connectionMode !== 'private_access_connector') {
    payload.privateAccessConnectorId = null
  } else if (
    payload.privateAccessConnectorId !== undefined
    && payload.privateAccessConnectorId !== null
    && !validPrivateAccessConnectorIds.has(payload.privateAccessConnectorId)
  ) {
    delete payload.privateAccessConnectorId
  }
}

function testRouteLabel(result: TestConnectionResult) {
  if (result.routeLabel) return result.routeLabel
  if (result.route === 'user_agent') return t('hosts.test.routeUserAgent')
  if (result.route === 'tenant_agent') return t('hosts.test.routeTenantAgent')
  if (result.route === 'private_access_connector') return t('hosts.test.routePrivateAccess')
  if (result.route === 'direct') return t('hosts.test.routeDirect')
  return null
}

function testFailureStepLabel(step: TestConnectionResult['failureStep']) {
  if (!step) return null
  return t(`hosts.test.failureStep.${step}`)
}

async function submitHost() {
  hostModalLoading.value = true
  try {
    normalizeHostNameField()
    const payload: HostForm = { ...form.value }
    payload.description = payload.description?.trim() || null
    sanitizeHostPayloadRelations(payload)
    if (payload.inventoryParentId === undefined || payload.inventoryParentId === null) {
      throw new Error(t('hosts.form.inventoryFolderRequired'))
    }
    if (usesSshCredentials(payload.accessProtocol)) {
      payload.sshUser = payload.sshUser.trim()
      if (!payload.sshUser) throw new Error(t('hosts.form.sshUserRequired'))
    }
    payload.associatedLinks = normalizeAssociatedLinks(form.value.associatedLinks)
    const invalidLink = payload.associatedLinks.find((link) =>
      !link.label
      || !link.urlTemplate
      || !linkValidation(link).valid,
    )
    if (invalidLink) {
      throw new Error(t('hosts.associatedLinks.validationError'))
    }
    if (!usesPasswordCredential(payload.accessProtocol)) {
      payload.sshUser = ''
      payload.authType = 'password'
      delete payload.password
      delete payload.pemKeyId
      delete payload.onePasswordRef
      delete payload.bastionId
    } else if (!usesSshCredentials(payload.accessProtocol)) {
      payload.sshUser = ''
      payload.authType = 'password'
      delete payload.pemKeyId
      delete payload.onePasswordRef
      delete payload.bastionId
    }
    if (payload.authType === 'pem') delete payload.password
    if (!canOpenInWebTerminal(payload.accessProtocol)) {
      payload.startupSnippetMode = 'disabled'
      payload.startupSnippetId = null
    } else if ((payload.startupSnippetMode ?? 'disabled') === 'disabled') {
      payload.startupSnippetId = null
    } else if (!payload.startupSnippetId) {
      throw new Error(t('hosts.form.startupSnippetRequired'))
    }
    if (editingHostId.value !== null) {
      const previous = hostById.value.get(editingHostId.value) ?? null
      const { data } = await hostService.update(editingHostId.value, payload)
      applyUpdatedHost(data, previous)
      msg.success(t('hosts.messages.hostUpdated'))
    } else {
      if (payload.bastionId === null) delete payload.bastionId
      await hostService.create({ ...payload, inventoryParentId: payload.inventoryParentId })
      msg.success(t('hosts.messages.hostCreated'))
      refreshHostData()
    }
    showHostModal.value = false
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? (err instanceof Error ? err.message : t('hosts.messages.saveError')))
  } finally {
    hostModalLoading.value = false
  }
}

const editingHost = computed(() =>
  editingHostId.value !== null
    ? knownHosts.value.find((host) => host.id === editingHostId.value) ?? null
    : null,
)

const hasSavedPasswordCredentialForCurrentAuth = computed(() =>
  Boolean(
    editingHost.value?.hasPasswordCredential
    && editingHost.value.authType === form.value.authType
    && (form.value.authType === 'password' || form.value.authType === 'pem_password'),
  ),
)

const isSshHostForm = computed(() => usesSshCredentials(form.value.accessProtocol))
const isPasswordCredentialHostForm = computed(() => usesPasswordCredential(form.value.accessProtocol))
const hostPasswordFieldLabel = computed(() =>
  isSshHostForm.value ? t('hosts.form.sshPassword') : t('hosts.form.password'),
)

function usesPasswordCredential(protocol: HostPublic['accessProtocol']) {
  return usesSshCredentials(protocol) || protocol === 'rdp' || protocol === 'vnc'
}

const canRunHostTest = computed(() => {
  if (!form.value.ip) return false
  if (!isSshHostForm.value) return true
  if (!form.value.sshUser) return false
  if (form.value.authType === 'password') {
    return Boolean(form.value.password || form.value.onePasswordRef || hasSavedPasswordCredentialForCurrentAuth.value)
  }
  if (form.value.authType === 'pem') return Boolean(form.value.pemKeyId)
  if (form.value.authType === 'pem_password') {
    return Boolean(form.value.pemKeyId && (form.value.password || form.value.onePasswordRef || hasSavedPasswordCredentialForCurrentAuth.value))
  }
  return true
})

function bastionSourceLabel(host: HostPublic) {
  if (host.effectiveBastionSource === 'host') return t('hosts.bastion.direct')
  if (host.effectiveBastionSource === 'group') return t('hosts.bastion.inherited')
  return t('hosts.bastion.none')
}

function bastionTooltip(host: HostPublic) {
  if (!host.effectiveBastionName) return t('hosts.bastion.noneTooltip')
  return t(
    host.effectiveBastionSource === 'group' ? 'hosts.bastion.inheritedTooltip' : 'hosts.bastion.directTooltip',
    { name: host.effectiveBastionName },
  )
}

const editingHostKeyStatus = computed(() => {
  const host = editingHost.value
  if (!host?.trustedHostKeyFingerprint) return 'missing'
  return 'trusted'
})

const authTypeHint = computed(() => {
  if (form.value.authType === 'password')     return t('hosts.form.authPasswordHint')
  if (form.value.authType === 'pem')          return t('hosts.form.authPemHint')
  if (form.value.authType === 'pem_password') return t('hosts.form.authPemPasswordHint')
  return ''
})

function formatHostKeyTimestamp(value?: Date | string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function hostKeyHistoryType(action: HostKeyTrustEvent['action']) {
  return action === 'HOST_KEY_UPDATED' ? 'warning' : 'info'
}

function hostKeyHistoryLabel(action: HostKeyTrustEvent['action']) {
  return action === 'HOST_KEY_UPDATED'
    ? t('hosts.hostKey.historyUpdated')
    : t('hosts.hostKey.historyTrusted')
}

function hostKeyHistoryValue(value?: string | null) {
  return value ?? '—'
}

function formatDeleteBlockers(blockers: { sessions: number; sessionAudits: number; mcpInteractiveSessions: number }) {
  const parts: string[] = []
  if (blockers.sessions > 0) parts.push(`${blockers.sessions} ${t('hosts.deleteHost.blockers.sessions')}`)
  if (blockers.sessionAudits > 0) parts.push(`${blockers.sessionAudits} ${t('hosts.deleteHost.blockers.sessionAudits')}`)
  if (blockers.mcpInteractiveSessions > 0) parts.push(`${blockers.mcpInteractiveSessions} ${t('hosts.deleteHost.blockers.mcpInteractiveSessions')}`)
  return parts.join(', ')
}

async function confirmDeleteHost(host: HostPublic) {
  let deleteCheck: { canDelete: boolean; blockers: { sessions: number; sessionAudits: number; mcpInteractiveSessions: number } } | null = null
  try {
    const { data } = await hostService.getDeleteCheck(host.id)
    deleteCheck = data
  } catch {
    // Se a prechecagem falhar, mantemos o fluxo atual e deixamos o delete responder.
  }

  const blockerSummary = deleteCheck && !deleteCheck.canDelete
    ? formatDeleteBlockers(deleteCheck.blockers)
    : ''

  dialog.warning({
    title:        t('hosts.deleteHost.title'),
    content:      () => h('div', { class: 'space-y-2' }, [
      h('div', t('hosts.deleteHost.content', { name: host.name })),
      blockerSummary
        ? h('div', { class: 'text-sm text-amber-400 leading-relaxed' }, t('hosts.deleteHost.blockedHint', { details: blockerSummary }))
        : null,
    ]),
    positiveText: t('hosts.deleteHost.confirm'),
    negativeText: t('hosts.deleteHost.cancel'),
    onPositiveClick: async () => {
      try {
        await hostService.delete(host.id)
        msg.success(t('hosts.messages.hostDeleted'))
        refreshHostData()
      } catch (e: any) {
        msg.error(e.response?.data?.message ?? t('hosts.messages.deleteError'))
      }
    },
  })
}

// ─── Mover host para pasta ────────────────────────────────────────────────────

async function moveToFolder(host: HostPublic, folderId: number | null) {
  try {
    const { data } = await hostService.update(host.id, { folderId })
    applyUpdatedHost(data, host)
    void loadSidebarBootstrap()
  } catch {
    msg.error(t('hosts.messages.moveError'))
  }
}

async function moveToInventoryFolder(host: HostPublic, inventoryParentId: number) {
  try {
    await inventoryService.moveHost(host.id, inventoryParentId)
    applyUpdatedHost({ ...host, inventoryParentId }, host)
    await loadSidebarBootstrap()
    msg.success(t('hosts.inventoryFolders.moveHostSuccess', { folder: inventoryFolderPathLabel(inventoryParentId) }))
  } catch (e: any) {
    msg.error(e.response?.data?.message ?? t('hosts.inventoryFolders.moveHostError'))
  }
}

async function moveInventoryFolder(folderId: number, inventoryParentId: number) {
  try {
    const { data } = await inventoryService.moveFolder(folderId, inventoryParentId)
    await loadSidebarBootstrap()
    msg.success(t('hosts.inventoryFolders.moveFolderSuccess', {
      folder: data.name,
      target: inventoryFolderPathLabel(inventoryParentId),
    }))
  } catch (e: any) {
    msg.error(e.response?.data?.message ?? t('hosts.inventoryFolders.moveFolderError'))
  }
}

function confirmRemoveHostInventoryAcl(host: HostPublic) {
  dialog.warning({
    title: t('hosts.inventoryFolders.removeHostAclTitle'),
    content: t('hosts.inventoryFolders.removeHostAclConfirm', { name: host.name }),
    positiveText: t('hosts.inventoryFolders.removeHostAclConfirmAction'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        const { data } = await hostService.update(host.id, { inventoryParentId: null })
        applyUpdatedHost(data, host)
        void loadSidebarBootstrap()
        msg.success(t('hosts.inventoryFolders.removeHostAclSuccess'))
      } catch (e: any) {
        msg.error(e.response?.data?.message ?? t('hosts.inventoryFolders.removeHostAclError'))
      }
    },
  })
}

const folderMoveOptions = computed(() => [
  { label: '— ' + t('hosts.form.noFolder') + ' —', value: 0 },
  ...folderSelectOptions.value,
])

function openFolderMoveDialog(host: HostPublic) {
  folderMoveHost.value       = host
  folderMoveSelectedId.value = host.folderId ?? null
}

async function confirmFolderMove() {
  if (!folderMoveHost.value) return
  await moveToFolder(folderMoveHost.value, folderMoveSelectedId.value)
  folderMoveHost.value = null
}

function hostCardActionOptions(host: HostPublic): DropdownOption[] {
  const options: DropdownOption[] = [
    {
      label: host.folderId ? (folders.value.find((f) => f.id === host.folderId)?.name ?? t('hosts.moveTo')) : t('hosts.moveTo'),
      key: 'move',
      disabled: !canEditHost(host),
    },
    { label: t('common.edit'), key: 'edit', disabled: !canEditHost(host) },
  ]
  if (canEditHost(host) || canAdminHost(host)) {
    options.push({
      label: canAdminHost(host) ? t('hosts.inventoryAcl.menu') : t('hosts.inventoryAcl.adminRequiredShort'),
      key: 'permissions',
      disabled: !canAdminHost(host),
    })
  }
  if (canEditHost(host)) {
    options.push({ type: 'divider', key: 'host-acl-divider' })
    options.push({
      label: t('hosts.inventoryFolders.removeHostAclAction'),
      key: 'remove-inventory-acl',
      disabled: host.inventoryParentId === null || host.inventoryParentId === undefined,
    })
    options.push({ label: t('hosts.deleteHost.menuAction'), key: 'delete' })
  }
  return options
}

function hasHostCardActions(host: HostPublic): boolean {
  return canEditHost(host) || canAdminHost(host)
}

const activeHostActionMenuId = ref<number | null>(null)
let hostActionMenuOutsideClickHandler: ((event: MouseEvent) => void) | null = null

function isHostActionMenuOpen(host: HostPublic): boolean {
  return activeHostActionMenuId.value === host.id
}

function toggleHostActionMenu(host: HostPublic) {
  if (isHostActionMenuOpen(host)) {
    closeHostActionMenu()
    return
  }
  activeHostActionMenuId.value = host.id
  attachHostActionMenuOutsideClick()
}

function attachHostActionMenuOutsideClick() {
  detachHostActionMenuOutsideClick()
  void nextTick(() => {
    if (activeHostActionMenuId.value === null || hostActionMenuOutsideClickHandler) return
    hostActionMenuOutsideClickHandler = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('[data-host-actions-button], .n-dropdown-menu')) return
      closeHostActionMenu()
    }
    document.addEventListener('click', hostActionMenuOutsideClickHandler, true)
  })
}

function detachHostActionMenuOutsideClick() {
  if (!hostActionMenuOutsideClickHandler) return
  document.removeEventListener('click', hostActionMenuOutsideClickHandler, true)
  hostActionMenuOutsideClickHandler = null
}

function closeHostActionMenu() {
  activeHostActionMenuId.value = null
  detachHostActionMenuOutsideClick()
}

function handleHostCardAction(key: string | number, host: HostPublic) {
  closeHostActionMenu()
  if (key === 'move') openFolderMoveDialog(host)
  if (key === 'edit') openEdit(host)
  if (key === 'delete') confirmDeleteHost(host)
  if (key === 'remove-inventory-acl') confirmRemoveHostInventoryAcl(host)
  if (key === 'permissions') openHostPermissions(host)
}

// ─── Conexão ─────────────────────────────────────────────────────────────────

async function connect(host: HostPublic) {
  if (!canConnectHost(host)) {
    msg.warning(connectBlockedMessage(host))
    return
  }
  const opensInTextTerminal = canOpenInWebTerminal(host.accessProtocol)
  const opensInGraphicalGateway = getHostAccessProtocolCapabilities(host.accessProtocol).graphicalGatewayPlanned

  if (!opensInTextTerminal && !opensInGraphicalGateway) {
    msg.info(t('hosts.protocols.connectionPending', { protocol: accessProtocolLabel(host.accessProtocol) }))
    return
  }

  if (opensInTextTerminal) {
    const routeStatus = agentRouteStatusForHost(host)
    if (routeStatus?.blocksConnection) msg.warning(routeStatus.tooltip)
  }

  if (opensInGraphicalGateway && termSettings.graphicalOpenMode === 'dedicated') {
    markHostAsRecent(host.id)
    router.push({ name: 'graphical-session', params: { hostId: host.id } })
    return
  }

  try {
    const features = await featuresService.get()
    multiConnect.value = features.multiConnect
  } catch {
    multiConnect.value = false
  }
  if (!multiConnect.value && termStore.tabs.length > 0) {
    msg.warning(t('terminal.noMultiConnect'))
    router.push({ name: 'terminal' })
    return
  }
  markHostAsRecent(host.id)
  termStore.add({
    id: host.id,
    name: host.name,
    ip: host.ip,
    port: host.port,
    authType: host.authType,
    accessProtocol: host.accessProtocol,
    startupSnippetId: host.startupSnippetId ?? null,
    startupSnippetMode: host.startupSnippetMode ?? 'disabled',
  })
  resetTerminalLayout()
  router.push({ name: 'terminal' })
}

function authTypeLabel(authType: HostPublic['authType']) {
  if (authType === 'pem') return t('hosts.authPem')
  if (authType === 'pem_password') return t('hosts.authPemPassword')
  return t('hosts.authPassword')
}

function accessProtocolLabel(protocol: HostPublic['accessProtocol'] | undefined) {
  const normalized = protocol ?? 'ssh'
  return translateOr(`hosts.protocols.${normalized}`, accessProtocolFallbackLabels[normalized] ?? 'SSH')
}

function accessProtocolTagType(protocol: HostPublic['accessProtocol']): 'default' | 'info' | 'warning' | 'success' {
  if (protocol === 'ssh') return 'success'
  if (protocol === 'telnet') return 'warning'
  if (protocol === 'rdp' || protocol === 'vnc') return 'info'
  return 'default'
}

function hostLiteTagClass(type: 'default' | 'info' | 'warning' | 'success' | 'error' | undefined) {
  return `host-lite-tag host-lite-tag--${type ?? 'default'}`
}

function operatingSystemLabel(operatingSystem: HostOperatingSystem | undefined) {
  const normalized = operatingSystem ?? 'unknown'
  const fallbacks: Record<HostOperatingSystem, string> = {
    unknown: 'Desconhecido',
    linux: 'Linux',
    ubuntu: 'Ubuntu',
    debian: 'Debian',
    centos: 'CentOS',
    rhel: 'Red Hat Enterprise Linux',
    rocky: 'Rocky Linux',
    almalinux: 'AlmaLinux',
    suse: 'SUSE',
    windows: 'Windows',
    windows_server: 'Windows Server',
    macos: 'macOS',
    freebsd: 'FreeBSD',
    other: 'Outro',
  }
  return translateOr(`hosts.operatingSystems.${normalized}`, fallbacks[normalized])
}

function shouldShowOperatingSystemIcon(host: HostPublic) {
  return (host.operatingSystem ?? 'unknown') !== 'unknown'
}

function authTypeIcon(authType: HostPublic['authType']) {
  if (authType === 'pem') return '🔑'
  if (authType === 'pem_password') return '🔑🔒'
  return '🔒'
}

function connectionModeLabel(connectionMode: HostPublic['connectionMode']) {
  if (connectionMode === 'agent_user') return t('hosts.form.connectionAgentUser')
  if (connectionMode === 'agent_tenant_fallback') return t('hosts.form.connectionAgentTenantFallback')
  if (connectionMode === 'private_access_connector') return t('hosts.form.connectionPrivateAccess')
  if (connectionMode === 'auto') return t('hosts.form.connectionAuto')
  if (connectionMode === 'agent') return t('hosts.form.connectionAgent')
  return t('hosts.form.connectionDirect')
}

function connectionModeShortLabel(connectionMode: HostPublic['connectionMode']) {
  if (connectionMode === 'agent_user') return t('hosts.form.connectionShortUser')
  if (connectionMode === 'agent_tenant_fallback' || connectionMode === 'agent') return t('hosts.form.connectionShortAgent')
  if (connectionMode === 'private_access_connector') return t('hosts.form.connectionShortPrivateAccess')
  if (connectionMode === 'auto') return t('hosts.form.connectionShortAuto')
  return t('hosts.form.connectionShortDirect')
}

function connectionModeTagType(connectionMode: HostPublic['connectionMode']): 'default' | 'info' | 'success' {
  if (connectionMode === 'direct') return 'default'
  if (connectionMode === 'auto') return 'info'
  return 'success'
}

function connectionModeTooltip(connectionMode: HostPublic['connectionMode']) {
  const mode = editableConnectionMode(connectionMode)
  const hint = mode === 'agent_user'
    ? t('hosts.form.connectionAgentUserHint')
    : mode === 'agent_tenant_fallback'
      ? t('hosts.form.connectionAgentTenantFallbackHint')
      : mode === 'private_access_connector'
        ? t('hosts.form.connectionPrivateAccessHint')
      : mode === 'auto'
        ? t('hosts.form.connectionAutoHint')
        : t('hosts.form.connectionDirectHint')
  return `${connectionModeLabel(connectionMode)}. ${hint}`
}

function editableConnectionMode(connectionMode: HostPublic['connectionMode']) {
  return connectionMode === 'agent' ? 'agent_tenant_fallback' : connectionMode
}

type HostAgentRouteStatus = {
  type: 'success' | 'warning' | 'info'
  label: string
  tooltip: string
  blocksConnection: boolean
} | null

const formAgentRouteStatus = computed(() => agentRouteStatusForConnectionMode(form.value.connectionMode))

function agentRouteStatusForHost(host: HostPublic): HostAgentRouteStatus {
  return agentRouteStatusByHostId.value.get(host.id) ?? null
}

function agentRouteStatusForConnectionMode(mode: HostPublic['connectionMode']): HostAgentRouteStatus {
  if (mode === 'direct') return null
  const st = agentStatus.value
  const userAgent = st?.userAgent ?? null
  const tenantAgent = st?.tenantAgent ?? null
  const privateAccessConnector = st?.privateAccessConnector ?? null

  if (mode === 'agent_user') {
    if (userAgent) {
      return {
        type: 'success',
        label: t('hosts.agent.userOnline'),
        tooltip: t('hosts.agent.online', { name: userAgent.name }),
        blocksConnection: false,
      }
    }
    return {
      type: 'warning',
      label: t('hosts.agent.userRequiredOffline'),
      tooltip: t('hosts.agent.userRequired'),
      blocksConnection: true,
    }
  }

  if (mode === 'private_access_connector') {
    const selectedConnectorId = form.value.connectionMode === 'private_access_connector'
      ? form.value.privateAccessConnectorId
      : null
    const selectedConnector = selectedConnectorId
      ? agents.value.find((agent) => agent.id === selectedConnectorId)
      : null
    if (selectedConnectorId && selectedConnector && !selectedConnector.online) {
      return {
        type: 'warning',
        label: t('hosts.agent.privateAccessRequiredOffline'),
        tooltip: t('hosts.agent.privateAccessSelectedOffline', { name: selectedConnector.name }),
        blocksConnection: true,
      }
    }
    if (privateAccessConnector) {
      return {
        type: 'success',
        label: t('hosts.agent.privateAccessOnline'),
        tooltip: t('hosts.agent.online', { name: privateAccessConnector.name }),
        blocksConnection: false,
      }
    }
    return {
      type: 'warning',
      label: t('hosts.agent.privateAccessRequiredOffline'),
      tooltip: t('hosts.agent.privateAccessRequired'),
      blocksConnection: true,
    }
  }

  if (mode === 'auto') {
    const availableAgent = userAgent ?? tenantAgent
    if (availableAgent) {
      return {
        type: 'success',
        label: userAgent ? t('hosts.agent.userOnline') : t('hosts.agent.tenantOnline'),
        tooltip: t('hosts.agent.online', { name: availableAgent.name }),
        blocksConnection: false,
      }
    }
    return {
      type: 'info',
      label: t('hosts.agent.directFallback'),
      tooltip: t('hosts.agent.autoDirectFallback'),
      blocksConnection: false,
    }
  }

  const requiredAgent = userAgent ?? tenantAgent
  if (requiredAgent) {
    return {
      type: 'success',
      label: userAgent ? t('hosts.agent.userOnline') : t('hosts.agent.tenantOnline'),
      tooltip: t('hosts.agent.online', { name: requiredAgent.name }),
      blocksConnection: false,
    }
  }

  return {
    type: 'warning',
    label: t('hosts.agent.requiredOffline'),
    tooltip: t('hosts.agent.required'),
    blocksConnection: true,
  }
}

function renderConnectionModeLabel(option: SelectOption) {
  const label = String(option.label ?? '')
  const description = typeof option.description === 'string' ? option.description : ''

  return h(
    NTooltip,
    { trigger: 'hover', placement: 'right' },
    {
      trigger: () => h('div', { class: 'leading-tight py-1 text-sm' }, label),
      default: () => description,
    },
  )
}

function associatedLinkSourceTypeLabel(link: HostAssociatedLink) {
  if (link.sourceType === 'integration') return t('hosts.associatedLinks.sourceIntegration')
  if (link.sourceType === 'derived') return t('hosts.associatedLinks.sourceDerived')
  return t('hosts.associatedLinks.sourceManual')
}

function associatedLinkSourceStatusLabel(link: HostAssociatedLink) {
  if (link.sourceStatus === 'synced') return t('hosts.associatedLinks.statusSynced')
  if (link.sourceStatus === 'stale') return t('hosts.associatedLinks.statusStale')
  if (link.sourceStatus === 'error') return t('hosts.associatedLinks.statusError')
  return t('hosts.associatedLinks.statusManual')
}

function associatedLinkProviderLabel(link: HostAssociatedLink) {
  if (link.sourceProvider === 'onepassword') return '1Password'
  return link.sourceProvider ?? null
}

function openAssociatedLink(host: HostPublic, link: HostAssociatedLink) {
  const url = resolveHostLinkTemplate(link.urlTemplate, {
    id: host.id,
    name: host.name,
    ip: host.ip,
    port: host.port,
    sshUser: host.sshUser,
  })
  const target = link.openMode === 'same_tab' ? '_self' : '_blank'
  window.open(url, target, target === '_blank' ? 'noopener,noreferrer' : undefined)
}

// ─── Menu de contexto (botão direito na área de hosts) ───────────────────────

const ctxVisible = ref(false)
const ctxX       = ref(0)
const ctxY       = ref(0)
const ctxHost    = ref<HostPublic | null>(null)

const ctxOptions = computed<DropdownOption[]>(() => {
  if (ctxHost.value) {
    const host = ctxHost.value
    const isFav = favoriteHostIdSet.value.has(host.id)
    const opts: DropdownOption[] = [
      { key: 'host-connect', label: t('hosts.connect'), disabled: !canConnectHost(host) },
      { type: 'divider',       key: 'dh0' },
    ]
    if (canManage.value || canEditHost(host) || canAdminHost(host)) {
      opts.push({ key: 'host-edit', label: t('common.edit'), disabled: !canEditHost(host) })
      opts.push({
        key: 'host-permissions',
        label: canAdminHost(host) ? t('hosts.inventoryAcl.menu') : t('hosts.inventoryAcl.adminRequiredShort'),
        disabled: !canAdminHost(host),
      })
    }
    opts.push({ key: 'host-favorite',  label: isFav ? t('hosts.removeFavorite') : t('hosts.addFavorite') })
    opts.push({ key: 'host-dashboard', label: 'Dashboard' })
    if (canManage.value || canEditHost(host)) {
      opts.push({ type: 'divider', key: 'dh1' })
      opts.push({
        key: 'host-remove-inventory-acl',
        label: t('hosts.inventoryFolders.removeHostAclAction'),
        disabled: !canEditHost(host) || host.inventoryParentId === null || host.inventoryParentId === undefined,
      })
      opts.push({ key: 'host-delete', label: t('hosts.deleteHost.menuAction'), disabled: !canEditHost(host) })
    }
    return opts
  }

  const opts: DropdownOption[] = []
  if (canManage.value) {
    opts.push({ key: 'new-host',   label: t('hosts.contextMenu.newHost')   })
    opts.push({ key: 'new-folder', label: t('hosts.contextMenu.newFolder') })
    opts.push({ type: 'divider',   key: 'd1'                               })
  }
  opts.push({ key: 'refresh', label: t('hosts.contextMenu.refresh') })
  return opts
})

function onHostContextMenu(e: MouseEvent, host: HostPublic) {
  e.preventDefault()
  closeInventoryFolderContext()
  ctxHost.value    = host
  ctxVisible.value = false
  setTimeout(() => {
    ctxX.value       = e.clientX
    ctxY.value       = e.clientY
    ctxVisible.value = true
  }, 0)
}

function onHostAreaContextMenu(e: MouseEvent) {
  e.preventDefault()
  closeInventoryFolderContext()
  ctxHost.value    = null
  ctxVisible.value = false
  setTimeout(() => {
    ctxX.value       = e.clientX
    ctxY.value       = e.clientY
    ctxVisible.value = true
  }, 0)
}

function onCtxSelect(key: string) {
  const host = ctxHost.value
  ctxVisible.value = false
  ctxHost.value    = null

  if (host) {
    if (key === 'host-connect')   connect(host)
    if (key === 'host-edit')      openEdit(host)
    if (key === 'host-permissions') openHostPermissions(host)
    if (key === 'host-favorite')  toggleFavoriteHost(host.id)
    if (key === 'host-dashboard') openHostDashboard(host.id)
    if (key === 'host-remove-inventory-acl') confirmRemoveHostInventoryAcl(host)
    if (key === 'host-delete')    confirmDeleteHost(host)
    return
  }

  if (key === 'new-host')   openCreate()
  if (key === 'new-folder') openCreateFolder()
  if (key === 'refresh')    load()
}

const showImport = ref(false)

</script>

<template>
  <div class="flex h-screen overflow-hidden">

    <!-- ── Painel esquerdo: árvore de pastas ── -->
    <div
      class="hosts-sidebar-panel shrink-0 bg-[#18181c] border-r border-gray-800 flex flex-col"
      :class="{ 'hosts-sidebar-panel--resizing': isSidebarResizing }"
      :style="sidebarStyle"
    >
      <div class="flex items-center justify-between px-3 py-3 border-b border-gray-800">
        <NText class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Sessões</NText>
        <NTooltip trigger="hover" placement="right">
          <template #trigger>
            <NButton
              size="small"
              type="primary"
              ghost
              style="padding: 0 8px; height: 24px; display: flex; align-items: center; gap: 4px;"
              @click="openCreateFolder"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
              <span style="font-size: 11px; line-height: 1;">{{ $t('hosts.personalFolders.new') }}</span>
            </NButton>
          </template>
          {{ $t('hosts.personalFolders.help') }}
        </NTooltip>
      </div>

      <div class="px-2 pt-2 pb-1 border-b border-gray-800">
        <NInput
          v-model:value="sidebarSearch"
          size="small"
          clearable
          :placeholder="$t('hosts.sidebarSearch')"
        />
      </div>

      <NScrollbar class="flex-1">
        <div class="py-1 px-1 select-none">

          <!-- Todos os hosts -->
          <button
            class="sidebar-item w-full"
            :class="selectedKey === 'all' ? 'sidebar-item--active' : ''"
            @click="selectedKey = 'all'"
          >
            <span>🖥</span>
            <span class="flex-1 text-left">{{ $t('hosts.allHosts') }}</span>
            <span v-if="counts.all" class="sidebar-badge">{{ counts.all }}</span>
          </button>

          <button
            class="sidebar-item w-full pl-6"
            :class="selectedKey === 'favorites' ? 'sidebar-item--active' : ''"
            @click="selectedKey = 'favorites'"
          >
            <span>★</span>
            <span class="flex-1 text-left">{{ $t('hosts.favorites') }}</span>
            <span v-if="counts.favorites" class="sidebar-badge">{{ counts.favorites }}</span>
          </button>

          <button
            class="sidebar-item w-full pl-6"
            :class="selectedKey === 'recent' ? 'sidebar-item--active' : ''"
            @click="selectedKey = 'recent'"
          >
            <span>🕘</span>
            <span class="flex-1 text-left">{{ $t('hosts.recent') }}</span>
            <span v-if="counts.recent" class="sidebar-badge">{{ counts.recent }}</span>
          </button>

          <!-- Pastas corporativas — ACL -->
          <div class="mt-2 border-t border-gray-800 pt-1">
            <div class="sidebar-panel-row" @contextmenu="openCorporateFoldersContext">
	              <button
	                type="button"
	                class="sidebar-panel-toggle"
	                :class="dropTargetKey === 'inventory-root' ? 'sidebar-item--drop' : ''"
	                :aria-expanded="corporateFoldersPanelExpanded"
	                @click="toggleCorporateFoldersPanelExpanded"
	                @dragover="onInventoryRootDragOver"
	                @dragleave="onDropZoneDragLeave($event, 'inventory-root')"
	                @drop="onInventoryRootDrop"
	              >
                <span class="sidebar-panel-chevron">{{ corporateFoldersPanelExpanded ? '▾' : '▸' }}</span>
                <span class="sidebar-panel-title">{{ $t('hosts.corporateFolders.title') }}</span>
                <span v-if="corporateInventoryHostTotal > 0" class="sidebar-badge">{{ corporateInventoryHostTotal }}</span>
              </button>
              <NTooltip v-if="canManage" trigger="hover" placement="right">
                <template #trigger>
                  <button
                    type="button"
                    class="sidebar-action"
                    :aria-label="$t('hosts.inventoryFolders.createRootAction')"
                    @click.stop="openCreateRootInventoryFolder"
                  >
                    +
                  </button>
                </template>
                {{ $t('hosts.inventoryFolders.createRootAction') }}
              </NTooltip>
            </div>
            <template v-if="corporateFoldersPanelExpanded">
              <div v-if="inventoryTreeData.length" class="px-1 pb-1">
                <NTree
                  :selected-keys="selectedInventoryTreeKeys"
                  :expanded-keys="expandedInventoryTreeKeys"
                  :data="inventoryTreeData"
                  block-line
                  selectable
                  :render-label="renderInventoryTreeLabel"
                  :render-switcher-icon="renderInventoryTreeSwitcherIcon"
                  @update:expanded-keys="onInventoryTreeExpanded"
                  @update:selected-keys="onInventoryTreeSelected"
                  class="inventory-sidebar-tree"
                />
              </div>
              <div v-else class="px-3 py-2 text-xs text-gray-500">
                {{ $t('hosts.corporateFolders.empty') }}
              </div>
            </template>
          </div>

          <!-- Minhas pastas — organização pessoal -->
          <button
            type="button"
            class="sidebar-panel-toggle"
            :aria-expanded="foldersPanelExpanded"
            @click="toggleFoldersPanelExpanded"
          >
            <span class="sidebar-panel-chevron">{{ foldersPanelExpanded ? '▾' : '▸' }}</span>
            <span class="sidebar-panel-title">{{ $t('hosts.personalFolders.title') }}</span>
            <span class="sidebar-badge">{{ filteredFolders.length + 1 }}</span>
          </button>

          <template v-if="foldersPanelExpanded">
          <button
            class="sidebar-item w-full pl-8"
            :class="[
              selectedKey === 'unfiled' ? 'sidebar-item--active' : '',
              dropTargetKey === 'unfiled' ? 'sidebar-item--drop' : '',
            ]"
            @click="selectedKey = 'unfiled'"
            @dragover="onDropZoneDragOver($event, 'unfiled')"
            @dragleave="onDropZoneDragLeave($event, 'unfiled')"
            @drop="onDropZoneDrop($event, null)"
          >
            <span>📋</span>
            <span class="truncate flex-1 text-left">{{ $t('hosts.unfiled') }}</span>
            <span v-if="dropTargetKey === 'unfiled'" class="text-blue-400 text-xs shrink-0">{{ $t('hosts.dropHere') }}</span>
            <span v-else-if="counts.unfiled" class="sidebar-badge">{{ counts.unfiled }}</span>
          </button>

          <div
            v-for="folder in filteredFolders"
            :key="`folder-${folder.id}`"
            class="flex items-center group"
          >
            <button
              class="sidebar-item flex-1 pl-8 min-w-0"
              :class="[
                selectedKey === `folder-${folder.id}` ? 'sidebar-item--active' : '',
                dropTargetKey === `folder-${folder.id}` ? 'sidebar-item--drop' : '',
              ]"
              @click="selectedKey = `folder-${folder.id}`"
              @dragover="onDropZoneDragOver($event, `folder-${folder.id}`)"
              @dragleave="onDropZoneDragLeave($event, `folder-${folder.id}`)"
              @drop="onDropZoneDrop($event, folder.id)"
            >
              <span>📁</span>
              <span class="truncate flex-1 text-left">{{ folder.name }}</span>
              <span v-if="dropTargetKey === `folder-${folder.id}`" class="text-blue-400 text-xs shrink-0">{{ $t('hosts.dropHere') }}</span>
              <span v-else-if="counts[`folder-${folder.id}`]" class="sidebar-badge">{{ counts[`folder-${folder.id}`] }}</span>
            </button>
            <!-- Ações inline da pasta -->
            <div v-if="canManage" class="flex shrink-0 opacity-0 group-hover:opacity-100 transition-opacity pr-1 gap-0.5">
              <NTooltip trigger="hover" placement="right">
                <template #trigger>
                  <button class="sidebar-action" @click.stop="openRenameFolder(folder)">✏</button>
                </template>
                {{ $t('hosts.rename') }}
              </NTooltip>
              <NTooltip trigger="hover" placement="right">
                <template #trigger>
                  <button class="sidebar-action text-red-400" @click.stop="confirmDeleteFolder(folder)">✕</button>
                </template>
                {{ $t('common.delete') }}
              </NTooltip>
            </div>
          </div>
          </template>

          <!-- Filtros legados — compatibilidade com modelo antigo, não ACL -->
          <button
            v-if="hasLegacyFilters"
            type="button"
            class="sidebar-panel-toggle"
            :aria-expanded="groupsPanelExpanded"
            @click="toggleGroupsPanelExpanded"
          >
            <span class="sidebar-panel-chevron">{{ groupsPanelExpanded ? '▾' : '▸' }}</span>
            <span class="sidebar-panel-title">{{ $t('hosts.legacyFilters.title') }}</span>
            <NTooltip trigger="hover" placement="right">
              <template #trigger>
                <span class="sidebar-help-dot" @click.stop>?</span>
              </template>
              {{ $t('hosts.legacyFilters.help') }}
            </NTooltip>
            <span class="sidebar-badge">{{ filteredGroupOptions.length + (counts.global ? 1 : 0) }}</span>
          </button>

          <template v-if="groupsPanelExpanded">
          <button
            v-if="counts.global || selectedKey === 'global'"
            class="sidebar-item w-full pl-8"
            :class="selectedKey === 'global' ? 'sidebar-item--active' : ''"
            @click="selectedKey = 'global'"
          >
            <span>🌐</span>
            <span class="truncate flex-1 text-left">{{ $t('hosts.legacyGlobal.title') }}</span>
            <span v-if="counts.global" class="sidebar-badge">{{ counts.global }}</span>
          </button>
          <button
            v-for="g in filteredGroupOptions"
            :key="`group-${g.value}`"
            class="sidebar-item w-full pl-8"
            :class="selectedKey === `group-${g.value}` ? 'sidebar-item--active' : ''"
            @click="selectedKey = `group-${g.value}`"
          >
            <span>👥</span>
            <span class="truncate flex-1 text-left">{{ g.label }}</span>
            <span v-if="counts[`group-${g.value}`]" class="sidebar-badge">{{ counts[`group-${g.value}`] }}</span>
          </button>
          </template>

          <!-- Tags -->
          <template v-if="filteredTags.length">
            <button
              type="button"
              class="sidebar-panel-toggle"
              :aria-expanded="tagsPanelExpanded"
              @click="toggleTagsPanelExpanded"
            >
              <span class="sidebar-panel-chevron">{{ tagsPanelExpanded ? '▾' : '▸' }}</span>
              <span class="sidebar-panel-title">{{ $t('hosts.tags') }}</span>
              <span class="sidebar-badge">{{ filteredTags.length }}</span>
            </button>
            <template v-if="tagsPanelExpanded">
            <div
              v-for="tag in filteredTags"
              :key="`tag-${tag.id}`"
              class="group flex items-center gap-1"
            >
              <button
                class="sidebar-item w-full pl-8"
                :class="selectedKey === `tag-${tag.id}` ? 'sidebar-item--active' : ''"
                @click="selectedKey = `tag-${tag.id}`"
              >
                <span
                  class="w-2 h-2 rounded-full shrink-0"
                  :style="{ background: tag.color }"
                />
                <span class="truncate flex-1 text-left">{{ tag.name }}</span>
                <span v-if="counts[`tag-${tag.id}`]" class="sidebar-badge">{{ counts[`tag-${tag.id}`] }}</span>
              </button>
              <NTooltip v-if="!counts[`tag-${tag.id}`]">
                <template #trigger>
                  <NButton
                    size="tiny"
                    text
                    style="color:#ef4444;"
                    class="opacity-0 transition-opacity group-hover:opacity-100"
                    @click.stop="confirmDeleteTag(tag)"
                  >
                    ×
                  </NButton>
                </template>
                {{ $t('common.delete') }}
              </NTooltip>
            </div>
            </template>
          </template>

          <div
            v-if="normalizedSidebarSearch && !hasSidebarSearchResults"
            class="px-3 py-4 text-xs text-gray-500"
          >
            {{ $t('hosts.sidebarSearchEmpty') }}
          </div>

        </div>
      </NScrollbar>

      <!-- Dica de arraste (aparece apenas quando há drag ativo) -->
      <div
        v-if="draggingHost"
        class="px-3 py-2 border-t border-gray-800 text-xs text-blue-400 text-center"
        style="background:#0f172a;"
      >
        {{ $t('hosts.dragHint') }}
      </div>
      <div
        class="hosts-sidebar-resize-handle"
        role="separator"
        aria-orientation="vertical"
        :aria-valuemin="HOSTS_SIDEBAR_MIN_WIDTH"
        :aria-valuemax="HOSTS_SIDEBAR_MAX_WIDTH"
        :aria-valuenow="sidebarWidth"
        :title="$t('profile.hosts.sidebarWidthHelp')"
        @pointerdown="startSidebarResize"
      />
    </div>

    <!-- ── Menu de contexto (botão direito) ── -->
    <NDropdown
      placement="bottom-start"
      trigger="manual"
      :x="ctxX"
      :y="ctxY"
      :options="ctxOptions"
      :show="ctxVisible"
      @clickoutside="ctxVisible = false; ctxHost = null"
      @select="onCtxSelect"
    />

    <NDropdown
      placement="bottom-start"
      trigger="manual"
      :x="inventoryFolderContextX"
      :y="inventoryFolderContextY"
      :options="inventoryFolderContextOptions"
      :show="inventoryFolderContextVisible"
      @clickoutside="closeInventoryFolderContext"
      @select="onInventoryFolderContextSelect"
    />

    <!-- ── Painel direito: hosts ── -->
    <div class="flex-1 overflow-auto p-6" @contextmenu="onHostAreaContextMenu">
      <div class="flex items-center justify-between mb-5">
        <div class="flex items-center gap-3">
          <NButton
            v-if="hostsDefaultView === 'home' && selectedKey !== 'home'"
            quaternary
            size="small"
            @click="() => { search = ''; selectedKey = 'home' }"
          >
            ← {{ $t('hosts.home.back') }}
          </NButton>
          <div>
            <h1 class="text-xl font-semibold text-white">{{ selectedLabel }}</h1>
            <NText v-if="selectedKey !== 'home'" depth="3" class="text-xs">{{ $t('hosts.count', { count: filteredHosts.length }) }}</NText>
          </div>
        </div>
        <NSpace>
          <NButton
            secondary
            @click="showHelp = true"
          >
            {{ $t('hosts.help.action') }}
          </NButton>
          <NButton
            v-if="hasOpenSessions"
            ghost
            type="primary"
            @click="openActiveSessionsReport"
          >
            🖥 Sessões abertas ({{ openSessionItems.length }})
          </NButton>
          <template v-if="canManage">
          <NButton ghost @click="showImport = true">⬆ {{ $t('import.title') }}</NButton>
          <NTooltip :disabled="!hostLimitReached">
            <template #trigger>
              <NButton type="primary" :disabled="hostLimitReached" data-host-new-button="true" @click="() => openCreate()">{{ $t('hosts.newHost') }}</NButton>
            </template>
            {{ hostLimitMessage }}
          </NTooltip>
          </template>
        </NSpace>
      </div>

      <div
        v-if="hasOpenSessions"
        data-open-sessions-panel="true"
        class="mb-4 rounded-xl border border-blue-900/40 bg-blue-950/20 p-3"
      >
        <div class="flex items-center justify-between gap-3 mb-2">
          <div>
            <div class="text-sm font-semibold text-white">Sessões abertas</div>
            <div class="text-xs text-gray-400">
              Você pode voltar ao terminal sem perder as conexões já abertas.
              <span v-if="openSessionPresenceTotals.uniqueUsers > 1" class="ml-1 text-blue-200">
                {{ openSessionPresenceTotals.uniqueUsers }} usuário(s) nesses host(s).
              </span>
            </div>
          </div>
          <NButton size="small" type="primary" @click="openFirstSessionItem">
            Voltar ao terminal
          </NButton>
        </div>
        <div class="flex flex-wrap gap-2">
          <div
            v-for="tab in openSessionItems"
            :key="`open-session-${tab.id}`"
            :data-open-session-host-id="tab.hostId"
            class="flex items-center gap-2 rounded-lg border px-2.5 py-2 min-w-[220px] max-w-[320px]"
            :class="tab.id === termStore.activeId
              ? 'border-blue-800 bg-[#141c2a]'
              : 'border-gray-800 bg-[#17171c]'"
          >
            <span
              class="w-2 h-2 rounded-full shrink-0"
              :class="tab.kind === 'detached' ? 'bg-blue-400' : tab.id === termStore.activeId ? 'bg-green-400' : 'bg-gray-500'"
            />
            <button class="min-w-0 flex-1 text-left" @click="openSessionItem(tab)">
              <div class="text-sm text-white truncate flex items-center gap-1.5">
                <span class="truncate">{{ tab.hostName }}</span>
                <NTag
                  size="tiny"
                  :type="accessProtocolTagType(tab.hostAccessProtocol ?? 'ssh')"
                  class="shrink-0"
                >
                  {{ accessProtocolLabel(tab.hostAccessProtocol ?? 'ssh') }}
                </NTag>
                <span
                  v-if="tab.kind === 'detached'"
                  class="inline-flex items-center rounded px-1 py-px text-[10px] font-medium text-blue-200 bg-blue-500/15 shrink-0"
                >
                  Janela separada
                </span>
                <span
                  v-if="tab.kind === 'local' && tab.unreadCount > 0"
                  class="inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full text-[10px] font-semibold px-1 shrink-0"
                  style="background: rgba(251,146,60,0.16); color: #fdba74;"
                >
                  {{ tab.unreadCount > 99 ? '99+' : tab.unreadCount }}
                </span>
              </div>
              <div class="text-[11px] text-gray-400 truncate">
                {{ tab.hostIp ?? 'Host sem IP' }}<span v-if="tab.hostPort">:{{ tab.hostPort }}</span>
                <span v-if="formatElapsed(tab.connectedAt)" class="ml-1">· {{ formatElapsed(tab.connectedAt) }}</span>
              </div>
              <div v-if="hostAccessPresence(tab.hostId)" class="mt-1 flex max-w-full">
                <HostPresencePill
                  :presence="hostAccessPresence(tab.hostId)!"
                  compact
                />
              </div>
            </button>
            <button
              v-if="tab.kind === 'local'"
              class="text-gray-500 hover:text-red-400 text-xs px-1 shrink-0"
              @click="closeSession(tab.id)"
            >✕</button>
          </div>
        </div>
      </div>

      <!-- Home ↔ List panel transition -->
      <NAlert v-if="aclRealtimeRefreshing" type="info" class="mb-3" :show-icon="false">
        {{ $t('hosts.inventoryAcl.refreshingAccess') }}
      </NAlert>

      <Transition name="host-panel" mode="out-in">
      <!-- Home: busca proeminente + quick access full-width -->
      <div v-if="selectedKey === 'home'" :key="`home-${hostPanelRefreshKey}`" class="mb-4 space-y-4">
        <div class="rounded-xl border border-gray-700/50 bg-[#17171c] p-6">
          <div class="mb-5 text-center">
            <div class="text-base font-semibold text-white">{{ $t('hosts.home.title') }}</div>
            <div class="mt-1 text-sm text-gray-400">{{ $t('hosts.home.subtitle') }}</div>
          </div>
          <div class="flex gap-2 max-w-xl mx-auto">
            <NInput
              v-model:value="search"
              :placeholder="$t('hosts.searchPlaceholder')"
              clearable
              size="large"
              class="flex-1"
              @keyup.enter="() => { selectedKey = 'all'; triggerSearchLoad() }"
            />
            <NButton type="primary" size="large" @click="() => { selectedKey = 'all'; triggerSearchLoad() }">
              {{ $t('hosts.search') }}
            </NButton>
          </div>
          <div class="mt-3 text-center">
            <NButton text size="small" class="text-gray-500 hover:text-gray-300" @click="selectedKey = 'all'">
              {{ $t('hosts.home.viewAll') }} →
            </NButton>
          </div>
        </div>

        <div class="rounded-xl border border-gray-800 bg-[#17171c] p-4">
          <div class="flex items-start justify-between gap-3" :class="!quickAccessCollapsed ? 'mb-3' : ''">
            <div>
              <div class="text-sm font-semibold text-white">{{ $t('hosts.quickAccess.title') }}</div>
              <div class="text-xs text-gray-400">{{ $t('hosts.quickAccess.subtitle') }}</div>
            </div>
            <div class="flex flex-wrap items-center justify-end gap-2">
              <span v-if="favoriteHosts.length" class="text-[11px] text-gray-500">
                {{ $t('hosts.favorites') }}: {{ favoriteHosts.length }}
              </span>
              <span v-if="recentHosts.length" class="text-[11px] text-gray-500">
                {{ $t('hosts.recent') }}: {{ recentHosts.length }}
              </span>
              <NButton quaternary size="small" @click="toggleQuickAccessCollapsed">
                {{ quickAccessCollapsed ? $t('hosts.quickAccess.expand') : $t('hosts.quickAccess.collapse') }}
              </NButton>
            </div>
          </div>

          <div v-if="!quickAccessCollapsed" class="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div class="min-w-0 rounded-lg border border-gray-800 bg-[#111113] p-3">
              <div class="mb-2 flex items-center justify-between gap-3">
                <div class="text-xs font-semibold uppercase tracking-wider text-amber-400/80">★ {{ $t('hosts.favorites') }}</div>
                <NButton quaternary size="tiny" @click="selectedKey = 'favorites'">{{ $t('hosts.quickAccess.viewAll') }}</NButton>
              </div>
              <div v-if="favoriteHosts.length" class="flex flex-wrap gap-2">
                <button
                  v-for="host in favoriteHosts"
                  :key="`home-fav-${host.id}`"
                  class="rounded-lg border border-amber-900/30 bg-[#111113] px-3 py-2 text-left min-w-[160px] max-w-[220px]"
                  :disabled="!canConnectHost(host)"
                  :title="canConnectHost(host) ? undefined : connectBlockedMessage(host)"
                  @click="connect(host)"
                  @contextmenu.stop="onHostContextMenu($event, host)"
                >
                  <div class="truncate text-sm font-semibold text-white flex items-center gap-2">
                    <span class="text-amber-300 shrink-0">★</span>
                    <span class="truncate">{{ host.name }}</span>
                    <NTag size="tiny" :type="accessProtocolTagType(host.accessProtocol)">
                      {{ accessProtocolLabel(host.accessProtocol) }}
                    </NTag>
                  </div>
                  <div class="truncate text-[11px] text-gray-400 font-mono">{{ host.ip }}:{{ host.port }}</div>
                </button>
              </div>
              <div v-else class="text-xs text-gray-500">{{ $t('hosts.empty.favorites') }}</div>
            </div>

            <div class="min-w-0 rounded-lg border border-gray-800 bg-[#111113] p-3">
              <div class="mb-2 flex items-center justify-between gap-3">
                <div class="text-xs font-semibold uppercase tracking-wider text-gray-500">{{ $t('hosts.recent') }}</div>
                <NButton quaternary size="tiny" @click="selectedKey = 'recent'">{{ $t('hosts.quickAccess.viewAll') }}</NButton>
              </div>
              <div v-if="recentHosts.length" class="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                <button
                  v-for="host in recentHosts"
                  :key="`home-rec-${host.id}`"
                  class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-gray-800 bg-[#111113] px-2.5 py-1.5 text-left hover:border-gray-700"
                  :disabled="!canConnectHost(host)"
                  :title="canConnectHost(host) ? undefined : connectBlockedMessage(host)"
                  @click="connect(host)"
                  @contextmenu.stop="onHostContextMenu($event, host)"
                >
                  <div class="min-w-0">
                    <div class="truncate text-sm font-medium text-white">{{ host.name }}</div>
                    <div class="truncate font-mono text-[11px] text-gray-500">{{ host.ip }}:{{ host.port }}</div>
                  </div>
                  <NTag size="tiny" :type="accessProtocolTagType(host.accessProtocol)">
                    {{ accessProtocolLabel(host.accessProtocol) }}
                  </NTag>
                </button>
              </div>
              <div v-else class="text-xs text-gray-500">{{ $t('hosts.empty.recent') }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Painel de quick access + busca + lista (modos que não são home) -->
      <div v-else :key="`list-${selectedKey}-${hostDisplayMode}-${hostPanelRefreshKey}`" class="space-y-4">
      <div class="mb-4">
        <div class="rounded-xl border border-gray-800 bg-[#17171c] p-2.5">
          <div class="flex items-center justify-between gap-3" :class="!quickAccessCollapsed ? 'mb-2' : ''">
            <div>
              <NTooltip trigger="hover" placement="top">
                <template #trigger>
                  <div class="inline-flex cursor-help items-center gap-1 text-sm font-semibold text-white">
                    {{ $t('hosts.quickAccess.title') }}
                    <span class="text-[11px] text-gray-500">?</span>
                  </div>
                </template>
                {{ $t('hosts.quickAccess.subtitle') }}
              </NTooltip>
            </div>
            <div class="flex flex-wrap items-center justify-end gap-2">
              <span v-if="favoriteHosts.length" class="text-[11px] text-gray-500">
                {{ $t('hosts.favorites') }}: {{ favoriteHosts.length }}
              </span>
              <span v-if="recentHosts.length" class="text-[11px] text-gray-500">
                {{ $t('hosts.recent') }}: {{ recentHosts.length }}
              </span>
              <NButton quaternary size="small" @click="toggleQuickAccessCollapsed">
                {{ quickAccessCollapsed ? $t('hosts.quickAccess.expand') : $t('hosts.quickAccess.collapse') }}
              </NButton>
            </div>
          </div>

          <div v-if="!quickAccessCollapsed" class="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div class="min-w-0 rounded-lg border border-gray-800 bg-[#111113] p-3">
              <div class="mb-1.5 flex items-center justify-between gap-3">
                <div class="text-xs font-semibold uppercase tracking-wider text-gray-500">{{ $t('hosts.favorites') }}</div>
                <NButton quaternary size="tiny" @click="selectedKey = 'favorites'">
                  {{ $t('hosts.quickAccess.viewAll') }}
                </NButton>
              </div>
              <div v-if="favoriteHosts.length" class="flex flex-wrap gap-2">
                <button
                  v-for="host in favoriteHosts"
                  :key="`favorite-host-${host.id}`"
                  class="rounded-md border border-amber-900/30 bg-[#111113] px-2.5 py-1.5 text-left min-w-[150px] max-w-[210px]"
                  :disabled="!canConnectHost(host)"
                  :title="canConnectHost(host) ? undefined : connectBlockedMessage(host)"
                  @click="connect(host)"
                  @contextmenu.stop="onHostContextMenu($event, host)"
                >
                  <div class="truncate text-sm font-semibold text-white flex items-center gap-2">
                    <span class="text-amber-300 shrink-0">★</span>
                    <span class="truncate">{{ host.name }}</span>
                  </div>
                  <div class="truncate text-[11px] text-gray-400 font-mono">{{ host.ip }}:{{ host.port }}</div>
                </button>
              </div>
              <div v-else class="text-xs text-gray-500">{{ $t('hosts.empty.favorites') }}</div>
            </div>

            <div class="min-w-0 rounded-lg border border-gray-800 bg-[#111113] p-3">
              <div class="mb-1.5 flex items-center justify-between gap-3">
                <div class="text-xs font-semibold uppercase tracking-wider text-gray-500">{{ $t('hosts.recent') }}</div>
                <NButton quaternary size="tiny" @click="selectedKey = 'recent'">
                  {{ $t('hosts.quickAccess.viewAll') }}
                </NButton>
              </div>
              <div v-if="recentHosts.length" class="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                <button
                  v-for="host in recentHosts"
                  :key="`recent-host-${host.id}`"
                  class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-gray-800 bg-[#111113] px-2.5 py-1.5 text-left hover:border-gray-700"
                  :disabled="!canConnectHost(host)"
                  :title="canConnectHost(host) ? undefined : connectBlockedMessage(host)"
                  @click="connect(host)"
                  @contextmenu.stop="onHostContextMenu($event, host)"
                >
                  <div class="min-w-0">
                    <div class="truncate text-sm font-medium text-white">{{ host.name }}</div>
                    <div class="truncate font-mono text-[11px] text-gray-500">{{ host.ip }}:{{ host.port }}</div>
                  </div>
                  <NTag size="tiny" :type="accessProtocolTagType(host.accessProtocol)">
                    {{ accessProtocolLabel(host.accessProtocol) }}
                  </NTag>
                </button>
              </div>
              <div v-else class="text-xs text-gray-500">{{ $t('hosts.empty.recent') }}</div>
            </div>
          </div>
        </div>

      </div>

      <NSpace class="mb-4" align="center" justify="space-between">
        <NSpace>
        <NInput
          v-model:value="search"
          :placeholder="$t('hosts.searchPlaceholder')"
          clearable
          style="width: 260px"
          @keyup.enter="triggerSearchLoad"
        />
        <NButton @click="triggerSearchLoad">{{ $t('hosts.search') }}</NButton>
        </NSpace>
        <NSpace align="center">
          <NText depth="3" class="text-xs">{{ $t('hosts.view.label') }}</NText>
          <NSelect
            :value="hostDisplayMode"
            :options="hostDisplayModeOptions"
            style="width: 160px"
            size="small"
            @update:value="updateHostDisplayPreference"
          />
          <NButton
            v-if="canBulkUpdateHosts"
            size="small"
            secondary
            :type="bulkSelectionMode ? 'primary' : 'default'"
            @click="bulkSelectionMode ? stopBulkSelection() : startBulkSelection()"
          >
            {{ bulkSelectionMode ? $t('hosts.bulk.exitMode') : $t('hosts.bulk.enterMode') }}
          </NButton>
          <NButton
            v-if="canBulkUpdateHosts"
            size="small"
            secondary
            @click="showBulkActionHistory = true"
          >
            {{ $t('hosts.bulk.history.open') }}
          </NButton>
        </NSpace>
      </NSpace>

      <div
        v-if="canBulkUpdateHosts && bulkSelectionMode && paginatedFilteredHosts.length"
        class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-800 bg-[#17171c] px-3 py-2"
      >
        <div class="flex flex-wrap items-center gap-3">
          <NCheckbox
            :checked="bulkSelectionSource === 'filter' || allVisibleBulkHostsSelected"
            :disabled="bulkSelectionSource === 'filter'"
            @update:checked="(checked) => toggleVisibleBulkHosts(Boolean(checked))"
          >
            {{ $t('hosts.bulk.selectVisible') }}
          </NCheckbox>
          <NText v-if="hasBulkSelection" depth="3" class="text-xs">
            {{ bulkSelectionDescription }}
          </NText>
        </div>
        <NSpace size="small">
          <NButton
            v-if="canSelectFilteredBulkHosts && bulkSelectionSource !== 'filter'"
            size="small"
            secondary
            @click="selectFilteredBulkHosts"
          >
            {{ $t('hosts.bulk.selectFiltered', { count: totalVisibleHosts }) }}
          </NButton>
          <NButton v-if="hasBulkSelection" size="small" secondary @click="clearBulkSelection">
            {{ $t('hosts.bulk.clearSelection') }}
          </NButton>
          <NButton size="small" secondary @click="stopBulkSelection">
            {{ $t('common.cancel') }}
          </NButton>
          <NButton
            size="small"
            type="primary"
            :disabled="!hasBulkSelection"
            @click="showBulkActionModal = true"
          >
            {{ $t('hosts.bulk.openActions') }}
          </NButton>
        </NSpace>
      </div>

      <div
        v-if="canBulkUpdateHosts && bulkSelectionMode"
        class="mb-4 rounded-lg border border-gray-800 bg-[#17171c] px-3 py-3"
      >
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <NText class="text-xs font-semibold uppercase tracking-wider text-gray-500">
            {{ $t('hosts.bulk.filters.title') }}
          </NText>
          <NButton
            v-if="hasBulkOperationalFilters"
            size="tiny"
            text
            @click="clearBulkOperationalFilters"
          >
            {{ $t('hosts.bulk.filters.clear') }}
          </NButton>
        </div>
        <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <NSelect
            v-model:value="bulkFilterBastionId"
            :options="bulkBastionFilterOptions"
            :placeholder="$t('hosts.bulk.filters.bastion')"
            clearable
            size="small"
          />
          <NSelect
            v-model:value="bulkFilterPemKeyId"
            :options="bulkPemKeyFilterOptions"
            :placeholder="$t('hosts.bulk.filters.pemKey')"
            clearable
            size="small"
          />
          <NSelect
            v-model:value="bulkFilterAuthType"
            :options="bulkAuthTypeFilterOptions"
            :placeholder="$t('hosts.bulk.filters.authType')"
            clearable
            size="small"
          />
          <NSelect
            v-model:value="bulkFilterConnectionMode"
            :options="bulkConnectionModeFilterOptions"
            :placeholder="$t('hosts.bulk.filters.connectionMode')"
            clearable
            size="small"
          />
        </div>
      </div>

      <div
        v-if="shouldPaginateHosts"
        class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-800 bg-[#17171c] px-3 py-2"
      >
        <NText depth="3" class="text-xs">
          Mostrando
          {{ visibleRangeStart }}
          -
          {{ visibleRangeEnd }}
          de {{ totalVisibleHosts }}
        </NText>
        <div class="flex items-center gap-3">
          <NSelect
            v-model:value="pageSizeModel"
            size="small"
            style="width: 110px"
            :options="hostDisplayMode === 'list'
              ? [{ label: '20 / pág', value: 20 }, { label: '40 / pág', value: 40 }, { label: '80 / pág', value: 80 }]
              : [{ label: '12 / pág', value: 12 }, { label: '24 / pág', value: 24 }, { label: '48 / pág', value: 48 }]"
            @update:value="visiblePage = 1"
          />
          <NPagination
            v-model:page="visiblePage"
            :page-size="currentPageSize"
            :item-count="totalVisibleHosts"
            size="small"
          />
        </div>
      </div>

      <NAlert v-if="error" type="error" class="mb-4" :title="error" />

      <NSpin :show="loading">
        <div v-if="!loading && !filteredHosts.length" class="py-20 flex flex-col items-center gap-3 text-center">
          <NEmpty :description="emptyStateDescription">
            <!-- Usuário sem hosts visíveis -->
            <template v-if="selectedKey === 'all' && totalVisibleHosts === 0 && !canManage" #extra>
              <div class="text-sm text-gray-400 max-w-xs space-y-1 mt-1">
                <p>{{ $t('hosts.empty.userHelp') }}</p>
                <ul class="text-left list-disc list-inside space-y-0.5">
                  <li>{{ $t('hosts.empty.userHelpGlobal') }}</li>
                  <li>{{ $t('hosts.empty.userHelpGroup') }}</li>
                </ul>
              </div>
            </template>
            <template v-else-if="selectedKey === 'favorites'" #extra>
              <div class="text-sm text-gray-400 max-w-xs space-y-2 mt-1">
                <p>{{ $t('hosts.empty.favoritesHelp') }}</p>
                <NButton size="small" secondary @click="selectedKey = 'all'">
                  {{ $t('hosts.empty.viewAllHosts') }}
                </NButton>
              </div>
            </template>
            <template v-else-if="selectedKey === 'recent'" #extra>
              <div class="text-sm text-gray-400 max-w-xs space-y-2 mt-1">
                <p>{{ $t('hosts.empty.recentHelp') }}</p>
                <NButton size="small" secondary @click="selectedKey = 'all'">
                  {{ $t('hosts.empty.viewAllHosts') }}
                </NButton>
              </div>
            </template>
            <!-- Admin sem hosts -->
            <template v-else-if="selectedKey === 'all' && totalVisibleHosts === 0 && canManage" #extra>
              <NTooltip :disabled="!hostLimitReached">
                <template #trigger>
                  <NButton type="primary" class="mt-2" :disabled="hostLimitReached" data-host-new-button="true" @click="() => openCreate()">{{ $t('hosts.empty.createFirst') }}</NButton>
                </template>
                {{ hostLimitMessage }}
              </NTooltip>
            </template>
          </NEmpty>
        </div>

        <div
          v-else-if="hostDisplayMode === 'list'"
          class="overflow-hidden rounded-xl border border-gray-800 bg-[#17171c]"
        >
          <div
            v-if="isLargeViewport"
            class="grid gap-3 border-b border-gray-800 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500"
            :class="bulkSelectionMode
              ? 'grid-cols-[32px_minmax(0,1.4fr)_160px_minmax(0,170px)_minmax(0,190px)_130px_210px]'
              : 'grid-cols-[minmax(0,1.4fr)_160px_minmax(0,170px)_minmax(0,190px)_130px_210px]'"
          >
            <div v-if="bulkSelectionMode"></div>
            <div>{{ $t('hosts.list.columns.host') }}</div>
            <div>{{ $t('hosts.list.columns.auth') }}</div>
            <div>{{ $t('hosts.list.columns.tags') }}</div>
            <div>{{ $t('hosts.list.columns.links') }}</div>
            <div>{{ $t('hosts.list.columns.forwardings') }}</div>
            <div class="text-right">{{ $t('hosts.list.columns.actions') }}</div>
          </div>

          <div class="host-list-container">
            <div
              v-for="{ host, meta, presence, agentRouteStatus, forwardingCount, isFavorite, favoriteActionLabel, showOperatingSystemIcon, operatingSystemDisplayLabel, accessProtocolDisplayLabel, authTypeDisplayLabel, connectionModeDisplayLabel, connectionModeDisplayTooltip, bastionDisplayTooltip, hasActions, canConnect, connectBlockedTitle, connectActionTitle } in visibleHostViewItems"
              :key="`list-${host.id}`"
              v-memo="[host, useMinimalHostList, isFavorite, canManage, selectedBulkHostIdSet.has(host.id), forwardingCount, agentRouteStatus?.type ?? null, presence?.activeSessions ?? 0, activeHostActionMenuId === host.id, draggingHost?.id === host.id]"
              :data-host-id="host.id"
              class="host-list-row border-b border-gray-800 px-4 py-3 last:border-b-0"
              :class="draggingHost?.id === host.id ? 'opacity-40' : ''"
              :draggable="canManage"
              @contextmenu.stop="onHostContextMenu($event, host)"
              @dragstart="canManage && onDragStart($event, host)"
              @dragend="onDragEnd"
            >
            <div
              v-if="useMinimalHostList"
              class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"
            >
              <button
                class="min-w-0 text-left"
                :disabled="!canConnect"
                :title="connectBlockedTitle"
                @click="connect(host)"
              >
                <div class="truncate text-sm font-semibold text-white">{{ host.name }}</div>
                <div class="truncate font-mono text-xs text-gray-400">{{ host.ip }}:{{ host.port }}</div>
              </button>
              <NButton
                size="small"
                type="primary"
                data-host-connect-button="true"
                :disabled="!canConnect"
                @click.stop="connect(host)"
              >
                {{ $t('hosts.connect') }}
              </NButton>
            </div>
            <div
              v-else-if="isLargeViewport"
              class="grid gap-3 items-center"
              :class="bulkSelectionMode
                ? 'lg:grid-cols-[32px_minmax(0,1.4fr)_160px_minmax(0,170px)_minmax(0,190px)_130px_210px]'
                : 'lg:grid-cols-[minmax(0,1.4fr)_160px_minmax(0,170px)_minmax(0,190px)_130px_210px]'"
            >
              <div v-if="bulkSelectionMode">
                <NCheckbox
                  v-if="canBulkUpdateHosts"
                  :checked="bulkSelectionSource === 'filter' || selectedBulkHostIdSet.has(host.id)"
                  :disabled="bulkSelectionSource === 'filter'"
                  @update:checked="(checked) => toggleBulkHost(host.id, Boolean(checked))"
                />
              </div>
              <button
                class="min-w-0 text-left"
                :disabled="!canConnect"
                :title="connectBlockedTitle"
                @click="connect(host)"
              >
                <div class="truncate text-sm font-semibold text-white flex items-center gap-2">
                  <HostOsIcon
                    v-if="showOperatingSystemIcon"
                    :operating-system="host.operatingSystem"
                    :label="operatingSystemDisplayLabel"
                    :title="operatingSystemDisplayLabel"
                  />
                  <button
                    type="button"
                    class="host-favorite-inline-button"
                    :class="isFavorite ? 'is-favorite' : ''"
                    :aria-label="favoriteActionLabel"
                    :title="favoriteActionLabel"
                    @click.stop="toggleFavoriteHost(host.id)"
                  >
                    ★
                  </button>
                  <span class="truncate">{{ host.name }}</span>
                  <span :class="hostLiteTagClass(accessProtocolTagType(host.accessProtocol))">
                    {{ accessProtocolDisplayLabel }}
                  </span>
                </div>
                <div class="truncate font-mono text-xs text-gray-400">{{ host.ip }}:{{ host.port }}</div>
                <div v-if="presence" class="mt-1 flex max-w-full">
                  <HostPresencePill
                    :presence="presence"
                    compact
                  />
                </div>
              </button>

              <div class="text-xs text-gray-300">
                {{ authTypeDisplayLabel }}
                <div class="mt-1 flex items-center gap-1.5">
                  <span
                    :class="hostLiteTagClass(connectionModeTagType(host.connectionMode))"
                    :title="connectionModeDisplayTooltip"
                  >
                    {{ connectionModeDisplayLabel }}
                  </span>
                  <span
                    v-if="agentRouteStatus"
                    :class="hostLiteTagClass(agentRouteStatus.type)"
                    :title="agentRouteStatus.tooltip"
                  >
                    {{ agentRouteStatus.label }}
                  </span>
                </div>
                <NTag
                  class="mt-1"
                  size="tiny"
                  :type="host.effectiveBastionSource === 'none' ? 'default' : 'info'"
                  :title="bastionDisplayTooltip"
                >
                  {{ host.effectiveBastionName ?? $t('hosts.bastion.noneShort') }}
                </NTag>
              </div>

              <div class="min-w-0">
                <div v-if="host.tags.length" class="flex items-center gap-1.5 min-w-0">
                  <span
                    v-for="tag in meta.visibleTags"
                    :key="`list-tag-${tag.id}`"
                    class="inline-flex max-w-full items-center truncate px-1.5 py-0.5 rounded text-[11px] font-medium"
                    :style="{ background: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}44` }"
                  >
                    {{ tag.name }}
                  </span>
                  <span
                    v-if="meta.hiddenTagCount > 0"
                    class="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium border border-gray-700 text-gray-300"
                    :title="meta.hiddenTagNames"
                  >
                    +{{ meta.hiddenTagCount }}
                  </span>
                </div>
                <span v-else class="text-[11px] text-gray-500">{{ $t('hosts.list.noTags') }}</span>
              </div>

              <div class="min-w-0">
                <div v-if="meta.visibleAssociatedLinkItems.length" class="flex min-w-0 flex-wrap gap-1.5">
                  <NButton
                    v-for="item in meta.visibleAssociatedLinkItems"
                    :key="item.key"
                    class="max-w-full"
                    size="small"
                    quaternary
                    :title="item.resolvedUrl"
                    @click.stop="openAssociatedLink(host, item.link)"
                  >
                    <span class="block max-w-[120px] truncate">{{ item.link.label }}</span>
                  </NButton>
                  <NTag
                    v-if="meta.hiddenAssociatedLinkCount > 0"
                    size="small"
                    :title="$t('hosts.associatedLinks.moreHidden', { count: meta.hiddenAssociatedLinkCount })"
                  >
                    +{{ meta.hiddenAssociatedLinkCount }}
                  </NTag>
                </div>
                <span v-else class="text-[11px] text-gray-500">—</span>
              </div>

              <div class="text-xs text-gray-300">
                <NTooltip v-if="forwardingCount > 0" trigger="hover" placement="top">
                  <template #trigger>
                    <span class="cursor-help">
                      {{ $t('hosts.forwardings.badge', { count: forwardingCount }) }}
                    </span>
                  </template>
                  <div class="max-w-[360px] space-y-1">
                    <div class="text-xs font-semibold">{{ $t('hosts.forwardings.title') }}</div>
                    <div
                      v-for="item in meta.forwardingTooltipItems"
                      :key="item"
                      class="font-mono text-[11px] leading-snug"
                    >
                      {{ item }}
                    </div>
                  </div>
                </NTooltip>
                <span v-else>
                  {{ $t('hosts.forwardings.badge', { count: 0 }) }}
                </span>
              </div>

              <div class="flex justify-end gap-1.5">
                <NButton
                  class="host-icon-button"
                  size="small"
                  :aria-label="$t('hosts.dashboard.open')"
                  :title="$t('hosts.dashboard.open')"
                  data-host-dashboard-button="true"
                  @click.stop="openHostDashboard(host.id)"
                >
                  <template #icon>
                    <svg class="host-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <path d="M8 17V11" />
                      <path d="M12 17V7" />
                      <path d="M16 17V13" />
                    </svg>
                  </template>
                </NButton>
                <template v-if="hasActions">
                  <NDropdown
                    v-if="isHostActionMenuOpen(host)"
                    trigger="manual"
                    :show="true"
                    placement="bottom-end"
                    :options="hostCardActionOptions(host)"
                    @clickoutside="closeHostActionMenu"
                    @select="(key) => handleHostCardAction(key, host)"
                  >
                    <NButton
                      size="small"
                      quaternary
                      class="host-card-menu-button"
                      data-host-actions-button="true"
                      @click.stop="toggleHostActionMenu(host)"
                    >
                      ⋮
                    </NButton>
                  </NDropdown>
                  <NButton
                    v-else
                    size="small"
                    quaternary
                    class="host-card-menu-button"
                    data-host-actions-button="true"
                    @click.stop="toggleHostActionMenu(host)"
                  >
                    ⋮
                  </NButton>
                </template>
                <NButton
                  size="small"
                  type="primary"
                  class="px-2"
                  data-host-connect-button="true"
                  :disabled="!canConnect"
                  :aria-label="$t('hosts.connect')"
                  :title="connectActionTitle"
                  @click.stop="connect(host)"
                >
                  <svg class="mr-1" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>
                    <path d="m7 9 3 3-3 3"/>
                    <path d="M12 15h5"/>
                  </svg>
                  {{ $t('hosts.connect') }}
                </NButton>
              </div>
            </div>

            <div v-else>
              <div v-if="canBulkUpdateHosts && bulkSelectionMode" class="mb-2">
                <NCheckbox
                  :checked="bulkSelectionSource === 'filter' || selectedBulkHostIdSet.has(host.id)"
                  :disabled="bulkSelectionSource === 'filter'"
                  @update:checked="(checked) => toggleBulkHost(host.id, Boolean(checked))"
                >
                  {{ $t('hosts.bulk.selectHost') }}
                </NCheckbox>
              </div>
              <button
                class="w-full text-left"
                :disabled="!canConnect"
                :title="connectBlockedTitle"
                @click="connect(host)"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="truncate text-sm font-semibold text-white flex items-center gap-2">
                      <button
                        type="button"
                        class="host-favorite-inline-button"
                        :class="isFavorite ? 'is-favorite' : ''"
                        :aria-label="favoriteActionLabel"
                        :title="favoriteActionLabel"
                        @click.stop="toggleFavoriteHost(host.id)"
                      >
                        ★
                      </button>
                      <span class="truncate">{{ host.name }}</span>
                    </div>
                    <div class="truncate font-mono text-xs text-gray-400">{{ host.ip }}:{{ host.port }}</div>
                    <div v-if="presence" class="mt-1 flex max-w-full">
                      <HostPresencePill
                        :presence="presence"
                        compact
                      />
                    </div>
                  </div>
                </div>
              </button>
              <div class="mt-2 text-xs text-gray-300">
                {{ authTypeDisplayLabel }}
                <NTooltip trigger="hover" placement="top">
                  <template #trigger>
                    <span
                      class="ml-1"
                      :class="hostLiteTagClass(connectionModeTagType(host.connectionMode))"
                    >
                      {{ connectionModeDisplayLabel }}
                    </span>
                  </template>
                  {{ connectionModeDisplayTooltip }}
                </NTooltip>
                <NTooltip v-if="agentRouteStatus" trigger="hover" placement="top">
                  <template #trigger>
                    <span
                      class="ml-1"
                      :class="hostLiteTagClass(agentRouteStatus.type)"
                    >
                      {{ agentRouteStatus.label }}
                    </span>
                  </template>
                  {{ agentRouteStatus.tooltip }}
                </NTooltip>
              </div>
              <NTooltip>
                <template #trigger>
                  <NTag
                    class="mt-2"
                    size="small"
                    :type="host.effectiveBastionSource === 'none' ? 'default' : 'info'"
                  >
                    {{ $t('hosts.bastion.badge', { name: host.effectiveBastionName ?? $t('hosts.bastion.noneShort') }) }}
                  </NTag>
                </template>
                {{ bastionDisplayTooltip }}
              </NTooltip>
              <div v-if="host.tags.length" class="mt-2 flex flex-wrap gap-1">
                <span
                  v-for="tag in host.tags"
                  :key="`list-mobile-tag-${tag.id}`"
                  class="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium"
                  :style="{ background: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}44` }"
                >
                  {{ tag.name }}
                </span>
              </div>
              <div class="mt-3 flex flex-wrap gap-2">
                <template v-if="hasActions">
                  <NButton
                    class="host-icon-button"
                    size="small"
                    :aria-label="$t('hosts.dashboard.open')"
                    :title="$t('hosts.dashboard.open')"
                    data-host-dashboard-button="true"
                    @click.stop="openHostDashboard(host.id)"
                  >
                    <template #icon>
                      <svg class="host-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <path d="M8 17V11" />
                        <path d="M12 17V7" />
                        <path d="M16 17V13" />
                      </svg>
                    </template>
                  </NButton>
                  <NDropdown
                    v-if="isHostActionMenuOpen(host)"
                    trigger="manual"
                    :show="true"
                    placement="bottom-end"
                    :options="hostCardActionOptions(host)"
                    @clickoutside="closeHostActionMenu"
                    @select="(key) => handleHostCardAction(key, host)"
                  >
                    <NButton
                      size="small"
                      quaternary
                      class="host-card-menu-button"
                      data-host-actions-button="true"
                      @click.stop="toggleHostActionMenu(host)"
                    >
                      ⋮
                    </NButton>
                  </NDropdown>
                  <NButton
                    v-else
                    size="small"
                    quaternary
                    class="host-card-menu-button"
                    data-host-actions-button="true"
                    @click.stop="toggleHostActionMenu(host)"
                  >
                    ⋮
                  </NButton>
                </template>
                <span class="inline-flex" :title="connectActionTitle">
                  <NButton
                    size="small"
                    type="primary"
                    class="px-2"
                    data-host-connect-button="true"
                    :disabled="!canConnect"
                    :aria-label="$t('hosts.connect')"
                    :title="connectActionTitle"
                    @click.stop="connect(host)"
                  >
                    <svg class="mr-1" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>
                      <path d="m7 9 3 3-3 3"/>
                      <path d="M12 15h5"/>
                    </svg>
                    {{ $t('hosts.connect') }}
                  </NButton>
                </span>
              </div>
            </div>
            </div>
          </div>
        </div>

          <NGrid v-else class="hosts-grid" :cols="3" :x-gap="16" :y-gap="16" responsive="screen">
          <NGridItem
            v-for="{ host, meta, presence, agentRouteStatus, forwardingCount, isFavorite, favoriteActionLabel, showOperatingSystemIcon, operatingSystemDisplayLabel, accessProtocolDisplayLabel, authTypeDisplayLabel, connectionModeDisplayLabel, connectionModeDisplayTooltip, bastionDisplayTooltip, hasActions, canConnect, connectBlockedTitle, connectActionTitle } in visibleHostViewItems"
            :key="host.id"
            v-memo="[host, isFavorite, canManage, selectedBulkHostIdSet.has(host.id), forwardingCount, agentRouteStatus?.type ?? null, presence?.activeSessions ?? 0, activeHostActionMenuId === host.id, draggingHost?.id === host.id]"
            style="height: 100%"
          >
            <NCard
              :data-host-id="host.id"
              hoverable :bordered="false"
              :style="{
                background: 'var(--na-surface-raised)',
                opacity: draggingHost?.id === host.id ? '0.4' : '1',
                transition: 'opacity 0.15s',
                cursor: canManage ? 'grab' : undefined,
                height: '100%',
                position: 'relative',
                borderRadius: '10px',
                overflow: 'hidden',
              }"
              content-style="display:flex;flex-direction:column;height:100%;"
              :draggable="canManage"
              @contextmenu.stop="onHostContextMenu($event, host)"
              @dragstart="canManage && onDragStart($event, host)"
              @dragend="onDragEnd"
            >
              <template v-if="hasActions">
                <NDropdown
                  v-if="isHostActionMenuOpen(host)"
                  trigger="manual"
                  :show="true"
                  placement="bottom-end"
                  :options="hostCardActionOptions(host)"
                  @clickoutside="closeHostActionMenu"
                  @select="(key) => handleHostCardAction(key, host)"
                >
                  <NButton
                    size="small"
                    quaternary
                    class="host-card-menu-button host-card-menu-button--fixed"
                    data-host-actions-button="true"
                    @click.stop="toggleHostActionMenu(host)"
                  >
                    ⋮
                  </NButton>
                </NDropdown>
                <NButton
                  v-else
                  size="small"
                  quaternary
                  class="host-card-menu-button host-card-menu-button--fixed"
                  data-host-actions-button="true"
                  @click.stop="toggleHostActionMenu(host)"
                >
                  ⋮
                </NButton>
              </template>
              <div v-if="canBulkUpdateHosts && bulkSelectionMode" class="mb-2">
                <NCheckbox
                  :checked="bulkSelectionSource === 'filter' || selectedBulkHostIdSet.has(host.id)"
                  :disabled="bulkSelectionSource === 'filter'"
                  @update:checked="(checked) => toggleBulkHost(host.id, Boolean(checked))"
                >
                  {{ $t('hosts.bulk.selectHost') }}
                </NCheckbox>
              </div>
              <div class="flex-1">
              <div class="flex items-start justify-between gap-3">
                <div
                  role="button"
                  :tabindex="canConnect ? 0 : -1"
                  class="min-w-0 flex-1 text-left"
                  :style="{ cursor: canConnect ? 'pointer' : 'default' }"
                  :title="connectBlockedTitle"
                  @click="connect(host)"
                  @keydown.enter.prevent="connect(host)"
                  @keydown.space.prevent="connect(host)"
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      class="host-favorite-inline-button"
                      :class="isFavorite ? 'is-favorite' : ''"
                      :aria-label="favoriteActionLabel"
                      :title="favoriteActionLabel"
                      @click.stop="toggleFavoriteHost(host.id)"
                    >
                      ★
                    </button>
                    <NText strong class="block truncate">{{ host.name }}</NText>
                    <span :class="hostLiteTagClass(accessProtocolTagType(host.accessProtocol))">
                      {{ accessProtocolDisplayLabel }}
                    </span>
                  </div>
                  <NText depth="3" class="text-xs font-mono">{{ host.ip }}:{{ host.port }}</NText>
                  <div v-if="presence" class="mt-2 flex max-w-full">
                    <HostPresencePill :presence="presence" />
                  </div>
                </div>
                <div class="ml-2 mr-8 flex shrink-0 flex-col items-end gap-1">
                  <div class="flex max-w-[150px] flex-wrap items-center justify-end gap-1">
                    <NTooltip trigger="hover" placement="top">
                      <template #trigger>
                        <span class="text-sm leading-none cursor-default select-none shrink-0">{{ authTypeIcon(host.authType) }}</span>
                      </template>
                      {{ authTypeDisplayLabel }}
                    </NTooltip>
                    <NTooltip trigger="hover" placement="top">
                      <template #trigger>
                        <span :class="hostLiteTagClass(connectionModeTagType(host.connectionMode))">
                          {{ connectionModeDisplayLabel }}
                        </span>
                      </template>
                      {{ connectionModeDisplayTooltip }}
                    </NTooltip>
                    <NTooltip v-if="agentRouteStatus" trigger="hover" placement="top">
                      <template #trigger>
                        <span :class="hostLiteTagClass(agentRouteStatus.type)">
                          {{ agentRouteStatus.type === 'success' ? '✓' : agentRouteStatus.type === 'warning' ? '!' : '↩' }}
                        </span>
                      </template>
                      {{ agentRouteStatus.label }} · {{ agentRouteStatus.tooltip }}
                    </NTooltip>
                  </div>
                </div>
              </div>

              <!-- Túneis -->
              <div
                v-if="forwardingCount > 0"
                class="mt-3 flex min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-blue-900/20 bg-blue-950/10 px-2 py-1.5"
              >
                <NTooltip
                  v-for="forwarding in meta.visibleForwardings"
                  :key="`card-forwarding-${host.id}-${forwarding.id}`"
                  trigger="hover"
                  placement="top"
                >
                  <template #trigger>
                    <span
                      class="inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium cursor-pointer select-none transition-opacity hover:opacity-80"
                      style="background:rgba(59,130,246,0.16); color:#93c5fd;"
                      @click.stop="openHostForwardings(host.id, host.name)"
                    >
                      <svg class="host-forwarding-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M5 12h14" />
                        <path d="M12 5v14" />
                        <path d="M4 5h5v5H4z" />
                        <path d="M15 14h5v5h-5z" />
                      </svg>
                      <span class="truncate">{{ forwardingLabel(forwarding) }}</span>
                    </span>
                  </template>
                  {{ forwardingLabel(forwarding) }}
                </NTooltip>
                <NTooltip v-if="meta.hiddenForwardingCount > 0" trigger="hover" placement="top">
                  <template #trigger>
                    <span
                      class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium cursor-pointer select-none transition-opacity hover:opacity-80"
                      style="background:rgba(255,255,255,0.06); color:#9ca3af;"
                      @click.stop="openHostForwardings(host.id, host.name)"
                    >
                      <svg class="host-forwarding-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M5 12h14" />
                        <path d="M12 5v14" />
                        <path d="M4 5h5v5H4z" />
                        <path d="M15 14h5v5h-5z" />
                      </svg>
                      +{{ meta.hiddenForwardingCount }}
                    </span>
                  </template>
                  {{ meta.hiddenForwardingNames }}
                </NTooltip>
              </div>

              <!-- Bastion -->
              <div v-if="host.effectiveBastionSource !== 'none'" class="mt-2">
                <NTooltip trigger="hover" placement="top">
                  <template #trigger>
                    <span
                      class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium cursor-default select-none"
                      style="background:rgba(99,102,241,0.16); color:#a5b4fc;"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/></svg>
                      {{ host.effectiveBastionName }}
                    </span>
                  </template>
                  {{ bastionDisplayTooltip }}
                </NTooltip>
              </div>

              <!-- Tags do host -->
              <div v-if="host.tags.length" class="mt-3 flex min-w-0 flex-wrap gap-1.5">
                <span
                  v-for="tag in meta.visibleCardTags"
                  :key="tag.id"
                  class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium"
                  :style="{ background: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}44` }"
                >
                  {{ tag.name }}
                </span>
                <NTooltip v-if="meta.hiddenCardTagCount > 0">
                  <template #trigger>
                    <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium border border-gray-700 text-gray-300">
                      +{{ meta.hiddenCardTagCount }}
                    </span>
                  </template>
                  {{ meta.hiddenCardTagNames }}
                </NTooltip>
              </div>

              <!-- Links -->
              <div v-if="meta.visibleAssociatedLinkItems.length" class="mt-3 flex min-w-0 flex-wrap gap-1.5">
                <NButton
                  v-for="item in meta.visibleAssociatedLinkItems"
                  :key="item.key"
                  size="tiny"
                  quaternary
                  :title="item.resolvedUrl"
                  @click.stop="openAssociatedLink(host, item.link)"
                >
                  <template #icon>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M10 13a5 5 0 0 0 7.54.54l2.92-2.92a5 5 0 0 0-7.07-7.07L11.5 5.43"/><path d="M14 11a5 5 0 0 0-7.54-.54L3.54 13.38a5 5 0 1 0 7.07 7.07l1.88-1.88"/></svg>
                  </template>
                  {{ item.link.label }}
                </NButton>
                <span
                  v-if="meta.hiddenAssociatedLinkCount > 0"
                  class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium cursor-default select-none"
                  style="background:rgba(255,255,255,0.06); color:#9ca3af;"
                  :title="$t('hosts.associatedLinks.hiddenCount', { count: meta.hiddenAssociatedLinkCount })"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M10 13a5 5 0 0 0 7.54.54l2.92-2.92a5 5 0 0 0-7.07-7.07L11.5 5.43"/><path d="M14 11a5 5 0 0 0-7.54-.54L3.54 13.38a5 5 0 1 0 7.07 7.07l1.88-1.88"/></svg>
                  +{{ meta.hiddenAssociatedLinkCount }}
                </span>
              </div>
              </div><!-- /flex-1 -->

              <!-- Rodapé: botões de ação -->
              <div class="mt-auto pt-3 flex flex-wrap items-center justify-end gap-1">
                  <HostOsIcon
                    v-if="showOperatingSystemIcon"
                    class="mr-auto"
                    :operating-system="host.operatingSystem"
                    :label="operatingSystemDisplayLabel"
                    :title="operatingSystemDisplayLabel"
                    size="card"
                  />
                  <NButton
                    class="host-icon-button"
                    size="small"
                    :aria-label="$t('hosts.dashboard.open')"
                    :title="$t('hosts.dashboard.open')"
                    data-host-dashboard-button="true"
                    @click.stop="openHostDashboard(host.id)"
                  >
                    <template #icon>
                      <svg class="host-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <path d="M8 17V11" />
                        <path d="M12 17V7" />
                        <path d="M16 17V13" />
                      </svg>
                    </template>
                  </NButton>
                  <span class="inline-flex" :title="connectActionTitle">
                    <NButton
                      size="small"
                      type="primary"
                      class="px-2"
                      data-host-connect-button="true"
                      :disabled="!canConnect"
                      :aria-label="$t('hosts.connect')"
                      :title="connectActionTitle"
                      @click.stop="connect(host)"
                    >
                      <svg class="mr-1" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>
                        <path d="m7 9 3 3-3 3"/>
                        <path d="M12 15h5"/>
                      </svg>
                      {{ $t('hosts.connect') }}
                    </NButton>
                  </span>
              </div>

            </NCard>
          </NGridItem>
        </NGrid>
      </NSpin>
      </div><!-- /v-else key="list" -->
      </Transition>
    </div>

    <!-- ── Modal: criar/editar host ── -->
    <NModal v-model:show="showHelp">
      <NCard
        style="width: min(900px, calc(100vw - 32px))"
        :title="$t('hosts.help.title')"
        :bordered="false"
        role="dialog"
        aria-modal="true"
      >
        <div class="max-h-[78vh] overflow-y-auto pr-1">
          <div class="mb-5 rounded border border-white/10 p-4">
            <NText depth="3" class="block text-sm">{{ $t('hosts.help.subtitle') }}</NText>
            <div class="mt-4 grid gap-3 md:grid-cols-3">
              <div
                v-for="item in helpQuickItems"
                :key="item"
                class="rounded bg-white/5 p-3"
              >
                <NText strong class="block text-sm">{{ $t(`hosts.help.quick.${item}.title`) }}</NText>
                <NText depth="3" class="block text-xs mt-1">{{ $t(`hosts.help.quick.${item}.description`) }}</NText>
              </div>
            </div>
          </div>

          <div class="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <section>
              <h2 class="text-sm font-semibold text-white mb-3">{{ $t('hosts.help.fieldsTitle') }}</h2>
              <div class="overflow-hidden rounded border border-white/10">
                <div
                  v-for="field in helpFields"
                  :key="field"
                  class="grid gap-2 border-b border-white/10 p-3 last:border-b-0 md:grid-cols-[150px_1fr]"
                >
                  <NText strong class="text-sm">{{ $t(`hosts.help.fields.${field}.title`) }}</NText>
                  <NText depth="3" class="text-sm">{{ $t(`hosts.help.fields.${field}.description`) }}</NText>
                </div>
              </div>
            </section>

            <section class="space-y-5">
              <div>
                <h2 class="text-sm font-semibold text-white mb-3">{{ $t('hosts.help.permissionsTitle') }}</h2>
                <div class="space-y-3">
                  <div
                    v-for="permission in helpPermissionItems"
                    :key="permission"
                    class="rounded border border-white/10 p-3"
                  >
                    <NTag size="small">{{ $t(`hosts.help.permissions.${permission}.label`) }}</NTag>
                    <NText depth="3" class="block text-sm mt-2">{{ $t(`hosts.help.permissions.${permission}.description`) }}</NText>
                  </div>
                </div>
              </div>

              <div>
                <h2 class="text-sm font-semibold text-white mb-3">{{ $t('hosts.help.routesTitle') }}</h2>
                <div class="space-y-3">
                  <div
                    v-for="route in helpRoutes"
                    :key="route"
                    class="rounded border border-white/10 p-3"
                  >
                    <NTag size="small" :type="route === 'direct' ? 'default' : 'success'">
                      {{ $t(`hosts.help.routes.${route}.label`) }}
                    </NTag>
                    <NText depth="3" class="block text-sm mt-2">{{ $t(`hosts.help.routes.${route}.description`) }}</NText>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </NCard>
    </NModal>

    <NModal v-model:show="showHostModal" preset="card" draggable :title="editingHostId ? $t('hosts.form.editTitle') : $t('hosts.form.newTitle')" style="width:min(820px, calc(100vw - 32px))">
      <div ref="hostFormScrollRef" class="overflow-y-auto pr-1" style="max-height: calc(85vh - 150px)">
        <NForm autocomplete="off" @submit.prevent="submitHost">
          <input type="text" name="fake-username" autocomplete="username" class="hidden" tabindex="-1">
          <input type="password" name="fake-password" autocomplete="current-password" class="hidden" tabindex="-1">

          <!-- ── Campos principais ── -->
          <div class="mb-3 border-b border-gray-800 pb-1">
            <span class="text-xs font-semibold uppercase tracking-wide text-gray-400">{{ $t('hosts.form.sectionMain') }}</span>
            <p class="mt-1 text-[11px] text-gray-500">{{ $t('hosts.form.sectionMainHint') }}</p>
          </div>
          <NFormItem :label="`${$t('hosts.form.name')} *`">
            <NInput v-model:value="form.name" :placeholder="$t('hosts.form.namePlaceholder')" @blur="normalizeHostNameField" />
          </NFormItem>
          <div class="grid gap-3 sm:grid-cols-[150px_minmax(180px,1fr)] lg:grid-cols-[150px_170px_minmax(240px,1fr)_110px]">
            <NFormItem :label="accessProtocolFieldLabel">
              <NSelect
                v-model:value="form.accessProtocol"
                :options="accessProtocolOptions"
                @update:value="onAccessProtocolChange"
              />
            </NFormItem>
            <NFormItem :label="$t('hosts.form.operatingSystem')">
              <NSelect
                v-model:value="form.operatingSystem"
                :options="hostOperatingSystemOptions"
                filterable
              />
            </NFormItem>
            <NFormItem
              :label="`${$t('hosts.form.ip')} *`"
              :feedback="ipValidationError ?? hostEndpointResolutionHint ?? undefined"
              :validation-status="ipValidationError ? 'error' : undefined"
            >
              <NInput
                v-model:value="form.ip"
                :placeholder="$t('hosts.form.ipPlaceholder')"
                @input="() => { resetTestResult(); normalizeHostIpField() }"
                @blur="() => { ipFieldBlurred = true; normalizeHostIpField() }"
              />
            </NFormItem>
            <NFormItem :label="$t('hosts.form.port')">
              <NInputNumber v-model:value="form.port" :min="1" :max="65535" :show-button="false" style="width:100%" @update:value="resetTestResult" />
            </NFormItem>
          </div>
          <NAlert
            v-if="form.accessProtocol === 'telnet'"
            type="warning"
            :bordered="false"
            :show-icon="true"
            class="mb-3"
          >
            {{ $t('hosts.protocols.telnetSecurityWarning') }}
          </NAlert>
          <NFormItem v-if="isSshHostForm" :label="`${$t('hosts.form.sshUser')} *`">
            <NInput
              v-model:value="form.sshUser"
              :placeholder="$t('hosts.form.sshUserPlaceholder')"
              autocomplete="off"
              name="ssh-user"
              @input="resetTestResult"
            />
          </NFormItem>
          <NFormItem v-if="isSshHostForm" :label="$t('hosts.form.authType')">
            <div class="w-full">
              <NSelect v-model:value="form.authType" :options="authTypeOptions" @update:value="resetTestResult" />
              <div v-if="authTypeHint" class="mt-1 text-[11px] text-gray-500">{{ authTypeHint }}</div>
            </div>
          </NFormItem>
          <NFormItem v-if="isPasswordCredentialHostForm && (form.authType === 'password' || form.authType === 'pem_password')" :label="hostPasswordFieldLabel">
            <div class="w-full">
              <NInput
                v-model:value="form.password"
                type="password"
                show-password-on="click"
                autocomplete="new-password"
                name="ssh-password"
                :placeholder="hasSavedPasswordCredentialForCurrentAuth ? $t('hosts.form.savedPasswordPlaceholder') : undefined"
                @input="resetTestResult"
              />
              <div v-if="hasSavedPasswordCredentialForCurrentAuth" class="mt-1 text-[11px] text-gray-500">
                {{ $t('hosts.form.savedPasswordHint') }}
              </div>
            </div>
          </NFormItem>
          <NFormItem v-if="isSshHostForm && (form.authType === 'pem' || form.authType === 'pem_password')" :label="$t('hosts.form.pemKey')">
            <div class="flex w-full flex-col gap-2">
              <div class="flex w-full gap-2">
                <NSelect
                  v-model:value="form.pemKeyId"
                  class="min-w-0 flex-1"
                  :options="pemKeyOptions"
                  clearable
                  :placeholder="$t('hosts.form.pemPlaceholder')"
                  @update:value="resetTestResult"
                >
                  <template #empty>
                    <div class="px-3 py-2 text-center text-xs text-gray-400">
                      {{ $t('hosts.form.pemEmptyInSelect') }}
                    </div>
                  </template>
                </NSelect>
                <NButton
                  secondary
                  :disabled="hostPemKeyLoading"
                  @click="showHostPemKeyCreate = true"
                >
                  {{ $t('hosts.form.addPemKey') }}
                </NButton>
              </div>
              <div v-if="showHostPemKeyCreate" class="space-y-2 rounded border border-gray-800 bg-gray-950/40 p-3">
                <NInput
                  v-model:value="hostPemKeyName"
                  :placeholder="$t('pemKeys.modal.namePlaceholder')"
                  :disabled="hostPemKeyLoading"
                />
                <NInput
                  v-model:value="hostPemKeyContent"
                  type="textarea"
                  :rows="6"
                  :placeholder="$t('hosts.form.pemContentPlaceholder')"
                  :disabled="hostPemKeyLoading"
                  style="font-family: monospace; font-size: 12px;"
                />
                <input
                  ref="hostPemKeyFileInput"
                  type="file"
                  accept=".pem,.key,.ppk,.txt,text/plain"
                  class="hidden"
                  @change="onHostPemKeyFileSelected"
                />
                <div
                  class="rounded border border-dashed px-3 py-3 text-center text-xs transition-colors"
                  :class="hostPemKeyDragOver ? 'border-blue-400 bg-blue-500/10 text-blue-200' : 'border-gray-700 text-gray-400'"
                  @dragenter.prevent="hostPemKeyDragOver = true"
                  @dragover.prevent="hostPemKeyDragOver = true"
                  @dragleave.prevent="hostPemKeyDragOver = false"
                  @drop.prevent="onHostPemKeyFileDrop"
                >
                  <div>{{ $t('hosts.form.pemFileDropHint') }}</div>
                  <NButton size="small" secondary class="mt-2" :disabled="hostPemKeyLoading" @click="triggerHostPemKeyFileSelect">
                    {{ $t('hosts.form.pemFileSelect') }}
                  </NButton>
                </div>
                <NAlert type="warning" :bordered="false" :show-icon="true">
                  {{ $t('pemKeys.modal.warning') }}
                </NAlert>
                <div class="flex justify-end gap-2">
                  <NButton :disabled="hostPemKeyLoading" @click="resetHostPemKeyCreate">
                    {{ $t('common.cancel') }}
                  </NButton>
                  <NButton
                    type="primary"
                    :loading="hostPemKeyLoading"
                    :disabled="!hostPemKeyName.trim() || !hostPemKeyContent.trim()"
                    @click="createPemKeyFromHostForm"
                  >
                    {{ $t('hosts.form.createPemKeyInline') }}
                  </NButton>
                </div>
              </div>
            </div>
          </NFormItem>

          <!-- Testar conexão -->
          <div class="flex items-center gap-3 mb-3">
            <NButton
              :loading="testLoading"
              :disabled="!canRunHostTest"
              @click="runTestConnection"
            >
              ⚡ {{ $t('hosts.test.button') }}
            </NButton>
          </div>

          <div
            v-if="testResult"
            class="mb-3 rounded-lg border p-3 text-sm"
            :class="testResult.success
              ? 'border-green-900/50 bg-green-950/20'
              : 'border-red-900/50 bg-red-950/20'"
          >
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                :style="testResult.success
                  ? 'background:#16a34a22;color:#4ade80;'
                  : 'background:#dc262622;color:#f87171;'"
              >
                {{ testResult.success ? $t('hosts.test.success') : $t('hosts.test.failed') }}
              </span>
              <span class="text-gray-300">{{ testResult.message }}</span>
              <span v-if="testResult.latencyMs !== null" class="text-[11px] text-gray-500">
                {{ testResult.latencyMs }}ms
              </span>
            </div>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <NTag v-if="testRouteLabel(testResult)" size="small" :type="testResult.route === 'direct' ? 'default' : 'success'">
                {{ $t('hosts.test.route') }}: {{ testRouteLabel(testResult) }}
              </NTag>
              <NTag v-if="testResult.agentName" size="small" type="success">
                {{ $t('hosts.test.agent') }}: {{ testResult.agentName }}
              </NTag>
              <NTag v-if="testResult.fallbackUsed" size="small" type="warning">
                {{ $t('hosts.test.fallbackUsed') }}
              </NTag>
              <NTag v-if="testFailureStepLabel(testResult.failureStep)" size="small" type="error">
                {{ $t('hosts.test.failureStepLabel') }}: {{ testFailureStepLabel(testResult.failureStep) }}
              </NTag>
            </div>
          </div>

          <NCollapse
            :expanded-names="hostFormExpandedSections"
            class="host-form-collapse mb-4"
            arrow-placement="right"
            @update:expanded-names="updateHostFormExpandedSections"
          >
            <NCollapseItem :title="$t('hosts.form.sectionOrganization')" name="organization">
              <div data-host-form-section="organization">
              <NAlert type="info" :bordered="false" :show-icon="false" class="mb-3">
                <div class="space-y-1 text-xs">
                  <div class="font-medium text-gray-200">{{ $t('hosts.form.accessAclTitle') }}</div>
                  <div class="text-gray-400">{{ $t('hosts.form.accessAclHint') }}</div>
                </div>
              </NAlert>
              <NFormItem :label="`${$t('hosts.form.inventoryFolder')} *`">
                <NTreeSelect
                  v-model:value="form.inventoryParentId"
                  :options="inventoryFolderTreeSelectOptions"
                  :placeholder="$t('hosts.form.inventoryFolderPlaceholder')"
                  :disabled="inventoryFolderTreeSelectOptions.length === 0"
                  filterable
                  default-expand-all
                >
                  <template #empty>
                    <div class="px-3 py-2 text-center text-xs text-gray-400">
                      {{ $t('hosts.form.noInventoryFolders') }}
                    </div>
                  </template>
                </NTreeSelect>
                <template #feedback>
                  <span>{{ $t('hosts.form.inventoryFolderHint') }}</span>
                  <span v-if="selectedInventoryFolderPath" class="ml-1 text-gray-500">
                    {{ selectedInventoryFolderPath }}
                  </span>
                </template>
              </NFormItem>
              <div class="mb-3 border-t border-gray-800 pt-3">
                <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {{ $t('hosts.form.visualOrganizationTitle') }}
                </div>
                <div class="mt-1 text-[11px] text-gray-500">
                  {{ $t('hosts.form.visualOrganizationHint') }}
                </div>
              </div>
              <NFormItem :label="$t('hosts.form.personalFolder')">
                <div class="flex w-full flex-col gap-2">
                  <div class="flex w-full gap-2">
                    <NSelect
                      v-model:value="form.folderId"
                      class="min-w-0 flex-1"
                      :options="folderSelectOptions"
                      clearable
                      :placeholder="$t('hosts.form.noFolder')"
                    >
                      <template #empty>
                        <div class="px-3 py-2 text-center text-xs text-gray-400">
                          {{ $t('hosts.folder.emptyInSelect') }}
                        </div>
                      </template>
                    </NSelect>
                    <NButton
                      secondary
                      :disabled="hostFolderLoading"
                      @click="showHostFolderCreate = true"
                    >
                      {{ $t('hosts.folder.addFromHost') }}
                    </NButton>
                  </div>
                  <div v-if="showHostFolderCreate" class="flex w-full gap-2">
                    <NInput
                      v-model:value="hostFolderName"
                      :placeholder="$t('hosts.folder.namePlaceholder')"
                      :disabled="hostFolderLoading"
                      @keyup.enter="createFolderFromHostForm"
                    />
                    <NButton
                      type="primary"
                      :loading="hostFolderLoading"
                      :disabled="!hostFolderName.trim()"
                      @click="createFolderFromHostForm"
                    >
                      {{ $t('hosts.folder.createInline') }}
                    </NButton>
                    <NButton :disabled="hostFolderLoading" @click="resetHostFolderCreate">
                      {{ $t('common.cancel') }}
                    </NButton>
                  </div>
                </div>
                <template #feedback>
                  {{ $t('hosts.form.personalFolderHint') }}
                </template>
              </NFormItem>
              <NFormItem :label="$t('hosts.form.description')">
                <NInput
                  v-model:value="form.description"
                  type="textarea"
                  :maxlength="1000"
                  show-count
                  :placeholder="$t('hosts.form.descriptionPlaceholder')"
                  :autosize="{ minRows: 3, maxRows: 6 }"
                />
                <template #feedback>
                  {{ $t('hosts.form.descriptionHint') }}
                </template>
              </NFormItem>
              <NFormItem :label="$t('hosts.form.tags')">
                <div class="flex w-full flex-col gap-2">
                  <div class="flex w-full gap-2">
                    <NSelect
                      v-model:value="form.tagNames"
                      class="min-w-0 flex-1"
                      multiple
                      filterable
                      tag
                      :options="tagSelectOptions"
                      :render-label="renderTagSelectLabel"
                      :placeholder="$t('hosts.form.tagsPlaceholder')"
                      :max-tag-count="8"
                    >
                      <template #empty>
                        <div class="px-3 py-2 text-center text-xs text-gray-400">
                          {{ $t('hosts.form.tagsEmptyInSelect') }}
                        </div>
                      </template>
                    </NSelect>
                    <NButton
                      secondary
                      :disabled="hostTagLoading"
                      @click="showHostTagCreate = true"
                    >
                      {{ $t('hosts.form.addTag') }}
                    </NButton>
                  </div>
                  <NAlert
                    v-if="pendingTagNames.length"
                    type="info"
                    :bordered="false"
                    :show-icon="false"
                  >
                    {{ $t('hosts.form.tagsWillBeCreated', { tags: pendingTagNames.join(', ') }) }}
                  </NAlert>
                  <div v-if="showHostTagCreate" class="flex w-full gap-2">
                    <NInput
                      v-model:value="hostTagName"
                      :placeholder="$t('hosts.form.tagNamePlaceholder')"
                      :disabled="hostTagLoading"
                      @keyup.enter="createTagFromHostForm"
                    />
                    <NButton
                      type="primary"
                      :loading="hostTagLoading"
                      :disabled="!hostTagName.trim()"
                      @click="createTagFromHostForm"
                    >
                      {{ $t('hosts.form.createTagInline') }}
                    </NButton>
                    <NButton :disabled="hostTagLoading" @click="resetHostTagCreate">
                      {{ $t('common.cancel') }}
                    </NButton>
                  </div>
                </div>
              </NFormItem>
              <div
                v-if="startupSnippetAvailable"
                class="mb-3 rounded border border-gray-800 bg-[#111113] p-3"
                data-host-startup-snippet-section="true"
              >
                <div class="mb-3 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div class="min-w-0">
                    <div class="text-xs font-semibold uppercase tracking-wide text-gray-400">
                      {{ $t('hosts.form.startupSnippetTitle') }}
                    </div>
                    <div class="mt-1 text-[11px] leading-relaxed text-gray-500">
                      {{ $t('hosts.form.startupSnippetHint') }}
                    </div>
                  </div>
                  <NTag
                    v-if="startupSnippetSelected"
                    size="small"
                    type="info"
                    class="shrink-0"
                  >
                    {{ startupSnippetSelected.name }}
                  </NTag>
                </div>
                <div class="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
                  <NFormItem :label="$t('hosts.form.startupSnippetMode')" :show-feedback="false">
                    <NSelect
                      v-model:value="form.startupSnippetMode"
                      :options="startupSnippetModeOptions"
                      data-host-startup-snippet-mode="true"
                    />
                  </NFormItem>
                  <NFormItem :label="$t('hosts.form.startupSnippet')" :show-feedback="false">
                    <NSelect
                      v-model:value="form.startupSnippetId"
                      :options="startupSnippetOptions"
                      :disabled="(form.startupSnippetMode ?? 'disabled') === 'disabled'"
                      :placeholder="$t('hosts.form.startupSnippetPlaceholder')"
                      filterable
                      clearable
                      data-host-startup-snippet-select="true"
                    >
                      <template #empty>
                        <div class="px-3 py-2 text-center text-xs text-gray-400">
                          {{ $t('hosts.form.startupSnippetEmpty') }}
                        </div>
                      </template>
                    </NSelect>
                  </NFormItem>
                </div>
                <div class="mt-2 text-[11px] leading-relaxed text-gray-500">
                  {{ form.startupSnippetMode === 'auto' ? $t('hosts.form.startupSnippetAutoHint') : $t('hosts.form.startupSnippetSuggestHint') }}
                </div>
              </div>
              </div>
            </NCollapseItem>

            <NCollapseItem :title="$t('hosts.form.sectionRouting')" name="routing">
              <div data-host-form-section="routing">
              <NFormItem :label="$t('hosts.form.connectionMode')">
                <div class="w-full">
                  <NSelect
                    v-model:value="form.connectionMode"
                    :options="connectionModeOptions"
                    :render-label="renderConnectionModeLabel"
                    @update:value="resetTestResult"
                  />
                  <NAlert
                    v-if="formAgentRouteStatus"
                    class="mt-2"
                    :type="formAgentRouteStatus.type"
                    :bordered="false"
                    :show-icon="false"
                  >
                    {{ formAgentRouteStatus.tooltip }}
                  </NAlert>
                </div>
              </NFormItem>
              <NFormItem
                v-if="form.connectionMode === 'private_access_connector'"
                :label="$t('hosts.form.privateAccessConnector')"
              >
                <div class="w-full">
                  <NSelect
                    v-model:value="form.privateAccessConnectorId"
                    :options="privateAccessConnectorOptions"
                    clearable
                    :placeholder="$t('hosts.form.privateAccessConnectorAuto')"
                    @update:value="resetTestResult"
                  />
                  <div class="mt-1 text-xs text-gray-500">
                    {{ $t('hosts.form.privateAccessConnectorHint') }}
                  </div>
                </div>
              </NFormItem>
              <NFormItem v-if="isSshHostForm" :label="$t('hosts.form.bastion')">
                <div class="w-full">
                  <NSelect
                    v-model:value="form.bastionId"
                    :options="bastionOptions"
                    clearable
                    :placeholder="$t('hosts.form.noBastion')"
                    @update:value="resetTestResult"
                  />
                  <div class="mt-1 text-xs text-gray-500">
                    {{ $t('hosts.form.bastionHint') }}
                  </div>
                </div>
              </NFormItem>
              </div>
            </NCollapseItem>
          </NCollapse>

          <!-- Hint pós-criação (só no modo criar) -->
          <div v-if="!editingHostId" class="mb-4 rounded-lg border border-gray-800 bg-[#111113] p-3">
            <p class="text-xs text-gray-500">{{ $t('hosts.form.afterCreateHint') }}</p>
          </div>

          <!-- ── Opções complementares ── -->
          <NCollapse
            :expanded-names="hostFormExpandedSections"
            class="host-form-collapse"
            arrow-placement="right"
            @update:expanded-names="updateHostFormExpandedSections"
          >
            <NCollapseItem v-if="editingHostId !== null" :title="$t('hosts.forwardings.title')" name="forwardings">
              <div data-host-form-section="forwardings">
          <div class="rounded-lg border border-gray-800 bg-[#111113] p-3">
            <div class="mb-2 flex items-center justify-between gap-3">
              <div class="text-xs font-semibold text-gray-300">{{ $t('hosts.forwardings.title') }}</div>
              <NButton v-if="canManageForwardings" size="tiny" @click="openHostForwardings(editingHostId, editingHost?.name ?? '')">{{ $t('forwardingsPage.addTunnel') }}</NButton>
            </div>
            <div v-if="editingHostForwardings.length === 0" class="text-xs text-gray-500">
              {{ $t('hosts.forwardings.empty') }}
            </div>
            <div v-else class="space-y-2">
              <div
                v-for="forwarding in editingHostForwardings"
                :key="`host-forwarding-${forwarding.id}`"
                class="rounded border border-gray-800 bg-[#0d0d0f] px-2.5 py-2"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="font-mono text-[11px] text-blue-300">
                    {{ forwarding.bindAddress }}:{{ forwarding.localPort }}
                    <span class="text-gray-600 mx-1">→</span>
                    {{ forwarding.remoteHost }}:{{ forwarding.remotePort }}
                  </div>
                  <div class="flex items-center gap-1">
                    <NButton
                      v-if="forwarding.webEnabled"
                      size="tiny"
                      quaternary
                      type="info"
                      @click="openHostForwardingWebAccess(forwarding)"
                    >
                      {{ $t('tunnels.openWeb') }}
                    </NButton>
                    <NButton v-if="canManageForwardings" size="tiny" quaternary @click="openEditHostForwarding(forwarding)">{{ $t('common.edit') }}</NButton>
                    <NButton v-if="canManageForwardings" size="tiny" quaternary type="error" @click="confirmDeleteHostForwarding(forwarding)">{{ $t('common.delete') }}</NButton>
                  </div>
                </div>
                <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-gray-400">
                    <NSwitch
                      :disabled="!canManageForwardings"
                      :value="forwarding.autoStart"
                      size="small"
                      @update:value="() => toggleHostForwardingAutoStart(forwarding)"
                    />
                    <span>{{ $t('tunnels.autoStart') }}</span>
                  </span>
                  <span
                    v-if="forwarding.autoStart"
                    class="inline-flex items-center rounded px-1.5 py-0.5"
                    style="background:rgba(34,197,94,0.15); color:#4ade80;"
                  >{{ $t('tunnels.autoStart') }}</span>
                  <span
                    v-if="forwarding.webEnabled"
                    class="inline-flex items-center rounded px-1.5 py-0.5"
                    style="background:rgba(59,130,246,0.16); color:#93c5fd;"
                  >{{ $t('tunnels.webEnabledBadge', { protocol: forwarding.webProtocol.toUpperCase() }) }}</span>
                  <span v-if="forwarding.description" class="text-gray-400">{{ forwarding.description }}</span>
                </div>
              </div>
            </div>
          </div>
              </div>
            </NCollapseItem>

            <NCollapseItem :title="$t('hosts.associatedLinks.title')" name="associatedLinks">
              <div data-host-form-section="associatedLinks">
          <div class="rounded-lg border border-gray-800 bg-[#111113] p-3">
            <div class="mb-2 flex items-center justify-between gap-3">
              <div>
                <div class="text-xs font-semibold text-gray-300">{{ $t('hosts.associatedLinks.title') }}</div>
                <div class="mt-1 text-[11px] text-gray-500">{{ $t('hosts.associatedLinks.hint') }}</div>
              </div>
              <NButton size="small" type="primary" secondary @click="addAssociatedLink">{{ $t('hosts.associatedLinks.add') }}</NButton>
            </div>

            <div v-if="editingHostId !== null && opActive" class="mb-3 rounded border border-gray-800 bg-[#0d0d0f] p-3">
              <div class="flex items-center justify-between gap-2">
                <div class="text-xs font-semibold text-gray-300">{{ $t('hosts.associatedLinks.importTitle') }}</div>
                <NButton size="tiny" quaternary @click="showOpImportInstructions = !showOpImportInstructions">
                  {{ showOpImportInstructions ? $t('hosts.associatedLinks.hideInstructions') : $t('hosts.associatedLinks.showInstructions') }}
                </NButton>
              </div>
              <div class="mt-1 text-[11px] text-gray-500">{{ $t('hosts.associatedLinks.importHint') }}</div>

              <div v-if="showOpImportInstructions" class="mt-3 rounded border border-gray-800 bg-[#111113] p-3">
                <div class="text-[11px] font-semibold text-gray-300 mb-2">{{ $t('hosts.associatedLinks.importHowTitle') }}</div>
                <ol class="list-decimal pl-4 space-y-1 text-[11px] text-gray-400">
                  <li>{{ $t('hosts.associatedLinks.importHow1') }}</li>
                  <li>{{ $t('hosts.associatedLinks.importHow2') }}</li>
                  <li>{{ $t('hosts.associatedLinks.importHow3') }}</li>
                </ol>
                <div class="mt-3 text-[11px] font-semibold text-gray-300">{{ $t('hosts.associatedLinks.importJsonTitle') }}</div>
                <pre v-pre class="mt-2 overflow-x-auto rounded border border-gray-800 bg-[#0b0b0d] p-3 text-[11px] text-blue-300">{
  "links": [
    {
      "label": "Pulse Admin",
      "urlTemplate": "http://{{HOST.IP}}:8080/Pulseadmin"
    },
    {
      "label": "Grafana",
      "url": "https://monitoramento.interno/host/{{HOST.NAME}}"
    }
  ]
}</pre>
              </div>
              <div class="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <NInput
                  v-model:value="associatedLinksOnePasswordRef"
                  :placeholder="$t('hosts.associatedLinks.importPlaceholder')"
                />
                <div class="flex flex-wrap gap-2">
                  <NButton
                    :loading="associatedLinksOnePasswordPreviewLoading"
                    :disabled="!associatedLinksOnePasswordRef.trim()"
                    @click="previewAssociatedLinksFromOnePassword"
                  >
                    {{ $t('hosts.associatedLinks.importPreviewAction') }}
                  </NButton>
                  <NButton
                    type="primary"
                    :loading="associatedLinksOnePasswordLoading"
                    :disabled="!associatedLinksOnePasswordRef.trim()"
                    @click="importAssociatedLinksFromOnePassword"
                  >
                    {{ $t('hosts.associatedLinks.importAction') }}
                  </NButton>
                </div>
              </div>

              <div v-if="associatedLinksOnePasswordPreviewLoading" class="mt-3">
                <NSpin size="small" />
              </div>

              <div v-else-if="associatedLinksOnePasswordPreview.length" class="mt-3 rounded border border-gray-800 bg-[#111113] p-3">
                <div class="text-[11px] font-semibold text-gray-300">
                  {{ $t('hosts.associatedLinks.importPreviewTitle', { count: associatedLinksOnePasswordPreview.length }) }}
                </div>
                <div class="mt-2 space-y-2">
                  <div
                    v-for="(previewLink, previewIndex) in associatedLinksOnePasswordPreview"
                    :key="`associated-link-preview-${previewIndex}`"
                    class="rounded border border-gray-800 bg-[#0d0d0f] px-2.5 py-2"
                  >
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <div class="text-xs font-medium text-gray-200">{{ previewLink.label }}</div>
                      <NTag size="small" :bordered="false">
                        {{ previewLink.openMode === 'same_tab' ? $t('hosts.associatedLinks.openModeSameTab') : $t('hosts.associatedLinks.openModeNewTab') }}
                      </NTag>
                    </div>
                    <div class="mt-2 overflow-x-auto rounded bg-[#0b0b0d] px-2 py-1.5 font-mono text-[11px] text-gray-300">
                      {{ hostLinkPreview(previewLink) }}
                    </div>
                  </div>
                </div>
              </div>

              <CollapsibleSection
                v-if="associatedLinksOnePasswordPreviewError"
                class="mt-3"
                :title="$t('hosts.associatedLinks.importFailureDetailsTitle')"
                body-class="mt-2 !bg-transparent"
              >
                <div class="overflow-x-auto rounded border border-gray-800 bg-[#0b0b0d] p-3 font-mono text-[11px] text-red-200 whitespace-pre-wrap break-words">
                  {{ associatedLinksOnePasswordPreviewError }}
                </div>
              </CollapsibleSection>
            </div>

            <div v-if="!(form.associatedLinks?.length)" class="text-xs text-gray-500">
              {{ $t('hosts.associatedLinks.empty') }}
            </div>

            <div v-else class="space-y-3">
              <div
                v-for="(link, index) in form.associatedLinks"
                :key="`associated-link-form-${index}`"
                class="rounded border border-gray-800 bg-[#0d0d0f] p-3"
              >
                <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px]">
                  <NFormItem :label="$t('hosts.associatedLinks.label')" :show-feedback="false">
                    <NInput v-model:value="link.label" :placeholder="$t('hosts.associatedLinks.labelPlaceholder')" />
                  </NFormItem>
                  <NFormItem :label="$t('hosts.associatedLinks.openMode')" :show-feedback="false">
                    <NSelect v-model:value="link.openMode" :options="associatedLinkOpenModeOptions" />
                  </NFormItem>
                </div>

                <NFormItem :label="$t('hosts.associatedLinks.urlTemplate')" :show-feedback="false">
                  <div class="w-full">
	                    <NInput
	                      v-model:value="link.urlTemplate"
	                      type="textarea"
	                      :autosize="{ minRows: 2, maxRows: 4 }"
	                      :placeholder="$t('hosts.associatedLinks.urlPlaceholder')"
	                      @focus="showHostLinkVariables"
	                      @click="showHostLinkVariables"
	                      @blur="hideHostLinkVariablesSoon"
	                    />
                    <div v-if="showHostLinkTemplateVariables" class="mt-2 flex flex-wrap gap-1.5">
                      <NTag v-for="variable in hostLinkTemplateVariables" :key="`host-link-var-${variable}`" size="small" type="info">
                        {{ variable }}
                      </NTag>
                    </div>
                  </div>
                </NFormItem>

                <div v-if="linkVariableErrors(link).length" class="mb-2">
                  <NAlert type="warning" :show-icon="false">
                    {{ $t('hosts.associatedLinks.unknownVariables', { variables: linkVariableErrors(link).join(', ') }) }}
                  </NAlert>
                </div>
                <div v-else-if="linkValidation(link).invalidScheme" class="mb-2">
                  <NAlert type="warning" :show-icon="false">
                    {{ $t('hosts.associatedLinks.invalidScheme') }}
                  </NAlert>
                </div>
                <div v-else-if="linkValidation(link).invalidResolvedUrl" class="mb-2">
                  <NAlert type="warning" :show-icon="false">
                    {{ $t('hosts.associatedLinks.invalidResolvedUrl') }}
                  </NAlert>
                </div>

                <div class="rounded border border-gray-800 bg-[#111113] px-2.5 py-2">
                  <div class="text-[11px] text-gray-500">{{ $t('hosts.associatedLinks.preview') }}</div>
                  <div class="mt-1 break-all font-mono text-[11px] text-blue-300">
                    {{ link.urlTemplate ? hostLinkPreview(link) : '—' }}
                  </div>
                </div>

                <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <NTag size="small" :type="link.sourceType === 'manual' ? 'default' : 'info'">
                    {{ associatedLinkSourceTypeLabel(link) }}
                  </NTag>
                  <NTag size="small" :type="link.sourceStatus === 'error' ? 'error' : link.sourceStatus === 'stale' ? 'warning' : 'success'">
                    {{ associatedLinkSourceStatusLabel(link) }}
                  </NTag>
                  <span v-if="associatedLinkProviderLabel(link)" class="text-gray-400">
                    {{ associatedLinkProviderLabel(link) }}
                  </span>
                </div>

                <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <NSwitch v-model:value="link.enabled" size="small" />
                    <span class="text-xs text-gray-400">{{ link.enabled ? $t('common.enabled') : $t('common.disabled') }}</span>
                  </div>
                  <div class="flex gap-2">
                    <NButton size="tiny" quaternary :disabled="index === 0" :aria-label="$t('hosts.associatedLinks.moveUp')" @click="moveAssociatedLink(index, -1)">↑</NButton>
                    <NButton size="tiny" quaternary :disabled="index === (form.associatedLinks?.length ?? 0) - 1" :aria-label="$t('hosts.associatedLinks.moveDown')" @click="moveAssociatedLink(index, 1)">↓</NButton>
                    <NButton size="tiny" quaternary type="error" @click="removeAssociatedLink(index)">
                      {{ $t('common.delete') }}
                    </NButton>
                  </div>
                </div>
              </div>
            </div>
          </div>
              </div>
            </NCollapseItem>

            <NCollapseItem v-if="editingHostId !== null" :title="$t('hostLinks.title')" name="hostLinks">
              <div data-host-form-section="hostLinks">
          <div class="rounded-lg border border-gray-800 bg-[#111113] p-3">
            <div class="text-xs font-semibold text-gray-300 mb-2">{{ $t('hostLinks.title') }}</div>
            <p class="mb-3 text-xs text-gray-500">{{ $t('hostLinks.cardHint') }}</p>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div>
                <div class="text-xs text-gray-500 mb-1">{{ $t('hostLinks.expiresIn') }}</div>
                <NSelect
                  v-model:value="hostLinkExpiryMinutes"
                  :options="hostLinkExpirySelectOptions"
                />
              </div>
              <NButton :loading="hostLinkLoading" @click="generateHostLink">
                {{ $t('hostLinks.generate') }}
              </NButton>
            </div>
            <p class="mt-2 text-xs text-gray-500">{{ $t('hostLinks.hint') }}</p>
            <div v-if="canManage" class="mt-3 border-t border-gray-800 pt-3">
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <p class="text-xs text-gray-500">{{ $t('hostLinks.jitHint') }}</p>
                <NButton secondary type="warning" :loading="hostLinkLoading" :disabled="!hostLinkJitEnabled" @click="generateJitHostLink">
                  {{ $t('hostLinks.generateJit') }}
                </NButton>
              </div>
              <p v-if="!hostLinkJitEnabled" class="mt-2 text-xs text-amber-400">
                {{ $t('hostLinks.jitDisabled') }}
              </p>
            </div>
            <div v-if="latestHostLink" class="mt-3 rounded border border-gray-800 bg-[#0d0d0f] p-2.5">
              <div class="text-[11px] text-gray-500 mb-1">
                {{ $t('hostLinks.expiresAt', { date: formatHostKeyTimestamp(latestHostLink.expiresAt) }) }}
              </div>
              <div class="font-mono text-[11px] break-all text-blue-300">{{ latestHostLink.url }}</div>
              <div class="mt-2 flex justify-end">
                <NButton size="small" quaternary @click="copyLatestHostLink">{{ $t('hostLinks.copy') }}</NButton>
              </div>
            </div>
            <div class="mt-3 rounded border border-gray-800 bg-[#0d0d0f] p-2.5">
              <div class="mb-2 flex items-center justify-between gap-3">
                <div class="text-xs font-semibold text-gray-300">{{ $t('hostLinks.recentTitle') }}</div>
                <NButton size="tiny" quaternary :loading="hostLinksLoading" @click="editingHostId !== null && loadHostLinks(editingHostId)">
                  {{ $t('common.refresh') }}
                </NButton>
              </div>
              <div v-if="hostLinksLoading" class="py-3 text-center">
                <NSpin size="small" />
              </div>
              <div v-else-if="hostLinks.length === 0" class="text-xs text-gray-500">
                {{ $t('hostLinks.empty') }}
              </div>
              <div v-else class="space-y-2">
                <div
                  v-for="link in hostLinks"
                  :key="link.id"
                  class="flex flex-col gap-2 rounded border border-gray-800 bg-[#111113] p-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <NTag size="small" :type="link.type === 'public_once' ? 'warning' : 'info'">
                        {{ $t(`hostLinks.types.${link.type}`) }}
                      </NTag>
                      <NTag size="small" :type="link.status === 'active' ? 'success' : link.status === 'revoked' ? 'error' : 'default'">
                        {{ $t(`hostLinks.status.${link.status}`) }}
                      </NTag>
                      <NTag v-if="link.pinRequired" size="small" type="warning">
                        {{ link.pin ? $t('hostLinks.pinValue', { pin: link.pin }) : $t('hostLinks.pinRequiredBadge') }}
                      </NTag>
                      <NTag v-if="link.activeSessions > 0" size="small" type="success">
                        {{ $t('hostLinks.activeSessions', { count: link.activeSessions }) }}
                      </NTag>
                    </div>
                    <div class="mt-1 text-[11px] text-gray-500">
                      {{ $t('hostLinks.createdBy', { user: link.createdBy.name, date: formatHostKeyTimestamp(link.createdAt) }) }}
                    </div>
                    <div class="text-[11px] text-gray-500">
                      {{ $t('hostLinks.expiresAt', { date: formatHostKeyTimestamp(link.expiresAt) }) }}
                    </div>
                  </div>
                  <NButton
                    size="small"
                    secondary
                    type="error"
                    :disabled="link.status === 'revoked' || link.status === 'expired'"
                    :loading="revokingHostLinkId === link.id"
                    @click="revokeHostLink(link)"
                  >
                    {{ $t('hostLinks.revoke') }}
                  </NButton>
                </div>
              </div>
            </div>
          </div>
              </div>
            </NCollapseItem>

            <NCollapseItem v-if="editingHost !== null" :title="$t('hosts.hostKey.title')" name="hostKey">
              <div data-host-form-section="hostKey">
          <div class="rounded-lg border border-gray-800 bg-[#111113] p-3">
            <div class="flex items-center justify-between gap-3 mb-2">
              <div class="text-xs font-semibold text-gray-300">{{ $t('hosts.hostKey.title') }}</div>
              <NTag :type="editingHostKeyStatus === 'trusted' ? 'success' : 'warning'" size="small">
                {{ editingHostKeyStatus === 'trusted' ? $t('hosts.hostKey.statusTrusted') : $t('hosts.hostKey.statusMissing') }}
              </NTag>
            </div>

            <div class="space-y-2 text-xs">
              <div>
                <div class="text-gray-500 mb-1">{{ $t('hosts.hostKey.fingerprint') }}</div>
                <div class="font-mono break-all text-gray-200">
                  {{ editingHost?.trustedHostKeyFingerprint ?? '—' }}
                </div>
              </div>
              <div>
                <div class="text-gray-500 mb-1">{{ $t('hosts.hostKey.lastVerifiedAt') }}</div>
                <div class="text-gray-300">{{ formatHostKeyTimestamp(editingHost?.trustedHostKeyVerifiedAt) }}</div>
              </div>
            </div>

            <div class="mt-3 border-t border-gray-800 pt-3">
              <div class="text-xs font-semibold text-gray-300 mb-2">{{ $t('hosts.hostKey.historyTitle') }}</div>
              <NSpin :show="hostKeyHistoryLoading">
                <div v-if="!editingHostKeyHistory.length" class="text-xs text-gray-500">
                  {{ $t('hosts.hostKey.historyEmpty') }}
                </div>
                <div v-else class="space-y-2">
                  <div
                    v-for="entry in editingHostKeyHistory"
                    :key="`${entry.action}-${entry.timestamp}`"
                    class="rounded border border-gray-800 bg-[#0d0d0f] px-2.5 py-2"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <NTag :type="hostKeyHistoryType(entry.action)" size="small">
                        {{ hostKeyHistoryLabel(entry.action) }}
                      </NTag>
                      <span class="text-[11px] text-gray-500">{{ formatHostKeyTimestamp(entry.timestamp) }}</span>
                    </div>
                    <div class="mt-1 text-xs text-gray-300">
                      {{ $t('hosts.hostKey.byUser', { user: entry.adminName }) }}
                    </div>
                    <div class="mt-2 space-y-1 text-[11px]">
                      <div>
                        <span class="text-gray-500">{{ $t('hosts.hostKey.previousFingerprint') }}:</span>
                        <span class="ml-1 font-mono break-all text-gray-300">{{ hostKeyHistoryValue(entry.previousFingerprint) }}</span>
                      </div>
                      <div>
                        <span class="text-gray-500">{{ $t('hosts.hostKey.nextFingerprint') }}:</span>
                        <span class="ml-1 font-mono break-all text-gray-300">{{ hostKeyHistoryValue(entry.nextFingerprint) }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </NSpin>
            </div>
          </div>
              </div>
            </NCollapseItem>

            <NCollapseItem v-if="opActive && isSshHostForm" :title="$t('hosts.form.sectionAdvanced')" name="advanced">
              <div data-host-form-section="advanced">
                <NFormItem :label="$t('hosts.form.onepasswordRef')">
                  <NInput
                    v-model:value="form.onePasswordRef"
                    :placeholder="$t('hosts.form.opRefPlaceholder')"
                    clearable
                    style="font-family: monospace;"
                    @input="resetTestResult"
                  />
                </NFormItem>
              </div>
            </NCollapseItem>
          </NCollapse>

        </NForm>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton @click="showHostModal = false">{{ $t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="hostModalLoading" @click="submitHost">
            {{ editingHostId ? $t('common.save') : $t('common.create') }}
          </NButton>
        </div>
      </template>
    </NModal>

    <!-- ── Modal: pasta ── -->
    <NModal v-model:show="showFolderModal" preset="card" :title="folderModalTitle" style="width:360px">
      <NFormItem :label="$t('hosts.folder.nameLabel')">
        <NInput v-model:value="folderName" :placeholder="$t('hosts.folder.namePlaceholder')" @keyup.enter="saveFolder" />
      </NFormItem>
      <div class="flex justify-end gap-2 mt-2">
        <NButton @click="showFolderModal = false">{{ $t('common.cancel') }}</NButton>
        <NButton type="primary" :loading="folderLoading" @click="saveFolder">{{ $t('common.save') }}</NButton>
      </div>
    </NModal>

    <!-- ── Modal: pasta corporativa ── -->
    <NModal v-model:show="showInventoryFolderModal" preset="card" :title="inventoryFolderModalTitle" style="width:380px">
      <NFormItem :label="$t('hosts.folder.nameLabel')">
        <NInput
          v-model:value="inventoryFolderName"
          :placeholder="$t('hosts.inventoryFolders.createPlaceholder')"
          @keyup.enter="saveInventoryFolder"
        />
      </NFormItem>
      <div class="flex justify-end gap-2 mt-2">
        <NButton @click="showInventoryFolderModal = false">{{ $t('common.cancel') }}</NButton>
        <NButton type="primary" :loading="inventoryFolderLoading" @click="saveInventoryFolder">{{ $t('common.save') }}</NButton>
      </div>
    </NModal>

    <!-- ── Import modal ─────────────────────────────────────────────────── -->
    <ImportHostsModal
      v-if="showImport"
      @close="showImport = false"
      @imported="refreshHostData()"
    />

    <HostBulkActionModal
      v-if="showBulkActionModal"
      :show="showBulkActionModal"
      :selection="bulkActionSelection"
      :selected-count="bulkSelectedCount"
      :bastions="bastions"
      :pem-keys="pemKeys"
      :tags="allTags"
      @close="closeBulkActionModal"
      @applied="onBulkApplied"
    />

    <HostBulkActionHistoryDrawer
      v-if="showBulkActionHistory"
      :show="showBulkActionHistory"
      @close="showBulkActionHistory = false"
      @rolled-back="refreshHostData"
    />

    <NModal
      v-model:show="showForwardingModal"
      preset="card"
      style="width: 480px"
      :title="$t('forwardingsPage.editTitle')"
    >
      <div class="space-y-3">
        <div>
          <p class="text-xs text-gray-400 mb-1">{{ $t('tunnels.description') }} ({{ $t('snippetsPage.optional') }})</p>
          <NInput v-model:value="forwardingForm.description" :placeholder="$t('tunnels.descriptionHint')" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <p class="text-xs text-gray-400 mb-1">{{ $t('tunnels.localPort') }}</p>
            <NInputNumber v-model:value="forwardingForm.localPort" :min="1024" :max="65535" style="width:100%" />
          </div>
          <div>
            <p class="text-xs text-gray-400 mb-1">{{ $t('tunnels.remoteHost') }}</p>
            <NInput v-model:value="forwardingForm.remoteHost" :placeholder="$t('tunnels.remoteHostPlaceholder')" />
          </div>
          <div>
            <p class="text-xs text-gray-400 mb-1">{{ $t('tunnels.remotePort') }}</p>
            <NInputNumber v-model:value="forwardingForm.remotePort" :min="1" :max="65535" style="width:100%" />
          </div>
        </div>
        <div class="rounded border border-gray-800 bg-[#111113] p-3 space-y-3">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-xs text-gray-300">{{ $t('tunnels.autoStart') }}</div>
              <div class="text-xs text-gray-500">{{ $t('tunnels.autoStartHint') }}</div>
            </div>
            <NSwitch v-model:value="forwardingForm.autoStart" size="small" />
          </div>
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-xs text-gray-300">{{ $t('tunnels.webEnabled') }}</div>
              <div class="text-xs text-gray-500">{{ $t('tunnels.webEnabledHint') }}</div>
            </div>
            <NSwitch v-model:value="forwardingForm.webEnabled" size="small" />
          </div>
          <div v-if="forwardingForm.webEnabled" class="grid grid-cols-2 gap-3">
            <div>
              <p class="text-xs text-gray-400 mb-1">{{ $t('tunnels.webProtocol') }}</p>
              <NSelect
                v-model:value="forwardingForm.webProtocol"
                :options="[
                  { label: 'HTTP', value: 'http' },
                  { label: 'HTTPS', value: 'https' },
                ]"
              />
            </div>
          </div>
        </div>
        <div class="rounded border border-gray-800 bg-[#111113] p-3">
          <button
            type="button"
            class="flex w-full items-center justify-between text-left"
            @click="showForwardingAdvancedOptions = !showForwardingAdvancedOptions"
          >
            <span class="text-xs font-medium text-gray-300">{{ $t('tunnels.advancedTitle') }}</span>
            <span class="text-xs text-gray-500">{{ showForwardingAdvancedOptions ? '▲' : '▼' }}</span>
          </button>
          <div v-if="showForwardingAdvancedOptions" class="mt-3">
            <p class="text-xs text-gray-400 mb-1">{{ $t('tunnels.bindAddress') }}</p>
            <NSelect
              v-model:value="forwardingForm.bindAddress"
              :options="[
                { label: '127.0.0.1', value: '127.0.0.1' },
                { label: '0.0.0.0', value: '0.0.0.0' },
              ]"
            />
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <NButton @click="showForwardingModal = false">{{ $t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="forwardingModalLoading" @click="submitHostForwarding">
            {{ $t('common.save') }}
          </NButton>
        </div>
      </div>
    </NModal>

    <!-- ── Modal: mover host para pasta ── -->
    <NModal
      :show="!!folderMoveHost"
      preset="card"
      :title="$t('hosts.moveTo')"
      style="width: 340px"
      @update:show="(v) => { if (!v) folderMoveHost = null }"
    >
      <NSelect
        :value="folderMoveSelectedId ?? 0"
        :options="folderMoveOptions"
        :placeholder="$t('hosts.moveTo')"
        @update:value="(v) => folderMoveSelectedId = Number(v) > 0 ? Number(v) : null"
      />
      <div class="mt-4 flex justify-end gap-2">
        <NButton @click="folderMoveHost = null">{{ $t('common.cancel') }}</NButton>
        <NButton type="primary" @click="confirmFolderMove">{{ $t('common.save') }}</NButton>
      </div>
    </NModal>

    <InventoryAclDrawer
      :show="permissionsHost !== null || permissionsInventoryNode !== null"
      :host-id="permissionsHost?.id ?? null"
      :inventory-node-id="permissionsInventoryNode?.id ?? null"
      :item-name="permissionsHost?.name ?? permissionsInventoryNode?.name ?? ''"
      @close="() => { permissionsHost = null; permissionsInventoryNode = null }"
    />

  </div>
</template>

<style scoped>
/* ─── Modal de host ─────────────────────────────────────────────────────── */
.host-form-collapse :deep(.n-collapse-item) {
  border: 1px solid var(--na-border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.025);
}
.host-form-collapse :deep(.n-collapse-item + .n-collapse-item) {
  margin-top: 8px;
}
.host-form-collapse :deep(.n-collapse-item__header) {
  padding: 10px 12px;
}
.host-form-collapse :deep(.n-collapse-item__content-inner) {
  padding: 0 12px 12px;
}

/* ─── Transição home ↔ lista ─────────────────────────────────────────────── */
.host-panel-enter-active {
  transition: opacity 200ms ease-out, transform 200ms ease-out;
}
.host-panel-leave-active {
  transition: opacity 110ms ease-in, transform 110ms ease-in;
}
.host-panel-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
.host-panel-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
@media (prefers-reduced-motion: reduce) {
  .host-panel-enter-active,
  .host-panel-leave-active {
    transition: none;
  }
  .host-panel-enter-from,
  .host-panel-leave-to {
    opacity: 1;
    transform: none;
  }
}

/* ─── Stagger de cards (primeiros 8; restantes entram sem delay) ─────────── */
@keyframes host-card-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0);   }
}
.hosts-grid :deep(.n-grid-item:nth-child(1))   { animation: host-card-in 180ms ease-out both 0ms;   }
.hosts-grid :deep(.n-grid-item:nth-child(2))   { animation: host-card-in 180ms ease-out both 30ms;  }
.hosts-grid :deep(.n-grid-item:nth-child(3))   { animation: host-card-in 180ms ease-out both 60ms;  }
.hosts-grid :deep(.n-grid-item:nth-child(4))   { animation: host-card-in 180ms ease-out both 90ms;  }
.hosts-grid :deep(.n-grid-item:nth-child(5))   { animation: host-card-in 180ms ease-out both 120ms; }
.hosts-grid :deep(.n-grid-item:nth-child(6))   { animation: host-card-in 180ms ease-out both 150ms; }
.hosts-grid :deep(.n-grid-item:nth-child(7))   { animation: host-card-in 180ms ease-out both 180ms; }
.hosts-grid :deep(.n-grid-item:nth-child(8))   { animation: host-card-in 180ms ease-out both 180ms; }
.hosts-grid :deep(.n-grid-item:nth-child(n+9)) { animation: host-card-in 180ms ease-out both 180ms; }

.host-icon-button {
  width: 34px;
  min-width: 34px;
  padding: 0;
}
.host-icon {
  display: block;
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}

.host-forwarding-icon {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
}

.host-lite-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  height: 18px;
  padding: 0 7px;
  border-radius: 3px;
  border: 1px solid transparent;
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
  white-space: nowrap;
}

.host-lite-tag--default {
  color: #d1d5db;
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.09);
}

.host-lite-tag--info {
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.14);
  border-color: rgba(59, 130, 246, 0.24);
}

.host-lite-tag--success {
  color: #86efac;
  background: rgba(34, 197, 94, 0.14);
  border-color: rgba(34, 197, 94, 0.24);
}

.host-lite-tag--warning {
  color: #fde68a;
  background: rgba(245, 158, 11, 0.14);
  border-color: rgba(245, 158, 11, 0.24);
}

.host-lite-tag--error {
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.14);
  border-color: rgba(239, 68, 68, 0.24);
}

.host-card-menu-button {
  width: 30px;
  min-width: 30px;
  padding: 0;
  font-size: 18px;
  line-height: 1;
}

.host-card-menu-button--fixed {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
}

.host-favorite-inline-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(75 85 99);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease, transform 0.15s ease;
}

.host-favorite-inline-button.is-favorite,
.host-favorite-inline-button:hover {
  color: rgb(252 211 77);
}

.host-favorite-inline-button:hover {
  background: rgba(251, 191, 36, 0.12);
  transform: translateY(-1px);
}

.host-favorite-inline-button:focus-visible {
  outline: 2px solid rgb(251 191 36);
  outline-offset: 2px;
}

/* ─── Sidebar ───────────────────────────────────────────────────────────── */
.sidebar-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  border-radius: 4px;
  font-size: 13px;
  color: #9ca3af;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
}
.sidebar-item:hover {
  background: #27272a;
  color: #e5e7eb;
}
.sidebar-item--active {
  background: #3f3f46;
  color: #ffffff;
}
.sidebar-item--drop {
  background: #1e3a5f !important;
  color: #60a5fa !important;
  outline: 1px dashed #3b82f6;
  outline-offset: -1px;
}
.sidebar-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: #3f3f46;
  color: #9ca3af;
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
}
.sidebar-item--active .sidebar-badge {
  background: #52525b;
  color: #e5e7eb;
}
.sidebar-help-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: #27272a;
  color: #a1a1aa;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  text-transform: none;
  flex-shrink: 0;
}
.sidebar-panel-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
}
.sidebar-panel-row .sidebar-panel-toggle {
  min-width: 0;
}
.sidebar-panel-toggle {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #71717a;
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  transition: background 0.12s, color 0.12s;
}
.sidebar-panel-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  color: #a1a1aa;
  font-size: 10px;
  line-height: 1;
}
.sidebar-panel-title {
  min-width: 0;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar-panel-toggle:hover {
  background: #27272a;
  color: #d4d4d8;
}
.sidebar-action {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  width: 28px;
  height: 28px;
  border-radius: 3px;
  border: none;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
  font-size: 11px;
  transition: background 0.1s, color 0.1s;
}
.sidebar-action:hover {
  background: #3f3f46;
  color: #e5e7eb;
}
.inventory-sidebar-tree {
  --n-node-height: 26px;
  --n-font-size: 12px;
  --n-node-text-color: #9ca3af;
  --n-node-text-color-hover: #e5e7eb;
  --n-node-color-hover: #27272a;
  --n-node-color-pressed: #3f3f46;
  --n-node-color-active: #3f3f46;
  --n-node-text-color-active: #ffffff;
  --n-node-border-radius: 4px;
}

.hosts-sidebar-panel {
  position: relative;
}

.hosts-sidebar-panel--resizing {
  cursor: col-resize;
}

.hosts-sidebar-resize-handle {
  position: absolute;
  top: 0;
  right: -4px;
  z-index: 5;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  touch-action: none;
}

.hosts-sidebar-resize-handle::after {
  content: '';
  position: absolute;
  top: 0;
  right: 3px;
  width: 1px;
  height: 100%;
  background: transparent;
  transition: background 0.12s;
}

.hosts-sidebar-resize-handle:hover::after,
.hosts-sidebar-panel--resizing .hosts-sidebar-resize-handle::after {
  background: #3b82f6;
}

.inventory-sidebar-tree :deep(.n-tree-node-content__text) {
  display: block;
  min-width: 0;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.inventory-tree-switcher-icon),
:deep(.inventory-tree-switcher-placeholder) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 14px;
  font-size: 11px;
  line-height: 1;
}

:deep(.inventory-tree-switcher-icon) {
  color: #71717a;
}

:deep(.inventory-folder-node-label) {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  min-width: 0;
  width: 100%;
  align-items: center;
  gap: 4px;
}

:deep(.inventory-host-node-label) {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  min-width: 0;
  width: 100%;
  align-items: center;
  gap: 4px;
  color: #a1a1aa;
  font-size: 11px;
}

:deep(.inventory-folder-node-icon) {
  font-size: 13px;
  line-height: 1;
  flex-shrink: 0;
}

:deep(.inventory-folder-node-count) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 16px;
  padding: 0 5px;
  border-radius: 999px;
  background: #27272a;
  color: #a1a1aa;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  flex-shrink: 0;
}

:deep(.inventory-host-node-icon) {
  font-size: 12px;
  line-height: 1;
  flex-shrink: 0;
  opacity: 0.82;
}

:deep(.inventory-folder-node-text) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.inventory-node-tooltip) {
  max-width: 320px;
  word-break: break-word;
}

:deep(.inventory-node-tooltip-line + .inventory-node-tooltip-line) {
  margin-top: 2px;
  color: #a1a1aa;
  font-size: 11px;
}

:global(body[data-theme='light']) .host-form-collapse :deep(.n-collapse-item) {
  border-color: var(--na-border);
  background: rgba(15, 23, 42, 0.025);
}

:global(body[data-theme='light']) .sidebar-item {
  color: var(--na-text-muted);
}

:global(body[data-theme='light']) .sidebar-item:hover {
  background: #eef5ff;
  color: #1d4ed8;
}

:global(body[data-theme='light']) .sidebar-item--active {
  background: #dbeafe;
  color: #1e40af;
}

:global(body[data-theme='light']) .sidebar-badge {
  background: #e2e8f0;
  color: #475569;
}

:global(body[data-theme='light']) .sidebar-item--active .sidebar-badge {
  background: #bfdbfe;
  color: #1e40af;
}

:global(body[data-theme='light']) .sidebar-action:hover {
  background: #e2e8f0;
  color: #334155;
}

:global(body[data-theme='light']) .inventory-sidebar-tree {
  --n-node-text-color: var(--na-text-muted);
  --n-node-text-color-hover: #1d4ed8;
  --n-node-color-hover: #eef5ff;
  --n-node-color-active: #dbeafe;
  --n-node-text-color-active: #1e40af;
}
</style>
