<script setup lang="ts">
import { ref, computed, watch, h, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NTree, NButton, NSpace, NText, NSpin, NEmpty, NInput, NProgress, NTooltip,
  useMessage, useDialog,
} from 'naive-ui'
import type { TreeOption } from 'naive-ui'
import type { SftpEntry } from '@nodeaccess/shared'
import { getSftpErrorMessage, sftpService } from '@/services/sftp.service'
import { hasTerminalSftpChannel, homeViaTerminalSftp, listViaTerminalSftp } from '@/services/terminal-sftp-channel.service'
import { usePlatform } from '@/composables/usePlatform'
import FileEditorModal from '@/components/FileEditorModal.vue'

const props = defineProps<{ hostId: number; sessionId?: number | null }>()

const { t } = useI18n()

const { shortcuts } = usePlatform()
const message = useMessage()
const dialog  = useDialog()

// ── Transfer tracking ─────────────────────────────────────────────────────

interface Transfer {
  id:       string
  name:     string
  type:     'upload' | 'download'
  progress: number           // 0–100
  loaded:   number           // bytes transferred
  total?:   number           // total bytes (undefined = unknown)
  status:   'active' | 'done' | 'error'
}

const transfers = ref<Transfer[]>([])

const hasTransfers     = computed(() => transfers.value.length > 0)
const showTransferPanel = computed(() => hasTransfers.value)

function addTransfer(name: string, type: Transfer['type']): string {
  const id: string = crypto.randomUUID()
  transfers.value.push({ id, name, type, progress: 0, loaded: 0, status: 'active' })
  return id
}

function updateTransfer(id: string, patch: Partial<Transfer>) {
  const item = transfers.value.find(t => t.id === id)
  if (item) Object.assign(item, patch)
}

function clearDone() {
  transfers.value = transfers.value.filter(t => t.status === 'active')
}

function autoClear(id: string, delay = 4000) {
  setTimeout(() => {
    transfers.value = transfers.value.filter(t => t.id !== id)
  }, delay)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

// ── Connection state ──────────────────────────────────────────────────────

type ConnStatus = 'connecting' | 'connected' | 'error'
const status  = ref<ConnStatus>('connecting')
const homeDir = ref('/')

async function resolveHome() {
  if (props.sessionId && hasTerminalSftpChannel(props.sessionId)) {
    try { return await homeViaTerminalSftp(props.sessionId) } catch { /* REST fallback */ }
  }
  return (await sftpService.ping(props.hostId)).data.home ?? '/'
}

async function listDirectory(path: string) {
  if (props.sessionId && hasTerminalSftpChannel(props.sessionId)) {
    try { return await listViaTerminalSftp(props.sessionId, path) } catch { /* REST fallback */ }
  }
  return (await sftpService.list(props.hostId, path)).data
}

async function initConnection() {
  status.value = 'connecting'
  try {
    homeDir.value = await resolveHome()
    status.value  = 'connected'
    treeData.value = [makeNode('/', '/')]
    await loadTreeChildren(treeData.value[0])
    await navigate('/')
  } catch {
    status.value = 'error'
  }
}

watch(() => [props.hostId, props.sessionId] as const, () => initConnection(), { immediate: true })

// ── Tree state ────────────────────────────────────────────────────────────

const treeData     = ref<TreeOption[]>([])
const selectedKeys = ref<string[]>([])
const expandedKeys = ref<string[]>([])

function makeNode(path: string, label: string): TreeOption {
  return {
    key:      path,
    label,
    isLeaf:   false,
    children: undefined,
    prefix:   () => h('span', { style: 'margin-right:4px;font-size:13px' }, '📁'),
  }
}

async function loadTreeChildren(node: TreeOption): Promise<void> {
  const path = node.key as string
  try {
    const data = await listDirectory(path)
    const dirs = data.entries
      .filter(e => e.type === 'directory')
      .sort((a, b) => a.name.localeCompare(b.name))
    node.children = dirs.length > 0 ? dirs.map(e => makeNode(e.path, e.name)) : []
  } catch {
    node.children = []
  }
}

async function onTreeLoad(node: TreeOption): Promise<void> {
  await loadTreeChildren(node)
}

function findNode(nodes: TreeOption[], key: string): TreeOption | null {
  for (const n of nodes) {
    if (n.key === key) return n
    if (n.children) {
      const found = findNode(n.children, key)
      if (found) return found
    }
  }
  return null
}

async function expandToPath(path: string): Promise<void> {
  const parts = path.split('/').filter(Boolean)
  const ancestors: string[] = ['/']
  for (let i = 1; i < parts.length; i++) {
    ancestors.push('/' + parts.slice(0, i).join('/'))
  }
  for (const ancestor of ancestors) {
    if (!expandedKeys.value.includes(ancestor)) {
      expandedKeys.value = [...expandedKeys.value, ancestor]
    }
    const node = findNode(treeData.value, ancestor)
    if (node && node.children === undefined) await loadTreeChildren(node)
  }
  selectedKeys.value = [path]
}

function onTreeSelect(keys: Array<string | number>) {
  if (keys.length === 0) return
  navigate(keys[0] as string)
}

// ── Right-panel file list ─────────────────────────────────────────────────

const currentPath = ref('/')
const entries     = ref<SftpEntry[]>([])
const loading     = ref(false)

const sorted = computed(() =>
  [...entries.value].sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1
    if (a.type !== 'directory' && b.type === 'directory') return 1
    return a.name.localeCompare(b.name)
  }),
)

async function loadDir(path: string) {
  loading.value = true
  try {
    const data = await listDirectory(path)
    entries.value = data.entries
  } catch {
    message.error(t('fileManager.messages.loadError'))
  } finally {
    loading.value = false
  }
}

async function navigate(path: string) {
  currentPath.value  = path
  selectedKeys.value = [path]
  await loadDir(path)
}

async function openEntry(entry: SftpEntry) {
  if (entry.type !== 'directory') return
  await expandToPath(entry.path)
  await navigate(entry.path)
}

function goUp() {
  if (currentPath.value === '/') return
  const parent = currentPath.value.split('/').slice(0, -1).join('/') || '/'
  expandToPath(parent)
  navigate(parent)
}

// ── Breadcrumb ────────────────────────────────────────────────────────────

const breadcrumbs = computed(() => {
  const parts = currentPath.value.split('/').filter(Boolean)
  const crumbs: { label: string; path: string }[] = [{ label: '/', path: '/' }]
  parts.forEach((p, i) => {
    crumbs.push({ label: p, path: '/' + parts.slice(0, i + 1).join('/') })
  })
  return crumbs
})

// ── Resize handle ─────────────────────────────────────────────────────────

const treeWidth = ref(240)

function startResize(e: MouseEvent) {
  const startX     = e.clientX
  const startWidth = treeWidth.value
  function onMove(ev: MouseEvent) {
    treeWidth.value = Math.max(160, Math.min(480, startWidth + (ev.clientX - startX)))
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// (mousemove/mouseup listeners are auto-cleaned on mouseup)

// ── Formatting ────────────────────────────────────────────────────────────

function formatSize(bytes: number, type: SftpEntry['type']): string {
  if (type === 'directory') return '—'
  return formatBytes(bytes)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

function entryIcon(entry: SftpEntry): string {
  if (entry.type === 'directory') return '📁'
  if (entry.type === 'symlink')   return '🔗'
  const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
  if (['sh', 'bash', 'zsh', 'fish'].includes(ext)) return '⚙️'
  if (['js', 'ts', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'rb', 'php'].includes(ext)) return '📄'
  if (['log', 'txt', 'md', 'rst'].includes(ext)) return '📝'
  if (['zip', 'tar', 'gz', 'xz', 'bz2', 'rar', '7z'].includes(ext)) return '🗜️'
  if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'ico'].includes(ext)) return '🖼️'
  if (['json', 'yaml', 'yml', 'toml', 'xml', 'conf', 'env'].includes(ext)) return '⚙️'
  return '📄'
}

// ── Upload ────────────────────────────────────────────────────────────────

const uploadRef = ref<HTMLInputElement | null>(null)

function triggerUpload() { uploadRef.value?.click() }

async function uploadFile(file: File) {
  const targetPath = currentPath.value.replace(/\/$/, '') + '/' + file.name
  const id = addTransfer(file.name, 'upload')
  try {
    await sftpService.upload(props.hostId, targetPath, file, (percent, loaded, total) => {
      updateTransfer(id, { progress: percent, loaded, total })
    }, { sessionId: props.sessionId })
    updateTransfer(id, { progress: 100, status: 'done' })
    message.success(t('fileManager.messages.uploadSuccess'))
    loadDir(currentPath.value)
    autoClear(id)
  } catch (err) {
    updateTransfer(id, { status: 'error' })
    message.error(getSftpErrorMessage(err, t('fileManager.messages.uploadError')))
  }
}

async function onFileSelected(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? [])
  ;(e.target as HTMLInputElement).value = ''
  for (const file of files) await uploadFile(file)
}

// ── Drag & drop ───────────────────────────────────────────────────────────

const isDragOver    = ref(false)
let   dragCounter   = 0

function onDragEnter(e: DragEvent) {
  if (!e.dataTransfer?.types.includes('Files')) return
  dragCounter++
  isDragOver.value = true
}

function onDragLeave() {
  dragCounter--
  if (dragCounter <= 0) { dragCounter = 0; isDragOver.value = false }
}

async function onDrop(e: DragEvent) {
  dragCounter = 0
  isDragOver.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  for (const file of files) await uploadFile(file)
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────

function onKeydown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement).tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (status.value !== 'connected') return
  const mod = e.metaKey || e.ctrlKey
  if (e.key === 'Backspace' && !mod) { e.preventDefault(); goUp() }
  if (mod && e.key === 'r')          { e.preventDefault(); loadDir(currentPath.value) }
  if (mod && e.key === 'u')          { e.preventDefault(); triggerUpload() }
}

onMounted(()   => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

// ── Download ──────────────────────────────────────────────────────────────

async function downloadEntry(entry: SftpEntry) {
  const id = addTransfer(entry.name, 'download')
  try {
    const response = await sftpService.download(props.hostId, entry.path, (percent, loaded, total) => {
      updateTransfer(id, { progress: percent, loaded, total })
    }, { sessionId: props.sessionId })
    updateTransfer(id, { progress: 100, status: 'done' })
    sftpService.saveBlobAs(response.data as unknown as Blob, entry.name)
    autoClear(id)
  } catch (err) {
    updateTransfer(id, { status: 'error' })
    message.error(getSftpErrorMessage(err, t('fileManager.messages.downloadError')))
  }
}

// ── New Folder ────────────────────────────────────────────────────────────

const showMkdirDialog = ref(false)
const mkdirName       = ref('')

function openMkdirDialog() { mkdirName.value = ''; showMkdirDialog.value = true }

async function confirmMkdir() {
  if (!mkdirName.value.trim()) return
  const path = currentPath.value.replace(/\/$/, '') + '/' + mkdirName.value.trim()
  try {
    await sftpService.mkdir(props.hostId, path, { sessionId: props.sessionId })
    message.success(t('fileManager.messages.mkdirSuccess'))
    showMkdirDialog.value = false
    const node = findNode(treeData.value, currentPath.value)
    if (node) { node.children = undefined; await loadTreeChildren(node) }
    loadDir(currentPath.value)
  } catch (err) {
    message.error(getSftpErrorMessage(err, t('fileManager.messages.mkdirError')))
  }
}

// ── New File ──────────────────────────────────────────────────────────────

const showTouchDialog = ref(false)
const touchName       = ref('')

function openTouchDialog() { touchName.value = ''; showTouchDialog.value = true }

async function confirmTouch() {
  if (!touchName.value.trim()) return
  const path = currentPath.value.replace(/\/$/, '') + '/' + touchName.value.trim()
  try {
    await sftpService.createFile(props.hostId, path, { sessionId: props.sessionId })
    message.success(t('fileManager.messages.createFileSuccess'))
    showTouchDialog.value = false
    loadDir(currentPath.value)
  } catch (err) {
    message.error(getSftpErrorMessage(err, t('fileManager.messages.createFileError')))
  }
}

// ── Rename ────────────────────────────────────────────────────────────────

const renamingEntry = ref<SftpEntry | null>(null)
const renameValue   = ref('')

function openRename(entry: SftpEntry) { renamingEntry.value = entry; renameValue.value = entry.name }

async function confirmRename() {
  if (!renamingEntry.value || !renameValue.value.trim()) return
  const entry   = renamingEntry.value
  const dir     = entry.path.slice(0, entry.path.lastIndexOf('/')) || '/'
  const newPath = dir.replace(/\/$/, '') + '/' + renameValue.value.trim()
  try {
    await sftpService.rename(props.hostId, entry.path, newPath, { sessionId: props.sessionId })
    message.success(t('fileManager.messages.renameSuccess'))
    renamingEntry.value = null
    if (entry.type === 'directory') {
      const node = findNode(treeData.value, dir)
      if (node) { node.children = undefined; await loadTreeChildren(node) }
    }
    loadDir(currentPath.value)
  } catch (err) {
    message.error(getSftpErrorMessage(err, t('fileManager.messages.renameError')))
  }
}

// ── Delete ────────────────────────────────────────────────────────────────

function confirmDelete(entry: SftpEntry) {
  dialog.warning({
    title:           t('fileManager.deleteDialog.title', { name: entry.name }),
    content:         t('fileManager.deleteDialog.content'),
    positiveText:    t('fileManager.deleteDialog.confirm'),
    negativeText:    t('fileManager.deleteDialog.cancel'),
    onPositiveClick: async () => {
      try {
        await sftpService.delete(props.hostId, entry.path, { sessionId: props.sessionId })
        message.success(t('fileManager.messages.deleteSuccess'))
        if (entry.type === 'directory') {
          const parent = findNode(treeData.value, currentPath.value)
          if (parent) { parent.children = undefined; await loadTreeChildren(parent) }
        }
        loadDir(currentPath.value)
      } catch (err) {
        message.error(getSftpErrorMessage(err, t('fileManager.messages.deleteError')))
      }
    },
  })
}

// ── Context menu ──────────────────────────────────────────────────────────

const ctxEntry = ref<SftpEntry | null>(null)
const ctxX     = ref(0)
const ctxY     = ref(0)
const showCtx  = ref(false)

function openCtx(e: MouseEvent, entry: SftpEntry) {
  e.preventDefault()
  ctxEntry.value = entry
  ctxX.value     = e.clientX
  ctxY.value     = e.clientY
  showCtx.value  = true
}

function closeCtx() { showCtx.value = false }

// ── File editor ───────────────────────────────────────────────────────────

const editingEntry = ref<SftpEntry | null>(null)

const BINARY_EXTENSIONS = new Set([
  'zip','tar','gz','bz2','xz','7z','rar',
  'jpg','jpeg','png','gif','webp','svg','ico','bmp','tiff',
  'pdf','doc','docx','xls','xlsx','ppt','pptx',
  'mp3','mp4','avi','mkv','mov','wav','flac',
  'exe','dll','so','dylib','bin','pyc','class',
])

function canEdit(entry: SftpEntry): boolean {
  if (entry.type !== 'file') return false
  const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
  return !BINARY_EXTENSIONS.has(ext)
}
</script>

<template>
  <div class="flex flex-col h-full bg-[#18181c] text-sm text-gray-200 select-none" @click="closeCtx">

    <!-- ── Status bar ──────────────────────────────────────────────────── -->
    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800 shrink-0 bg-[#1a1b1e]">
      <span
        class="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
        :class="{
          'bg-yellow-400/10 text-yellow-400': status === 'connecting',
          'bg-green-400/10  text-green-400':  status === 'connected',
          'bg-red-400/10    text-red-400':    status === 'error',
        }"
      >
        <span
          class="w-1.5 h-1.5 rounded-full"
          :class="{
            'bg-yellow-400 animate-pulse': status === 'connecting',
            'bg-green-400':                status === 'connected',
            'bg-red-400':                  status === 'error',
          }"
        />
        {{ $t(`fileManager.status.${status}`) }}
      </span>

      <div class="flex-1" />

      <NButton v-if="status === 'error'" size="tiny" type="error" ghost @click="initConnection">
        {{ $t('fileManager.retry') }}
      </NButton>

      <template v-if="status === 'connected'">
        <NTooltip trigger="hover" placement="bottom" :delay="800">
          <template #trigger>
            <NButton size="tiny" ghost @click="loadDir(currentPath)">↺</NButton>
          </template>
          <span class="text-xs">{{ $t('fileManager.refresh') }} <span class="text-gray-400 font-mono ml-1">{{ shortcuts.refresh }}</span></span>
        </NTooltip>
        <NTooltip trigger="hover" placement="bottom" :delay="800">
          <template #trigger>
            <NButton size="tiny" ghost @click="triggerUpload">↑ {{ $t('fileManager.uploadBtn') }}</NButton>
          </template>
          <span class="text-xs">{{ $t('fileManager.uploadBtn') }} <span class="text-gray-400 font-mono ml-1">{{ shortcuts.upload }}</span></span>
        </NTooltip>
        <NButton size="tiny" ghost @click="openMkdirDialog">＋ {{ $t('fileManager.newFolder') }}</NButton>
        <NButton size="tiny" ghost @click="openTouchDialog">＋ {{ $t('fileManager.newFile') }}</NButton>
      </template>
      <input ref="uploadRef" type="file" multiple class="hidden" @change="onFileSelected" />
    </div>

    <!-- ── Error state ─────────────────────────────────────────────────── -->
    <div v-if="status === 'error'" class="flex-1 flex flex-col items-center justify-center gap-3 text-gray-500">
      <span class="text-3xl">⚠️</span>
      <NText depth="3">{{ $t('fileManager.status.error') }}</NText>
      <NButton type="primary" size="small" @click="initConnection">{{ $t('fileManager.retry') }}</NButton>
    </div>

    <!-- ── Connecting ──────────────────────────────────────────────────── -->
    <div v-else-if="status === 'connecting'" class="flex-1 flex items-center justify-center">
      <NSpin size="medium" />
    </div>

    <!-- ── Main layout ─────────────────────────────────────────────────── -->
    <div v-else class="flex flex-1 overflow-hidden min-h-0">

      <!-- Left: directory tree -->
      <div
        class="shrink-0 overflow-y-auto bg-[#18181c] border-r border-gray-800 pt-1"
        :style="{ width: treeWidth + 'px' }"
      >
        <NTree
          :data="treeData"
          :selected-keys="selectedKeys"
          :expanded-keys="expandedKeys"
          :on-load="onTreeLoad"
          :node-props="() => ({ style: 'font-size:12px' })"
          block-line
          @update:selected-keys="onTreeSelect"
          @update:expanded-keys="(keys) => { expandedKeys = keys as string[] }"
        />
      </div>

      <!-- Resize handle -->
      <div
        class="w-1 shrink-0 cursor-col-resize bg-gray-800 hover:bg-blue-500 transition-colors"
        @mousedown.prevent="startResize"
      />

      <!-- Right: breadcrumb + file table (drag & drop zone) -->
      <div
        class="flex-1 overflow-hidden flex flex-col min-w-0 relative"
        @dragenter.prevent="onDragEnter"
        @dragover.prevent
        @dragleave="onDragLeave"
        @drop.prevent="onDrop"
      >
        <!-- Drop overlay -->
        <Teleport to="body">
          <div
            v-if="isDragOver"
            class="fixed inset-0 z-[200] flex items-center justify-center pointer-events-none"
          >
            <div class="absolute inset-0 bg-blue-500/10 border-2 border-dashed border-blue-400 rounded-lg m-2" />
            <div class="relative bg-[#1e2533] text-blue-300 text-sm font-medium px-6 py-4 rounded-xl shadow-2xl border border-blue-500/40 flex items-center gap-3">
              <span class="text-2xl">☁</span>
              {{ $t('fileManager.dropToUpload') }}
            </div>
          </div>
        </Teleport>

        <!-- Breadcrumb -->
        <div class="flex items-center gap-0.5 px-3 py-1.5 border-b border-gray-800 shrink-0 bg-[#1a1b1e] overflow-x-auto">
          <button
            v-if="currentPath !== '/'"
            class="text-gray-500 hover:text-white text-xs mr-1 shrink-0"
            :title="$t('fileManager.goUp')"
            @click="goUp"
          >↑</button>
          <template v-for="(crumb, i) in breadcrumbs" :key="crumb.path">
            <button
              class="text-xs whitespace-nowrap hover:text-white transition-colors"
              :class="i === breadcrumbs.length - 1 ? 'text-white font-semibold' : 'text-gray-400'"
              @click="expandToPath(crumb.path); navigate(crumb.path)"
            >{{ crumb.label }}</button>
            <span v-if="i < breadcrumbs.length - 1" class="text-gray-600 text-xs mx-0.5 shrink-0">/</span>
          </template>
        </div>

        <!-- File table -->
        <div class="flex-1 overflow-y-auto">
          <NSpin :show="loading">
            <NEmpty
              v-if="!loading && sorted.length === 0"
              :description="$t('fileManager.empty')"
              class="flex flex-col items-center justify-center py-12"
            />
            <table v-else class="w-full text-xs">
              <thead class="sticky top-0 z-10 bg-[#18181c]">
                <tr class="text-gray-500 border-b border-gray-800">
                  <th class="text-left px-3 py-1.5 font-normal">{{ $t('fileManager.columns.name') }}</th>
                  <th class="text-right px-3 py-1.5 font-normal w-20">{{ $t('fileManager.columns.size') }}</th>
                  <th class="text-left px-3 py-1.5 font-normal w-24 font-mono">{{ $t('fileManager.columns.permissions') }}</th>
                  <th class="text-left px-3 py-1.5 font-normal w-32">{{ $t('fileManager.columns.modified') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="entry in sorted"
                  :key="entry.path"
                  class="border-b border-gray-800/40 hover:bg-[#1e1e22] transition-colors group"
                  :class="entry.type === 'directory' ? 'cursor-pointer' : 'cursor-default'"
                  @dblclick="openEntry(entry)"
                  @contextmenu="openCtx($event, entry)"
                >
                  <td class="px-3 py-1.5">
                    <div class="flex items-center gap-1.5 min-w-0">
                      <span class="shrink-0">{{ entryIcon(entry) }}</span>
                      <span
                        class="truncate"
                        :class="entry.type === 'directory' ? 'text-blue-300 font-medium' : 'text-gray-200'"
                        :title="entry.name"
                      >{{ entry.name }}</span>
                    </div>
                  </td>
                  <td class="px-3 py-1.5 text-right text-gray-400 tabular-nums">{{ formatSize(entry.size, entry.type) }}</td>
                  <td class="px-3 py-1.5 text-gray-400 font-mono">{{ entry.permissions }}</td>
                  <td class="px-3 py-1.5 text-gray-400 whitespace-nowrap">{{ formatDate(entry.modifiedAt) }}</td>
                </tr>
              </tbody>
            </table>
          </NSpin>
        </div>
      </div>
    </div>

    <!-- ── Transfer panel ──────────────────────────────────────────────── -->
    <transition name="panel-slide">
      <div
        v-if="showTransferPanel"
        class="shrink-0 border-t border-gray-700 bg-[#141416]"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-3 py-1.5 border-b border-gray-800">
          <span class="text-xs font-medium text-gray-400">
            {{ $t('fileManager.transfers.title') }}
            <span class="ml-1 text-gray-600">({{ transfers.length }})</span>
          </span>
          <button
            class="text-xs text-gray-600 hover:text-gray-300 transition-colors"
            @click="clearDone"
          >{{ $t('fileManager.transfers.clearDone') }}</button>
        </div>

        <!-- Transfer rows -->
        <div class="max-h-40 overflow-y-auto">
          <div
            v-for="tr in transfers"
            :key="tr.id"
            class="px-3 py-2 border-b border-gray-800/50 last:border-0"
          >
            <!-- Row header -->
            <div class="flex items-center gap-2 mb-1">
              <!-- Type icon -->
              <span class="text-xs shrink-0" :class="tr.type === 'upload' ? 'text-blue-400' : 'text-green-400'">
                {{ tr.type === 'upload' ? '↑' : '↓' }}
              </span>
              <!-- Filename -->
              <span class="text-xs text-gray-300 truncate flex-1" :title="tr.name">{{ tr.name }}</span>
              <!-- Status / progress -->
              <span class="text-xs shrink-0 tabular-nums" :class="{
                'text-gray-400':  tr.status === 'active',
                'text-green-400': tr.status === 'done',
                'text-red-400':   tr.status === 'error',
              }">
                <template v-if="tr.status === 'active'">
                  {{ tr.progress }}%
                  <span v-if="tr.total" class="text-gray-600 ml-1">
                    {{ formatBytes(tr.loaded) }} / {{ formatBytes(tr.total) }}
                  </span>
                </template>
                <template v-else-if="tr.status === 'done'">✓ {{ $t('fileManager.transfers.done') }}</template>
                <template v-else>✕ {{ $t('fileManager.transfers.error') }}</template>
              </span>
            </div>
            <!-- Progress bar -->
            <NProgress
              type="line"
              :percentage="tr.progress"
              :status="tr.status === 'error' ? 'error' : tr.status === 'done' ? 'success' : 'default'"
              :show-indicator="false"
              :height="3"
              :border-radius="2"
              :fill-border-radius="2"
            />
          </div>
        </div>
      </div>
    </transition>

    <!-- ── Context menu ────────────────────────────────────────────────── -->
    <Teleport to="body">
      <div
        v-if="showCtx && ctxEntry"
        class="fixed z-50 bg-[#1e1e22] border border-gray-700 rounded shadow-xl py-1 text-xs text-gray-200 min-w-[140px]"
        :style="{ top: ctxY + 'px', left: ctxX + 'px' }"
        @click.stop
      >
        <button
          v-if="ctxEntry.type === 'file' && canEdit(ctxEntry)"
          class="w-full text-left px-4 py-1.5 hover:bg-[#2a2a30] transition-colors"
          @click="editingEntry = ctxEntry; closeCtx()"
        >{{ $t('fileManager.edit') }}</button>
        <button
          v-if="ctxEntry.type === 'file'"
          class="w-full text-left px-4 py-1.5 hover:bg-[#2a2a30] transition-colors"
          @click="downloadEntry(ctxEntry!); closeCtx()"
        >{{ $t('fileManager.download') }}</button>
        <button
          class="w-full text-left px-4 py-1.5 hover:bg-[#2a2a30] transition-colors"
          @click="openRename(ctxEntry!); closeCtx()"
        >{{ $t('fileManager.rename') }}</button>
        <div class="border-t border-gray-700 my-1" />
        <button
          class="w-full text-left px-4 py-1.5 hover:bg-[#2a2a30] transition-colors text-red-400"
          @click="confirmDelete(ctxEntry!); closeCtx()"
        >{{ $t('fileManager.delete') }}</button>
      </div>
    </Teleport>

    <!-- ── Mkdir dialog ────────────────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="showMkdirDialog" class="fixed inset-0 flex items-center justify-center bg-black/60 z-50" @click.self="showMkdirDialog = false">
        <div class="bg-[#1e1e22] rounded-lg p-5 w-80 shadow-xl border border-gray-700">
          <p class="text-sm font-semibold mb-3 text-white">{{ $t('fileManager.newFolderDialog.title') }}</p>
          <p class="text-xs text-gray-400 mb-2">{{ $t('fileManager.newFolderDialog.label') }}</p>
          <NInput v-model:value="mkdirName" size="small" :placeholder="$t('fileManager.newFolderDialog.placeholder')" @keyup.enter="confirmMkdir" />
          <div class="flex justify-end gap-2 mt-4">
            <NButton size="small" @click="showMkdirDialog = false">{{ $t('fileManager.newFolderDialog.cancel') }}</NButton>
            <NButton size="small" type="primary" :disabled="!mkdirName.trim()" @click="confirmMkdir">{{ $t('fileManager.newFolderDialog.confirm') }}</NButton>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ── Touch dialog ────────────────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="showTouchDialog" class="fixed inset-0 flex items-center justify-center bg-black/60 z-50" @click.self="showTouchDialog = false">
        <div class="bg-[#1e1e22] rounded-lg p-5 w-80 shadow-xl border border-gray-700">
          <p class="text-sm font-semibold mb-3 text-white">{{ $t('fileManager.newFileDialog.title') }}</p>
          <p class="text-xs text-gray-400 mb-2">{{ $t('fileManager.newFileDialog.label') }}</p>
          <NInput v-model:value="touchName" size="small" :placeholder="$t('fileManager.newFileDialog.placeholder')" @keyup.enter="confirmTouch" />
          <div class="flex justify-end gap-2 mt-4">
            <NButton size="small" @click="showTouchDialog = false">{{ $t('fileManager.newFileDialog.cancel') }}</NButton>
            <NButton size="small" type="primary" :disabled="!touchName.trim()" @click="confirmTouch">{{ $t('fileManager.newFileDialog.confirm') }}</NButton>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ── Rename dialog ───────────────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="renamingEntry" class="fixed inset-0 flex items-center justify-center bg-black/60 z-50" @click.self="renamingEntry = null">
        <div class="bg-[#1e1e22] rounded-lg p-5 w-80 shadow-xl border border-gray-700">
          <p class="text-sm font-semibold mb-3 text-white">{{ $t('fileManager.renameDialog.title') }}</p>
          <p class="text-xs text-gray-400 mb-2">{{ $t('fileManager.renameDialog.label') }}</p>
          <NInput v-model:value="renameValue" size="small" @keyup.enter="confirmRename" />
          <div class="flex justify-end gap-2 mt-4">
            <NButton size="small" @click="renamingEntry = null">{{ $t('fileManager.renameDialog.cancel') }}</NButton>
            <NButton size="small" type="primary" :disabled="!renameValue.trim()" @click="confirmRename">{{ $t('fileManager.renameDialog.confirm') }}</NButton>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ── File editor ────────────────────────────────────────────────── -->
    <FileEditorModal
      v-if="editingEntry"
      :host-id="hostId"
      :file-path="editingEntry.path"
      :file-name="editingEntry.name"
      :session-id="sessionId"
      @close="editingEntry = null"
      @saved="loadDir(currentPath)"
    />

  </div>
</template>

<style scoped>
:deep(.n-tree) { background: transparent; color: #d1d5db; }
:deep(.n-tree-node-content) { font-size: 12px; padding: 2px 0; }
:deep(.n-tree-node--selected > .n-tree-node-content) { background: rgba(59,130,246,0.2); color: #93c5fd; }
:deep(.n-tree-node-content:hover) { background: rgba(255,255,255,0.05); }
:deep(.n-tree-node-switcher) { color: #6b7280; }

.panel-slide-enter-active,
.panel-slide-leave-active { transition: max-height 0.2s ease, opacity 0.2s ease; overflow: hidden; }
.panel-slide-enter-from,
.panel-slide-leave-to { max-height: 0; opacity: 0; }
.panel-slide-enter-to,
.panel-slide-leave-from { max-height: 200px; }
</style>
