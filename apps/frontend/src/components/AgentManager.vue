<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { NButton, NInput, NEmpty, NSpin, NTooltip, useMessage, NModal } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { agentService, type AgentInfo } from '@/services/agent.service'

const { t } = useI18n()
const message = useMessage()

// ── State ─────────────────────────────────────────────────────────────────────

const agents    = ref<AgentInfo[]>([])
const loading   = ref(false)
const newName   = ref('')
const creating  = ref(false)
const showForm  = ref(false)

// Token gerado — exibido uma única vez
const newToken    = ref('')
const showToken   = ref(false)

// ── Server URL para exibir no comando ────────────────────────────────────────

const serverWsUrl = computed(() => {
  const base = window.location.origin.replace(/^http/, 'ws')
  return base
})

// ── Data ──────────────────────────────────────────────────────────────────────

async function load() {
  loading.value = true
  try {
    const { data } = await agentService.list()
    agents.value = data
  } finally {
    loading.value = false
  }
}

onMounted(load)

// ── Criar ─────────────────────────────────────────────────────────────────────

async function create() {
  if (!newName.value.trim()) return
  creating.value = true
  try {
    const { data } = await agentService.create(newName.value.trim())
    newToken.value  = data.token
    showToken.value = true
    showForm.value  = false
    newName.value   = ''
    await load()
  } catch {
    message.error(t('agents.createError'))
  } finally {
    creating.value = false
  }
}

// ── Revogar ───────────────────────────────────────────────────────────────────

async function revoke(agent: AgentInfo) {
  if (!window.confirm(t('agents.revokeConfirm', { name: agent.name }))) return
  try {
    await agentService.revoke(agent.id)
    await load()
    message.success(t('agents.revoked'))
  } catch {
    message.error(t('agents.revokeError'))
  }
}

// ── Copy token ────────────────────────────────────────────────────────────────

function copyToken() {
  navigator.clipboard.writeText(newToken.value)
  message.success(t('agents.tokenCopied'))
}

function copyCommand() {
  const cmd = `nodeaccess-agent --server ${serverWsUrl.value} --token ${newToken.value}`
  navigator.clipboard.writeText(cmd)
  message.success(t('agents.commandCopied'))
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}
</script>

<template>
  <div class="p-6 max-w-2xl mx-auto space-y-6">

    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold text-white">{{ $t('agents.title') }}</h2>
        <p class="text-sm text-gray-400 mt-0.5">{{ $t('agents.subtitle') }}</p>
      </div>
      <NButton type="primary" @click="showForm = !showForm">
        + {{ $t('agents.new') }}
      </NButton>
    </div>

    <!-- Como funciona -->
    <div class="rounded-lg border border-gray-700 bg-[#111113] p-4 text-sm text-gray-400 space-y-1">
      <p class="font-medium text-gray-300">{{ $t('agents.howTitle') }}</p>
      <p>{{ $t('agents.howDesc') }}</p>
      <div class="font-mono text-xs text-blue-400 mt-2 bg-[#0d0d0f] rounded p-2">
        NodeAccess ←── WebSocket ──── Agent (sua máquina + VPN) ──→ SSH host
      </div>
    </div>

    <!-- Form criar agente -->
    <div v-if="showForm" class="rounded-lg border border-gray-700 bg-[#111113] p-4 space-y-3">
      <p class="text-sm font-medium text-gray-300">{{ $t('agents.formTitle') }}</p>
      <div class="flex gap-2">
        <NInput
          v-model:value="newName"
          :placeholder="$t('agents.namePlaceholder')"
          @keydown.enter="create"
        />
        <NButton type="primary" :loading="creating" @click="create">
          {{ $t('agents.create') }}
        </NButton>
        <NButton @click="showForm = false">{{ $t('common.cancel') }}</NButton>
      </div>
    </div>

    <!-- Token modal — exibido APENAS uma vez após criação -->
    <NModal v-model:show="showToken" :mask-closable="false" preset="card" style="max-width:560px;" :title="$t('agents.tokenTitle')">
      <div class="space-y-4">
        <div class="rounded border border-yellow-600 bg-yellow-900/20 p-3 text-sm text-yellow-300">
          ⚠ {{ $t('agents.tokenWarning') }}
        </div>

        <div>
          <p class="text-xs text-gray-400 mb-1">{{ $t('agents.tokenLabel') }}</p>
          <div class="flex gap-2">
            <div class="flex-1 font-mono text-xs bg-[#0d0d0f] rounded p-2 text-green-400 break-all select-all">
              {{ newToken }}
            </div>
            <NButton size="small" @click="copyToken">{{ $t('agents.copy') }}</NButton>
          </div>
        </div>

        <div>
          <p class="text-xs text-gray-400 mb-1">{{ $t('agents.commandLabel') }}</p>
          <div class="flex gap-2">
            <div class="flex-1 font-mono text-xs bg-[#0d0d0f] rounded p-2 text-blue-400 break-all select-all">
              nodeaccess-agent --server {{ serverWsUrl }} --token {{ newToken }}
            </div>
            <NButton size="small" @click="copyCommand">{{ $t('agents.copy') }}</NButton>
          </div>
        </div>

        <div class="border-t border-gray-700 pt-3 text-xs text-gray-500 space-y-1">
          <p>{{ $t('agents.installHint') }}</p>
          <div class="font-mono bg-[#0d0d0f] rounded p-2 text-gray-400">
            # Com Node.js instalado:<br>
            npx @nodeaccess/agent --server {{ serverWsUrl }} --token &lt;TOKEN&gt;<br><br>
            # Ou baixe o binário em: Settings → Agents → Download
          </div>
        </div>

        <div class="flex justify-end">
          <NButton type="primary" @click="showToken = false; newToken = ''">
            {{ $t('agents.tokenDone') }}
          </NButton>
        </div>
      </div>
    </NModal>

    <!-- Lista de agentes -->
    <div class="space-y-2">
      <NSpin v-if="loading" class="py-8 flex justify-center" />
      <NEmpty v-else-if="agents.length === 0" :description="$t('agents.empty')" class="py-8" />
      <div
        v-for="agent in agents"
        :key="agent.id"
        class="flex items-center gap-3 rounded-lg border border-gray-800 bg-[#18181c] px-4 py-3"
      >
        <!-- Status online -->
        <NTooltip trigger="hover" placement="top">
          <template #trigger>
            <span
              class="w-2.5 h-2.5 rounded-full shrink-0"
              :class="agent.online ? 'bg-green-400' : 'bg-gray-600'"
            />
          </template>
          {{ agent.online ? $t('agents.online') : $t('agents.offline') }}
        </NTooltip>

        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-white">{{ agent.name }}</p>
          <p class="text-xs text-gray-500">
            {{ $t('agents.lastSeen') }}: {{ formatDate(agent.lastSeenAt) }}
          </p>
        </div>

        <!-- Badge desativado -->
        <span
          v-if="!agent.active"
          class="text-[10px] px-1.5 py-px rounded"
          style="background:rgba(239,68,68,0.15);color:#f87171"
        >{{ $t('common.inactive') }}</span>

        <NTooltip trigger="hover" placement="left">
          <template #trigger>
            <NButton
              size="small" text
              style="color:#ef4444;"
              :disabled="!agent.active"
              @click="revoke(agent)"
            >{{ $t('agents.revoke') }}</NButton>
          </template>
          {{ $t('agents.revokeHint') }}
        </NTooltip>
      </div>
    </div>
  </div>
</template>
