<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { NAlert, NButton, NCard, NEmpty, NInput, NModal, NPagination, NSpin } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { canOpenInWebTerminal, type HostPublic, type InventoryNodePublic } from '@nodeaccess/shared'
import type { FolderPublic } from '@/services/folder.service'
import { hostService, type HostSidebarSummary } from '@/services/host.service'

type FolderKind = 'corporate' | 'personal' | 'unfiled'
type FolderNode = {
  key: string
  kind: FolderKind
  id: number | null
  name: string
  depth: number
  parentKey: string | null
  count: number
  directCount: number
  directHostIds: number[]
}
type BranchState = { hosts: HostPublic[]; page: number; total: number; loading: boolean; error: string | null }

const PAGE_SIZE = 20
const ALL_PAGE_SIZE = 25

const props = defineProps<{
  folders: FolderPublic[]
  inventory: InventoryNodePublic[]
  summary: HostSidebarSummary | null
  loading: boolean
  error: string | null
  activeHostIds: number[]
}>()
const emit = defineEmits<{
  refresh: []
  selectHost: [host: HostPublic]
}>()
const { t } = useI18n()

const corporateSectionExpanded = ref(true)
const personalSectionExpanded = ref(true)
const expandedKeys = ref(new Set<string>())
const branchStates = ref(new Map<string, BranchState>())
const search = ref('')
const searchHosts = ref<HostPublic[]>([])
const searchLoading = ref(false)
const searchError = ref<string | null>(null)
let searchTimer: ReturnType<typeof setTimeout> | null = null
let searchSequence = 0

const showAllHosts = ref(false)
const allSearch = ref('')
const allHosts = ref<HostPublic[]>([])
const allPage = ref(1)
const allTotal = ref(0)
const allLoading = ref(false)
const allError = ref<string | null>(null)
let allTimer: ReturnType<typeof setTimeout> | null = null
let allSequence = 0

function replaceBranch(key: string, value: BranchState) {
  const next = new Map(branchStates.value)
  next.set(key, value)
  branchStates.value = next
}

const corporateNodes = computed<FolderNode[]>(() => {
  const folders = props.inventory.filter((node) => node.type === 'FOLDER')
  const hosts = props.inventory.filter((node) => node.type === 'HOST')
  const folderIds = new Set(folders.map((folder) => folder.id))
  const descendants = (rootId: number) => {
    const ids = new Set([rootId])
    let changed = true
    while (changed) {
      changed = false
      folders.forEach((folder) => {
        if (folder.parentId !== null && ids.has(folder.parentId) && !ids.has(folder.id)) {
          ids.add(folder.id); changed = true
        }
      })
    }
    return ids
  }
  return folders.map((folder) => {
    const directHostIds = hosts.filter((host) => host.parentId === folder.id && host.hostId !== null).map((host) => host.hostId as number)
    const subtree = descendants(folder.id)
    return {
      key: `corporate-${folder.id}`,
      kind: 'corporate',
      id: folder.id,
      name: folder.name,
      depth: Math.max(0, folder.depth - 1),
      parentKey: folder.parentId !== null && folderIds.has(folder.parentId) ? `corporate-${folder.parentId}` : null,
      count: hosts.filter((host) => host.parentId !== null && subtree.has(host.parentId)).length,
      directCount: directHostIds.length,
      directHostIds,
    }
  })
})

const personalNodes = computed<FolderNode[]>(() => {
  const folderIds = new Set(props.folders.map((folder) => folder.id))
  const descendants = (rootId: number) => {
    const ids = new Set([rootId])
    let changed = true
    while (changed) {
      changed = false
      props.folders.forEach((folder) => {
        if (folder.parentId !== null && ids.has(folder.parentId) && !ids.has(folder.id)) {
          ids.add(folder.id); changed = true
        }
      })
    }
    return ids
  }
  return props.folders.map((folder) => {
    const subtree = descendants(folder.id)
    const directCount = props.summary?.folders[String(folder.id)] ?? 0
    const count = [...subtree].reduce((total, id) => total + (props.summary?.folders[String(id)] ?? 0), 0)
    return {
      key: `personal-${folder.id}`,
      kind: 'personal',
      id: folder.id,
      name: folder.name,
      depth: depthForPersonalFolder(folder),
      parentKey: folder.parentId !== null && folderIds.has(folder.parentId) ? `personal-${folder.parentId}` : null,
      count,
      directCount,
      directHostIds: [],
    }
  })
})

const unfiledNode = computed<FolderNode>(() => ({
  key: 'personal-unfiled', kind: 'unfiled', id: null, name: t('hosts.unfiled'), depth: 0, parentKey: null,
  count: props.summary?.unfiled ?? 0, directCount: props.summary?.unfiled ?? 0, directHostIds: [],
}))

function depthForPersonalFolder(folder: FolderPublic) {
  const byId = new Map(props.folders.map((item) => [item.id, item]))
  let depth = 0
  let current = folder
  const visited = new Set<number>()
  while (current.parentId !== null && !visited.has(current.id)) {
    visited.add(current.id)
    const parent = byId.get(current.parentId)
    if (!parent) break
    depth += 1
    current = parent
  }
  return depth
}

function visibleFolders(nodes: FolderNode[]) {
  const ordered: FolderNode[] = []
  const append = (parentKey: string | null) => nodes
    .filter((node) => node.parentKey === parentKey)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }))
    .forEach((node) => {
      ordered.push(node)
      if (expandedKeys.value.has(node.key)) append(node.key)
    })
  append(null)
  return ordered
}

const visibleCorporateNodes = computed(() => visibleFolders(corporateNodes.value))
const visiblePersonalNodes = computed(() => visibleFolders(personalNodes.value))
const corporateTotal = computed(() => corporateNodes.value.filter((node) => node.parentKey === null).reduce((sum, node) => sum + node.count, 0))

function hasChildFolders(node: FolderNode) {
  const source = node.kind === 'corporate' ? corporateNodes.value : personalNodes.value
  return source.some((candidate) => candidate.parentKey === node.key)
}

function branchState(key: string) {
  return branchStates.value.get(key)
}

async function loadBranch(node: FolderNode, nextPage = 1) {
  const current = branchState(node.key)
  if (current?.loading || (nextPage === 1 && current && !current.error)) return
  replaceBranch(node.key, { hosts: current?.hosts ?? [], page: current?.page ?? 0, total: node.directCount, loading: true, error: null })
  try {
    let hosts: HostPublic[]
    let total = node.directCount
    if (node.kind === 'corporate') {
      const ids = node.directHostIds.slice((nextPage - 1) * PAGE_SIZE, nextPage * PAGE_SIZE)
      hosts = ids.length ? (await hostService.listVisibleByIds(ids)).data : []
      const order = new Map(ids.map((id, index) => [id, index]))
      hosts.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))
    } else {
      const response = await hostService.list(node.kind === 'unfiled'
        ? { page: nextPage, limit: PAGE_SIZE, unfiled: true }
        : { page: nextPage, limit: PAGE_SIZE, folderId: node.id as number })
      hosts = response.data.data
      total = response.data.total
    }
    const previous = nextPage > 1 ? branchState(node.key)?.hosts ?? [] : []
    replaceBranch(node.key, { hosts: [...previous, ...hosts.filter((host) => !previous.some((item) => item.id === host.id))], page: nextPage, total, loading: false, error: null })
  } catch {
    replaceBranch(node.key, { hosts: current?.hosts ?? [], page: current?.page ?? 0, total: node.directCount, loading: false, error: t('terminal.sessionsNavigator.loadError') })
  }
}

async function toggleFolder(node: FolderNode) {
  const next = new Set(expandedKeys.value)
  if (next.has(node.key)) next.delete(node.key)
  else {
    next.add(node.key)
    if (node.directCount > 0) void loadBranch(node)
  }
  expandedKeys.value = next
}

function selectHost(host: HostPublic) {
  if (hostDisabled(host)) return
  emit('selectHost', host)
}

function hostDisabled(host: HostPublic) {
  return host.accessPermissions?.connect === false || !canOpenInWebTerminal(host.accessProtocol)
}

function hostSubtitle(host: HostPublic) {
  return `${host.ip}:${host.port} · ${host.accessProtocol.toUpperCase()} · ${connectionModeLabel(host)}`
}

function connectionModeLabel(host: HostPublic) {
  if (host.connectionMode === 'direct') return t('hosts.form.connectionShortDirect')
  if (host.connectionMode === 'agent_user') return t('hosts.form.connectionShortUser')
  if (host.connectionMode === 'agent_tenant_fallback' || host.connectionMode === 'agent') return t('hosts.form.connectionShortAgent')
  if (host.connectionMode === 'private_access_connector') return t('hosts.form.connectionShortPrivateAccess')
  return t('hosts.form.connectionShortAuto')
}

async function runSearch(value: string) {
  const query = value.trim()
  const sequence = ++searchSequence
  if (!query) { searchHosts.value = []; searchError.value = null; searchLoading.value = false; return }
  searchLoading.value = true
  searchError.value = null
  try {
    const response = await hostService.list({ page: 1, limit: PAGE_SIZE, search: query })
    if (sequence === searchSequence) searchHosts.value = response.data.data
  } catch {
    if (sequence === searchSequence) searchError.value = t('terminal.sessionsNavigator.loadError')
  } finally {
    if (sequence === searchSequence) searchLoading.value = false
  }
}

watch(search, (value) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void runSearch(value), 250)
})

async function loadAllHosts(page = allPage.value) {
  const sequence = ++allSequence
  allLoading.value = true
  allError.value = null
  try {
    const response = await hostService.list({ page, limit: ALL_PAGE_SIZE, search: allSearch.value.trim() || undefined })
    if (sequence !== allSequence) return
    allHosts.value = response.data.data
    allTotal.value = response.data.total
    allPage.value = response.data.page
  } catch {
    if (sequence === allSequence) allError.value = t('terminal.sessionsNavigator.loadError')
  } finally {
    if (sequence === allSequence) allLoading.value = false
  }
}

function openAllHosts() {
  showAllHosts.value = true
  allPage.value = 1
  void loadAllHosts(1)
}

watch(allSearch, () => {
  if (!showAllHosts.value) return
  if (allTimer) clearTimeout(allTimer)
  allTimer = setTimeout(() => { allPage.value = 1; void loadAllHosts(1) }, 250)
})

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
  if (allTimer) clearTimeout(allTimer)
  searchSequence += 1
  allSequence += 1
})
</script>

<template>
  <aside class="terminal-sessions-navigator na-card flex w-[300px] shrink-0 flex-col border-r border-gray-800 max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:z-50 max-lg:w-[min(320px,88vw)] max-lg:shadow-2xl" data-terminal-sessions-navigator="true" :aria-label="$t('terminal.sessionsNavigator.title')">
    <div class="border-b border-gray-800 p-3">
      <div class="flex items-center justify-between gap-2">
        <div><div class="text-sm font-semibold text-white">{{ $t('terminal.sessionsNavigator.title') }}</div><div class="text-[11px] text-gray-500">{{ $t('terminal.sessionsNavigator.subtitle') }}</div></div>
        <NButton size="tiny" text :loading="loading" :aria-label="$t('common.refresh')" @click="emit('refresh')">↻</NButton>
      </div>
      <NInput v-model:value="search" size="small" clearable class="mt-3" :placeholder="$t('terminal.sessionsNavigator.search')" data-terminal-sessions-search="true" />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-2">
      <NAlert v-if="error" type="error" :bordered="false" class="mb-2">{{ error }}</NAlert>
      <NSpin :show="loading || searchLoading">
        <template v-if="search.trim()">
          <NAlert v-if="searchError" type="error" :bordered="false">{{ searchError }}</NAlert>
          <div class="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{{ $t('terminal.sessionsNavigator.searchResults') }}</div>
          <button v-for="host in searchHosts" :key="`search-${host.id}`" type="button" class="session-host-row" :class="[hostDisabled(host) ? 'cursor-not-allowed opacity-50' : '', activeHostIds.includes(host.id) ? 'na-selection-active' : '']" :aria-current="activeHostIds.includes(host.id) ? 'true' : undefined" :disabled="hostDisabled(host)" :data-terminal-sessions-host="host.id" @click="selectHost(host)">
            <span class="h-2 w-2 shrink-0 rounded-full" :class="activeHostIds.includes(host.id) ? 'bg-green-400' : 'bg-gray-600'" />
            <span class="min-w-0 flex-1"><span class="block truncate text-xs text-gray-200">{{ host.name }}</span><span class="block truncate font-mono text-[10px] text-gray-500">{{ hostSubtitle(host) }}</span></span>
          </button>
          <NEmpty v-if="!searchLoading && !searchHosts.length" size="small" :description="$t('terminal.hostSwitcherEmpty')" class="py-5" />
        </template>

        <template v-else>
          <button type="button" class="sessions-sidebar-item w-full text-gray-300 hover:bg-white/5" data-terminal-all-hosts="true" @click="openAllHosts">
            <span aria-hidden="true">🖥</span><span class="min-w-0 flex-1 truncate">{{ $t('hosts.allHosts') }}</span><span class="sessions-sidebar-badge">{{ summary?.all ?? 0 }}</span>
          </button>

          <button type="button" class="sessions-section-toggle" :aria-expanded="corporateSectionExpanded" @click="corporateSectionExpanded = !corporateSectionExpanded">
            <span aria-hidden="true">{{ corporateSectionExpanded ? '▾' : '▸' }}</span><span class="min-w-0 flex-1 truncate">{{ $t('hosts.corporateFolders.title') }}</span><span class="sessions-sidebar-badge">{{ corporateTotal }}</span>
          </button>
          <template v-if="corporateSectionExpanded">
            <template v-for="node in visibleCorporateNodes" :key="node.key">
              <button type="button" class="sessions-sidebar-item" :style="{ paddingLeft: `${8 + node.depth * 14}px` }" :aria-expanded="expandedKeys.has(node.key)" :data-terminal-corporate-folder="node.id" @click="toggleFolder(node)">
                <span class="w-3 text-center text-gray-500" aria-hidden="true">{{ expandedKeys.has(node.key) ? '▾' : '▸' }}</span><span aria-hidden="true">📁</span><span class="min-w-0 flex-1 truncate">{{ node.name }}</span><span v-if="node.count" class="sessions-sidebar-badge">{{ node.count }}</span>
              </button>
              <template v-if="expandedKeys.has(node.key)">
                <div v-if="branchState(node.key)?.loading && !branchState(node.key)?.hosts.length" class="py-1 text-center text-[10px] text-gray-500">{{ $t('common.loading') }}</div>
                <NAlert v-if="branchState(node.key)?.error" type="error" :bordered="false" class="my-1 text-xs">
                  <div class="flex items-center justify-between gap-2"><span>{{ branchState(node.key)?.error }}</span><NButton size="tiny" secondary data-terminal-folder-retry="true" @click.stop="loadBranch(node)">{{ $t('common.retry') }}</NButton></div>
                </NAlert>
                <button v-for="host in branchState(node.key)?.hosts ?? []" :key="`${node.key}-${host.id}`" type="button" class="session-host-row" :class="[hostDisabled(host) ? 'cursor-not-allowed opacity-50' : '', activeHostIds.includes(host.id) ? 'na-selection-active' : '']" :aria-current="activeHostIds.includes(host.id) ? 'true' : undefined" :disabled="hostDisabled(host)" :style="{ paddingLeft: `${30 + node.depth * 14}px` }" :data-terminal-sessions-host="host.id" @click="selectHost(host)">
                  <span class="h-2 w-2 shrink-0 rounded-full" :class="activeHostIds.includes(host.id) ? 'bg-green-400' : 'bg-gray-600'" /><span class="min-w-0 flex-1"><span class="block truncate text-xs text-gray-200">{{ host.name }}</span><span class="block truncate font-mono text-[10px] text-gray-500">{{ hostSubtitle(host) }}</span></span>
                </button>
                <NButton v-if="branchState(node.key) && branchState(node.key)!.hosts.length < branchState(node.key)!.total" size="tiny" text class="ml-8 text-blue-300" :loading="branchState(node.key)?.loading" @click="loadBranch(node, (branchState(node.key)?.page ?? 0) + 1)">{{ $t('terminal.sessionsNavigator.loadMore') }}</NButton>
                <div v-if="!hasChildFolders(node) && node.directCount === 0" class="py-1 text-[10px] text-gray-600" :style="{ paddingLeft: `${30 + node.depth * 14}px` }">{{ $t('terminal.sessionsNavigator.emptyFolder') }}</div>
              </template>
            </template>
          </template>

          <button type="button" class="sessions-section-toggle" :aria-expanded="personalSectionExpanded" @click="personalSectionExpanded = !personalSectionExpanded">
            <span aria-hidden="true">{{ personalSectionExpanded ? '▾' : '▸' }}</span><span class="min-w-0 flex-1 truncate">{{ $t('hosts.personalFolders.title') }}</span><span class="sessions-sidebar-badge">{{ personalNodes.length + 1 }}</span>
          </button>
          <template v-if="personalSectionExpanded">
            <template v-for="node in [unfiledNode, ...visiblePersonalNodes]" :key="node.key">
              <button type="button" class="sessions-sidebar-item" :style="{ paddingLeft: `${8 + node.depth * 14}px` }" :aria-expanded="expandedKeys.has(node.key)" :data-terminal-personal-folder="node.id ?? 'unfiled'" @click="toggleFolder(node)">
                <span class="w-3 text-center text-gray-500" aria-hidden="true">{{ expandedKeys.has(node.key) ? '▾' : '▸' }}</span><span aria-hidden="true">{{ node.kind === 'unfiled' ? '📋' : '📁' }}</span><span class="min-w-0 flex-1 truncate">{{ node.name }}</span><span v-if="node.count" class="sessions-sidebar-badge">{{ node.count }}</span>
              </button>
              <template v-if="expandedKeys.has(node.key)">
                <div v-if="branchState(node.key)?.loading && !branchState(node.key)?.hosts.length" class="py-1 text-center text-[10px] text-gray-500">{{ $t('common.loading') }}</div>
                <NAlert v-if="branchState(node.key)?.error" type="error" :bordered="false" class="my-1 text-xs">
                  <div class="flex items-center justify-between gap-2"><span>{{ branchState(node.key)?.error }}</span><NButton size="tiny" secondary data-terminal-folder-retry="true" @click.stop="loadBranch(node)">{{ $t('common.retry') }}</NButton></div>
                </NAlert>
                <button v-for="host in branchState(node.key)?.hosts ?? []" :key="`${node.key}-${host.id}`" type="button" class="session-host-row" :class="[hostDisabled(host) ? 'cursor-not-allowed opacity-50' : '', activeHostIds.includes(host.id) ? 'na-selection-active' : '']" :aria-current="activeHostIds.includes(host.id) ? 'true' : undefined" :disabled="hostDisabled(host)" :style="{ paddingLeft: `${30 + node.depth * 14}px` }" :data-terminal-sessions-host="host.id" @click="selectHost(host)">
                  <span class="h-2 w-2 shrink-0 rounded-full" :class="activeHostIds.includes(host.id) ? 'bg-green-400' : 'bg-gray-600'" /><span class="min-w-0 flex-1"><span class="block truncate text-xs text-gray-200">{{ host.name }}</span><span class="block truncate font-mono text-[10px] text-gray-500">{{ hostSubtitle(host) }}</span></span>
                </button>
                <NButton v-if="branchState(node.key) && branchState(node.key)!.hosts.length < branchState(node.key)!.total" size="tiny" text class="ml-8 text-blue-300" :loading="branchState(node.key)?.loading" @click="loadBranch(node, (branchState(node.key)?.page ?? 0) + 1)">{{ $t('terminal.sessionsNavigator.loadMore') }}</NButton>
                <div v-if="!hasChildFolders(node) && node.directCount === 0" class="py-1 text-[10px] text-gray-600" :style="{ paddingLeft: `${30 + node.depth * 14}px` }">{{ $t('terminal.sessionsNavigator.emptyFolder') }}</div>
              </template>
            </template>
          </template>
        </template>
      </NSpin>
    </div>
  </aside>

  <NModal v-model:show="showAllHosts" :mask-closable="true">
    <NCard role="dialog" aria-modal="true" :title="$t('terminal.sessionsNavigator.allHostsTitle')" class="w-[min(680px,94vw)]" :bordered="false" data-terminal-all-hosts-dialog="true">
      <NInput v-model:value="allSearch" clearable :placeholder="$t('terminal.sessionsNavigator.search')" data-terminal-all-hosts-search="true" />
      <NAlert v-if="allError" type="error" class="mt-3">{{ allError }}</NAlert>
      <NSpin :show="allLoading">
        <div class="mt-3 max-h-[55vh] overflow-y-auto">
          <button v-for="host in allHosts" :key="`all-${host.id}`" type="button" class="session-host-row" :class="[hostDisabled(host) ? 'cursor-not-allowed opacity-50' : '', activeHostIds.includes(host.id) ? 'na-selection-active' : '']" :aria-current="activeHostIds.includes(host.id) ? 'true' : undefined" :disabled="hostDisabled(host)" :data-terminal-all-host-row="host.id" @click="selectHost(host); showAllHosts = false">
            <span class="h-2 w-2 shrink-0 rounded-full" :class="activeHostIds.includes(host.id) ? 'bg-green-400' : 'bg-gray-600'" /><span class="min-w-0 flex-1"><span class="block truncate text-sm text-gray-100">{{ host.name }}</span><span class="block truncate font-mono text-[11px] text-gray-500">{{ hostSubtitle(host) }}</span></span>
          </button>
          <NEmpty v-if="!allLoading && !allHosts.length" :description="$t('terminal.hostSwitcherEmpty')" class="py-8" />
        </div>
      </NSpin>
      <div class="mt-3 flex items-center justify-between gap-3 border-t border-gray-800 pt-3">
        <span class="text-xs text-gray-500">{{ $t('terminal.sessionsNavigator.totalHosts', { count: allTotal }) }}</span>
        <NPagination v-model:page="allPage" :page-size="ALL_PAGE_SIZE" :item-count="allTotal" :page-slot="5" @update:page="loadAllHosts" />
      </div>
    </NCard>
  </NModal>
</template>

<style scoped>
.sessions-sidebar-item,.sessions-section-toggle,.session-host-row{display:flex;width:100%;min-height:30px;align-items:center;gap:.4rem;border:1px solid transparent;border-radius:.25rem;padding:.35rem .5rem;text-align:left;transition:background-color .15s ease,color .15s ease}.sessions-sidebar-item:hover,.session-host-row:hover{background:var(--na-sidebar-hover)}.sessions-section-toggle{margin-top:.5rem;border-top:1px solid var(--na-border);border-radius:0;color:var(--na-text-muted);font-size:.625rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase}.sessions-section-toggle:hover{color:var(--na-text-strong)}.sessions-sidebar-badge{flex:none;min-width:1.25rem;border-radius:9999px;background:var(--na-shortcut-bg);padding:.05rem .35rem;text-align:center;font-size:.625rem;color:var(--na-text-muted)}.session-host-row:focus-visible,.sessions-sidebar-item:focus-visible,.sessions-section-toggle:focus-visible{outline:2px solid rgb(37 99 235);outline-offset:1px}
</style>
