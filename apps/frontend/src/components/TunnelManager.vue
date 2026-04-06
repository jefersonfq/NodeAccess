<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NEmpty, NSpin, NTooltip, NSwitch, NInput, NInputNumber, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { portForwardingService, type PortForwarding, type CreatePortForwardingDto } from '@/services/portForwarding.service'
import { tunnelService } from '@/services/tunnel.service'
import { webAccessService } from '@/services/webAccess.service'
import type { ActiveTunnel } from '@/composables/useTerminal'

const props = defineProps<{
  hostId:        number | null
  hostName?:     string
  activeTunnels?: { tunnels: ActiveTunnel[]; errors: Array<{ portForwardingId: number; localPort: number; code: string; message: string }> }
}>()
const emit = defineEmits<{
  activeTunnelsChange: [state: { tunnels: ActiveTunnel[]; errors: Array<{ portForwardingId: number; localPort: number; code: string; message: string }> }]
}>()

const { t } = useI18n()
const message = useMessage()
const liveActiveTunnels = ref<ActiveTunnel[] | null>(null)

// ── Templates (saved config) ──────────────────────────────────────────────────
const templates  = ref<PortForwarding[]>([])
const loading    = ref(false)
const showForm   = ref(false)
const saving     = ref(false)
const showAdvancedOptions = ref(false)
const editingTemplateId = ref<number | null>(null)

const bindAddressOptions = [
  { label: '127.0.0.1', value: '127.0.0.1' },
  { label: '0.0.0.0', value: '0.0.0.0' },
] as const

const emptyForm = (): CreatePortForwardingDto => ({ bindAddress: '127.0.0.1', webEnabled: false, webProtocol: 'http', localPort: 0, remoteHost: '127.0.0.1', remotePort: 0, autoStart: false })
const form = ref<CreatePortForwardingDto & { description: string }>(Object.assign(emptyForm(), { description: '' }))

function getErrorMessage(error: unknown, fallback: string): string {
  const err = error as { response?: { data?: { message?: string } } }
  return err.response?.data?.message ?? fallback
}

function errorBadge(code: string) {
  switch (code) {
    case 'TUNNEL_LOCAL_PORT_IN_USE':
      return { label: t('tunnels.errorKinds.portInUse'), style: 'background:rgba(239,68,68,0.16); color:#fca5a5;' }
    case 'AGENT_REQUIRED':
    case 'AGENT_TUNNEL_CONNECT_FAILED':
      return { label: t('tunnels.errorKinds.agent'), style: 'background:rgba(59,130,246,0.16); color:#93c5fd;' }
    case 'HOST_FORBIDDEN':
      return { label: t('tunnels.errorKinds.permission'), style: 'background:rgba(245,158,11,0.18); color:#fcd34d;' }
    default:
      return { label: t('tunnels.errorKinds.ssh'), style: 'background:rgba(107,114,128,0.18); color:#d1d5db;' }
  }
}

async function loadTemplates() {
  if (!props.hostId) return
  loading.value = true
  try {
    const { data } = await portForwardingService.list(props.hostId)
    templates.value = data
  } finally {
    loading.value = false
  }
}

const effectiveActiveTunnels = computed(() => ({
  tunnels: liveActiveTunnels.value ?? props.activeTunnels?.tunnels ?? [],
  errors: props.activeTunnels?.errors ?? [],
}))
const templateById = computed(() => new Map(templates.value.map((template) => [template.id, template] as const)))

const activeTunnelByTemplateId = computed(() => {
  const entries = effectiveActiveTunnels.value.tunnels
    .filter((tunnel) => typeof tunnel.portForwardingId === 'number')
    .map((tunnel) => [tunnel.portForwardingId as number, tunnel] as const)
  return new Map(entries)
})

function activeTunnelLabel(tunnel: ActiveTunnel) {
  if (tunnel.description?.trim()) return tunnel.description.trim()
  const template = typeof tunnel.portForwardingId === 'number' ? templateById.value.get(tunnel.portForwardingId) : null
  if (template?.description?.trim()) return template.description.trim()
  return null
}

function publishActiveTunnels() {
  emit('activeTunnelsChange', effectiveActiveTunnels.value)
}

async function refreshActiveTunnels() {
  if (!props.hostId) {
    liveActiveTunnels.value = []
    publishActiveTunnels()
    return
  }

  try {
    const { data } = await tunnelService.list()
    liveActiveTunnels.value = data.filter((tunnel) => tunnel.hostId === props.hostId)
  } catch {
    liveActiveTunnels.value = props.activeTunnels?.tunnels ?? []
  }
  publishActiveTunnels()
}

watch(() => props.hostId, async () => {
  await loadTemplates()
  await refreshActiveTunnels()
}, { immediate: true })

watch(() => props.activeTunnels, () => {
  publishActiveTunnels()
}, { deep: true })

async function saveTemplate() {
  if (!props.hostId || !form.value.localPort || !form.value.remoteHost || !form.value.remotePort) return
  saving.value = true
  try {
    const dto: CreatePortForwardingDto = {
      bindAddress: form.value.bindAddress,
      webEnabled:  form.value.webEnabled,
      webProtocol: form.value.webProtocol,
      localPort:   form.value.localPort,
      remoteHost:  form.value.remoteHost,
      remotePort:  form.value.remotePort,
      autoStart:   form.value.autoStart,
      description: form.value.description || undefined,
    }
    if (editingTemplateId.value !== null) {
      const { data } = await portForwardingService.update(props.hostId, editingTemplateId.value, dto)
      templates.value = templates.value.map((tpl) => tpl.id === editingTemplateId.value ? data : tpl)
    } else {
      const { data } = await portForwardingService.create(props.hostId, dto)
      templates.value.push(data)
    }
    showForm.value = false
    showAdvancedOptions.value = false
    editingTemplateId.value = null
    form.value = Object.assign(emptyForm(), { description: '' })
    message.success(t('tunnels.templateSaved'))
  } catch (error: unknown) {
    message.error(getErrorMessage(error, t('tunnels.templateError')))
  } finally {
    saving.value = false
  }
}

function openEditTemplate(tpl: PortForwarding) {
  editingTemplateId.value = tpl.id
  showAdvancedOptions.value = tpl.bindAddress !== '127.0.0.1'
  form.value = {
    description: tpl.description ?? '',
    bindAddress: tpl.bindAddress,
    webEnabled: tpl.webEnabled,
    webProtocol: tpl.webProtocol,
    localPort: tpl.localPort,
    remoteHost: tpl.remoteHost,
    remotePort: tpl.remotePort,
    autoStart: tpl.autoStart,
  }
  showForm.value = true
}

function closeTemplateForm() {
  showForm.value = false
  showAdvancedOptions.value = false
  editingTemplateId.value = null
  form.value = Object.assign(emptyForm(), { description: '' })
}

async function toggleAutoStart(tpl: PortForwarding) {
  if (!props.hostId) return
  try {
    await portForwardingService.update(props.hostId, tpl.id, { autoStart: !tpl.autoStart })
    tpl.autoStart = !tpl.autoStart
  } catch (error: unknown) {
    message.error(getErrorMessage(error, t('common.error')))
  }
}

async function removeTemplate(tpl: PortForwarding) {
  if (!props.hostId) return
  try {
    await portForwardingService.remove(props.hostId, tpl.id)
    templates.value = templates.value.filter(t => t.id !== tpl.id)
    message.success(t('tunnels.templateRemoved'))
  } catch (error: unknown) {
    message.error(getErrorMessage(error, t('common.error')))
  }
}

// ── Active tunnels ────────────────────────────────────────────────────────────
async function closeTunnel(id: string) {
  try {
    await tunnelService.close(id)
    await refreshActiveTunnels()
    message.success(t('tunnels.closed'))
  } catch (error: unknown) {
    message.error(getErrorMessage(error, t('tunnels.closeError')))
  }
}

async function openWebAccess(templateId: number) {
  try {
    const { data } = await webAccessService.createLink(templateId)
    await refreshActiveTunnels()
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

async function copyTunnelEndpoint(tunnel: ActiveTunnel) {
  try {
    await navigator.clipboard.writeText(`localhost:${tunnel.assignedLocalPort}`)
    if (tunnel.usedPortFallback) {
      message.success(t('tunnels.endpointCopiedWithFallback', {
        assigned: tunnel.assignedLocalPort,
        requested: tunnel.requestedLocalPort,
      }))
    } else {
      message.success(t('tunnels.endpointCopied', { port: tunnel.assignedLocalPort }))
    }
  } catch {
    message.error(t('tunnels.endpointCopyError'))
  }
}
</script>

<template>
  <div class="flex flex-col h-full bg-[#18181c] border-l border-gray-800">

    <!-- Header -->
    <div class="flex items-center gap-2 px-3 py-2 border-b border-gray-800 shrink-0" style="height:36px;">
      <span class="text-xs font-semibold text-gray-300 flex-1">{{ $t('tunnels.title') }}</span>
      <NButton size="tiny" type="primary" :disabled="!hostId" @click="showForm ? closeTemplateForm() : (showForm = true)">
        + {{ $t('tunnels.new') }}
      </NButton>
    </div>

    <!-- Add form -->
    <div v-if="showForm" class="p-3 border-b border-gray-800 shrink-0 bg-[#111113] space-y-2">
      <p class="text-xs font-semibold text-gray-200">
        {{ editingTemplateId !== null ? $t('common.edit') : $t('tunnels.formTitle') }}
      </p>

      <div class="flex items-center gap-2">
        <span class="text-[11px] text-gray-400 w-20 shrink-0">{{ $t('tunnels.localPort') }}</span>
        <NInputNumber v-model:value="form.localPort" :min="1024" :max="65535" size="small" class="flex-1" placeholder="8080" />
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[11px] text-gray-400 w-20 shrink-0">{{ $t('tunnels.remoteHost') }}</span>
        <NInput v-model:value="form.remoteHost" size="small" class="flex-1" :placeholder="$t('tunnels.remoteHostPlaceholder')" />
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[11px] text-gray-400 w-20 shrink-0">{{ $t('tunnels.remotePort') }}</span>
        <NInputNumber v-model:value="form.remotePort" :min="1" :max="65535" size="small" class="flex-1" placeholder="3306" />
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[11px] text-gray-400 w-20 shrink-0">{{ $t('tunnels.description') }}</span>
        <NInput v-model:value="form.description" size="small" class="flex-1" :placeholder="$t('tunnels.descriptionHint')" />
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[11px] text-gray-400 w-20 shrink-0">{{ $t('tunnels.webEnabled') }}</span>
        <NSwitch v-model:value="form.webEnabled" size="small" />
      </div>
      <div v-if="form.webEnabled" class="flex items-center gap-2">
        <span class="text-[11px] text-gray-400 w-20 shrink-0">{{ $t('tunnels.webProtocol') }}</span>
        <select v-model="form.webProtocol" class="flex-1 rounded border border-gray-700 bg-[#18181c] px-2 py-1 text-xs text-gray-200">
          <option value="http">HTTP</option>
          <option value="https">HTTPS</option>
        </select>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[11px] text-gray-400 w-20 shrink-0">{{ $t('tunnels.autoStart') }}</span>
        <NSwitch v-model:value="form.autoStart" size="small" />
        <span class="text-[11px] text-gray-500">{{ $t('tunnels.autoStartHint') }}</span>
      </div>
      <div class="border border-gray-800 rounded bg-[#0d0d0f] px-2 py-2">
        <button
          type="button"
          class="flex w-full items-center justify-between text-left"
          @click="showAdvancedOptions = !showAdvancedOptions"
        >
          <span class="text-[11px] text-gray-300">{{ $t('tunnels.advancedTitle') }}</span>
          <span class="text-[10px] text-gray-500">{{ showAdvancedOptions ? '▲' : '▼' }}</span>
        </button>
        <div v-if="showAdvancedOptions" class="mt-2 flex items-center gap-2">
          <span class="text-[11px] text-gray-400 w-20 shrink-0">{{ $t('tunnels.bindAddress') }}</span>
          <select v-model="form.bindAddress" class="flex-1 rounded border border-gray-700 bg-[#18181c] px-2 py-1 text-xs text-gray-200">
            <option v-for="option in bindAddressOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </div>
      </div>
      <p v-if="form.webEnabled" class="text-[10px] text-gray-500">
        {{ $t('tunnels.webEnabledNote') }}
      </p>
      <p v-if="form.localPort && form.remoteHost && form.remotePort" class="text-[11px] text-blue-400 font-mono">
        {{ form.bindAddress }}:{{ form.localPort }} → {{ form.remoteHost }}:{{ form.remotePort }}
      </p>
      <p class="text-[10px] text-gray-500">
        {{ form.bindAddress === '0.0.0.0' ? $t('tunnels.bindAddressWarnPublic') : $t('tunnels.bindAddressWarnLocal') }}
      </p>
      <div class="flex gap-2 justify-end pt-1">
        <NButton size="small" @click="closeTemplateForm">{{ $t('common.cancel') }}</NButton>
        <NButton size="small" type="primary" :loading="saving" @click="saveTemplate">
          {{ $t('tunnels.save') }}
        </NButton>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto">

      <!-- ── Active tunnels section ─────────────────────────────────────── -->
      <div v-if="effectiveActiveTunnels.tunnels.length || effectiveActiveTunnels.errors.length" class="border-b border-gray-800">
        <div class="px-3 py-2 flex items-center gap-2">
          <span class="text-[11px] font-semibold text-cyan-400 uppercase tracking-wider">{{ $t('tunnels.active') }}</span>
          <span class="text-[10px] text-gray-600">{{ $t('tunnels.activeHint') }}</span>
        </div>

        <!-- Active -->
        <div
          v-for="tun in effectiveActiveTunnels.tunnels"
          :key="tun.id"
          class="px-3 py-2 hover:bg-[#1e1e22] group flex items-start gap-2 transition-colors"
        >
          <span class="w-2 h-2 rounded-full bg-green-400 shrink-0 mt-1" />
          <div class="flex-1 min-w-0">
            <div v-if="activeTunnelLabel(tun)" class="text-[11px] text-gray-300 truncate mb-0.5">
              {{ activeTunnelLabel(tun) }}
            </div>
            <div class="mb-1">
              <span
                class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                :style="tun.connectionMethod === 'agent'
                  ? 'background:rgba(59,130,246,0.16); color:#93c5fd;'
                  : 'background:rgba(107,114,128,0.18); color:#d1d5db;'"
              >
                {{ tun.connectionMethod === 'agent' ? $t('tunnels.viaAgent') : $t('tunnels.direct') }}
              </span>
            </div>
            <div class="font-mono text-[11px] text-blue-300">
              {{ tun.bindAddress }}:{{ tun.assignedLocalPort }}
              <span class="text-gray-500 mx-1">→</span>
              {{ tun.remoteHost }}:{{ tun.remotePort }}
            </div>
            <div v-if="tun.usedPortFallback" class="mt-1 text-[10px] text-amber-300">
              {{ $t('tunnels.assignedPortWithFallback', { requested: tun.requestedLocalPort, assigned: tun.assignedLocalPort }) }}
            </div>
            <div v-else class="mt-1 text-[10px] text-gray-500">
              {{ $t('tunnels.assignedPort', { port: tun.assignedLocalPort }) }}
            </div>
          </div>
          <NTooltip trigger="hover" placement="left">
            <template #trigger>
              <NButton
                size="tiny"
                text
                class="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                style="color:#60a5fa;"
                @click="copyTunnelEndpoint(tun)"
              >⧉</NButton>
            </template>
            {{ $t('tunnels.copyEndpoint') }}
          </NTooltip>
          <NTooltip trigger="hover" placement="left">
            <template #trigger>
              <NButton
                size="tiny" text
                class="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                style="color:#ef4444;"
                @click="closeTunnel(tun.id)"
              >✕</NButton>
            </template>
            {{ $t('tunnels.close') }}
          </NTooltip>
        </div>

        <!-- Errors -->
        <div
          v-for="err in effectiveActiveTunnels.errors"
          :key="err.portForwardingId"
          class="px-3 py-2 flex items-start gap-2"
        >
          <span class="w-2 h-2 rounded-full bg-red-400 shrink-0 mt-1" />
          <div class="flex-1 min-w-0">
            <div class="mb-1">
              <span
                class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                :style="errorBadge(err.code).style"
              >
                {{ errorBadge(err.code).label }}
              </span>
            </div>
            <div class="font-mono text-[11px] text-red-300">localhost:{{ err.localPort }}</div>
            <div class="text-[10px] text-gray-500 truncate">{{ err.message }}</div>
          </div>
        </div>
      </div>

      <!-- ── Configured templates ───────────────────────────────────────── -->
      <div class="px-3 py-2">
        <span class="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{{ $t('tunnels.configured') }}</span>
      </div>

      <NSpin v-if="loading" class="flex items-center justify-center py-6" />

      <NEmpty
        v-else-if="templates.length === 0"
        :description="$t('tunnels.emptyTemplates')"
        class="py-6"
      >
        <template #extra>
          <p class="text-xs text-gray-500 text-center max-w-[220px] mx-auto">{{ $t('tunnels.emptyTemplatesHint') }}</p>
        </template>
      </NEmpty>

      <div v-else class="divide-y divide-gray-800/50">
        <div
          v-for="tpl in templates"
          :key="tpl.id"
          class="px-3 py-3 group transition-colors"
          :class="activeTunnelByTemplateId.get(tpl.id)
            ? 'bg-emerald-500/5 ring-1 ring-inset ring-emerald-400/20'
            : 'hover:bg-[#1e1e22]'"
        >
          <div class="flex items-start gap-2">
            <div class="flex-1 min-w-0">
              <div v-if="tpl.description" class="text-[11px] text-gray-300 mb-0.5 truncate">{{ tpl.description }}</div>
              <div
                v-if="activeTunnelByTemplateId.get(tpl.id)"
                class="mb-1"
              >
                <span
                  class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                  style="background:rgba(34,197,94,0.16); color:#86efac;"
                >
                  {{
                    activeTunnelByTemplateId.get(tpl.id)?.usedPortFallback
                      ? $t('tunnels.templateActiveWithFallback', {
                        assigned: activeTunnelByTemplateId.get(tpl.id)?.assignedLocalPort,
                        requested: activeTunnelByTemplateId.get(tpl.id)?.requestedLocalPort,
                      })
                      : $t('tunnels.templateActive', {
                        port: activeTunnelByTemplateId.get(tpl.id)?.assignedLocalPort,
                      })
                  }}
                </span>
              </div>
              <div class="font-mono text-[11px] text-gray-400">
                {{ tpl.bindAddress }}:{{ tpl.localPort }}
                <span class="text-gray-600 mx-1">→</span>
                {{ tpl.remoteHost }}:{{ tpl.remotePort }}
              </div>
              <div v-if="tpl.webEnabled" class="mt-1">
                <button
                  type="button"
                  class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                  style="background:rgba(59,130,246,0.16); color:#93c5fd;"
                  @click="openWebAccess(tpl.id)"
                >
                  {{ $t('tunnels.webEnabledBadge', { protocol: tpl.webProtocol.toUpperCase() }) }}
                </button>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="text-[10px] text-gray-500">{{ $t('tunnels.autoStart') }}</span>
              <NButton
                size="tiny"
                text
                class="opacity-0 group-hover:opacity-100 transition-opacity"
                style="color:#9ca3af;"
                @click="openEditTemplate(tpl)"
              >{{ $t('common.edit') }}</NButton>
              <NTooltip trigger="hover" placement="top">
                <template #trigger>
                  <NSwitch
                    :value="tpl.autoStart"
                    size="small"
                    @update:value="toggleAutoStart(tpl)"
                  />
                </template>
                {{ tpl.autoStart ? $t('tunnels.autoStartOn') : $t('tunnels.autoStartOff') }}
              </NTooltip>
              <NButton
                size="tiny" text
                class="opacity-0 group-hover:opacity-100 transition-opacity"
                style="color:#6b7280;"
                @click="removeTemplate(tpl)"
              >✕</NButton>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>
