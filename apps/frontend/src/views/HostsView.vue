<script setup lang="ts">
import { ref, onMounted, computed, nextTick, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NSpace, NInput, NInputNumber, NSelect, NButton, NCard, NTag, NSpin, NSwitch,
  NEmpty, NGrid, NGridItem, NText, NAlert, NModal, NForm, NFormItem,
  NScrollbar, NTooltip, NDropdown, useMessage, useDialog,
} from 'naive-ui'
import type { DropdownOption } from 'naive-ui'
import type { HostPublic, CreateHostDto, HostKeyTrustEvent, HostLinkCreated, PemKeyPublic, TestConnectionResult } from '@nodeaccess/shared'
import { hostService }        from '@/services/host.service'
import { groupService }       from '@/services/group.service'
import { folderService, type FolderPublic } from '@/services/folder.service'
import { pemKeyService }      from '@/services/pem-key.service'
import { integrationService } from '@/services/integration.service'
import { tagService }         from '@/services/tag.service'
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

const router    = useRouter()
const route     = useRoute()
const auth      = useAuthStore()
const termStore = useTerminalStore()
const msg       = useMessage()
const dialog    = useDialog()
const { t }     = useI18n()
const canManage = computed(() => auth.isAdmin || !!auth.user?.canManageHosts)
const hasOpenSessions = computed(() => termStore.tabs.length > 0)
const sidebarSearch = ref('')

// ─── Dados ───────────────────────────────────────────────────────────────────

const hosts        = ref<HostPublic[]>([])
const folders      = ref<FolderPublic[]>([])
const groupOptions = ref<{ label: string; value: number }[]>([])
const pemKeys      = ref<PemKeyPublic[]>([])
const allTags      = ref<TagPublic[]>([])
const forwardings  = ref<PortForwardingWithHost[]>([])
const total        = ref(0)
const loading      = ref(false)
const error        = ref<string | null>(null)

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
      createHostId: String(hostId),
      createHostName: hostName,
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
  const [fRes, gRes, pkRes, intRes, tagRes, fwRes] = await Promise.allSettled([
    folderService.list(),
    groupService.list(),
    pemKeyService.list(),
    integrationService.list(),
    tagService.list(),
    portForwardingService.listAll(),
  ])
  if (fRes.status   === 'fulfilled') folders.value      = fRes.value.data
  if (gRes.status   === 'fulfilled') groupOptions.value = gRes.value.data.map((g) => ({ label: g.name, value: g.id }))
  if (pkRes.status  === 'fulfilled') pemKeys.value      = pkRes.value.data
  if (tagRes.status === 'fulfilled') allTags.value      = tagRes.value.data
  if (fwRes.status  === 'fulfilled') forwardings.value  = fwRes.value.data
  if (intRes.status === 'fulfilled') {
    const op = intRes.value.data.find((i) => i.provider === 'onepassword')
    opActive.value = !!(op?.enabled && op?.hasToken)
  }
}

onMounted(() => { load(); loadSidebar() })

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
  { label: t('hosts.form.connectionDirect'), value: 'direct' },
  { label: t('hosts.form.connectionAgent'), value: 'agent' },
])

const folderSelectOptions = computed(() =>
  folders.value.map((f) => ({ label: f.name, value: f.id })),
)

const pemKeyOptions = computed(() =>
  pemKeys.value.map((k) => ({ label: k.name, value: k.id })),
)

const emptyForm = (): CreateHostDto & { folderId?: number } => ({
  name: '', ip: '', port: 22, sshUser: '', authType: 'password',
  connectionMode: 'direct',
  scope: 'personal', groupId: undefined, folderId: undefined, password: '', pemKeyId: undefined,
  onePasswordRef: undefined, tagNames: [],
})

const form = ref<CreateHostDto & { folderId?: number }>(emptyForm())

const tagSelectOptions = computed(() =>
  allTags.value.map((t) => ({ label: t.name, value: t.name })),
)

function openCreate() {
  editingHostId.value = null
  editingHostKeyHistory.value = []
  latestHostLink.value = null
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
  form.value = {
    name: host.name, ip: host.ip, port: host.port, sshUser: host.sshUser,
    authType: host.authType, connectionMode: host.connectionMode, scope: host.scope,
    groupId:  host.groupId  ?? undefined,
    folderId: host.folderId ?? undefined,
    onePasswordRef: host.onePasswordRef ?? undefined,
    tagNames:       host.tags.map((t) => t.name),
    password: '',
  }
  testResult.value = null
  showHostModal.value = true
  void refreshEditingHost(host.id)
  void loadHostKeyHistory(host.id)
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
      ip:        form.value.ip,
      port:      form.value.port,
      sshUser:   form.value.sshUser,
      authType:  form.value.authType,
      connectionMode: form.value.connectionMode,
      password:  form.value.authType === 'password' || form.value.authType === 'pem_password' ? form.value.password : undefined,
      pemKeyId:  form.value.authType === 'pem' || form.value.authType === 'pem_password' ? form.value.pemKeyId : undefined,
      bastionId: form.value.bastionId,
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

async function submitHost() {
  hostModalLoading.value = true
  try {
    const payload = { ...form.value }
    if (payload.authType === 'pem') delete payload.password
    if (editingHostId.value !== null) {
      await hostService.update(editingHostId.value, payload)
      msg.success(t('hosts.messages.hostUpdated'))
    } else {
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

// ─── Conexão ─────────────────────────────────────────────────────────────────

function connect(host: HostPublic) {
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

function visibleTags(host: HostPublic) {
  return host.tags.slice(0, 1)
}

function hiddenTagCount(host: HostPublic) {
  return Math.max(0, host.tags.length - 1)
}

function hiddenTagNames(host: HostPublic) {
  return host.tags.slice(1).map((tag) => tag.name).join(', ')
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
            v-if="hasOpenSessions"
            ghost
            type="primary"
            @click="openSession(termStore.activeId ?? undefined)"
          >
            🖥 Sessões abertas ({{ termStore.tabs.length }})
          </NButton>
          <template v-if="canManage">
          <NButton ghost @click="showImport = true">⬆ {{ $t('import.title') }}</NButton>
          <NButton type="primary" @click="openCreate">{{ $t('hosts.newHost') }}</NButton>
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
              <NButton type="primary" class="mt-2" @click="openCreate">{{ $t('hosts.empty.createFirst') }}</NButton>
            </template>
          </NEmpty>
        </div>

        <div
          v-else-if="hostDisplayMode === 'list'"
          class="overflow-hidden rounded-xl border border-gray-800 bg-[#17171c]"
        >
          <div class="hidden lg:grid grid-cols-[minmax(0,1.4fr)_120px_140px_180px_120px_220px] gap-3 border-b border-gray-800 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            <div>{{ $t('hosts.list.columns.host') }}</div>
            <div>{{ $t('hosts.list.columns.scope') }}</div>
            <div>{{ $t('hosts.list.columns.auth') }}</div>
            <div>{{ $t('hosts.list.columns.tags') }}</div>
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
            <div class="hidden lg:grid lg:grid-cols-[minmax(0,1.4fr)_120px_140px_180px_120px_220px] gap-3 items-center">
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
                <div class="mt-1 text-[11px] text-gray-500">
                  {{ host.connectionMode === 'agent' ? $t('hosts.form.connectionAgent') : $t('hosts.form.connectionDirect') }}
                </div>
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
                ·
                {{ host.connectionMode === 'agent' ? $t('hosts.form.connectionAgent') : $t('hosts.form.connectionDirect') }}
              </div>
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
          <NGridItem v-for="host in filteredHosts" :key="host.id">
            <NCard
              :data-host-id="host.id"
              hoverable :bordered="false"
              :style="{
                background: '#1e1e22',
                opacity: draggingHost?.id === host.id ? '0.4' : '1',
                transition: 'opacity 0.15s',
                cursor: canManage ? 'grab' : undefined,
              }"
              :draggable="canManage"
              @dragstart="canManage && onDragStart($event, host)"
              @dragend="onDragEnd"
            >
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

              <div v-if="(forwardingCountByHost.get(host.id) ?? 0) > 0" class="mt-2 flex flex-wrap gap-1.5">
                <span
                  class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium"
                  style="background:rgba(59,130,246,0.16); color:#93c5fd;"
                >
                  {{ $t('hosts.forwardings.badge', { count: forwardingCountByHost.get(host.id) ?? 0 }) }}
                </span>
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

              <div class="mt-3 flex items-center justify-between">
                <NText depth="3" class="text-xs">
                  {{ authTypeLabel(host.authType) }}
                  ·
                  {{ host.connectionMode === 'agent' ? $t('hosts.form.connectionAgent') : $t('hosts.form.connectionDirect') }}
                </NText>
                <NSpace size="small">
                  <template v-if="canManage">
                    <!-- Mover para pasta -->
                    <NSelect
                      :value="host.folderId ?? 0"
                      :options="folderMoveOptions"
                      size="tiny"
                      style="width: 130px"
                      :placeholder="folders.length ? $t('hosts.moveTo') : $t('hosts.noFolders')"
                      @update:value="(v) => moveToFolder(host, Number(v) > 0 ? Number(v) : null)"
                    />
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
                </NSpace>
              </div>
            </NCard>
          </NGridItem>
        </NGrid>
      </NSpin>
    </div>

    <!-- ── Modal: criar/editar host ── -->
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
          <NSelect v-model:value="form.connectionMode" :options="connectionModeOptions" @update:value="resetTestResult" />
        </NFormItem>
        <NFormItem v-if="form.authType === 'password' || form.authType === 'pem_password'" :label="$t('hosts.form.sshPassword')">
          <NInput
            v-model:value="form.password"
            type="password"
            show-password-on="click"
            autocomplete="new-password"
            name="ssh-password"
            @input="resetTestResult"
          />
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
              || (form.authType === 'password' && !form.password && !form.onePasswordRef)
              || (form.authType === 'pem' && !form.pemKeyId)
              || (form.authType === 'pem_password' && (!form.pemKeyId || (!form.password && !form.onePasswordRef)))"
            @click="runTestConnection"
          >
            ⚡ Testar conexão
          </NButton>
          <div v-if="testResult" class="flex items-center gap-2 text-sm">
            <span
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
              :style="testResult.success
                ? 'background:#16a34a22;color:#4ade80;'
                : 'background:#dc262622;color:#f87171;'"
            >
              {{ testResult.success ? '✓ Sucesso' : '✗ Falhou' }}
            </span>
            <span style="color:#9ca3af;">{{ testResult.message }}</span>
            <span v-if="testResult.latencyMs !== null" style="color:#6b7280;font-size:11px;">
              ({{ testResult.latencyMs }}ms)
            </span>
          </div>
        </div>

        <NFormItem :label="$t('hosts.form.scope')">
          <NSelect v-model:value="form.scope" :options="scopeFormOptions" />
        </NFormItem>
        <NFormItem v-if="form.scope === 'team'" :label="$t('hosts.form.group')">
          <NSelect v-model:value="form.groupId" :options="groupOptions" clearable :placeholder="$t('hosts.form.selectGroup')" />
        </NFormItem>
        <NFormItem :label="$t('hosts.form.folder')">
          <NSelect v-model:value="form.folderId" :options="folderSelectOptions" clearable :placeholder="$t('hosts.form.noFolder')" />
        </NFormItem>
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
            <NButton size="tiny" @click="openHostForwardings(editingHostId, editingHost?.name ?? '')">{{ $t('forwardingsPage.addTunnel') }}</NButton>
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
                  <NButton size="tiny" quaternary @click="openEditHostForwarding(forwarding)">{{ $t('common.edit') }}</NButton>
                  <NButton size="tiny" quaternary type="error" @click="confirmDeleteHostForwarding(forwarding)">{{ $t('common.delete') }}</NButton>
                </div>
              </div>
              <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                <span class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-gray-400">
                  <NSwitch
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
