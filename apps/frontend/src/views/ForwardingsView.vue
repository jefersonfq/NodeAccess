<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  NAlert, NButton, NInput, NSwitch, NEmpty, NSpin, NModal, useMessage,
} from 'naive-ui'
import { useI18n } from 'vue-i18n'
import {
  portForwardingService,
  type PortForwardingWithHost,
  type CreatePortForwardingDto,
} from '@/services/portForwarding.service'
import { webAccessService } from '@/services/webAccess.service'
import { featuresService } from '@/services/features.service'

const { t, tm } = useI18n()
const message    = useMessage()
const router     = useRouter()
const route      = useRoute()

// ── State ─────────────────────────────────────────────────────────────────────

const forwardings = ref<PortForwardingWithHost[]>([])
const loading     = ref(false)
const portForwardingLicensed = ref(true)
const search      = ref('')
const showHelp    = ref(false)
const selectedHostFilterId = ref<number | null>(null)
const selectedHostFilterName = ref('')

const showModal   = ref(false)
const modalHostId = ref(0)
const modalHostName = ref('')
const editId      = ref<number | null>(null)
const saving      = ref(false)
const showAdvancedOptions = ref(false)
const form        = ref<CreatePortForwardingDto & { description: string }>({
  description: '', bindAddress: '127.0.0.1', webEnabled: false, webProtocol: 'http', localPort: 3306, remoteHost: '127.0.0.1', remotePort: 3306, autoStart: false,
})

const bindAddressOptions = [
  { label: '127.0.0.1', value: '127.0.0.1' },
  { label: '0.0.0.0', value: '0.0.0.0' },
] as const

function getErrorMessage(error: unknown, fallback: string): string {
  const err = error as { response?: { data?: { message?: string } } }
  return err.response?.data?.message ?? fallback
}

// Examples extraídos via tm() para não serializar o array
const helpExamples = computed<Array<{ title: string; local: number; host: string; remote: number; desc: string }>>(() =>
  tm('forwardingsPage.help.examples') as Array<{ title: string; local: number; host: string; remote: number; desc: string }>,
)

// ── Data ──────────────────────────────────────────────────────────────────────

async function load() {
  const features = await featuresService.get()
  portForwardingLicensed.value = features.portForwardingLicensed
  if (!portForwardingLicensed.value) {
    forwardings.value = []
    return
  }

  loading.value = true
  try {
    const { data } = await portForwardingService.listAll()
    forwardings.value = data
  } finally {
    loading.value = false
  }
}

onMounted(load)
onMounted(() => {
  syncHostFilterFromRoute()
  void maybeOpenCreateFromRoute()
})
watch(() => route.query.hostId, () => {
  syncHostFilterFromRoute()
})
watch(() => route.query.hostName, () => {
  syncHostFilterFromRoute()
})
watch(() => route.query.createHostId, async () => {
  await maybeOpenCreateFromRoute()
})

// ── Grouped by host ───────────────────────────────────────────────────────────

interface HostGroup {
  hostId:   number
  hostName: string
  hostIp:   string
  items:    PortForwardingWithHost[]
}

const groups = computed<HostGroup[]>(() => {
  const q = search.value.toLowerCase()
  const map = new Map<number, HostGroup>()

  for (const fw of forwardings.value) {
    if (selectedHostFilterId.value !== null && fw.hostId !== selectedHostFilterId.value) continue

    if (q && !(
      fw.hostName.toLowerCase().includes(q) ||
      fw.hostIp.toLowerCase().includes(q) ||
      fw.remoteHost.toLowerCase().includes(q) ||
      (fw.description ?? '').toLowerCase().includes(q)
    )) continue

    if (!map.has(fw.hostId)) {
      map.set(fw.hostId, { hostId: fw.hostId, hostName: fw.hostName, hostIp: fw.hostIp, items: [] })
    }
    map.get(fw.hostId)!.items.push(fw)
  }
  return [...map.values()].sort((a, b) => a.hostName.localeCompare(b.hostName))
})

// ── Toggle autoStart ──────────────────────────────────────────────────────────

async function toggleAutoStart(fw: PortForwardingWithHost) {
  if (!portForwardingLicensed.value) return
  const next = !fw.autoStart
  try {
    await portForwardingService.update(fw.hostId, fw.id, { autoStart: next })
    fw.autoStart = next
  } catch (error: unknown) {
    message.error(getErrorMessage(error, t('tunnels.templateError')))
  }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

function openCreate(hostId: number, hostName = '') {
  if (!portForwardingLicensed.value) return
  modalHostId.value = hostId
  modalHostName.value = hostName
  editId.value      = null
  showAdvancedOptions.value = false
  form.value        = { description: '', bindAddress: '127.0.0.1', webEnabled: false, webProtocol: 'http', localPort: 3306, remoteHost: '127.0.0.1', remotePort: 3306, autoStart: false }
  showModal.value   = true
}

async function maybeOpenCreateFromRoute() {
  const raw = route.query.createHostId
  if (!raw) return

  const hostId = Number(Array.isArray(raw) ? raw[0] : raw)
  if (!Number.isFinite(hostId) || hostId <= 0) return
  const rawName = route.query.createHostName
  const hostName = Array.isArray(rawName) ? rawName[0] : rawName

  openCreate(hostId, typeof hostName === 'string' ? hostName : '')

  const query = { ...route.query }
  delete query.createHostId
  delete query.createHostName
  await router.replace({ query })
}

function syncHostFilterFromRoute() {
  const rawId = route.query.hostId
  const hostId = Number(Array.isArray(rawId) ? rawId[0] : rawId)
  selectedHostFilterId.value = Number.isFinite(hostId) && hostId > 0 ? hostId : null

  const rawName = route.query.hostName
  const hostName = Array.isArray(rawName) ? rawName[0] : rawName
  selectedHostFilterName.value = typeof hostName === 'string' ? hostName : ''
}

async function clearHostFilter() {
  const query = { ...route.query }
  delete query.hostId
  delete query.hostName
  await router.replace({ query })
}

function openEdit(fw: PortForwardingWithHost) {
  if (!portForwardingLicensed.value) return
  modalHostId.value = fw.hostId
  modalHostName.value = fw.hostName
  editId.value      = fw.id
  showAdvancedOptions.value = fw.bindAddress !== '127.0.0.1'
  form.value        = {
    description: fw.description ?? '',
    bindAddress: fw.bindAddress,
    webEnabled: fw.webEnabled,
    webProtocol: fw.webProtocol,
    localPort:   fw.localPort,
    remoteHost:  fw.remoteHost,
    remotePort:  fw.remotePort,
    autoStart:   fw.autoStart,
  }
  showModal.value = true
}

async function save() {
  if (!portForwardingLicensed.value) return
  saving.value = true
  try {
    const payload: CreatePortForwardingDto = {
      ...(form.value.description.trim() && { description: form.value.description.trim() }),
      bindAddress: form.value.bindAddress,
      webEnabled: form.value.webEnabled,
      webProtocol: form.value.webProtocol,
      localPort:  form.value.localPort,
      remoteHost: form.value.remoteHost,
      remotePort: form.value.remotePort,
      autoStart:  form.value.autoStart,
    }
    if (editId.value !== null) {
      await portForwardingService.update(modalHostId.value, editId.value, payload)
    } else {
      await portForwardingService.create(modalHostId.value, payload)
    }
    showModal.value = false
    await load()
    message.success(t('tunnels.templateSaved'))
  } catch (error: unknown) {
    message.error(getErrorMessage(error, t('tunnels.templateError')))
  } finally {
    saving.value = false
  }
}

async function remove(fw: PortForwardingWithHost) {
  if (!portForwardingLicensed.value) return
  if (!window.confirm(t('forwardingsPage.deleteConfirm', { port: fw.localPort }))) return
  try {
    await portForwardingService.remove(fw.hostId, fw.id)
    await load()
    message.success(t('tunnels.templateRemoved'))
  } catch (error: unknown) {
    message.error(getErrorMessage(error, t('tunnels.templateError')))
  }
}

async function openWebAccess(fw: PortForwardingWithHost) {
  if (!portForwardingLicensed.value) return
  try {
    const { data } = await webAccessService.createLink(fw.id)
    if (data.usedPortFallback) {
      message.info(t('tunnels.webOpenReadyWithFallback', {
        assigned: data.assignedLocalPort,
        requested: data.requestedLocalPort,
      }))
    } else {
      message.success(t('tunnels.webOpenReady', { port: data.assignedLocalPort }))
    }
    window.open(data.url, '_blank', 'noopener,noreferrer')
  } catch (error: unknown) {
    message.error(getErrorMessage(error, t('tunnels.webOpenError')))
  }
}

function goToHost(hostId: number) {
  router.push({ name: 'hosts', query: { editHostId: String(hostId) } })
}

function preview(fw: { bindAddress?: '127.0.0.1' | '0.0.0.0'; localPort: number; remoteHost: string; remotePort: number }) {
  return `${fw.bindAddress ?? '127.0.0.1'}:${fw.localPort} → ${fw.remoteHost}:${fw.remotePort}`
}
</script>

<template>
  <div style="height: 100vh; overflow-y: auto; background: #101014;">
    <div class="max-w-4xl mx-auto px-6 py-8 space-y-6">

      <!-- ── Header ──────────────────────────────────────────────────────────── -->
      <div>
        <h1 class="text-2xl font-bold text-white">{{ $t('forwardingsPage.title') }}</h1>
        <p class="text-gray-400 mt-1 text-sm">{{ $t('forwardingsPage.subtitle') }}</p>
      </div>
      <NAlert
        v-if="!portForwardingLicensed"
        type="warning"
        :show-icon="true"
        style="border-radius: 12px;"
      >
        <template #header>{{ $t('forwardingsPage.license.title') }}</template>
        {{ $t('forwardingsPage.license.description') }}
      </NAlert>
      <div
        v-if="portForwardingLicensed && selectedHostFilterId !== null"
        class="flex items-center justify-between gap-3 rounded-lg border border-blue-900/40 bg-blue-950/20 px-4 py-3"
      >
        <div class="min-w-0">
          <div class="text-xs text-blue-300">{{ $t('forwardingsPage.filteredByHost') }}</div>
          <div class="mt-1 truncate text-sm text-blue-100">
            <span class="font-medium">{{ selectedHostFilterName || $t('forwardingsPage.selectedHostFallback', { id: selectedHostFilterId }) }}</span>
            <span class="ml-2 font-mono text-blue-300/70">#{{ selectedHostFilterId }}</span>
          </div>
        </div>
        <NButton size="small" quaternary @click="clearHostFilter">
          {{ $t('forwardingsPage.clearHostFilter') }}
        </NButton>
      </div>

      <!-- ── Help card (retrátil) ────────────────────────────────────────────── -->
      <div v-if="portForwardingLicensed" class="rounded-xl border border-gray-800 bg-[#111113] overflow-hidden">
        <button
          class="w-full flex items-center justify-between px-5 py-3.5 text-left"
          @click="showHelp = !showHelp"
        >
          <span class="text-sm font-semibold text-gray-200">{{ $t('forwardingsPage.help.title') }}</span>
          <span class="text-gray-500 text-xs">{{ showHelp ? '▲' : '▼' }}</span>
        </button>

        <div v-if="showHelp" class="border-t border-gray-800">
          <div class="px-5 py-4 space-y-4">

            <p class="text-sm text-gray-400">{{ $t('forwardingsPage.help.desc') }}</p>

            <!-- Diagrama de fluxo -->
            <div class="rounded-lg bg-[#0d0d0f] p-4 space-y-3">
              <p class="text-xs font-semibold text-gray-300">{{ $t('forwardingsPage.help.flowTitle') }}</p>
              <div class="font-mono text-xs text-center leading-loose">
                <span class="text-gray-400">Seu cliente</span>
                <span class="text-gray-600 mx-2">──→</span>
                <span class="text-blue-400">localhost:{{ $t('forwardingsPage.help.examplePort') }}</span>
                <span class="text-gray-600 mx-2">──→ SSH tunnel ──→</span>
                <span class="text-green-400">remoteHost:port</span>
                <span class="text-gray-600 mx-2">──→</span>
                <span class="text-purple-400">{{ $t('forwardingsPage.help.flowTarget') }}</span>
              </div>
              <p class="text-[11px] text-gray-500 text-center">{{ $t('forwardingsPage.help.flowNote') }}</p>
            </div>

            <!-- Exemplos práticos -->
            <div>
              <p class="text-xs font-semibold text-gray-300 mb-2">{{ $t('forwardingsPage.help.examplesTitle') }}</p>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div
                  v-for="(ex, i) in helpExamples"
                  :key="i"
                  class="rounded-lg border border-gray-700 bg-[#0d0d0f] p-3 space-y-1.5"
                >
                  <p class="text-xs font-semibold text-gray-300">{{ ex.title }}</p>
                  <pre class="text-[11px] text-blue-300 font-mono">localhost:{{ ex.local }} → {{ ex.host }}:{{ ex.remote }}</pre>
                  <p class="text-[11px] text-gray-500 leading-relaxed">{{ ex.desc }}</p>
                </div>
              </div>
            </div>

            <!-- Auto-start -->
            <div class="rounded-lg bg-[#0d0d0f] px-4 py-3 space-y-1 text-xs text-gray-500">
              <p class="font-medium text-gray-400">{{ $t('forwardingsPage.help.autoStartTitle') }}</p>
              <p>{{ $t('forwardingsPage.help.autoStartDesc') }}</p>
            </div>

          </div>
        </div>
      </div>

      <!-- ── Busca ───────────────────────────────────────────────────────────── -->
      <NInput
        v-if="portForwardingLicensed"
        v-model:value="search"
        :placeholder="$t('forwardingsPage.search')"
        size="small"
        clearable
      />

      <!-- ── Grupos por host ─────────────────────────────────────────────────── -->
      <NSpin v-if="loading" class="flex justify-center py-12" />
      <NEmpty
        v-else-if="!portForwardingLicensed"
        :description="$t('forwardingsPage.license.description')"
        class="py-12"
      />
      <NEmpty
        v-else-if="groups.length === 0"
        :description="search ? $t('forwardingsPage.noResults') : $t('forwardingsPage.empty')"
        class="py-12"
      />
      <div v-else class="space-y-4">
        <div
          v-for="group in groups"
          :key="group.hostId"
          class="rounded-xl border border-gray-800 bg-[#111113] overflow-hidden"
        >
          <!-- Cabeçalho do host -->
          <div class="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-white">{{ group.hostName }}</span>
              <span class="text-xs text-gray-500 font-mono">{{ group.hostIp }}</span>
              <span
                class="text-[10px] px-1.5 py-0.5 rounded"
                :style="group.items[0]?.hostConnectionMode === 'AGENT'
                  ? 'background:rgba(59,130,246,0.16); color:#93c5fd;'
                  : 'background:rgba(107,114,128,0.18); color:#d1d5db;'"
              >{{ group.items[0]?.hostConnectionMode === 'AGENT' ? $t('tunnels.viaAgent') : $t('tunnels.direct') }}</span>
              <span
                class="text-[10px] px-1.5 py-0.5 rounded"
                style="background:rgba(99,102,241,0.15); color:#818cf8;"
              >{{ group.items.length }} {{ group.items.length === 1 ? $t('forwardingsPage.tunnel') : $t('forwardingsPage.tunnels') }}</span>
            </div>
            <div class="flex items-center gap-2">
              <NButton size="small" ghost @click="goToHost(group.hostId)">
                {{ $t('forwardingsPage.goToHost') }}
              </NButton>
              <NButton size="small" @click="openCreate(group.hostId)">
                + {{ $t('forwardingsPage.addTunnel') }}
              </NButton>
            </div>
          </div>

          <!-- Linhas de forwarding -->
          <div class="divide-y divide-gray-800/60">
            <div
              v-for="fw in group.items"
              :key="fw.id"
              class="flex items-center gap-3 px-4 py-3 group hover:bg-[#16161a] transition-colors"
            >
              <!-- Toggle auto-start -->
              <NSwitch
                :value="fw.autoStart"
                size="small"
                @update:value="toggleAutoStart(fw)"
              />

              <!-- Preview + descrição -->
              <div class="flex-1 min-w-0">
                <p class="text-[12px] font-mono text-blue-300 truncate">{{ preview(fw) }}</p>
                <p v-if="fw.description" class="text-xs text-gray-400 truncate mt-0.5">{{ fw.description }}</p>
              </div>

              <!-- Badge auto-start ativo -->
              <span
                v-if="fw.autoStart"
                class="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                style="background:rgba(34,197,94,0.15); color:#4ade80;"
              >{{ $t('tunnels.autoStart') }}</span>
              <span
                class="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                :style="fw.bindAddress === '0.0.0.0'
                  ? 'background:rgba(239,68,68,0.14); color:#fca5a5;'
                  : 'background:rgba(107,114,128,0.18); color:#d1d5db;'"
              >{{ fw.bindAddress }}</span>
              <NButton
                v-if="fw.webEnabled"
                size="small"
                quaternary
                type="info"
                class="shrink-0 px-1.5"
                @click="openWebAccess(fw)"
              >
                {{ $t('tunnels.webEnabledBadge', { protocol: fw.webProtocol.toUpperCase() }) }}
              </NButton>

              <!-- Ações (visíveis no hover) -->
              <div class="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <NButton size="small" text style="color:#9ca3af;" @click="openEdit(fw)">
                  {{ $t('common.edit') }}
                </NButton>
                <NButton size="small" text style="color:#ef4444;" @click="remove(fw)">
                  {{ $t('common.delete') }}
                </NButton>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>

  <!-- ── Modal criar / editar ──────────────────────────────────────────────────── -->
  <NModal
    v-if="portForwardingLicensed"
    v-model:show="showModal"
    preset="card"
    style="max-width: 480px;"
    :title="editId !== null ? $t('forwardingsPage.editTitle') : $t('forwardingsPage.createTitle')"
  >
    <div class="space-y-3">
      <div class="rounded border border-gray-800 bg-[#111113] px-3 py-2 text-xs">
        <div class="text-gray-500">{{ $t('forwardingsPage.selectedHost') }}</div>
        <div class="mt-1 text-gray-200">
          <span class="font-medium">{{ modalHostName || $t('forwardingsPage.selectedHostFallback', { id: modalHostId }) }}</span>
          <span class="ml-2 font-mono text-gray-500">#{{ modalHostId }}</span>
        </div>
      </div>
      <div>
        <p class="text-xs text-gray-400 mb-1">{{ $t('tunnels.description') }} ({{ $t('snippetsPage.optional') }})</p>
        <NInput v-model:value="form.description" :placeholder="$t('tunnels.descriptionHint')" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <p class="text-xs text-gray-400 mb-1">{{ $t('tunnels.localPort') }}</p>
          <NInput
            :value="String(form.localPort)"
            @update:value="v => form.localPort = Number(v)"
            :placeholder="$t('tunnels.localPortPlaceholder')"
          />
        </div>
        <div>
          <p class="text-xs text-gray-400 mb-1">{{ $t('tunnels.remoteHost') }}</p>
          <NInput v-model:value="form.remoteHost" :placeholder="$t('tunnels.remoteHostPlaceholder')" />
        </div>
        <div>
          <p class="text-xs text-gray-400 mb-1">{{ $t('tunnels.remotePort') }}</p>
          <NInput
            :value="String(form.remotePort)"
            @update:value="v => form.remotePort = Number(v)"
            :placeholder="$t('tunnels.remotePortPlaceholder')"
          />
        </div>
      </div>
      <div class="rounded border border-gray-800 bg-[#111113] p-3 space-y-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-xs text-gray-300">{{ $t('tunnels.autoStart') }}</div>
            <div class="text-xs text-gray-500">{{ $t('tunnels.autoStartHint') }}</div>
          </div>
          <NSwitch v-model:value="form.autoStart" size="small" />
        </div>
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-xs text-gray-300">{{ $t('tunnels.webEnabled') }}</div>
            <div class="text-xs text-gray-500">{{ $t('tunnels.webEnabledHint') }}</div>
          </div>
          <NSwitch v-model:value="form.webEnabled" size="small" />
        </div>
        <div v-if="form.webEnabled" class="grid grid-cols-2 gap-3">
          <div>
            <p class="text-xs text-gray-400 mb-1">{{ $t('tunnels.webProtocol') }}</p>
            <select v-model="form.webProtocol" class="w-full rounded border border-gray-700 bg-[#18181c] px-3 py-2 text-sm text-gray-200">
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
            </select>
          </div>
        </div>
        <p v-if="form.webEnabled" class="text-xs text-gray-500">{{ $t('tunnels.webEnabledNote') }}</p>
      </div>
      <div class="rounded border border-gray-800 bg-[#111113] p-3">
        <button
          type="button"
          class="flex w-full items-center justify-between text-left"
          @click="showAdvancedOptions = !showAdvancedOptions"
        >
          <span class="text-xs font-medium text-gray-300">{{ $t('tunnels.advancedTitle') }}</span>
          <span class="text-xs text-gray-500">{{ showAdvancedOptions ? '▲' : '▼' }}</span>
        </button>
        <div v-if="showAdvancedOptions" class="mt-3">
          <p class="text-xs text-gray-400 mb-1">{{ $t('tunnels.bindAddress') }}</p>
          <select v-model="form.bindAddress" class="w-full rounded border border-gray-700 bg-[#18181c] px-3 py-2 text-sm text-gray-200">
            <option v-for="option in bindAddressOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
          <p class="mt-2 text-xs text-gray-500">
            {{ form.bindAddress === '0.0.0.0' ? $t('tunnels.bindAddressWarnPublic') : $t('tunnels.bindAddressWarnLocal') }}
          </p>
        </div>
      </div>
      <!-- Preview em tempo real -->
      <div
        v-if="form.localPort && form.remoteHost && form.remotePort"
        class="font-mono text-xs bg-[#0d0d0f] rounded p-2 text-blue-300"
      >
        {{ preview(form) }}
      </div>
      <div class="flex justify-end gap-2 pt-2">
        <NButton @click="showModal = false">{{ $t('common.cancel') }}</NButton>
        <NButton type="primary" :loading="saving" @click="save">{{ $t('common.save') }}</NButton>
      </div>
    </div>
  </NModal>
</template>
