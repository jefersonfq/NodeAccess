<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { NButton, NInput, NEmpty, NSpin, NTooltip, useMessage, NModal, NTag, NAlert } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { agentService, type AgentInfo, type AgentDownloadInfo } from '@/services/agent.service'
import { featuresService } from '@/services/features.service'

const { t } = useI18n()
const message = useMessage()

// ── State ─────────────────────────────────────────────────────────────────────

const agents   = ref<AgentInfo[]>([])
const downloads = ref<AgentDownloadInfo[]>([])
const loading  = ref(false)
const agentsLicensed = ref(true)
const newName  = ref('')
const creating = ref(false)
const showForm = ref(false)

const newToken  = ref('')
const showToken = ref(false)

const serverUrl = computed(() => window.location.origin)

// ── Data ──────────────────────────────────────────────────────────────────────

async function load() {
  const features = await featuresService.get()
  agentsLicensed.value = features.agentsLicensed
  if (!agentsLicensed.value) {
    agents.value = []
    downloads.value = []
    return
  }

  loading.value = true
  try {
    const [{ data: listedAgents }, { data: availableDownloads }] = await Promise.all([
      agentService.list(),
      agentService.downloads(),
    ])
    agents.value = listedAgents
    downloads.value = availableDownloads
  } finally {
    loading.value = false
  }
}

onMounted(load)

// ── Create ────────────────────────────────────────────────────────────────────

async function create() {
  if (!agentsLicensed.value) return
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

// ── Revoke ────────────────────────────────────────────────────────────────────

async function revoke(agent: AgentInfo) {
  if (!agentsLicensed.value) return
  if (!window.confirm(t('agents.revokeConfirm', { name: agent.name }))) return
  try {
    await agentService.revoke(agent.id)
    await load()
    message.success(t('agents.revoked'))
  } catch {
    message.error(t('agents.revokeError'))
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function copy(text: string, successKey: string) {
  navigator.clipboard.writeText(text)
  message.success(t(successKey))
}

function npxCommand(token = '<TOKEN>') {
  return `npx @nodeaccess/agent --server ${serverUrl.value} --token ${token}`
}

function windowsBinaryCommand(token = '<TOKEN>') {
  return `.\\nodeaccess-agent.exe --server ${serverUrl.value} --token ${token}`
}

function unixBinaryCommand(token = '<TOKEN>') {
  return `chmod +x ./nodeaccess-agent && ./nodeaccess-agent --server ${serverUrl.value} --token ${token}`
}

function downloadInfo(platform: AgentDownloadInfo['platform']) {
  return downloads.value.find((item) => item.platform === platform) ?? {
    platform,
    fileName: platform === 'windows' ? 'nodeaccess-agent.exe' : `nodeaccess-agent-${platform}`,
    available: false,
    downloadUrl: `/api/v1/agents/download/${platform}`,
  }
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}
</script>

<template>
  <div style="height: 100vh; overflow-y: auto; background: #101014;">
    <div class="max-w-4xl mx-auto px-6 py-8 space-y-8">

      <!-- ── Page header ───────────────────────────────────────────────────── -->
      <div>
        <h1 class="text-2xl font-bold text-white">{{ $t('agents.title') }}</h1>
        <p class="text-gray-400 mt-1">{{ $t('agents.subtitle') }}</p>
      </div>

      <NAlert
        v-if="!agentsLicensed"
        type="warning"
        :show-icon="true"
        style="border-radius: 12px;"
      >
        <template #header>{{ $t('agents.license.title') }}</template>
        {{ $t('agents.license.description') }}
      </NAlert>

      <!-- ── How it works ─────────────────────────────────────────────────── -->
      <div v-if="agentsLicensed" class="rounded-xl border border-gray-800 bg-[#111113] p-5">
        <p class="text-sm font-semibold text-gray-200 mb-2">{{ $t('agents.howTitle') }}</p>
        <p class="text-sm text-gray-400 mb-4">{{ $t('agents.howDesc') }}</p>
        <div class="font-mono text-xs bg-[#0d0d0f] rounded-lg p-4 text-center leading-loose">
          <span class="text-blue-400">NodeAccess</span>
          <span class="text-gray-600 mx-3">←── WebSocket ──→</span>
          <span class="text-green-400">{{ $t('agents.arch.agent') }}</span>
          <span class="text-gray-600 mx-3">──→</span>
          <span class="text-purple-400">{{ $t('agents.arch.host') }}</span>
        </div>
        <p class="text-xs text-gray-500 mt-3">{{ $t('agents.arch.note') }}</p>
      </div>

      <!-- ── Practical scenarios ───────────────────────────────────────────── -->
      <div v-if="agentsLicensed">
        <p class="text-sm font-semibold text-gray-200 mb-3">{{ $t('agents.scenarios.title') }}</p>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">

          <div class="rounded-xl border border-gray-800 bg-[#111113] p-4 space-y-2">
            <div class="flex items-center gap-2">
              <span class="text-xl">🔐</span>
              <p class="text-sm font-medium text-white">{{ $t('agents.scenarios.vpn.title') }}</p>
            </div>
            <p class="text-xs text-gray-400 leading-relaxed">{{ $t('agents.scenarios.vpn.desc') }}</p>
            <div class="text-[10px] font-mono bg-[#0d0d0f] rounded p-2 text-gray-500 leading-relaxed">
              VPN Cliente A<br>
              └─ nodeaccess-agent<br>
              &nbsp;&nbsp;&nbsp;└─ SSH host
            </div>
          </div>

          <div class="rounded-xl border border-gray-800 bg-[#111113] p-4 space-y-2">
            <div class="flex items-center gap-2">
              <span class="text-xl">🏢</span>
              <p class="text-sm font-medium text-white">{{ $t('agents.scenarios.network.title') }}</p>
            </div>
            <p class="text-xs text-gray-400 leading-relaxed">{{ $t('agents.scenarios.network.desc') }}</p>
            <div class="text-[10px] font-mono bg-[#0d0d0f] rounded p-2 text-gray-500 leading-relaxed">
              Rede Interna (10.0.0.x)<br>
              └─ nodeaccess-agent<br>
              &nbsp;&nbsp;&nbsp;└─ SSH host
            </div>
          </div>

          <div class="rounded-xl border border-gray-800 bg-[#111113] p-4 space-y-2">
            <div class="flex items-center gap-2">
              <span class="text-xl">💻</span>
              <p class="text-sm font-medium text-white">{{ $t('agents.scenarios.dev.title') }}</p>
            </div>
            <p class="text-xs text-gray-400 leading-relaxed">{{ $t('agents.scenarios.dev.desc') }}</p>
            <div class="text-[10px] font-mono bg-[#0d0d0f] rounded p-2 text-gray-500 leading-relaxed">
              Notebook local<br>
              └─ nodeaccess-agent<br>
              &nbsp;&nbsp;&nbsp;└─ localhost:22 / WSL
            </div>
          </div>

        </div>
      </div>

      <!-- ── Download ──────────────────────────────────────────────────────── -->
      <div v-if="agentsLicensed">
        <p class="text-sm font-semibold text-gray-200 mb-3">{{ $t('agents.download.title') }}</p>

        <!-- OS download cards -->
        <div class="grid grid-cols-3 gap-3 mb-4">
          <a
            :href="downloadInfo('windows').available ? downloadInfo('windows').downloadUrl : undefined"
            class="flex flex-col items-center gap-2 rounded-xl border border-gray-800 bg-[#111113] p-4 relative transition-colors"
            :class="downloadInfo('windows').available ? 'hover:border-gray-600' : 'opacity-60 cursor-not-allowed'"
            style="text-decoration:none;"
            @click.prevent="!downloadInfo('windows').available"
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="#60a5fa">
              <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.551H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
            </svg>
            <span class="text-sm font-medium text-white">Windows</span>
            <span class="text-xs text-gray-500">{{ downloadInfo('windows').fileName }}</span>
            <NTag v-if="!downloadInfo('windows').available" size="tiny">{{ $t('agents.download.notPublished') }}</NTag>
          </a>

          <a
            :href="downloadInfo('linux').available ? downloadInfo('linux').downloadUrl : undefined"
            class="flex flex-col items-center gap-2 rounded-xl border border-gray-800 bg-[#111113] p-4 relative transition-colors"
            :class="downloadInfo('linux').available ? 'hover:border-gray-600' : 'opacity-60 cursor-not-allowed'"
            style="text-decoration:none;"
            @click.prevent="!downloadInfo('linux').available"
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#fb923c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 17 10 11 4 5"/>
              <line x1="12" y1="19" x2="20" y2="19"/>
            </svg>
            <span class="text-sm font-medium text-white">Linux</span>
            <span class="text-xs text-gray-500">{{ downloadInfo('linux').fileName }}</span>
            <NTag v-if="!downloadInfo('linux').available" size="tiny">{{ $t('agents.download.notPublished') }}</NTag>
          </a>

          <a
            :href="downloadInfo('macos').available ? downloadInfo('macos').downloadUrl : undefined"
            class="flex flex-col items-center gap-2 rounded-xl border border-gray-800 bg-[#111113] p-4 relative transition-colors"
            :class="downloadInfo('macos').available ? 'hover:border-gray-600' : 'opacity-60 cursor-not-allowed'"
            style="text-decoration:none;"
            @click.prevent="!downloadInfo('macos').available"
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#d1d5db" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2a3 3 0 0 1 3 3c0 1.5-.5 2.5-1 3.5"/>
              <path d="M6 8c-2.5 1.5-4 4-4 7a9 9 0 0 0 9 9 9 9 0 0 0 9-9c0-3-1.5-5.5-4-7"/>
            </svg>
            <span class="text-sm font-medium text-white">macOS</span>
            <span class="text-xs text-gray-500">{{ downloadInfo('macos').fileName }}</span>
            <NTag v-if="!downloadInfo('macos').available" size="tiny">{{ $t('agents.download.notPublished') }}</NTag>
          </a>
        </div>

        <div class="rounded-xl border border-amber-900/40 bg-[#15120d] p-4 mb-4">
          <div class="flex items-center justify-between gap-3 mb-2">
            <p class="text-xs font-medium text-amber-300">{{ $t('agents.download.windowsLabel') }}</p>
            <NTag size="tiny" type="warning">{{ $t('agents.download.windowsCli') }}</NTag>
          </div>
          <p class="text-[12px] text-gray-300 leading-relaxed">
            {{ $t('agents.download.windowsHint') }}
          </p>
          <div class="mt-3 flex gap-2 items-start">
            <div class="flex-1 font-mono text-xs bg-[#0d0d0f] rounded p-3 text-amber-200 break-all select-all leading-relaxed">
              {{ windowsBinaryCommand() }}
            </div>
            <NButton size="small" @click="copy(windowsBinaryCommand(), 'agents.commandCopied')">
              {{ $t('agents.copy') }}
            </NButton>
          </div>
          <p class="text-[11px] text-gray-500 mt-2">{{ $t('agents.download.windowsNote') }}</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div class="rounded-xl border border-gray-800 bg-[#111113] p-4">
            <div class="flex items-center justify-between gap-3 mb-2">
              <p class="text-xs font-medium text-gray-200">{{ $t('agents.download.linuxLabel') }}</p>
              <NTag size="tiny">Linux</NTag>
            </div>
            <p class="text-[12px] text-gray-300 leading-relaxed">
              {{ $t('agents.download.linuxHint') }}
            </p>
            <div class="mt-3 flex gap-2 items-start">
              <div class="flex-1 font-mono text-xs bg-[#0d0d0f] rounded p-3 text-gray-200 break-all select-all leading-relaxed">
                {{ unixBinaryCommand() }}
              </div>
              <NButton size="small" @click="copy(unixBinaryCommand(), 'agents.commandCopied')">
                {{ $t('agents.copy') }}
              </NButton>
            </div>
            <p class="text-[11px] text-gray-500 mt-2">{{ $t('agents.download.linuxNote') }}</p>
          </div>

          <div class="rounded-xl border border-gray-800 bg-[#111113] p-4">
            <div class="flex items-center justify-between gap-3 mb-2">
              <p class="text-xs font-medium text-gray-200">{{ $t('agents.download.macosLabel') }}</p>
              <NTag size="tiny">macOS</NTag>
            </div>
            <p class="text-[12px] text-gray-300 leading-relaxed">
              {{ $t('agents.download.macosHint') }}
            </p>
            <div class="mt-3 flex gap-2 items-start">
              <div class="flex-1 font-mono text-xs bg-[#0d0d0f] rounded p-3 text-gray-200 break-all select-all leading-relaxed">
                {{ unixBinaryCommand() }}
              </div>
              <NButton size="small" @click="copy(unixBinaryCommand(), 'agents.commandCopied')">
                {{ $t('agents.copy') }}
              </NButton>
            </div>
            <p class="text-[11px] text-gray-500 mt-2">{{ $t('agents.download.macosNote') }}</p>
          </div>
        </div>

        <!-- npx command — available now -->
        <div class="rounded-xl border border-blue-900/40 bg-[#0d1117] p-4">
          <div class="flex items-center justify-between mb-2">
            <p class="text-xs font-medium text-blue-300">{{ $t('agents.download.npxLabel') }}</p>
            <NTag size="tiny" type="success">{{ $t('agents.download.availableNow') }}</NTag>
          </div>
          <div class="flex gap-2 items-start">
            <div class="flex-1 font-mono text-xs bg-[#060a0f] rounded p-3 text-blue-300 break-all select-all leading-relaxed">
              {{ npxCommand() }}
            </div>
            <NButton size="small" @click="copy(npxCommand(), 'agents.commandCopied')">
              {{ $t('agents.copy') }}
            </NButton>
          </div>
          <p class="text-[11px] text-gray-500 mt-2">{{ $t('agents.download.npxNote') }}</p>
        </div>
      </div>

      <!-- ── Step-by-step setup ───────────────────────────────────────────── -->
      <div v-if="agentsLicensed">
        <p class="text-sm font-semibold text-gray-200 mb-3">{{ $t('agents.setup.title') }}</p>
        <div class="space-y-2">
          <div
            v-for="(step, i) in [
              $t('agents.setup.step1'),
              $t('agents.setup.step2'),
              $t('agents.setup.step3'),
              $t('agents.setup.step4'),
              $t('agents.setup.step5'),
            ]"
            :key="i"
            class="flex items-start gap-3 rounded-lg border border-gray-800 bg-[#111113] px-4 py-3"
          >
            <span
              class="flex items-center justify-center rounded-full shrink-0 text-[11px] font-bold"
              style="width:22px;height:22px;background:#1e3a8a;color:#93c5fd;margin-top:1px;"
            >{{ i + 1 }}</span>
            <p class="text-sm text-gray-300">{{ step }}</p>
          </div>
        </div>
      </div>

      <!-- ── Agent management ──────────────────────────────────────────────── -->
      <div>
        <div class="flex items-center justify-between mb-3">
          <p class="text-sm font-semibold text-gray-200">{{ $t('agents.myAgents') }}</p>
          <NButton type="primary" size="small" @click="showForm = !showForm">
            + {{ $t('agents.new') }}
          </NButton>
        </div>

        <!-- Create form -->
        <div v-if="showForm" class="rounded-xl border border-gray-800 bg-[#111113] p-4 mb-4">
          <p class="text-xs font-medium text-gray-300 mb-2">{{ $t('agents.formTitle') }}</p>
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

        <!-- Agent list -->
        <div class="space-y-2">
          <NSpin v-if="loading" class="py-8 flex justify-center" />
          <NEmpty v-else-if="agents.length === 0" :description="$t('agents.empty')" class="py-8" />
          <div
            v-for="agent in agents"
            :key="agent.id"
            class="flex items-center gap-3 rounded-xl border border-gray-800 bg-[#111113] px-4 py-3"
          >
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

            <NTag v-if="!agent.active" size="small" type="error">{{ $t('common.inactive') }}</NTag>

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

    </div>

    <!-- ── Token modal (shown once after creation) ───────────────────────── -->
    <NModal
      v-if="agentsLicensed"
      v-model:show="showToken"
      :mask-closable="false"
      preset="card"
      style="max-width:560px;"
      :title="$t('agents.tokenTitle')"
    >
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
            <NButton size="small" @click="copy(newToken, 'agents.tokenCopied')">
              {{ $t('agents.copy') }}
            </NButton>
          </div>
        </div>

        <div>
          <p class="text-xs text-gray-400 mb-1">{{ $t('agents.commandLabel') }}</p>
          <div class="flex gap-2">
            <div class="flex-1 font-mono text-xs bg-[#0d0d0f] rounded p-2 text-blue-400 break-all select-all">
              {{ npxCommand(newToken) }}
            </div>
            <NButton size="small" @click="copy(npxCommand(newToken), 'agents.commandCopied')">
              {{ $t('agents.copy') }}
            </NButton>
          </div>
        </div>

        <div class="border-t border-gray-700 pt-3 text-xs text-gray-500 space-y-1">
          <p>{{ $t('agents.download.npxLabel') }}:</p>
          <div class="font-mono bg-[#0d0d0f] rounded p-2 text-gray-400">
            npx @nodeaccess/agent --server {{ serverUrl }} --token &lt;TOKEN&gt;
          </div>
          <p>{{ $t('agents.download.windowsLabel') }}:</p>
          <div class="font-mono bg-[#0d0d0f] rounded p-2 text-gray-400">
            .\nodeaccess-agent.exe --server {{ serverUrl }} --token &lt;TOKEN&gt;
          </div>
        </div>

        <div class="flex justify-end">
          <NButton type="primary" @click="showToken = false; newToken = ''">
            {{ $t('agents.tokenDone') }}
          </NButton>
        </div>
      </div>
    </NModal>
  </div>
</template>
