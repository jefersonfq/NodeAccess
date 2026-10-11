<script setup lang="ts">
import ManualLink from '@/components/manual/ManualLink.vue'
import { ref, computed, watch, h, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NTree, NButton, NSpace, NText, NSpin, NEmpty, NInput, NProgress, NTooltip, NAlert, NDropdown, NModal,
  useMessage, useDialog,
} from 'naive-ui'
import type { TreeOption } from 'naive-ui'
import type { SftpEntry } from '@nodeaccess/shared'
import { getSftpErrorMessage, sftpService } from '@/services/sftp.service'
import { hasTerminalSftpChannel, homeViaTerminalSftp, listViaTerminalSftp } from '@/services/terminal-sftp-channel.service'
import { usePlatform } from '@/composables/usePlatform'
import FileUtilitiesModal from '@/components/FileUtilitiesModal.vue'
import FileEditorModal from '@/components/FileEditorModal.vue'

const utilityContext = ref<{ sessionId: number; hostId: number; path: string; mode: 'copy' | 'edit' } | null>(null)
function openUtility(mode: 'copy' | 'edit', path: string): void { if (props.sessionId && hasTerminalSftpChannel(props.sessionId)) utilityContext.value = { sessionId: props.sessionId, hostId: props.hostId, path, mode } }

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

function updateTransfer(id: string, patch: Partial<Transfer>): void {
  const item = transfers.value.find(t => t.id === id)
  if (item) Object.assign(item, patch)
}

function clearDone(): void {
  transfers.value = transfers.value.filter(t => t.status === 'active')
}

function autoClear(id: string, delay = 4000): void {
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

let connectionVersion = 0
let listingVersion = 0
let disposed = false

async function resolveHome(hostId = props.hostId, sessionId = props.sessionId): Promise<string> {
  if (sessionId && hasTerminalSftpChannel(sessionId)) {
    try { return await homeViaTerminalSftp(sessionId) } catch { /* REST fallback */ }
  }
  return (await sftpService.ping(hostId)).data.home ?? '/'
}

async function listDirectory(path: string, hostId = props.hostId, sessionId = props.sessionId): Promise<{ entries: SftpEntry[]; path: string; }> {
  if (sessionId && hasTerminalSftpChannel(sessionId)) {
    try { return await listViaTerminalSftp(sessionId, path) } catch { /* REST fallback */ }
  }
  return (await sftpService.list(hostId, path)).data
}

async function initConnection(): Promise<void> {
  const version = ++connectionVersion
  ++listingVersion
  status.value = 'connecting'
  entries.value = []
  currentPath.value = '/'
  directoryError.value = null
  selectedKeys.value = []
  expandedKeys.value = []
  treeData.value = []
  showMkdirDialog.value = false
  showTouchDialog.value = false
  renamingEntry.value = null
  mutationLoading.value = false
  editingEntry.value = null
  showCtx.value = false
  try {
    const home = await resolveHome()
    if (disposed || version !== connectionVersion) return
    homeDir.value = home
    treeData.value = [makeNode('/', '/')]
    await loadTreeChildren(treeData.value[0])
    if (disposed || version !== connectionVersion) return
    await navigate('/')
    if (!disposed && version === connectionVersion) status.value = 'connected'
  } catch {
    if (!disposed && version === connectionVersion) status.value = 'error'
  }
}

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
  const version = connectionVersion
  try {
    const data = await listDirectory(path)
    if (disposed || version !== connectionVersion) return
    const dirs = data.entries
      .filter(e => e.type === 'directory')
      .sort((a, b) => a.name.localeCompare(b.name))
    node.children = dirs.length > 0 ? dirs.map(e => makeNode(e.path, e.name)) : []
  } catch {
    if (disposed || version !== connectionVersion) return
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
  const version = connectionVersion
  const parts = path.split('/').filter(Boolean)
  const ancestors: string[] = ['/']
  for (let i = 1; i < parts.length; i++) {
    ancestors.push('/' + parts.slice(0, i).join('/'))
  }
  for (const ancestor of ancestors) {
    if (disposed || version !== connectionVersion || path !== currentPath.value) return
    if (!expandedKeys.value.includes(ancestor)) {
      expandedKeys.value = [...expandedKeys.value, ancestor]
    }
    const node = findNode(treeData.value, ancestor)
    if (node && node.children === undefined) await loadTreeChildren(node)
  }
  if (!disposed && version === connectionVersion && path === currentPath.value) selectedKeys.value = [path]
}

function onTreeSelect(keys: Array<string | number>): void {
  if (keys.length === 0) return
  void navigate(keys[0] as string)
}

// ── Right-panel file list ─────────────────────────────────────────────────

const currentPath = ref('/')
const entries     = ref<SftpEntry[]>([])
const loading     = ref(false)
const directoryError = ref<string | null>(null)

const sorted = computed(() =>
  [...entries.value].sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1
    if (a.type !== 'directory' && b.type === 'directory') return 1
    return a.name.localeCompare(b.name)
  }),
)

async function loadDir(path: string): Promise<void> {
  const request = ++listingVersion
  const version = connectionVersion
  loading.value = true
  directoryError.value = null
  entries.value = []
  try {
    const data = await listDirectory(path)
    if (disposed || request !== listingVersion || version !== connectionVersion) return
    entries.value = data.entries
  } catch (err) {
    if (disposed || request !== listingVersion || version !== connectionVersion) return
    const error = await getSftpErrorMessage(err, t('fileManager.messages.loadError'))
    if (!disposed && request === listingVersion && version === connectionVersion) directoryError.value = error
  } finally {
    if (!disposed && request === listingVersion && version === connectionVersion) loading.value = false
  }
}

async function navigate(path: string): Promise<void> {
  currentPath.value = path
  selectedKeys.value = [path]
  await loadDir(path)
  if (path === currentPath.value && !directoryError.value) void expandToPath(path)
}

async function openEntry(entry: SftpEntry): Promise<void> {
  if (entry.type === 'directory') await navigate(entry.path)
}

function goUp(): void {
  if (currentPath.value === '/') return
  void navigate(currentPath.value.split('/').slice(0, -1).join('/') || '/')
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
const showTree = ref(false)

function startResize(e: MouseEvent): void {
  const startX     = e.clientX
  const startWidth = treeWidth.value
  function onMove(ev: MouseEvent): void {
    treeWidth.value = Math.max(160, Math.min(480, startWidth + (ev.clientX - startX)))
  }
  function onUp(): void {
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

function triggerUpload(): void { uploadRef.value?.click() }

async function uploadFile(file: File, context: { hostId: number; sessionId?: number | null; path: string; version: number }): Promise<void> {
  const targetPath = context.path.replace(/\/$/, '') + '/' + file.name
  const id = addTransfer(file.name, 'upload')
  try {
    await sftpService.upload(context.hostId, targetPath, file, (percent, loaded, total) => {
      updateTransfer(id, { progress: percent, loaded, total })
    }, { sessionId: context.sessionId })
    updateTransfer(id, { progress: 100, status: 'done' })
    if (disposed || context.version !== connectionVersion) { autoClear(id); return }
    message.success(t('fileManager.messages.uploadSuccess'))
    if (currentPath.value === context.path) void loadDir(currentPath.value)
    autoClear(id)
  } catch (err) {
    updateTransfer(id, { status: 'error' })
    message.error(await getSftpErrorMessage(err, t('fileManager.messages.uploadError')))
  }
}

async function onFileSelected(e: Event): Promise<void> {
  const files = Array.from((e.target as HTMLInputElement).files ?? [])
  ;(e.target as HTMLInputElement).value = ''
  await uploadFiles(files)
}

async function uploadFiles(files: File[]): Promise<void> {
  if (status.value !== 'connected' || loading.value || directoryError.value) return
  const context = { hostId: props.hostId, sessionId: props.sessionId, path: currentPath.value, version: connectionVersion }
  for (const file of files) {
    if (disposed || context.version !== connectionVersion) break
    await uploadFile(file, context)
  }
}

// ── Drag & drop ───────────────────────────────────────────────────────────

const isDragOver    = ref(false)
let   dragCounter   = 0

function onDragEnter(e: DragEvent): void {
  if (!e.dataTransfer?.types.includes('Files')) return
  dragCounter++
  isDragOver.value = true
}

function onDragLeave(): void {
  dragCounter--
  if (dragCounter <= 0) { dragCounter = 0; isDragOver.value = false }
}

async function onDrop(e: DragEvent): Promise<void> {
  dragCounter = 0
  isDragOver.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  await uploadFiles(files)
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────

function onKeydown(e: KeyboardEvent): void {
  const tag = (e.target as HTMLElement).tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (status.value !== 'connected' || showMkdirDialog.value || showTouchDialog.value || renamingEntry.value || editingEntry.value) return
  const mod = e.metaKey || e.ctrlKey
  if (e.key === 'Backspace' && !mod) { e.preventDefault(); goUp() }
  if (mod && e.key === 'r')          { e.preventDefault(); void loadDir(currentPath.value) }
  if (mod && e.key === 'u' && !loading.value && !directoryError.value) { e.preventDefault(); triggerUpload() }
}

onMounted(()   => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  disposed = true
  ++connectionVersion
  ++listingVersion
  window.removeEventListener('keydown', onKeydown)
})

// ── Download ──────────────────────────────────────────────────────────────

async function downloadEntry(entry: SftpEntry): Promise<void> {
  const id = addTransfer(entry.name, 'download')
  try {
    const response = await sftpService.download(props.hostId, entry.path, (percent, loaded, total) => {
      updateTransfer(id, { progress: percent, loaded, total })
    }, { sessionId: props.sessionId })
    updateTransfer(id, { progress: 100, status: 'done' })
    sftpService.saveBlobAs(response.data, entry.name)
    autoClear(id)
  } catch (err) {
    updateTransfer(id, { status: 'error' })
    message.error(await getSftpErrorMessage(err, t('fileManager.messages.downloadError')))
  }
}

// ── New Folder ────────────────────────────────────────────────────────────

const mutationLoading = ref(false)
const showMkdirDialog = ref(false)
const mkdirName       = ref('')

function openMkdirDialog(): void { mkdirName.value = ''; showMkdirDialog.value = true }

async function confirmMkdir(): Promise<void> {
  if (mutationLoading.value || !mkdirName.value.trim()) return
  const version = connectionVersion
  mutationLoading.value = true
  const path = currentPath.value.replace(/\/$/, '') + '/' + mkdirName.value.trim()
  try {
    await sftpService.mkdir(props.hostId, path, { sessionId: props.sessionId })
    if (disposed || version !== connectionVersion) return
    message.success(t('fileManager.messages.mkdirSuccess'))
    showMkdirDialog.value = false
    const node = findNode(treeData.value, currentPath.value)
    if (node) { node.children = undefined; await loadTreeChildren(node) }
    void loadDir(currentPath.value)
  } catch (err) {
    if (disposed || version !== connectionVersion) return
    message.error(await getSftpErrorMessage(err, t('fileManager.messages.mkdirError')))
  } finally { if (version === connectionVersion) mutationLoading.value = false }
}

// ── New File ──────────────────────────────────────────────────────────────

const showTouchDialog = ref(false)
const touchName       = ref('')

function openTouchDialog(): void { touchName.value = ''; showTouchDialog.value = true }

async function confirmTouch(): Promise<void> {
  if (mutationLoading.value || !touchName.value.trim()) return
  const version = connectionVersion
  mutationLoading.value = true
  const path = currentPath.value.replace(/\/$/, '') + '/' + touchName.value.trim()
  try {
    await sftpService.createFile(props.hostId, path, { sessionId: props.sessionId })
    if (disposed || version !== connectionVersion) return
    message.success(t('fileManager.messages.createFileSuccess'))
    showTouchDialog.value = false
    void loadDir(currentPath.value)
  } catch (err) {
    if (disposed || version !== connectionVersion) return
    message.error(await getSftpErrorMessage(err, t('fileManager.messages.createFileError')))
  } finally { if (version === connectionVersion) mutationLoading.value = false }
}

// ── Rename ────────────────────────────────────────────────────────────────

const renamingEntry = ref<SftpEntry | null>(null)
const renameValue   = ref('')

function openRename(entry: SftpEntry): void { renamingEntry.value = entry; renameValue.value = entry.name }

async function confirmRename(): Promise<void> {
  if (mutationLoading.value || !renamingEntry.value || !renameValue.value.trim()) return
  const version = connectionVersion
  mutationLoading.value = true
  const entry   = renamingEntry.value
  const dir     = entry.path.slice(0, entry.path.lastIndexOf('/')) || '/'
  const newPath = dir.replace(/\/$/, '') + '/' + renameValue.value.trim()
  try {
    await sftpService.rename(props.hostId, entry.path, newPath, { sessionId: props.sessionId })
    if (disposed || version !== connectionVersion) return
    message.success(t('fileManager.messages.renameSuccess'))
    renamingEntry.value = null
    if (entry.type === 'directory') {
      const node = findNode(treeData.value, dir)
      if (node) { node.children = undefined; await loadTreeChildren(node) }
    }
    void loadDir(currentPath.value)
  } catch (err) {
    if (disposed || version !== connectionVersion) return
    message.error(await getSftpErrorMessage(err, t('fileManager.messages.renameError')))
  } finally { if (version === connectionVersion) mutationLoading.value = false }
}

// ── Delete ────────────────────────────────────────────────────────────────

function confirmDelete(entry: SftpEntry): void {
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
        void loadDir(currentPath.value)
      } catch (err) {
        message.error(await getSftpErrorMessage(err, t('fileManager.messages.deleteError')))
      }
    },
  })
}

// ── Context menu ──────────────────────────────────────────────────────────

const ctxEntry = ref<SftpEntry | null>(null)
const ctxX     = ref(0)
const ctxY     = ref(0)
const showCtx  = ref(false)

function openCtx(e: MouseEvent, entry: SftpEntry): void {
  e.preventDefault()
  ctxEntry.value = entry
  ctxX.value     = e.clientX
  ctxY.value     = e.clientY
  showCtx.value  = true
}

function closeCtx(): void { showCtx.value = false }

function entryActions(entry: SftpEntry): { label: string; key: string; }[] {
  return [
    ...(entry.type === 'file' && props.sessionId && hasTerminalSftpChannel(props.sessionId) ? [{ label: t('fileUtilities.copyTitle'), key: 'copy-host' }, ...(canEdit(entry) ? [{ label: t('fileUtilities.editTitle'), key: 'external-edit' }] : [])] : []),
    ...(canEdit(entry) ? [{ label: t('fileManager.edit'), key: 'edit' }] : []),
    ...(entry.type === 'file' ? [{ label: t('fileManager.download'), key: 'download' }] : []),
    { label: t('fileManager.rename'), key: 'rename' },
    { label: t('fileManager.delete'), key: 'delete' },
  ]
}

function runEntryAction(key: string, entry: SftpEntry): void {
  closeCtx()
  if (key === 'copy-host') openUtility('copy', entry.path)
  else if (key === 'external-edit') openUtility('edit', entry.path)
  else if (key === 'edit') editingEntry.value = entry
  else if (key === 'download') void downloadEntry(entry)
  else if (key === 'rename') openRename(entry)
  else if (key === 'delete') confirmDelete(entry)
}

function onEntryKeydown(event: KeyboardEvent, entry: SftpEntry): void {
  if (event.target !== event.currentTarget) return
  if (event.key === 'Enter' && entry.type === 'directory') { event.preventDefault(); void openEntry(entry) }
}

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
watch(() => [props.hostId, props.sessionId] as const, () => initConnection(), { immediate: true })
</script>

<template>
  <FileUtilitiesModal
    v-if="utilityContext"
    v-bind="utilityContext"
    @close="utilityContext = null"
  />
  <div
    class="sftp-manager flex flex-col h-full bg-[var(--na-surface)] text-sm text-[var(--na-text)] select-none"
    @click="closeCtx"
  >
    <!-- ── Status bar ──────────────────────────────────────────────────── -->
    <div class="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-[var(--na-border)] shrink-0 bg-[var(--na-surface-soft)]">
      <span
        class="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
        :class="{
          'bg-yellow-400/10 text-yellow-400': status === 'connecting',
          'bg-green-400/10  text-green-400': status === 'connected',
          'bg-red-400/10    text-red-400': status === 'error',
        }"
      >
        <span
          class="w-1.5 h-1.5 rounded-full"
          :class="{
            'bg-yellow-400 animate-pulse': status === 'connecting',
            'bg-green-400': status === 'connected',
            'bg-red-400': status === 'error',
          }"
        />
        {{ $t(`fileManager.status.${status}`) }}
      </span>

      <div class="flex-1" />
      <ManualLink chapter="sftp" />
      <NDropdown
        v-if="sessionId && hasTerminalSftpChannel(sessionId)"
        :options="[{ label: t('fileUtilities.copyTitle'), key: 'copy' }, { label: t('fileUtilities.editTitle'), key: 'edit' }]"
        @select="key => openUtility(key as 'copy' | 'edit', currentPath.replace(/\/$/, '') + '/')"
      >
        <NButton
          size="tiny"
          ghost
        >
          {{ t('fileUtilities.utilities') }}
        </NButton>
      </NDropdown>

      <NButton
        v-if="status === 'error'"
        size="tiny"
        type="error"
        ghost
        @click="initConnection"
      >
        {{ $t('fileManager.retry') }}
      </NButton>

      <template v-if="status === 'connected'">
        <NButton
          size="tiny"
          ghost
          class="sftp-tree-toggle"
          :aria-expanded="showTree"
          @click="showTree = !showTree"
        >
          {{ $t('fileManager.folders') }}
        </NButton>
        <NTooltip
          trigger="hover"
          placement="bottom"
          :delay="800"
        >
          <template #trigger>
            <NButton
              size="tiny"
              ghost
              @click="loadDir(currentPath)"
            >
              ↺
            </NButton>
          </template>
          <span class="text-xs">{{ $t('fileManager.refresh') }} <span class="text-[var(--na-text-muted)] font-mono ml-1">{{ shortcuts.refresh }}</span></span>
        </NTooltip>
        <NTooltip
          trigger="hover"
          placement="bottom"
          :delay="800"
        >
          <template #trigger>
            <NButton
              size="tiny"
              ghost
              :disabled="loading || !!directoryError"
              @click="triggerUpload"
            >
              ↑ {{ $t('fileManager.uploadBtn') }}
            </NButton>
          </template>
          <span class="text-xs">{{ $t('fileManager.uploadBtn') }} <span class="text-[var(--na-text-muted)] font-mono ml-1">{{ shortcuts.upload }}</span></span>
        </NTooltip>
        <NButton
          size="tiny"
          ghost
          :disabled="loading || !!directoryError"
          @click="openMkdirDialog"
        >
          ＋ {{ $t('fileManager.newFolder') }}
        </NButton>
        <NButton
          size="tiny"
          ghost
          :disabled="loading || !!directoryError"
          @click="openTouchDialog"
        >
          ＋ {{ $t('fileManager.newFile') }}
        </NButton>
      </template>
      <input
        ref="uploadRef"
        type="file"
        multiple
        class="hidden"
        @change="onFileSelected"
      >
    </div>

    <!-- ── Error state ─────────────────────────────────────────────────── -->
    <div
      v-if="status === 'error'"
      class="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--na-text-subtle)]"
    >
      <span class="text-3xl">⚠️</span>
      <NText depth="3">
        {{ $t('fileManager.status.error') }}
      </NText>
      <NButton
        type="primary"
        size="small"
        @click="initConnection"
      >
        {{ $t('fileManager.retry') }}
      </NButton>
    </div>

    <!-- ── Connecting ──────────────────────────────────────────────────── -->
    <div
      v-else-if="status === 'connecting'"
      class="flex-1 flex items-center justify-center"
    >
      <NSpin size="medium" />
    </div>

    <!-- ── Main layout ─────────────────────────────────────────────────── -->
    <div
      v-else
      class="flex flex-1 overflow-hidden min-h-0"
    >
      <!-- Left: directory tree -->
      <div
        class="sftp-tree shrink-0 overflow-y-auto bg-[var(--na-surface)] border-r border-[var(--na-border)] pt-1"
        :class="{ 'sftp-tree-open': showTree }"
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
        class="sftp-tree-resize w-1 shrink-0 cursor-col-resize bg-[var(--na-border)] hover:bg-blue-500 transition-colors"
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
            <div class="relative bg-[#1e2533] text-[var(--na-info-text)] text-sm font-medium px-6 py-4 rounded-xl shadow-2xl border border-blue-500/40 flex items-center gap-3">
              <span class="text-2xl">☁</span>
              {{ $t('fileManager.dropToUpload') }}
            </div>
          </div>
        </Teleport>

        <!-- Breadcrumb -->
        <div class="flex items-center gap-0.5 px-3 py-1.5 border-b border-[var(--na-border)] shrink-0 bg-[var(--na-surface-soft)] overflow-x-auto">
          <button
            v-if="currentPath !== '/'"
            class="text-[var(--na-text-subtle)] hover:text-[var(--na-text-strong)] text-xs mr-1 shrink-0"
            :title="$t('fileManager.goUp')"
            @click="goUp"
          >
            ↑
          </button>
          <template
            v-for="(crumb, i) in breadcrumbs"
            :key="crumb.path"
          >
            <button
              class="text-xs whitespace-nowrap hover:text-[var(--na-text-strong)] transition-colors"
              :class="i === breadcrumbs.length - 1 ? 'text-[var(--na-text-strong)] font-semibold' : 'text-[var(--na-text-muted)]'"
              @click="navigate(crumb.path)"
            >
              {{ crumb.label }}
            </button>
            <span
              v-if="i < breadcrumbs.length - 1"
              class="text-gray-600 text-xs mx-0.5 shrink-0"
            >/</span>
          </template>
        </div>

        <!-- File table -->
        <div class="flex-1 overflow-auto">
          <NAlert
            v-if="directoryError"
            type="error"
            class="m-3"
            :title="directoryError"
          >
            <NButton
              size="small"
              @click="loadDir(currentPath)"
            >
              {{ $t('fileManager.retry') }}
            </NButton>
          </NAlert>
          <NSpin :show="loading">
            <NEmpty
              v-if="!loading && !directoryError && sorted.length === 0"
              :description="$t('fileManager.empty')"
              class="flex flex-col items-center justify-center py-12"
            />
            <table
              v-else-if="!directoryError"
              class="w-full text-xs"
            >
              <thead class="sticky top-0 z-10 bg-[var(--na-surface)]">
                <tr class="text-[var(--na-text-subtle)] border-b border-[var(--na-border)]">
                  <th class="text-left px-3 py-1.5 font-normal">
                    {{ $t('fileManager.columns.name') }}
                  </th>
                  <th class="px-2 py-1.5 font-normal">
                    {{ $t('fileManager.actions') }}
                  </th>
                  <th class="text-right px-3 py-1.5 font-normal w-20">
                    {{ $t('fileManager.columns.size') }}
                  </th>
                  <th class="text-left px-3 py-1.5 font-normal w-24 font-mono">
                    {{ $t('fileManager.columns.permissions') }}
                  </th>
                  <th class="text-left px-3 py-1.5 font-normal w-32">
                    {{ $t('fileManager.columns.modified') }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="entry in sorted"
                  :key="entry.path"
                  class="border-b border-[var(--na-border)]/40 hover:bg-[var(--na-sidebar-hover)] transition-colors group"
                  :class="entry.type === 'directory' ? 'cursor-pointer' : 'cursor-default'"
                  tabindex="0"
                  :aria-label="entry.name"
                  @keydown="onEntryKeydown($event, entry)"
                  @dblclick="openEntry(entry)"
                  @contextmenu="openCtx($event, entry)"
                >
                  <td class="px-3 py-1.5">
                    <div class="flex items-center gap-1.5 min-w-0">
                      <span class="shrink-0">{{ entryIcon(entry) }}</span>
                      <span
                        class="truncate"
                        :class="entry.type === 'directory' ? 'text-[var(--na-info-text)] font-medium' : 'text-[var(--na-text)]'"
                        :title="entry.name"
                      >{{ entry.name }}</span>
                    </div>
                  </td>
                  <td class="px-2 py-1.5">
                    <NDropdown
                      trigger="click"
                      :options="entryActions(entry)"
                      @select="(key) => runEntryAction(key, entry)"
                    >
                      <NButton
                        size="tiny"
                        :aria-label="$t('fileManager.actionsFor', { name: entry.name })"
                      >
                        ⋯
                      </NButton>
                    </NDropdown>
                  </td>
                  <td class="px-3 py-1.5 text-right text-[var(--na-text-muted)] tabular-nums">
                    {{ formatSize(entry.size, entry.type) }}
                  </td>
                  <td class="px-3 py-1.5 text-[var(--na-text-muted)] font-mono">
                    {{ entry.permissions }}
                  </td>
                  <td class="px-3 py-1.5 text-[var(--na-text-muted)] whitespace-nowrap">
                    {{ formatDate(entry.modifiedAt) }}
                  </td>
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
        <div class="flex items-center justify-between px-3 py-1.5 border-b border-[var(--na-border)]">
          <span class="text-xs font-medium text-[var(--na-text-muted)]">
            {{ $t('fileManager.transfers.title') }}
            <span class="ml-1 text-gray-600">({{ transfers.length }})</span>
          </span>
          <button
            class="text-xs text-gray-600 hover:text-gray-300 transition-colors"
            @click="clearDone"
          >
            {{ $t('fileManager.transfers.clearDone') }}
          </button>
        </div>

        <!-- Transfer rows -->
        <div class="max-h-40 overflow-y-auto">
          <div
            v-for="tr in transfers"
            :key="tr.id"
            class="px-3 py-2 border-b border-[var(--na-border)]/50 last:border-0"
          >
            <!-- Row header -->
            <div class="flex items-center gap-2 mb-1">
              <!-- Type icon -->
              <span
                class="text-xs shrink-0"
                :class="tr.type === 'upload' ? 'text-blue-400' : 'text-green-400'"
              >
                {{ tr.type === 'upload' ? '↑' : '↓' }}
              </span>
              <!-- Filename -->
              <span
                class="text-xs text-gray-300 truncate flex-1"
                :title="tr.name"
              >{{ tr.name }}</span>
              <!-- Status / progress -->
              <span
                class="text-xs shrink-0 tabular-nums"
                :class="{
                  'text-[var(--na-text-muted)]': tr.status === 'active',
                  'text-green-400': tr.status === 'done',
                  'text-red-400': tr.status === 'error',
                }"
              >
                <template v-if="tr.status === 'active'">
                  {{ tr.progress }}%
                  <span
                    v-if="tr.total"
                    class="text-gray-600 ml-1"
                  >
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

    <NDropdown
      trigger="manual"
      :show="showCtx"
      :x="ctxX"
      :y="ctxY"
      :options="ctxEntry ? entryActions(ctxEntry) : []"
      @clickoutside="closeCtx"
      @select="(key) => ctxEntry && runEntryAction(key, ctxEntry)"
    />

    <NModal
      v-model:show="showMkdirDialog"
      preset="card"
      :title="$t('fileManager.newFolderDialog.title')"
      style="width: min(320px, calc(100vw - 32px))"
    >
      <form @submit.prevent="confirmMkdir">
        <label
          for="sftp-mkdir-name"
          class="block mb-2"
        >{{ $t('fileManager.newFolderDialog.label') }}</label>
        <NInput
          v-model:value="mkdirName"
          :input-props="{ id: 'sftp-mkdir-name' }"
          :placeholder="$t('fileManager.newFolderDialog.placeholder')"
        />
        <NSpace
          justify="end"
          class="mt-4"
        >
          <NButton @click="showMkdirDialog = false">
            {{ $t('common.cancel') }}
          </NButton>
          <NButton
            type="primary"
            attr-type="submit"
            :loading="mutationLoading"
            :disabled="!mkdirName.trim() || mutationLoading"
          >
            {{ $t('fileManager.newFolderDialog.confirm') }}
          </NButton>
        </NSpace>
      </form>
    </NModal>

    <NModal
      v-model:show="showTouchDialog"
      preset="card"
      :title="$t('fileManager.newFileDialog.title')"
      style="width: min(320px, calc(100vw - 32px))"
    >
      <form @submit.prevent="confirmTouch">
        <label
          for="sftp-touch-name"
          class="block mb-2"
        >{{ $t('fileManager.newFileDialog.label') }}</label>
        <NInput
          v-model:value="touchName"
          :input-props="{ id: 'sftp-touch-name' }"
          :placeholder="$t('fileManager.newFileDialog.placeholder')"
        />
        <NSpace
          justify="end"
          class="mt-4"
        >
          <NButton @click="showTouchDialog = false">
            {{ $t('common.cancel') }}
          </NButton>
          <NButton
            type="primary"
            attr-type="submit"
            :loading="mutationLoading"
            :disabled="!touchName.trim() || mutationLoading"
          >
            {{ $t('fileManager.newFileDialog.confirm') }}
          </NButton>
        </NSpace>
      </form>
    </NModal>

    <NModal
      :show="!!renamingEntry"
      preset="card"
      :title="$t('fileManager.renameDialog.title')"
      style="width: min(320px, calc(100vw - 32px))"
      @update:show="(show) => { if (!show) renamingEntry = null }"
    >
      <form @submit.prevent="confirmRename">
        <label
          for="sftp-rename-name"
          class="block mb-2"
        >{{ $t('fileManager.renameDialog.label') }}</label>
        <NInput
          v-model:value="renameValue"
          :input-props="{ id: 'sftp-rename-name' }"
        />
        <NSpace
          justify="end"
          class="mt-4"
        >
          <NButton @click="renamingEntry = null">
            {{ $t('common.cancel') }}
          </NButton>
          <NButton
            type="primary"
            attr-type="submit"
            :loading="mutationLoading"
            :disabled="!renameValue.trim() || mutationLoading"
          >
            {{ $t('fileManager.renameDialog.confirm') }}
          </NButton>
        </NSpace>
      </form>
    </NModal>

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
.sftp-manager { container-type: inline-size; }
.sftp-tree-toggle { display: none; }
tr:focus-visible { outline: 2px solid #60a5fa; outline-offset: -2px; }
@container (max-width: 640px) {
  .sftp-tree-toggle { display: inline-flex; }
  .sftp-tree { display: none; max-width: 35%; }
  .sftp-tree.sftp-tree-open { display: block; }
  .sftp-tree-resize { display: none; }
}
:deep(.n-tree) { background: transparent; color: var(--na-text); }
:deep(.n-tree-node-content) { font-size: 12px; padding: 2px 0; }
:deep(.n-tree-node--selected > .n-tree-node-content) { background: var(--na-primary-soft); color: var(--na-info-text); }
:deep(.n-tree-node-content:hover) { background: var(--na-sidebar-hover); }
:deep(.n-tree-node-switcher) { color: #6b7280; }

.panel-slide-enter-active,
.panel-slide-leave-active { transition: max-height 0.2s ease, opacity 0.2s ease; overflow: hidden; }
.panel-slide-enter-from,
.panel-slide-leave-to { max-height: 0; opacity: 0; }
.panel-slide-enter-to,
.panel-slide-leave-from { max-height: 200px; }
</style>
