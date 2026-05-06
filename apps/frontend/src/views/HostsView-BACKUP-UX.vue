<script setup lang="ts">
import { h, ref, onMounted, onBeforeUnmount, computed, nextTick, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NSpace, NInput, NInputNumber, NSelect, NButton, NCard, NTag, NSpin, NSwitch,
  NEmpty, NGrid, NGridItem, NText, NAlert, NModal, NForm, NFormItem,
  NScrollbar, NTooltip, NDropdown, useMessage, useDialog,
} from 'naive-ui'
import type { DropdownOption, SelectOption } from 'naive-ui'
import {
  validateHostLinkTemplate,
  findUnknownHostLinkVariables,
  listHostLinkVariables,
  resolveHostLinkTemplate,
  type BastionPublic,
  type HostAssociatedLink,
  type HostPublic,
  type CreateHostDto,
  type HostKeyTrustEvent,
  type HostLinkCreated,
  type PemKeyPublic,
  type TestConnectionResult,
} from '@nodeaccess/shared'
import { hostService }        from '@/services/host.service'
import { agentService, type AgentStatusInfo } from '@/services/agent.service'
import { groupService }       from '@/services/group.service'
import { folderService, type FolderPublic } from '@/services/folder.service'
import { bastionService }     from '@/services/bastion.service'
import { pemKeyService }      from '@/services/pem-key.service'
import { integrationService } from '@/services/integration.service'
import { tagService }         from '@/services/tag.service'
import { settingsService }    from '@/services/settings.service'
import { portForwardingService, type PortForwardingWithHost } from '@/services/portForwarding.service'
import { webAccessService } from '@/services/webAccess.service'
import { hostLinkService } from '@/services/host-link.service'
import {
  hostDisplayMode,
  quickAccessCollapsed,
  productivityCollapsed,
  setHostDisplayMode,
  setProductivityCollapsed,
  setQuickAccessCollapsed,
  type HostDisplayMode,
} from '@/services/host-view-preferences.service'
import { favoriteHostIds, isFavoriteHost, markHostAsRecent, recentHostIds, toggleFavoriteHost } from '@/services/host-quick-access.service'
import { resetTerminalLayout } from '@/services/terminal-layout.service'
import { useAuthStore }       from '@/stores/auth'
import { useTerminalStore }   from '@/stores/terminals'
import type { TagPublic }     from '@nodeaccess/shared'
import ImportHostsModal       from '@/components/ImportHostsModal.vue'
import CollapsibleSection     from '@/components/CollapsibleSection.vue'

const router    = useRouter()
const route     = useRoute()
const auth      = useAuthStore()
const termStore = useTerminalStore()
const msg       = useMessage()
const dialog    = useDialog()
const { t }     = useI18n()
const canManage = computed(() => auth.isAdmin || !!auth.user?.canManageHosts)
const canManageForwardings = computed(() => auth.isAdmin)
const hasOpenSessions = computed(() => termStore.tabs.length > 0)
const sidebarSearch = ref('')

// ─── Dados ───────────────────────────────────────────────────────────────────

const hosts        = ref<HostPublic[]>([])
const folders      = ref<FolderPublic[]>([])
const groupOptions = ref<{ label: string; value: number }[]>([])
const bastions     = ref<BastionPublic[]>([])
const pemKeys      = ref<PemKeyPublic[]>([])
const allTags      = ref<TagPublic[]>([])
const forwardings  = ref<PortForwardingWithHost[]>([])
const total        = ref(0)
const loading      = ref(false)
const error        = ref<string | null>(null)
const maxHostsLicensed = ref<number | null>(null)
const agentStatus  = ref<AgentStatusInfo | null>(null)
const showHelp             = ref(false)
const folderMoveHost       = ref<HostPublic | null>(null)
const folderMoveSelectedId = ref<number | null>(null)
let agentStatusTimer: ReturnType<typeof setInterval> | null = null

const helpQuickItems = computed(() => ['scope', 'route', 'access'])
const helpFields = computed(() => ['sidebar', 'quickAccess', 'scope', 'auth', 'route', 'links', 'forwardings', 'tags'])
const helpScopes = computed(() => ['personal', 'team', 'global'])
const helpRoutes = computed(() => ['direct', 'auto', 'agent_user', 'agent_tenant'])

function openSession(tabId?: string) {
  if (tabId) termStore.activate(tabId)
  resetTerminalLayout()
  router.push({ name: 'terminal' })
}

function closeSession(tabId: string) {
  termStore.remove(tabId)
}

function toggleQuickAccessCollapsed() {
  setQuickAccessCollapsed(!quickAccessCollapsed.value)
}

function toggleProductivityCollapsed() {
  setProductivityCollapsed(!productivityCollapsed.value)
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

// key: 'all' | 'folder-{id}' | 'group-{id}' | 'global' | 'unfiled' | 'tag-{id}'
const selectedKey = ref<string>('all')

const filteredHosts = computed(() => {
  const key = selectedKey.value
  if (key === 'all')     return hosts.value
  if (key === 'favorites') {
    return favoriteHostIds.value
      .map((id) => hosts.value.find((host) => host.id === id))
      .filter((host): host is HostPublic => !!host)
  }
  if (key === 'recent') {
    return recentHostIds.value
      .map((id) => hosts.value.find((host) => host.id === id))
      .filter((host): host is HostPublic => !!host)
  }
  if (key === 'global')  return hosts.value.filter((h) => h.scope === 'global')
  if (key === 'unfiled') return hosts.value.filter((h) => !h.folderId)
  if (key.startsWith('folder-')) {
    const id = Number(key.replace('folder-', ''))
    return hosts.value.filter((h) => h.folderId === id)
  }
  if (key.startsWith('group-')) {
    const id = Number(key.replace('group-', ''))
    return hosts.value.filter((h) => h.groupId === id)
  }
  if (key.startsWith('tag-')) {
    const id = Number(key.replace('tag-', ''))
    return hosts.value.filter((h) => h.tags.some((t) => t.id === id))
  }
  return hosts.value
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
    all:     hosts.value.length,
    favorites: hosts.value.filter((h) => favoriteHostIds.value.includes(h.id)).length,
    recent: hosts.value.filter((h) => recentHostIds.value.includes(h.id)).length,
    unfiled: hosts.value.filter((h) => !h.folderId).length,
    global:  hosts.value.filter((h) => h.scope === 'global').length,
  }
  for (const f of folders.value) {
    c[`folder-${f.id}`] = hosts.value.filter((h) => h.folderId === f.id).length
  }
  for (const g of groupOptions.value) {
    c[`group-${g.value}`] = hosts.value.filter((h) => h.groupId === g.value).length
  }
  for (const t of allTags.value) {
    c[`tag-${t.id}`] = hosts.value.filter((h) => h.tags.some((ht) => ht.id === t.id)).length
  }
  return c
})

const selectedLabel = computed(() => {
  if (selectedKey.value === 'all')     return t('hosts.allHosts')
  if (selectedKey.value === 'favorites') return t('hosts.favorites')
  if (selectedKey.value === 'recent') return t('hosts.recent')
  if (selectedKey.value === 'global')  return t('hosts.global')
  if (selectedKey.value === 'unfiled') return t('hosts.unfiled')
  if (selectedKey.value.startsWith('folder-')) {
    const id = Number(selectedKey.value.replace('folder-', ''))
    return folders.value.find((f) => f.id === id)?.name ?? 'Pasta'
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
    .map((id) => hosts.value.find((host) => host.id === id))
    .filter((host): host is HostPublic => !!host)
    .slice(0, 6),
)

const recentHosts = computed(() =>
  recentHostIds.value
    .map((id) => hosts.value.find((host) => host.id === id))
    .filter((host): host is HostPublic => !!host)
    .slice(0, 6),
)

const normalizedSidebarSearch = computed(() => sidebarSearch.value.trim().toLowerCase())

const filteredFolders = computed(() => {
  if (!normalizedSidebarSearch.value) return folders.value
  return folders.value.filter((folder) => folder.name.toLowerCase().includes(normalizedSidebarSearch.value))
})

const filteredGroupOptions = computed(() => {
  if (!normalizedSidebarSearch.value) return groupOptions.value
  return groupOptions.value.filter((group) => group.label.toLowerCase().includes(normalizedSidebarSearch.value))
})

const filteredTags = computed(() => {
  if (!normalizedSidebarSearch.value) return allTags.value
  return allTags.value.filter((tag) => tag.name.toLowerCase().includes(normalizedSidebarSearch.value))
})

const hasSidebarSearchResults = computed(() => (
  !normalizedSidebarSearch.value
  || filteredFolders.value.length > 0
  || filteredGroupOptions.value.length > 0
  || filteredTags.value.length > 0
))

const emptyStateDescription = computed(() => {
  if (selectedKey.value === 'favorites') return t('hosts.empty.favorites')
  if (selectedKey.value === 'recent') return t('hosts.empty.recent')
  if (selectedKey.value === 'all' && !hosts.value.length) {
    return canManage.value ? t('hosts.empty.admin') : t('hosts.empty.user')
  }
  return t('hosts.empty.section')
})

const hostLimitReached = computed(() =>
  maxHostsLicensed.value !== null && total.value >= maxHostsLicensed.value,
)

const hostLimitMessage = computed(() => {
  if (maxHostsLicensed.value === null) return ''
  return t('hosts.license.maxHostsReached', { count: maxHostsLicensed.value })
})

// ─── Drag and drop ────────────────────────────────────────────────────────────

const draggingHost  = ref<HostPublic | null>(null)
const dropTargetKey = ref<string | null>(null)

function onDragStart(e: DragEvent, host: HostPublic) {
  draggingHost.value = host
  e.dataTransfer!.effectAllowed = 'move'
  // small delay so the card renders dimmed before browser captures the ghost
  setTimeout(() => { /* noop — reactivity handles opacity */ }, 0)
}

function onDragEnd() {
  draggingHost.value  = null
  dropTargetKey.value = null
}

function onDropZoneDragOver(e: DragEvent, key: string) {
  if (!draggingHost.value) return
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'move'
  dropTargetKey.value = key
}

function onDropZoneDragLeave(e: DragEvent, key: string) {
  // only clear if the mouse truly left this element (not just moved to a child)
  if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return
  if (dropTargetKey.value === key) dropTargetKey.value = null
}

async function onDropZoneDrop(e: DragEvent, folderId: number | null) {
  e.preventDefault()
  dropTargetKey.value = null
  if (!draggingHost.value) return
  const host = draggingHost.value
  draggingHost.value = null
  if (host.folderId === folderId) return   // already there
  await moveToFolder(host, folderId)
}

// ─── Carregamento ────────────────────────────────────────────────────────────

const search = ref('')

async function load() {
  loading.value = true
  error.value   = null
  try {
    const { data } = await hostService.list({ page: 1, limit: 200, search: search.value || undefined })
    hosts.value = data.data
    total.value = data.total
    await maybeOpenHostFromRoute()
  } catch {
    error.value = 'Erro ao carregar hosts'
  } finally {
    loading.value = false
  }
}

const opActive = ref(false)

async function loadSidebar() {
  const [fRes, gRes, bRes, pkRes, intRes, tagRes, fwRes, agentRes] = await Promise.allSettled([
    folderService.list(),
    groupService.list(),
    bastionService.list(),
    pemKeyService.list(),
    integrationService.list(),
    tagService.list(),
    portForwardingService.listAll(),
    agentService.status(),
  ])
  if (fRes.status      === 'fulfilled') folders.value      = fRes.value.data
  if (gRes.status      === 'fulfilled') groupOptions.value = gRes.value.data.map((g) => ({ label: g.name, value: g.id }))
  if (bRes.status      === 'fulfilled') bastions.value     = bRes.value.data
  if (pkRes.status     === 'fulfilled') pemKeys.value      = pkRes.value.data
  if (tagRes.status    === 'fulfilled') allTags.value      = tagRes.value.data
  if (fwRes.status     === 'fulfilled') forwardings.value  = fwRes.value.data
  if (agentRes.status  === 'fulfilled') agentStatus.value  = agentRes.value.data
  if (intRes.status    === 'fulfilled') {
    const op = intRes.value.data.find((i) => i.provider === 'onepassword')
    opActive.value = !!(op?.enabled && op?.hasToken)
  }
}

async function refreshAgentStatus() {
  try {
    const { data } = await agentService.status()
    agentStatus.value = data
  } catch {
    // Status de agente é informativo; a conexão SSH ainda valida no backend.
  }
}

function startAgentStatusRefresh() {
  stopAgentStatusRefresh()
  agentStatusTimer = setInterval(refreshAgentStatus, 5000)
}

function stopAgentStatusRefresh() {
  if (agentStatusTimer !== null) {
    clearInterval(agentStatusTimer)
    agentStatusTimer = null
  }
}

async function loadLicenseSettings() {
  try {
    const { data } = await settingsService.get()
    maxHostsLicensed.value = data.license.maxHosts
  } catch {
    maxHostsLicensed.value = null
  }
}

onMounted(() => {
  load()
  loadSidebar()
  loadLicenseSettings()
  startAgentStatusRefresh()
})

onBeforeUnmount(stopAgentStatusRefresh)

watch(() => route.query.editHostId, async () => {
  await maybeOpenHostFromRoute()
})

const forwardingCountByHost = computed(() => {
  const counts = new Map<number, number>()
  for (const forwarding of forwardings.value) {
    counts.set(forwarding.hostId, (counts.get(forwarding.hostId) ?? 0) + 1)
  }
  return counts
})

const editingHostForwardings = computed(() => {
  if (editingHostId.value === null) return []
  return forwardings.value.filter((forwarding) => forwarding.hostId === editingHostId.value)
})

const hostLinkExpiryMinutes = ref<5 | 10 | 30>(10)
const hostLinkLoading = ref(false)
const latestHostLink = ref<HostLinkCreated | null>(null)
const associatedLinksOnePasswordRef = ref('')
const associatedLinksOnePasswordPreview = ref<HostAssociatedLink[]>([])
const associatedLinksOnePasswordPreviewError = ref<string | null>(null)
const associatedLinksOnePasswordPreviewLoading = ref(false)
const associatedLinksOnePasswordLoading = ref(false)

watch(associatedLinksOnePasswordRef, () => {
  associatedLinksOnePasswordPreview.value = []
  associatedLinksOnePasswordPreviewError.value = null
})

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
    loadSidebar()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('hosts.messages.folderSaveError'))
  } finally {
    folderLoading.value = false
  }
}

function confirmDeleteFolder(folder: FolderPublic) {
  dialog.warning({
    title:        t('hosts.deleteFolder.title'),
    content:      t('hosts.deleteFolder.content', { name: folder.name }),
    positiveText: t('hosts.deleteFolder.confirm'),
    negativeText: t('hosts.deleteFolder.cancel'),
    onPositiveClick: async () => {
      await folderService.delete(folder.id)
      msg.success(t('hosts.messages.folderDeleted'))
      if (selectedKey.value === `folder-${folder.id}`) selectedKey.value = 'all'
      loadSidebar()
      load()
    },
  })
}

// ─── Modal host (criar / editar) ─────────────────────────────────────────────

const showHostModal  = ref(false)
const hostModalLoading = ref(false)
const editingHostId  = ref<number | null>(null)
const editingHostKeyHistory = ref<HostKeyTrustEvent[]>([])
const hostKeyHistoryLoading = ref(false)

const scopeFormOptions = computed(() => [
  { label: t('hosts.form.scopePersonal'), value: 'personal' },
  { label: t('hosts.form.scopeTeam'),     value: 'team' },
  { label: t('hosts.form.scopeGlobal'),   value: 'global' },
])
const authTypeOptions = computed(() => [
  { label: t('hosts.form.authPassword'), value: 'password' },
  { label: t('hosts.form.authPem'),      value: 'pem' },
  { label: t('hosts.form.authPemPassword'), value: 'pem_password' },
])
const connectionModeOptions = computed(() => [
  { label: t('hosts.form.connectionDirect'), value: 'direct', description: t('hosts.form.connectionDirectHint') },
  { label: t('hosts.form.connectionAgentUser'), value: 'agent_user', description: t('hosts.form.connectionAgentUserHint') },
  { label: t('hosts.form.connectionAgentTenantFallback'), value: 'agent_tenant_fallback', description: t('hosts.form.connectionAgentTenantFallbackHint') },
  { label: t('hosts.form.connectionAuto'), value: 'auto', description: t('hosts.form.connectionAutoHint') },
])

const folderSelectOptions = computed(() =>
  folders.value.map((f) => ({ label: f.name, value: f.id })),
)

const pemKeyOptions = computed(() =>
  pemKeys.value.map((k) => ({ label: k.name, value: k.id })),
)

const bastionOptions = computed(() =>
  bastions.value.map((bastion) => ({ label: bastion.name, value: bastion.id })),
)

type HostForm = CreateHostDto & { folderId?: number; bastionId?: number | null }
type HostAssociatedLinkForm = HostAssociatedLink

const emptyForm = (): HostForm => ({
  name: '', ip: '', port: 22, sshUser: '', authType: 'password',
  connectionMode: 'direct',
  scope: 'personal', groupId: undefined, folderId: undefined, password: '', pemKeyId: undefined,
  bastionId: undefined, onePasswordRef: undefined, tagNames: [], associatedLinks: [],
})

const form = ref<HostForm>(emptyForm())

const tagSelectOptions = computed(() =>
  allTags.value.map((t) => ({ label: t.name, value: t.name })),
)

const associatedLinkOpenModeOptions = computed(() => [
  { label: t('hosts.associatedLinks.openModeNewTab'), value: 'new_tab' },
  { label: t('hosts.associatedLinks.openModeSameTab'), value: 'same_tab' },
])

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
      position,
    }))
    .filter((link) => link.label || link.urlTemplate)
}

function openCreate() {
  if (hostLimitReached.value) {
    msg.warning(hostLimitMessage.value)
    return
  }
  editingHostId.value = null
  editingHostKeyHistory.value = []
  latestHostLink.value = null
  associatedLinksOnePasswordRef.value = ''
  associatedLinksOnePasswordPreview.value = []
  associatedLinksOnePasswordPreviewError.value = null
  form.value = emptyForm()
  testResult.value = null
  // Pré-seleciona pasta/grupo conforme nó ativo na árvore
  const key = selectedKey.value
  if (key.startsWith('folder-')) form.value.folderId = Number(key.replace('folder-', ''))
  if (key.startsWith('group-'))  form.value.groupId  = Number(key.replace('group-', ''))
  if (key === 'global')          form.value.scope    = 'global'
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
    await loadSidebar()
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
    await loadSidebar()
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
        await loadSidebar()
        msg.success(t('tunnels.templateRemoved'))
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } }
        msg.error(e.response?.data?.message ?? t('tunnels.templateError'))
      }
    },
  })
}

function openEdit(host: HostPublic) {
  editingHostId.value = host.id
  editingHostKeyHistory.value = []
  latestHostLink.value = null
  associatedLinksOnePasswordRef.value = ''
  associatedLinksOnePasswordPreview.value = []
  associatedLinksOnePasswordPreviewError.value = null
  form.value = {
    name: host.name, ip: host.ip, port: host.port, sshUser: host.sshUser,
    authType: host.authType, connectionMode: editableConnectionMode(host.connectionMode), scope: host.scope,
    groupId:  host.groupId  ?? undefined,
    folderId: host.folderId ?? undefined,
    bastionId: host.bastionId ?? undefined,
    pemKeyId: host.pemKeyId ?? undefined,
    onePasswordRef: host.onePasswordRef ?? undefined,
    tagNames:       host.tags.map((t) => t.name),
    associatedLinks: (host.associatedLinks ?? []).map((link, position) => ({ ...link, position })),
    password: '',
  }
  testResult.value = null
  showHostModal.value = true
  void refreshEditingHost(host.id)
  void loadHostKeyHistory(host.id)
}

async function previewAssociatedLinksFromOnePassword() {
  if (editingHostId.value === null || !associatedLinksOnePasswordRef.value.trim()) return
  associatedLinksOnePasswordPreviewLoading.value = true
  try {
    const { data } = await hostService.previewAssociatedLinksFromOnePassword(editingHostId.value, {
      ref: associatedLinksOnePasswordRef.value.trim(),
    })
    associatedLinksOnePasswordPreview.value = (data.links ?? []).map((link, position) => ({ ...link, position }))
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
    hosts.value = hosts.value.map((host) => host.id === data.id ? data : host)
    form.value.associatedLinks = (data.associatedLinks ?? []).map((link, position) => ({ ...link, position }))
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
    await navigator.clipboard.writeText(data.url)
    msg.success(t('hostLinks.createdAndCopied'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('hostLinks.createError'))
  } finally {
    hostLinkLoading.value = false
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
    hosts.value = hosts.value.map((host) => host.id === hostId ? data : host)
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

  const host = hosts.value.find((item) => item.id === id)
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
  testLoading.value = true
  testResult.value  = null
  try {
    const { data } = await hostService.testConnection({
      ...(editingHostId.value !== null && { hostId: editingHostId.value }),
      ip:        form.value.ip,
      port:      form.value.port,
      sshUser:   form.value.sshUser,
      authType:  form.value.authType,
      connectionMode: form.value.connectionMode,
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

function testRouteLabel(result: TestConnectionResult) {
  if (result.routeLabel) return result.routeLabel
  if (result.route === 'user_agent') return t('hosts.test.routeUserAgent')
  if (result.route === 'tenant_agent') return t('hosts.test.routeTenantAgent')
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
    const payload = { ...form.value }
    payload.associatedLinks = normalizeAssociatedLinks(form.value.associatedLinks)
    const invalidLink = payload.associatedLinks.find((link) =>
      !link.label
      || !link.urlTemplate
      || !linkValidation(link).valid,
    )
    if (invalidLink) {
      throw new Error(t('hosts.associatedLinks.validationError'))
    }
    if (payload.authType === 'pem') delete payload.password
    if (editingHostId.value !== null) {
      await hostService.update(editingHostId.value, payload)
      msg.success(t('hosts.messages.hostUpdated'))
    } else {
      if (payload.bastionId === null) delete payload.bastionId
      await hostService.create(payload)
      msg.success(t('hosts.messages.hostCreated'))
    }
    showHostModal.value = false
    load()
    loadSidebar()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('hosts.messages.saveError'))
  } finally {
    hostModalLoading.value = false
  }
}

const editingHost = computed(() =>
  editingHostId.value !== null
    ? hosts.value.find((host) => host.id === editingHostId.value) ?? null
    : null,
)

const hasSavedPasswordCredentialForCurrentAuth = computed(() =>
  Boolean(
    editingHost.value?.hasPasswordCredential
    && editingHost.value.authType === form.value.authType
    && (form.value.authType === 'password' || form.value.authType === 'pem_password'),
  ),
)

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

function confirmDeleteHost(host: HostPublic) {
  dialog.warning({
    title:        t('hosts.deleteHost.title'),
    content:      t('hosts.deleteHost.content', { name: host.name }),
    positiveText: t('hosts.deleteHost.confirm'),
    negativeText: t('hosts.deleteHost.cancel'),
    onPositiveClick: async () => {
      await hostService.delete(host.id)
      msg.success(t('hosts.messages.hostDeleted'))
      load()
    },
  })
}

// ─── Mover host para pasta ────────────────────────────────────────────────────

async function moveToFolder(host: HostPublic, folderId: number | null) {
  try {
    await hostService.update(host.id, { folderId })
    load()
  } catch {
    msg.error(t('hosts.messages.moveError'))
  }
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

// ─── Conexão ─────────────────────────────────────────────────────────────────

function connect(host: HostPublic) {
  const routeStatus = agentRouteStatusForHost(host)
  if (routeStatus?.blocksConnection) msg.warning(routeStatus.tooltip)
  markHostAsRecent(host.id)
  termStore.add({ id: host.id, name: host.name, ip: host.ip, port: host.port, authType: host.authType })
  resetTerminalLayout()
  router.push({ name: 'terminal' })
}

function scopeColor(s: string) {
  return s === 'personal' ? 'info' : s === 'team' ? 'success' : 'warning'
}

function authTypeLabel(authType: HostPublic['authType']) {
  if (authType === 'pem') return t('hosts.authPem')
  if (authType === 'pem_password') return t('hosts.authPemPassword')
  return t('hosts.authPassword')
}

function authTypeIcon(authType: HostPublic['authType']) {
  if (authType === 'pem') return '🔑'
  if (authType === 'pem_password') return '🔑🔒'
  return '🔒'
}

function connectionModeLabel(connectionMode: HostPublic['connectionMode']) {
  if (connectionMode === 'agent_user') return t('hosts.form.connectionAgentUser')
  if (connectionMode === 'agent_tenant_fallback') return t('hosts.form.connectionAgentTenantFallback')
  if (connectionMode === 'auto') return t('hosts.form.connectionAuto')
  if (connectionMode === 'agent') return t('hosts.form.connectionAgent')
  return t('hosts.form.connectionDirect')
}

function connectionModeShortLabel(connectionMode: HostPublic['connectionMode']) {
  if (connectionMode === 'agent_user') return t('hosts.form.connectionShortUser')
  if (connectionMode === 'agent_tenant_fallback' || connectionMode === 'agent') return t('hosts.form.connectionShortAgent')
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
  return agentRouteStatusForConnectionMode(host.connectionMode)
}

function agentRouteStatusForConnectionMode(mode: HostPublic['connectionMode']): HostAgentRouteStatus {
  if (mode === 'direct') return null
  const st = agentStatus.value
  const userAgent = st?.userAgent ?? null
  const tenantAgent = st?.tenantAgent ?? null

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
      trigger: () => h('div', { class: 'leading-tight py-1' }, [
        h('div', { class: 'text-sm' }, label),
        description ? h('div', { class: 'text-[11px] text-gray-400 mt-0.5' }, description) : null,
      ]),
      default: () => description,
    },
  )
}

function visibleTags(host: HostPublic) {
  return host.tags.slice(0, 1)
}

function hiddenTagCount(host: HostPublic) {
  return Math.max(0, host.tags.length - 1)
}

function hiddenTagNames(host: HostPublic) {
  return host.tags.slice(1).map((tag) => tag.name).join(', ')
}

function visibleAssociatedLinks(host: HostPublic) {
  return (host.associatedLinks ?? []).filter((link) => link.enabled).slice(0, 2)
}

function hiddenAssociatedLinkCount(host: HostPublic) {
  return Math.max(0, (host.associatedLinks ?? []).filter((link) => link.enabled).length - 2)
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

const ctxOptions = computed<DropdownOption[]>(() => {
  const opts: DropdownOption[] = []
  if (canManage.value) {
    opts.push({ key: 'new-host',   label: t('hosts.contextMenu.newHost')   })
    opts.push({ key: 'new-folder', label: t('hosts.contextMenu.newFolder') })
    opts.push({ type: 'divider',   key: 'd1'                               })
  }
  opts.push({ key: 'refresh', label: t('hosts.contextMenu.refresh') })
  return opts
})

function onHostAreaContextMenu(e: MouseEvent) {
  e.preventDefault()
  ctxVisible.value = false
  // nextTick allows the dropdown to re-render at new position
  setTimeout(() => {
    ctxX.value       = e.clientX
    ctxY.value       = e.clientY
    ctxVisible.value = true
  }, 0)
}

function onCtxSelect(key: string) {
  ctxVisible.value = false
  if (key === 'new-host')   openCreate()
  if (key === 'new-folder') openCreateFolder()
  if (key === 'refresh')    load()
}

const showImport = ref(false)

</script>

<template>
  <div class="flex h-screen overflow-hidden">

    <!-- ── Painel esquerdo: árvore de pastas ── -->
    <div class="w-56 shrink-0 bg-[#18181c] border-r border-gray-800 flex flex-col">
      <div class="flex items-center justify-between px-3 py-3 border-b border-gray-800">
        <NText class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Sessões</NText>
        <NTooltip trigger="hover" placement="right">
          <template #trigger>
            <NButton
              size="small"
              type="primary"
              ghost
              style="padding: 0 8px; height: 24px; font-size: 16px; line-height: 1;"
              @click="openCreateFolder"
            >＋</NButton>
          </template>
          {{ $t('hosts.newFolder') }}
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

          <!-- Pessoais sem pasta — drop zone -->
          <button
            class="sidebar-item w-full pl-6"
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

          <!-- Pastas — drop zones -->
          <div
            v-for="folder in filteredFolders"
            :key="`folder-${folder.id}`"
            class="flex items-center group"
          >
            <button
              class="sidebar-item flex-1 pl-6 min-w-0"
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

          <!-- Grupos -->
          <button
            v-for="g in filteredGroupOptions"
            :key="`group-${g.value}`"
            class="sidebar-item w-full pl-6"
            :class="selectedKey === `group-${g.value}` ? 'sidebar-item--active' : ''"
            @click="selectedKey = `group-${g.value}`"
          >
            <span>👥</span>
            <span class="truncate flex-1 text-left">{{ g.label }}</span>
            <span v-if="counts[`group-${g.value}`]" class="sidebar-badge">{{ counts[`group-${g.value}`] }}</span>
          </button>

          <!-- Global -->
          <button
            class="sidebar-item w-full pl-6"
            :class="selectedKey === 'global' ? 'sidebar-item--active' : ''"
            @click="selectedKey = 'global'"
          >
            <span>🌐</span>
            <span class="flex-1 text-left">{{ $t('hosts.global') }}</span>
            <span v-if="counts.global" class="sidebar-badge">{{ counts.global }}</span>
          </button>

          <!-- Tags -->
          <template v-if="filteredTags.length">
            <div class="px-2 pt-3 pb-1">
              <span class="text-xs font-semibold text-gray-600 uppercase tracking-wider">{{ $t('hosts.tags') }}</span>
            </div>
            <button
              v-for="tag in filteredTags"
              :key="`tag-${tag.id}`"
              class="sidebar-item w-full pl-6"
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
    </div>

    <!-- ── Menu de contexto (botão direito) ── -->
    <NDropdown
      placement="bottom-start"
      trigger="manual"
      :x="ctxX"
      :y="ctxY"
      :options="ctxOptions"
      :show="ctxVisible"
      @clickoutside="ctxVisible = false"
      @select="onCtxSelect"
    />

    <!-- ── Painel direito: hosts ── -->
    <div class="flex-1 overflow-auto p-6" @contextmenu="onHostAreaContextMenu">
      <div class="flex items-center justify-between mb-5">
        <div>
          <h1 class="text-xl font-semibold text-white">{{ selectedLabel }}</h1>
          <NText depth="3" class="text-xs">{{ $t('hosts.count', { count: filteredHosts.length }) }}</NText>
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
            @click="openSession(termStore.activeId ?? undefined)"
          >
            🖥 Sessões abertas ({{ termStore.tabs.length }})
          </NButton>
          <template v-if="canManage">
          <NButton ghost @click="showImport = true">⬆ {{ $t('import.title') }}</NButton>
          <NTooltip :disabled="!hostLimitReached">
            <template #trigger>
              <NButton type="primary" :disabled="hostLimitReached" @click="openCreate">{{ $t('hosts.newHost') }}</NButton>
            </template>
            {{ hostLimitMessage }}
          </NTooltip>
          </template>
        </NSpace>
      </div>

      <div
        v-if="hasOpenSessions"
        class="mb-4 rounded-xl border border-blue-900/40 bg-blue-950/20 p-3"
      >
        <div class="flex items-center justify-between gap-3 mb-2">
          <div>
            <div class="text-sm font-semibold text-white">Sessões abertas</div>
            <div class="text-xs text-gray-400">Você pode voltar ao terminal sem perder as conexões já abertas.</div>
          </div>
          <NButton size="small" type="primary" @click="openSession(termStore.activeId ?? undefined)">
            Voltar ao terminal
          </NButton>
        </div>
        <div class="flex flex-wrap gap-2">
          <div
            v-for="tab in termStore.tabs"
            :key="`open-session-${tab.id}`"
            class="flex items-center gap-2 rounded-lg border px-2.5 py-2 min-w-[220px] max-w-[320px]"
            :class="tab.id === termStore.activeId
              ? 'border-blue-800 bg-[#141c2a]'
              : 'border-gray-800 bg-[#17171c]'"
          >
            <span
              class="w-2 h-2 rounded-full shrink-0"
              :class="tab.id === termStore.activeId ? 'bg-green-400' : 'bg-gray-500'"
            />
            <button class="min-w-0 flex-1 text-left" @click="openSession(tab.id)">
              <div class="text-sm text-white truncate flex items-center gap-1.5">
                <span class="truncate">{{ tab.hostName }}</span>
                <span
                  v-if="tab.unreadCount > 0"
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
            </button>
            <button class="text-gray-500 hover:text-red-400 text-xs px-1 shrink-0" @click="closeSession(tab.id)">✕</button>
          </div>
        </div>
      </div>

      <div class="mb-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div class="rounded-xl border border-gray-800 bg-[#17171c] p-3">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-sm font-semibold text-white">{{ $t('hosts.quickAccess.title') }}</div>
              <div class="text-xs text-gray-400">{{ $t('hosts.quickAccess.subtitle') }}</div>
            </div>
            <div class="flex items-center gap-2">
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

          <div v-if="!quickAccessCollapsed" class="mt-3 space-y-3">
            <div>
              <div class="mb-2 flex items-center justify-between gap-3">
                <div class="text-xs font-semibold uppercase tracking-wider text-gray-500">{{ $t('hosts.favorites') }}</div>
                <NButton quaternary size="tiny" @click="selectedKey = 'favorites'">
                  {{ $t('hosts.quickAccess.viewAll') }}
                </NButton>
              </div>
              <div v-if="favoriteHosts.length" class="flex flex-wrap gap-2">
                <button
                  v-for="host in favoriteHosts"
                  :key="`favorite-host-${host.id}`"
                  class="rounded-lg border border-amber-900/30 bg-[#111113] px-3 py-2 text-left min-w-[160px] max-w-[220px]"
                  @click="connect(host)"
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

            <div>
              <div class="mb-2 flex items-center justify-between gap-3">
                <div class="text-xs font-semibold uppercase tracking-wider text-gray-500">{{ $t('hosts.recent') }}</div>
                <NButton quaternary size="tiny" @click="selectedKey = 'recent'">
                  {{ $t('hosts.quickAccess.viewAll') }}
                </NButton>
              </div>
              <div v-if="recentHosts.length" class="flex flex-wrap gap-2">
                <button
                  v-for="host in recentHosts"
                  :key="`recent-host-${host.id}`"
                  class="rounded-lg border border-gray-800 bg-[#111113] px-3 py-2 text-left min-w-[160px] max-w-[220px]"
                  @click="connect(host)"
                >
                  <div class="truncate text-sm font-semibold text-white">{{ host.name }}</div>
                  <div class="truncate text-[11px] text-gray-400 font-mono">{{ host.ip }}:{{ host.port }}</div>
                </button>
              </div>
              <div v-else class="text-xs text-gray-500">{{ $t('hosts.empty.recent') }}</div>
            </div>
          </div>
        </div>

        <div class="rounded-xl border border-emerald-900/30 bg-emerald-950/10 p-3">
          <div class="flex items-start justify-between gap-3" :class="!productivityCollapsed ? 'mb-3' : ''">
            <div>
              <div class="text-sm font-semibold text-white">{{ $t('hosts.productivity.title') }}</div>
              <div class="text-xs text-gray-400">{{ $t('hosts.productivity.subtitle') }}</div>
            </div>
            <NButton quaternary size="small" @click="toggleProductivityCollapsed">
              {{ productivityCollapsed ? $t('hosts.productivity.expand') : $t('hosts.productivity.collapse') }}
            </NButton>
          </div>

          <div v-if="!productivityCollapsed" class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              class="rounded-lg border border-emerald-900/20 bg-[#17171c] p-3 text-left"
              @click="router.push({ name: 'terminal' })"
            >
              <div class="text-sm font-semibold text-white">{{ $t('hosts.productivity.terminal.title') }}</div>
              <div class="mt-1 text-xs text-gray-400">{{ $t('hosts.productivity.terminal.description') }}</div>
            </button>

            <button
              class="rounded-lg border border-emerald-900/20 bg-[#17171c] p-3 text-left"
              @click="router.push({ name: 'snippets' })"
            >
              <div class="text-sm font-semibold text-white">{{ $t('hosts.productivity.snippets.title') }}</div>
              <div class="mt-1 text-xs text-gray-400">{{ $t('hosts.productivity.snippets.description') }}</div>
            </button>

            <button
              class="rounded-lg border border-emerald-900/20 bg-[#17171c] p-3 text-left"
              @click="router.push({ name: 'forwardings' })"
            >
              <div class="text-sm font-semibold text-white">{{ $t('hosts.productivity.forwardings.title') }}</div>
              <div class="mt-1 text-xs text-gray-400">{{ $t('hosts.productivity.forwardings.description') }}</div>
            </button>

            <button
              class="rounded-lg border border-emerald-900/20 bg-[#17171c] p-3 text-left"
              @click="router.push({ name: 'links' })"
            >
              <div class="text-sm font-semibold text-white">{{ $t('hosts.productivity.links.title') }}</div>
              <div class="mt-1 text-xs text-gray-400">{{ $t('hosts.productivity.links.description') }}</div>
            </button>

            <button
              class="rounded-lg border border-emerald-900/20 bg-[#17171c] p-3 text-left"
              @click="router.push({ name: 'profile' })"
            >
              <div class="text-sm font-semibold text-white">{{ $t('hosts.productivity.preferences.title') }}</div>
              <div class="mt-1 text-xs text-gray-400">{{ $t('hosts.productivity.preferences.description') }}</div>
            </button>
          </div>
        </div>
      </div>

      <!-- Busca -->
      <NSpace class="mb-4" align="center" justify="space-between">
        <NSpace>
        <NInput
          v-model:value="search"
          :placeholder="$t('hosts.searchPlaceholder')"
          clearable
          style="width: 260px"
          @keyup.enter="load"
        />
        <NButton @click="load">{{ $t('hosts.search') }}</NButton>
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
        </NSpace>
      </NSpace>

      <NAlert v-if="error" type="error" class="mb-4" :title="error" />

      <NSpin :show="loading">
        <div v-if="!loading && !filteredHosts.length" class="py-20 flex flex-col items-center gap-3 text-center">
          <NEmpty :description="emptyStateDescription">
            <!-- Usuário sem hosts visíveis -->
            <template v-if="selectedKey === 'all' && !hosts.length && !canManage" #extra>
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
            <template v-else-if="selectedKey === 'all' && !hosts.length && canManage" #extra>
              <NTooltip :disabled="!hostLimitReached">
                <template #trigger>
                  <NButton type="primary" class="mt-2" :disabled="hostLimitReached" @click="openCreate">{{ $t('hosts.empty.createFirst') }}</NButton>
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
          <div class="hidden lg:grid grid-cols-[minmax(0,1.3fr)_100px_150px_minmax(0,150px)_minmax(0,180px)_110px_170px] gap-3 border-b border-gray-800 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            <div>{{ $t('hosts.list.columns.host') }}</div>
            <div>{{ $t('hosts.list.columns.scope') }}</div>
            <div>{{ $t('hosts.list.columns.auth') }}</div>
            <div>{{ $t('hosts.list.columns.tags') }}</div>
            <div>{{ $t('hosts.list.columns.links') }}</div>
            <div>{{ $t('hosts.list.columns.forwardings') }}</div>
            <div class="text-right">{{ $t('hosts.list.columns.actions') }}</div>
          </div>

          <div
            v-for="host in filteredHosts"
            :key="`list-${host.id}`"
            :data-host-id="host.id"
            class="border-b border-gray-800 px-4 py-3 last:border-b-0"
            :class="draggingHost?.id === host.id ? 'opacity-40' : ''"
            :draggable="canManage"
            @dragstart="canManage && onDragStart($event, host)"
            @dragend="onDragEnd"
          >
            <div class="hidden lg:grid lg:grid-cols-[minmax(0,1.3fr)_100px_150px_minmax(0,150px)_minmax(0,180px)_110px_170px] gap-3 items-center">
              <button class="min-w-0 text-left" @click="connect(host)">
                <div class="truncate text-sm font-semibold text-white flex items-center gap-2">
                  <span
                    class="shrink-0 text-sm"
                    :class="isFavoriteHost(host.id) ? 'text-amber-300' : 'text-gray-600'"
                  >★</span>
                  <span class="truncate">{{ host.name }}</span>
                </div>
                <div class="truncate font-mono text-xs text-gray-400">{{ host.ip }}:{{ host.port }}</div>
              </button>

              <div>
                <NTag :type="scopeColor(host.scope)" size="small">{{ host.scope }}</NTag>
              </div>

              <div class="text-xs text-gray-300">
                {{ authTypeLabel(host.authType) }}
                <div class="mt-1 flex items-center gap-1.5">
                  <NTooltip trigger="hover" placement="top">
                    <template #trigger>
                      <NTag size="tiny" :type="connectionModeTagType(host.connectionMode)">
                        {{ connectionModeShortLabel(host.connectionMode) }}
                      </NTag>
                    </template>
                    {{ connectionModeTooltip(host.connectionMode) }}
                  </NTooltip>
                  <NTooltip v-if="agentRouteStatusForHost(host)" trigger="hover" placement="top">
                    <template #trigger>
                      <NTag size="tiny" :type="agentRouteStatusForHost(host)!.type">
                        {{ agentRouteStatusForHost(host)!.label }}
                      </NTag>
                    </template>
                    {{ agentRouteStatusForHost(host)!.tooltip }}
                  </NTooltip>
                </div>
                <NTooltip>
                  <template #trigger>
                    <NTag
                      class="mt-1"
                      size="tiny"
                      :type="host.effectiveBastionSource === 'none' ? 'default' : 'info'"
                    >
                      {{ host.effectiveBastionName ?? $t('hosts.bastion.noneShort') }}
                    </NTag>
                  </template>
                  {{ bastionTooltip(host) }}
                </NTooltip>
              </div>

              <div class="min-w-0">
                <div v-if="host.tags.length" class="flex items-center gap-1.5 min-w-0">
                  <span
                    v-for="tag in visibleTags(host)"
                    :key="`list-tag-${tag.id}`"
                    class="inline-flex max-w-full items-center truncate px-1.5 py-0.5 rounded text-[11px] font-medium"
                    :style="{ background: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}44` }"
                  >
                    {{ tag.name }}
                  </span>
                  <NTooltip v-if="hiddenTagCount(host) > 0">
                    <template #trigger>
                      <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium border border-gray-700 text-gray-300">
                        +{{ hiddenTagCount(host) }}
                      </span>
                    </template>
                    {{ hiddenTagNames(host) }}
                  </NTooltip>
                </div>
                <span v-else class="text-[11px] text-gray-500">{{ $t('hosts.list.noTags') }}</span>
              </div>

              <div class="min-w-0">
                <div v-if="visibleAssociatedLinks(host).length" class="flex min-w-0 flex-wrap gap-1.5">
                  <NTooltip
                    v-for="link in visibleAssociatedLinks(host)"
                    :key="`list-link-${host.id}-${link.label}-${link.position}`"
                  >
                    <template #trigger>
                      <NButton class="max-w-full" size="small" quaternary @click.stop="openAssociatedLink(host, link)">
                        <span class="block max-w-[120px] truncate">{{ link.label }}</span>
                      </NButton>
                    </template>
                    {{ resolveHostLinkTemplate(link.urlTemplate, { id: host.id, name: host.name, ip: host.ip, port: host.port, sshUser: host.sshUser }) }}
                  </NTooltip>
                  <NTooltip v-if="hiddenAssociatedLinkCount(host) > 0">
                    <template #trigger>
                      <NTag size="small">+{{ hiddenAssociatedLinkCount(host) }}</NTag>
                    </template>
                    {{ $t('hosts.associatedLinks.moreHidden', { count: hiddenAssociatedLinkCount(host) }) }}
                  </NTooltip>
                </div>
                <span v-else class="text-[11px] text-gray-500">—</span>
              </div>

              <div class="text-xs text-gray-300">
                {{ $t('hosts.forwardings.badge', { count: forwardingCountByHost.get(host.id) ?? 0 }) }}
              </div>

              <div class="flex justify-end gap-2">
                <template v-if="canManage">
                  <NTooltip>
                    <template #trigger>
                      <NButton size="small" @click="openEdit(host)">✎</NButton>
                    </template>
                    {{ $t('common.edit') }}
                  </NTooltip>
                  <NTooltip>
                    <template #trigger>
                      <NButton size="small" @click="toggleFavoriteHost(host.id)">
                        {{ isFavoriteHost(host.id) ? '★' : '☆' }}
                      </NButton>
                    </template>
                    {{ isFavoriteHost(host.id) ? $t('hosts.removeFavorite') : $t('hosts.addFavorite') }}
                  </NTooltip>
                  <NTooltip>
                    <template #trigger>
                      <NButton size="small" type="error" @click="confirmDeleteHost(host)">✕</NButton>
                    </template>
                    {{ $t('common.delete') }}
                  </NTooltip>
                </template>
                <NButton size="small" type="primary" @click.stop="connect(host)">{{ $t('hosts.connect') }}</NButton>
              </div>
            </div>

            <div class="lg:hidden">
              <button class="w-full text-left" @click="connect(host)">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="truncate text-sm font-semibold text-white flex items-center gap-2">
                      <span
                        class="shrink-0 text-sm"
                        :class="isFavoriteHost(host.id) ? 'text-amber-300' : 'text-gray-600'"
                      >★</span>
                      <span class="truncate">{{ host.name }}</span>
                    </div>
                    <div class="truncate font-mono text-xs text-gray-400">{{ host.ip }}:{{ host.port }}</div>
                  </div>
                  <NTag :type="scopeColor(host.scope)" size="small">{{ host.scope }}</NTag>
                </div>
              </button>
              <div class="mt-2 text-xs text-gray-300">
                {{ authTypeLabel(host.authType) }}
                <NTooltip trigger="hover" placement="top">
                  <template #trigger>
                    <NTag size="tiny" :type="connectionModeTagType(host.connectionMode)" class="ml-1">
                      {{ connectionModeShortLabel(host.connectionMode) }}
                    </NTag>
                  </template>
                  {{ connectionModeTooltip(host.connectionMode) }}
                </NTooltip>
                <NTooltip v-if="agentRouteStatusForHost(host)" trigger="hover" placement="top">
                  <template #trigger>
                    <NTag size="tiny" :type="agentRouteStatusForHost(host)!.type" class="ml-1">
                      {{ agentRouteStatusForHost(host)!.label }}
                    </NTag>
                  </template>
                  {{ agentRouteStatusForHost(host)!.tooltip }}
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
                {{ bastionTooltip(host) }}
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
                <template v-if="canManage">
                  <NTooltip>
                    <template #trigger>
                      <NButton size="small" @click="openEdit(host)">✎</NButton>
                    </template>
                    {{ $t('common.edit') }}
                  </NTooltip>
                  <NTooltip>
                    <template #trigger>
                      <NButton size="small" @click="toggleFavoriteHost(host.id)">
                        {{ isFavoriteHost(host.id) ? '★' : '☆' }}
                      </NButton>
                    </template>
                    {{ isFavoriteHost(host.id) ? $t('hosts.removeFavorite') : $t('hosts.addFavorite') }}
                  </NTooltip>
                  <NTooltip>
                    <template #trigger>
                      <NButton size="small" type="error" @click="confirmDeleteHost(host)">✕</NButton>
                    </template>
                    {{ $t('common.delete') }}
                  </NTooltip>
                </template>
                <NButton size="small" type="primary" @click.stop="connect(host)">{{ $t('hosts.connect') }}</NButton>
              </div>
            </div>
          </div>
        </div>

        <NGrid v-else :cols="3" :x-gap="16" :y-gap="16" responsive="screen">
          <NGridItem v-for="host in filteredHosts" :key="host.id" style="height: 100%">
            <NCard
              :data-host-id="host.id"
              hoverable :bordered="false"
              :style="{
                background: '#1e1e22',
                opacity: draggingHost?.id === host.id ? '0.4' : '1',
                transition: 'opacity 0.15s',
                cursor: canManage ? 'grab' : undefined,
                height: '100%',
              }"
              content-style="display:flex;flex-direction:column;height:100%;"
              :draggable="canManage"
              @dragstart="canManage && onDragStart($event, host)"
              @dragend="onDragEnd"
            >
              <div class="flex-1">
              <div class="flex items-start justify-between" style="cursor:pointer" @click="connect(host)">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 min-w-0">
                    <button
                      class="shrink-0 text-sm leading-none"
                      :class="isFavoriteHost(host.id) ? 'text-amber-300' : 'text-gray-600'"
                      @click.stop="toggleFavoriteHost(host.id)"
                    >★</button>
                    <NText strong class="block truncate">{{ host.name }}</NText>
                  </div>
                  <NText depth="3" class="text-xs font-mono">{{ host.ip }}:{{ host.port }}</NText>
                </div>
                <NTag :type="scopeColor(host.scope)" size="small" class="ml-2 shrink-0">
                  {{ host.scope }}
                </NTag>
              </div>

              <!-- Badges de contexto: acessos locais + bastion -->
              <div
                v-if="(forwardingCountByHost.get(host.id) ?? 0) > 0 || host.effectiveBastionSource !== 'none'"
                class="mt-2 flex items-center gap-1.5 flex-wrap"
              >
                <!-- Acessos locais: clicável → navega para a tela filtrada por host -->
                <NTooltip v-if="(forwardingCountByHost.get(host.id) ?? 0) > 0" trigger="hover" placement="top">
                  <template #trigger>
                    <span
                      class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium cursor-pointer select-none transition-opacity hover:opacity-80"
                      style="background:rgba(59,130,246,0.16); color:#93c5fd;"
                      @click.stop="openHostForwardings(host.id, host.name)"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                      {{ forwardingCountByHost.get(host.id) }}
                    </span>
                  </template>
                  {{ $t('hosts.forwardings.badge', { count: forwardingCountByHost.get(host.id) ?? 0 }) }}
                </NTooltip>

                <!-- Bastion: informativo (navegação planejada para versão futura) -->
                <NTooltip v-if="host.effectiveBastionSource !== 'none'" trigger="hover" placement="top">
                  <template #trigger>
                    <span
                      class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium cursor-default select-none"
                      style="background:rgba(99,102,241,0.16); color:#a5b4fc;"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/></svg>
                      {{ host.effectiveBastionName }}
                    </span>
                  </template>
                  {{ bastionTooltip(host) }}
                </NTooltip>
              </div>

              <!-- Tags do host -->
              <div v-if="host.tags.length" class="flex flex-wrap gap-1 mt-2">
                <span
                  v-for="tag in host.tags"
                  :key="tag.id"
                  class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium"
                  :style="{ background: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}44` }"
                >
                  {{ tag.name }}
                </span>
              </div>

              <div v-if="visibleAssociatedLinks(host).length" class="mt-2 flex flex-wrap gap-1.5">
                <NTooltip
                  v-for="link in visibleAssociatedLinks(host)"
                  :key="`card-link-${host.id}-${link.label}-${link.position}`"
                >
                  <template #trigger>
                    <NButton size="tiny" quaternary @click.stop="openAssociatedLink(host, link)">
                      <template #icon>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M10 13a5 5 0 0 0 7.54.54l2.92-2.92a5 5 0 0 0-7.07-7.07L11.5 5.43"/><path d="M14 11a5 5 0 0 0-7.54-.54L3.54 13.38a5 5 0 1 0 7.07 7.07l1.88-1.88"/></svg>
                      </template>
                      {{ link.label }}
                    </NButton>
                  </template>
                  {{ resolveHostLinkTemplate(link.urlTemplate, { id: host.id, name: host.name, ip: host.ip, port: host.port, sshUser: host.sshUser }) }}
                </NTooltip>
                <NTooltip v-if="hiddenAssociatedLinkCount(host) > 0" trigger="hover" placement="top">
                  <template #trigger>
                    <span
                      class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium cursor-default select-none"
                      style="background:rgba(255,255,255,0.06); color:#9ca3af;"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M10 13a5 5 0 0 0 7.54.54l2.92-2.92a5 5 0 0 0-7.07-7.07L11.5 5.43"/><path d="M14 11a5 5 0 0 0-7.54-.54L3.54 13.38a5 5 0 1 0 7.07 7.07l1.88-1.88"/></svg>
                      +{{ hiddenAssociatedLinkCount(host) }}
                    </span>
                  </template>
                  {{ $t('hosts.associatedLinks.hiddenCount', { count: hiddenAssociatedLinkCount(host) }) }}
                </NTooltip>
              </div>
              </div><!-- /flex-1 -->

              <!-- Rodapé: auth info + botões de ação -->
              <div class="mt-auto pt-3 flex items-center justify-between gap-2">
                <div class="flex items-center gap-1 min-w-0">
                  <NTooltip trigger="hover" placement="top">
                    <template #trigger>
                      <span class="text-sm leading-none cursor-default select-none shrink-0">{{ authTypeIcon(host.authType) }}</span>
                    </template>
                    {{ authTypeLabel(host.authType) }}
                  </NTooltip>
                  <NTooltip trigger="hover" placement="top">
                    <template #trigger>
                      <NTag size="tiny" :type="connectionModeTagType(host.connectionMode)">
                        {{ connectionModeShortLabel(host.connectionMode) }}
                      </NTag>
                    </template>
                    {{ connectionModeTooltip(host.connectionMode) }}
                  </NTooltip>
                  <NTooltip v-if="agentRouteStatusForHost(host)" trigger="hover" placement="top">
                    <template #trigger>
                      <NTag size="tiny" :type="agentRouteStatusForHost(host)!.type">
                        {{ agentRouteStatusForHost(host)!.type === 'success' ? '✓' : agentRouteStatusForHost(host)!.type === 'warning' ? '!' : '↩' }}
                      </NTag>
                    </template>
                    {{ agentRouteStatusForHost(host)!.label }} · {{ agentRouteStatusForHost(host)!.tooltip }}
                  </NTooltip>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <template v-if="canManage">
                    <NTooltip>
                      <template #trigger>
                        <NButton size="small" quaternary style="opacity: 0.45" @click.stop="openFolderMoveDialog(host)">📁</NButton>
                      </template>
                      {{ host.folderId ? (folders.find(f => f.id === host.folderId)?.name ?? $t('hosts.moveTo')) : $t('hosts.moveTo') }}
                    </NTooltip>
                    <NTooltip>
                      <template #trigger>
                        <NButton size="small" @click="openEdit(host)">✎</NButton>
                      </template>
                      {{ $t('common.edit') }}
                    </NTooltip>
                    <NTooltip>
                      <template #trigger>
                        <NButton size="small" @click="toggleFavoriteHost(host.id)">
                          {{ isFavoriteHost(host.id) ? '★' : '☆' }}
                        </NButton>
                      </template>
                      {{ isFavoriteHost(host.id) ? $t('hosts.removeFavorite') : $t('hosts.addFavorite') }}
                    </NTooltip>
                    <NTooltip>
                      <template #trigger>
                        <NButton size="small" type="error" @click="confirmDeleteHost(host)">✕</NButton>
                      </template>
                      {{ $t('common.delete') }}
                    </NTooltip>
                  </template>
                  <NButton size="small" type="primary" @click.stop="connect(host)">{{ $t('hosts.connect') }}</NButton>
                </div>
              </div>

            </NCard>
          </NGridItem>
        </NGrid>
      </NSpin>
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
                <h2 class="text-sm font-semibold text-white mb-3">{{ $t('hosts.help.scopesTitle') }}</h2>
                <div class="space-y-3">
                  <div
                    v-for="scope in helpScopes"
                    :key="scope"
                    class="rounded border border-white/10 p-3"
                  >
                    <NTag size="small">{{ $t(`hosts.help.scopes.${scope}.label`) }}</NTag>
                    <NText depth="3" class="block text-sm mt-2">{{ $t(`hosts.help.scopes.${scope}.description`) }}</NText>
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

    <NModal v-model:show="showHostModal" preset="card" :title="editingHostId ? $t('hosts.form.editTitle') : $t('hosts.form.newTitle')" style="width:520px">
      <NForm autocomplete="off" @submit.prevent="submitHost">
        <input type="text" name="fake-username" autocomplete="username" class="hidden" tabindex="-1">
        <input type="password" name="fake-password" autocomplete="current-password" class="hidden" tabindex="-1">
        <NFormItem :label="$t('hosts.form.name')">
          <NInput v-model:value="form.name" :placeholder="$t('hosts.form.namePlaceholder')" />
        </NFormItem>
        <NFormItem :label="$t('hosts.form.ip')">
          <NInput v-model:value="form.ip" :placeholder="$t('hosts.form.ipPlaceholder')" @input="resetTestResult" />
        </NFormItem>
        <NFormItem :label="$t('hosts.form.port')">
          <NInputNumber v-model:value="form.port" :min="1" :max="65535" style="width:120px" @update:value="resetTestResult" />
        </NFormItem>
        <NFormItem :label="$t('hosts.form.sshUser')">
          <NInput
            v-model:value="form.sshUser"
            :placeholder="$t('hosts.form.sshUserPlaceholder')"
            autocomplete="off"
            name="ssh-user"
            @input="resetTestResult"
          />
        </NFormItem>
        <NFormItem :label="$t('hosts.form.authType')">
          <NSelect v-model:value="form.authType" :options="authTypeOptions" @update:value="resetTestResult" />
        </NFormItem>
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
        <NFormItem v-if="form.authType === 'password' || form.authType === 'pem_password'" :label="$t('hosts.form.sshPassword')">
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
        <NFormItem v-if="form.authType === 'pem' || form.authType === 'pem_password'" :label="$t('hosts.form.pemKey')">
          <NSelect
            v-model:value="form.pemKeyId"
            :options="pemKeyOptions"
            clearable
            :placeholder="$t('hosts.form.pemPlaceholder')"
            @update:value="resetTestResult"
          />
        </NFormItem>

        <NFormItem :label="$t('hosts.form.tags')">
          <NSelect
            v-model:value="form.tagNames"
            multiple
            filterable
            tag
            :options="tagSelectOptions"
            :placeholder="$t('hosts.form.tagsPlaceholder')"
            :max-tag-count="8"
          />
        </NFormItem>

        <NFormItem v-if="opActive" :label="$t('hosts.form.onepasswordRef')">
          <NInput
            v-model:value="form.onePasswordRef"
            :placeholder="$t('hosts.form.opRefPlaceholder')"
            clearable
            style="font-family: monospace;"
            @input="resetTestResult"
          />
        </NFormItem>

        <!-- Testar conexão -->
        <div class="flex items-center gap-3 mb-2">
          <NButton
            :loading="testLoading"
            :disabled="!form.ip || !form.sshUser
              || (form.authType === 'password' && !form.password && !form.onePasswordRef && !hasSavedPasswordCredentialForCurrentAuth)
              || (form.authType === 'pem' && !form.pemKeyId)
              || (form.authType === 'pem_password' && (!form.pemKeyId || (!form.password && !form.onePasswordRef && !hasSavedPasswordCredentialForCurrentAuth)))"
            @click="runTestConnection"
          >
            ⚡ Testar conexão
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

        <NFormItem :label="$t('hosts.form.scope')">
          <NSelect v-model:value="form.scope" :options="scopeFormOptions" />
        </NFormItem>
        <NFormItem v-if="form.scope === 'team'" :label="$t('hosts.form.group')">
          <NSelect v-model:value="form.groupId" :options="groupOptions" clearable :placeholder="$t('hosts.form.selectGroup')" />
        </NFormItem>
        <NFormItem :label="$t('hosts.form.bastion')">
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
        </NFormItem>
        <NFormItem :label="$t('hosts.form.folder')">
          <NSelect v-model:value="form.folderId" :options="folderSelectOptions" clearable :placeholder="$t('hosts.form.noFolder')" />
        </NFormItem>
        <div class="mb-4 rounded-lg border border-gray-800 bg-[#111113] p-3">
          <div class="mb-2 flex items-center justify-between gap-3">
            <div>
              <div class="text-xs font-semibold text-gray-300">{{ $t('hosts.associatedLinks.title') }}</div>
              <div class="mt-1 text-[11px] text-gray-500">{{ $t('hosts.associatedLinks.hint') }}</div>
            </div>
            <NButton size="tiny" @click="addAssociatedLink">{{ $t('hosts.associatedLinks.add') }}</NButton>
          </div>

          <div class="mb-3 flex flex-wrap gap-1.5">
            <NTag v-for="variable in hostLinkTemplateVariables" :key="`host-link-var-${variable}`" size="small" type="info">
              {{ variable }}
            </NTag>
          </div>

          <div v-if="editingHostId !== null && opActive" class="mb-3 rounded border border-gray-800 bg-[#0d0d0f] p-3">
            <div class="text-xs font-semibold text-gray-300">{{ $t('hosts.associatedLinks.importTitle') }}</div>
            <div class="mt-1 text-[11px] text-gray-500">{{ $t('hosts.associatedLinks.importHint') }}</div>
            <div class="mt-3 rounded border border-gray-800 bg-[#111113] p-3">
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
                <NInput
                  v-model:value="link.urlTemplate"
                  type="textarea"
                  :autosize="{ minRows: 2, maxRows: 4 }"
                  :placeholder="$t('hosts.associatedLinks.urlPlaceholder')"
                />
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
                  <NButton size="tiny" quaternary :disabled="index === 0" @click="moveAssociatedLink(index, -1)">↑</NButton>
                  <NButton size="tiny" quaternary :disabled="index === (form.associatedLinks?.length ?? 0) - 1" @click="moveAssociatedLink(index, 1)">↓</NButton>
                  <NButton size="tiny" quaternary type="error" @click="removeAssociatedLink(index)">
                    {{ $t('common.delete') }}
                  </NButton>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-if="editingHost !== null" class="mb-4 rounded-lg border border-gray-800 bg-[#111113] p-3">
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
        <div v-if="editingHostId !== null" class="mb-4 rounded-lg border border-gray-800 bg-[#111113] p-3">
          <div class="text-xs font-semibold text-gray-300 mb-2">{{ $t('hostLinks.title') }}</div>
          <p class="mb-3 text-xs text-gray-500">{{ $t('hostLinks.cardHint') }}</p>
          <div class="grid grid-cols-[1fr_auto] gap-3 items-end">
            <div>
              <div class="text-xs text-gray-500 mb-1">{{ $t('hostLinks.expiresIn') }}</div>
              <NSelect
                v-model:value="hostLinkExpiryMinutes"
                :options="[
                  { label: $t('hostLinks.expiryOption', { minutes: 5 }), value: 5 },
                  { label: $t('hostLinks.expiryOption', { minutes: 10 }), value: 10 },
                  { label: $t('hostLinks.expiryOption', { minutes: 30 }), value: 30 },
                ]"
              />
            </div>
            <NButton :loading="hostLinkLoading" @click="generateHostLink">
              {{ $t('hostLinks.generate') }}
            </NButton>
          </div>
          <p class="mt-2 text-xs text-gray-500">{{ $t('hostLinks.hint') }}</p>
          <div v-if="latestHostLink" class="mt-3 rounded border border-gray-800 bg-[#0d0d0f] p-2.5">
            <div class="text-[11px] text-gray-500 mb-1">
              {{ $t('hostLinks.expiresAt', { date: formatHostKeyTimestamp(latestHostLink.expiresAt) }) }}
            </div>
            <div class="font-mono text-[11px] break-all text-blue-300">{{ latestHostLink.url }}</div>
            <div class="mt-2 flex justify-end">
              <NButton size="small" quaternary @click="copyLatestHostLink">{{ $t('hostLinks.copy') }}</NButton>
            </div>
          </div>
        </div>
        <div v-if="editingHostId !== null" class="mb-4 rounded-lg border border-gray-800 bg-[#111113] p-3">
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
        <div class="flex justify-end gap-2 mt-2">
          <NButton @click="showHostModal = false">{{ $t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="hostModalLoading" @click="submitHost">
            {{ editingHostId ? $t('common.save') : $t('common.create') }}
          </NButton>
        </div>
      </NForm>
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

    <!-- ── Import modal ─────────────────────────────────────────────────── -->
    <ImportHostsModal
      v-if="showImport"
      @close="showImport = false"
      @imported="load()"
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
  </div>
</template>

<style scoped>
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
.sidebar-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
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
</style>
