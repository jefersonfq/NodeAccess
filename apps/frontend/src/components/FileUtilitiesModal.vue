<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { NAlert, NButton, NInput, NModal, NRadioGroup, NRadioButton, NSelect } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { fileUtilityViaTerminal, subscribeTerminalEdits, subscribeTerminalChannels, terminalEdits, rememberTerminalEdit, type FileDestination } from '@/services/terminal-sftp-channel.service'
import { hostService } from '@/services/host.service'
import { useTerminalStore } from '@/stores/terminals'
import type { HostPublic } from '@nodeaccess/shared'

const props = defineProps<{ sessionId: number; hostId: number; path: string; mode: 'copy' | 'edit' }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const terminals = useTerminalStore()
const sourceHost = ref<HostPublic | null>(null)
const hostMetadata = ref<HostPublic[]>([])
const sameFolder = (host: HostPublic | undefined): boolean => !!host && !!sourceHost.value && ((!!host.inventoryParentId && host.inventoryParentId === sourceHost.value.inventoryParentId) || (!!host.folderId && host.folderId === sourceHost.value.folderId))
const destinations = ref<FileDestination[]>([])
const localEditorAvailable = ref(false)
const selected = ref<number | null>(null)
const file = ref(props.path)
const directory = ref('')
const method = ref<'copy' | 'command'>('copy')
const loading = ref(false); const error = ref(''); const result = ref(''); const command = ref('')
const search = ref(''); const hosts = ref<HostPublic[]>([]); const searching = ref(false)
const editing = ref(''); const editId = ref('')
const options = computed(() => [...destinations.value]
  .sort((a, b) => Number(sameFolder(hostMetadata.value.find(h => h.id === b.hostId)))
    - Number(sameFolder(hostMetadata.value.find(h => h.id === a.hostId))) || a.name.localeCompare(b.name))
  .map(destination => ({
    value: destination.sessionId,
    label: `${sameFolder(hostMetadata.value.find(h => h.id === destination.hostId)) ? t('fileUtilities.sameFolder') + ' · ' : ''}${destination.name} · ${destination.username}@${destination.ip}`,
  })))
const stateLabels = computed<Record<string, string>>(() => ({ editing: t('fileUtilities.editing'), sending: t('fileUtilities.sending'), synced: t('fileUtilities.synced'), conflict: t('fileUtilities.conflict'), error: t('fileUtilities.editError'), offline: t('fileUtilities.offline'), 'agent-unavailable': t('fileUtilities.agentUnavailable'), declined: t('fileUtilities.editorOpenFailed'), closed: t('fileUtilities.closed') }))
let disposed = false; let queryVersion = 0
let unsubscribe: (() => void) | undefined
let unsubscribeChannels: (() => void) | undefined
let channelRefresh: ReturnType<typeof setTimeout> | undefined
let connectingHostId: number | undefined
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { if (!disposed) void findHosts() }, 250) })
function describe(error: unknown): string { const code = error instanceof Error ? error.message : ''; return t(`fileUtilities.errors.${code}`, t('fileUtilities.failed')) }
async function refresh(): Promise<void> {
  loading.value = true; error.value = ''
  try {
    const data = await fileUtilityViaTerminal(props.sessionId, { operation: 'destinations' })
    if (disposed) return
    destinations.value = data.destinations ?? []
    localEditorAvailable.value = data.localEditorAvailable === true
    if (props.mode === 'copy') {
      try {
        const ids = [...new Set([props.hostId, ...destinations.value.map(d => d.hostId)])]
        const metadata = await hostService.listVisibleByIds(ids)
        if (!disposed) {
          hostMetadata.value = metadata.data
          sourceHost.value = metadata.data.find(h => h.id === props.hostId) ?? null
        }
      } catch { /* Ranking is optional; operational sessions remain usable. */ }
      if (connectingHostId) selected.value = destinations.value.find(d => d.hostId === connectingHostId)?.sessionId ?? selected.value
    }
  }
  catch (e) { if (!disposed) error.value = describe(e) }
  finally { if (!disposed) loading.value = false }
}
async function findHosts(): Promise<void> {
  const version = ++queryVersion
  searching.value = true; error.value = ''
  try { const { data } = await hostService.list({ search: search.value.trim() || undefined, page: 1, limit: 20, accessProtocol: 'ssh' }); if (!disposed && version === queryVersion) hosts.value = [...data.data].sort((a, b) => Number(sameFolder(b)) - Number(sameFolder(a))) }
  catch (e) { if (!disposed && version === queryVersion) error.value = describe(e) }
  finally { if (!disposed && version === queryVersion) searching.value = false }
}
function connect(host: HostPublic): void {
  connectingHostId = host.id
  let tab = terminals.tabs.find(tab => tab.hostId === host.id)
  if (!tab) {
    const origin = terminals.activeId
    const id = terminals.add(host)
    terminals.activeId = origin
    tab = terminals.tabs.find(tab => tab.id === id)
  }
  if (tab) tab.connectInBackground = true
  selected.value = destinations.value.find(destination => destination.hostId === host.id)?.sessionId ?? selected.value
  result.value = t('fileUtilities.connectHint')
}
async function run(): Promise<void> {
  loading.value = true; error.value = ''; result.value = ''; command.value = ''
  try {
    const data = await fileUtilityViaTerminal(props.sessionId, { operation: props.mode === 'edit' ? 'edit' : method.value, path: file.value, targetSessionId: selected.value ?? undefined, directory: directory.value.trim() || undefined })
    if (disposed) return
    if (data.editId) { editId.value = data.editId; editing.value = 'preparing'; rememberTerminalEdit(props.sessionId, file.value, data.editId) }
    else if (data.command) command.value = data.command
    else result.value = t('fileUtilities.copied', { path: data.path, username: data.username })
  } catch (e) { if (!disposed) error.value = describe(e) }
  finally { if (!disposed) loading.value = false }
}
async function copyCommand(): Promise<void> {
  try { await navigator.clipboard.writeText(command.value); result.value = t('fileUtilities.commandCopied') } catch { error.value = t('fileUtilities.clipboardError') }
}
async function cancelCopy(): Promise<void> {
  try { await fileUtilityViaTerminal(props.sessionId, { operation: 'cancel' }) } catch (e) { error.value = describe(e) }
}
async function retryEdit(): Promise<void> {
  error.value = ''
  try { await fileUtilityViaTerminal(props.sessionId, { operation: 'resume-edit', editId: editId.value }); editing.value = 'sending' } catch (e) { error.value = describe(e) }
}
async function stop(): Promise<void> {
  loading.value = true
  try { await fileUtilityViaTerminal(props.sessionId, { operation: 'stop-edit', editId: editId.value }); editing.value = 'closed'; editId.value = ''; terminalEdits.delete(`${props.sessionId}:${file.value}`) }
  catch (e) { error.value = describe(e) }
  finally { loading.value = false }
}
onMounted(() => {
  unsubscribe = subscribeTerminalEdits(props.sessionId, event => { if (event.path === file.value) { editing.value = String(event.state); error.value = event.code === 'FILE_BACKUP_QUOTA' ? t('fileUtilities.errors.FILE_BACKUP_QUOTA') : ''; if (['closed','declined','offline','agent-unavailable'].includes(editing.value)) editId.value = '' } })
  const active = terminalEdits.get(`${props.sessionId}:${props.path}`)
  if (active) { if (active.code === 'FILE_BACKUP_QUOTA') error.value = t('fileUtilities.errors.FILE_BACKUP_QUOTA'); editing.value = active.state; editId.value = ['closed','declined','offline','agent-unavailable'].includes(active.state) ? '' : active.editId }
  void refresh()
  if (props.mode === 'copy') {
    unsubscribeChannels = subscribeTerminalChannels(() => { clearTimeout(channelRefresh); channelRefresh = setTimeout(() => { if (!disposed) void refresh() }, 300) })
  }
})
onUnmounted(() => { disposed = true; queryVersion++; unsubscribe?.(); unsubscribeChannels?.(); clearTimeout(channelRefresh); clearTimeout(searchTimer) })
</script>

<template>
  <NModal
    :show="true"
    preset="card"
    :title="t(mode === 'copy' ? 'fileUtilities.copyTitle' : 'fileUtilities.editTitle')"
    style="width:min(580px,calc(100vw - 24px))"
    :mask-closable="!loading"
    @close="!loading && emit('close')"
    @update:show="v => { if (!v && !loading) emit('close') }"
  >
    <label
      class="block mb-1"
      for="utility-file"
    >{{ t('fileUtilities.file') }}</label>
    <NInput
      v-model:value="file"
      :disabled="loading || !!editId"
      :input-props="{ id: 'utility-file' }"
      class="mb-4"
    />
    <NAlert
      v-if="error"
      type="error"
      class="mb-3"
    >
      {{ error }}
    </NAlert>
    <NAlert
      v-if="result"
      type="success"
      class="mb-3"
    >
      {{ result }}
    </NAlert>
    <template v-if="mode === 'copy'">
      <NRadioGroup
        v-model:value="method"
        class="mb-4"
        :disabled="loading"
      >
        <NRadioButton value="copy">
          {{ t('fileUtilities.smallCopy') }}
        </NRadioButton>
        <NRadioButton value="command">
          {{ t('fileUtilities.directCommand') }}
        </NRadioButton>
      </NRadioGroup>
      <p class="mb-3 text-sm">
        {{ t(method === 'copy' ? 'fileUtilities.copyHint' : 'fileUtilities.commandHint') }}
      </p>
      <label
        class="block mb-1"
        for="file-destination"
      >{{ t('fileUtilities.destination') }}</label>
      <NSelect
        v-model:value="selected"
        :options="options"
        filterable
        :disabled="loading"
        :input-props="{ id: 'file-destination' }"
        :placeholder="t('fileUtilities.selectDestination')"
      />
      <NButton
        class="mt-2 mb-4"
        size="small"
        :loading="loading"
        @click="refresh"
      >
        {{ t('fileUtilities.refresh') }}
      </NButton>
      <label
        class="block mb-1"
        for="file-directory"
      >{{ t('fileUtilities.directory') }}</label>
      <NInput
        v-model:value="directory"
        :input-props="{ id: 'file-directory' }"
        :disabled="loading"
        :placeholder="t('fileUtilities.homeDefault')"
      />
      <details
        class="my-4"
        @toggle="event => { if ((event.target as HTMLDetailsElement).open && !hosts.length) findHosts() }"
      >
        <summary>{{ t('fileUtilities.otherHost') }}</summary>
        <form
          class="flex gap-2 mt-3"
          @submit.prevent="findHosts"
        >
          <NInput
            v-model:value="search"
            :placeholder="t('fileUtilities.search')"
            :input-props="{ 'aria-label': t('fileUtilities.search') }"
          />
          <NButton
            attr-type="submit"
            :loading="searching"
          >
            {{ t('fileUtilities.searchButton') }}
          </NButton>
        </form>
        <div
          v-for="host in hosts"
          :key="host.id"
          class="flex justify-between items-center gap-2 py-2"
        >
          <span>{{ host.name }} · {{ host.ip }}</span>
          <NButton
            size="small"
            @click="connect(host)"
          >
            {{ t('fileUtilities.connect') }}
          </NButton>
        </div>
        <p class="text-sm mt-2">
          {{ t('fileUtilities.connectHint') }}
        </p>
      </details>
      <NInput
        v-if="command"
        :value="command"
        type="textarea"
        readonly
        :input-props="{ 'aria-label': t('fileUtilities.command') }"
      />
      <NButton
        v-if="command"
        class="mt-2"
        @click="copyCommand"
      >
        {{ t('fileUtilities.copyCommand') }}
      </NButton>
      <NAlert
        v-if="command"
        type="warning"
        class="mt-3"
      >
        {{ t('fileUtilities.commandWarning') }}
      </NAlert>
    </template>
    <template v-else>
      <p class="mb-3">
        {{ t('fileUtilities.editHint') }}
      </p>
      <NAlert
        v-if="!loading && !localEditorAvailable && !editId"
        type="warning"
        class="mb-3"
      >
        {{ t('fileUtilities.agentUnavailable') }} <NButton
          class="mt-2"
          size="small"
          @click="refresh"
        >
          {{ t('fileUtilities.checkAgent') }}
        </NButton>
      </NAlert>
      <NAlert
        v-if="editing"
        :type="['conflict','error','declined','offline','agent-unavailable'].includes(editing) ? 'warning' : 'info'"
      >
        {{ stateLabels[editing] || t('fileUtilities.preparing') }}
      </NAlert>
      <p class="mt-3 text-sm">
        {{ t('fileUtilities.draftHint') }}
      </p>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 flex-wrap">
        <NButton
          v-if="loading && mode === 'copy' && method === 'copy'"
          @click="cancelCopy"
        >
          {{ t('fileUtilities.cancelCopy') }}
        </NButton>
        <NButton
          :disabled="loading"
          @click="emit('close')"
        >
          {{ t('fileUtilities.close') }}
        </NButton>
        <NButton
          v-if="editId && editing === 'error'"
          @click="retryEdit"
        >
          {{ t('fileUtilities.retryUpload') }}
        </NButton>
        <NButton
          v-if="editId"
          type="warning"
          :loading="loading"
          @click="stop"
        >
          {{ t('fileUtilities.stop') }}
        </NButton>
        <NButton
          v-else
          type="primary"
          :loading="loading"
          :disabled="mode === 'copy' ? !selected : !localEditorAvailable"
          @click="run"
        >
          {{ t(mode === 'edit' ? 'fileUtilities.openEditor' : method === 'copy' ? 'fileUtilities.copy' : 'fileUtilities.prepareCommand') }}
        </NButton>
      </div>
    </template>
  </NModal>
</template>
