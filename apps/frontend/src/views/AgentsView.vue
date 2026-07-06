<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { NButton, NInput, NEmpty, NSpin, NTooltip, useMessage, NModal, NTag, NAlert, NSelect, NCard, NText } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { agentService, type AgentInfo, type AgentDownloadInfo, type AgentMode, type AgentType } from '@/services/agent.service'
import { featuresService } from '@/services/features.service'
import { hostService } from '@/services/host.service'
import { useAuthStore } from '@/stores/auth'
import type { HostPublic, TestConnectionResult } from '@nodeaccess/shared'

const { t } = useI18n()
const message = useMessage()
const authStore = useAuthStore()

// ── State ─────────────────────────────────────────────────────────────────────

const agents   = ref<AgentInfo[]>([])
const downloads = ref<AgentDownloadInfo[]>([])
const loading  = ref(false)
const agentsLicensed = ref(true)
const newName  = ref('')
const creating = ref(false)
const showForm = ref(false)
const showHelp = ref(false)
const helpInlineOpen = ref(false)
const agentsPanelOpen = ref(true)
const downloadPanelOpen = ref(false)
const installPanelOpen = ref(false)
const servicePanelOpen = ref(false)
const setupPanelOpen = ref(false)

const newToken    = ref('')
const showToken   = ref(false)
const newAgentId  = ref<number | null>(null)
const agentOnline = ref(false)
let   pollTimer: ReturnType<typeof setInterval> | null = null
let   listRefreshTimer: ReturnType<typeof setInterval> | null = null
const newAgentMode = ref<AgentMode>('USER_BOUND')
const newAgentType = ref<AgentType>('PROXY_AGENT')
const privateAccessSiteName = ref('')
const privateAccessEnvironment = ref('')
const privateAccessCidrs = ref('')
const privateAccessPorts = ref('22')
const onboardingPlatform = ref<'windows' | 'linux' | 'macos'>('windows')
const onboardingInstallMode = ref<'run' | 'service'>('run')
const validatingAgent = ref(false)
const agentStatusFilter = ref<'all' | 'online' | 'offline'>('all')
const hosts = ref<HostPublic[]>([])
const testAgent = ref<AgentInfo | null>(null)
const testHostId = ref<number | null>(null)
const testLoading = ref(false)
const testResult = ref<TestConnectionResult | null>(null)

const serverUrl = computed(() => window.location.origin)
const onlineAgentsCount = computed(() => agents.value.filter((agent) => agent.online).length)
const filteredAgents = computed(() => {
  if (agentStatusFilter.value === 'online') return agents.value.filter((agent) => agent.online)
  if (agentStatusFilter.value === 'offline') return agents.value.filter((agent) => !agent.online)
  return agents.value
})
const hostOptions = computed(() =>
  hosts.value.map((host) => ({ label: `${host.name} (${host.ip}:${host.port})`, value: host.id })),
)
const helpQuickItems = computed(() => ['online', 'mode', 'test'])
const helpFields = computed(() => ['status', 'mode', 'default', 'diagnostics', 'heartbeat', 'testHost', 'token'])
const helpModes = computed(() => ['user', 'service'])
const helpStatuses = computed(() => ['online', 'offline', 'revoked'])
const newPrivateAccessIsWideOpen = computed(() =>
  splitList(privateAccessCidrs.value)?.some(isWideOpenCidr) ?? false,
)

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
    await loadHostsForTesting()
  } finally {
    loading.value = false
  }
}

async function loadHostsForTesting() {
  try {
    const { data } = await hostService.list({ page: 1, limit: 200 })
    hosts.value = data.data
  } catch {
    hosts.value = []
  }
}

async function refreshAgents() {
  if (!agentsLicensed.value) return
  try {
    const { data } = await agentService.list({ fresh: true })
    agents.value = data
    if (newAgentId.value !== null) {
      agentOnline.value = data.some((agent) => agent.id === newAgentId.value && agent.online)
      if (agentOnline.value) stopConnectionPoll()
    }
  } catch {
    // Atualização de status é best-effort; ações explícitas exibem erro próprio.
  }
}

function startListRefresh() {
  stopListRefresh()
  listRefreshTimer = setInterval(refreshAgents, 5000)
}

function stopListRefresh() {
  if (listRefreshTimer !== null) {
    clearInterval(listRefreshTimer)
    listRefreshTimer = null
  }
}

onMounted(() => {
  void load()
  startListRefresh()
})

// ── Create ────────────────────────────────────────────────────────────────────

async function create() {
  if (!agentsLicensed.value) return
  if (!newName.value.trim()) return
  creating.value = true
  try {
    const agentMode = newAgentType.value === 'PRIVATE_ACCESS_CONNECTOR' ? 'SERVICE_BOUND' : newAgentMode.value
    const { data } = await agentService.create({
      name: newName.value.trim(),
      agentType: newAgentType.value,
      agentMode,
      ...(newAgentType.value === 'PRIVATE_ACCESS_CONNECTOR' && {
        privateAccess: {
          siteName: privateAccessSiteName.value.trim() || undefined,
          environment: privateAccessEnvironment.value.trim() || undefined,
          allowedCidrs: splitList(privateAccessCidrs.value),
          allowedPorts: splitPorts(privateAccessPorts.value),
        },
      }),
    })
    newToken.value  = data.token
    newAgentId.value = data.agent.id
    agentOnline.value = false
    showToken.value = true
    showForm.value  = false
    newName.value    = ''
    newAgentMode.value = 'USER_BOUND'
    newAgentType.value = 'PROXY_AGENT'
    privateAccessSiteName.value = ''
    privateAccessEnvironment.value = ''
    privateAccessCidrs.value = ''
    privateAccessPorts.value = '22'
    await load()
    startConnectionPoll()
  } catch {
    message.error(t('agents.createError'))
  } finally {
    creating.value = false
  }
}

function setNewAgentType(agentType: AgentType) {
  newAgentType.value = agentType
  if (agentType === 'PRIVATE_ACCESS_CONNECTOR') {
    newAgentMode.value = 'SERVICE_BOUND'
    onboardingInstallMode.value = 'service'
  }
}

function splitList(value: string): string[] | undefined {
  const items = value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean)
  return items.length > 0 ? items : undefined
}

function splitPorts(value: string): number[] | undefined {
  const items = value
    .split(/[,\n]/)
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0 && item <= 65535)
  return items.length > 0 ? Array.from(new Set(items)) : undefined
}

function startConnectionPoll() {
  stopConnectionPoll()
  pollTimer = setInterval(async () => {
    await refreshAgents()
  }, 2000)
}

function stopConnectionPoll() {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function validateNewAgentConnection() {
  if (newAgentId.value === null) return
  validatingAgent.value = true
  try {
    const { data } = await agentService.list({ fresh: true })
    agents.value = data
    agentOnline.value = data.some((agent) => agent.id === newAgentId.value && agent.online)
    if (agentOnline.value) {
      stopConnectionPoll()
      message.success(t('agents.onboarding.validationOnline'))
    } else {
      message.warning(t('agents.onboarding.validationWaiting'))
    }
  } catch {
    message.error(t('agents.onboarding.validationError'))
  } finally {
    validatingAgent.value = false
  }
}

function closeTokenModal() {
  showToken.value  = false
  newToken.value   = ''
  newAgentId.value = null
  agentOnline.value = false
  stopConnectionPoll()
}

onBeforeUnmount(() => {
  stopConnectionPoll()
  stopListRefresh()
})

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

async function permanentDelete(agent: AgentInfo) {
  if (!agentsLicensed.value) return
  if (!window.confirm(t('agents.deleteConfirm', { name: agent.name }))) return
  try {
    await agentService.permanentDelete(agent.id)
    await load()
    message.success(t('agents.deleted'))
  } catch {
    message.error(t('agents.deleteError'))
  }
}

async function setDefault(agent: AgentInfo) {
  if (!agentsLicensed.value) return
  try {
    await agentService.setDefault(agent.id)
    await load()
    message.success(t('agents.setDefaultSuccess'))
  } catch {
    message.error(t('agents.setDefaultError'))
  }
}

async function reactivate(agent: AgentInfo) {
  if (!agentsLicensed.value) return
  try {
    await agentService.reactivate(agent.id)
    await load()
    message.success(t('agents.reactivated'))
  } catch {
    message.error(t('agents.reactivateError'))
  }
}

// ── Service setup helpers ─────────────────────────────────────────────────────

const serviceTab = ref<'linux' | 'windows' | 'macos'>('linux')

function systemdUnit(token = '<TOKEN>') {
  return `[Unit]
Description=NodeAccess Agent
After=network.target

[Service]
ExecStart=/usr/local/bin/nodeaccess-agent --server ${serverUrl.value} --token ${token}
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target`
}

function systemdInstallCmd(token = '<TOKEN>') {
  return `sudo cp ./nodeaccess-agent-linux /usr/local/bin/nodeaccess-agent
sudo chmod +x /usr/local/bin/nodeaccess-agent
sudo tee /etc/systemd/system/nodeaccess-agent.service << 'EOF'
${systemdUnit(token)}
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now nodeaccess-agent`
}

function launchdPlist(token = '<TOKEN>') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.nodeaccess.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/nodeaccess-agent</string>
    <string>--server</string><string>${serverUrl.value}</string>
    <string>--token</string><string>${token}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/var/log/nodeaccess-agent.log</string>
  <key>StandardErrorPath</key><string>/var/log/nodeaccess-agent.log</string>
</dict>
</plist>`
}

function launchdInstallCmd(token = '<TOKEN>') {
  return `sudo cp ./nodeaccess-agent-macos /usr/local/bin/nodeaccess-agent
sudo chmod +x /usr/local/bin/nodeaccess-agent
# Crie o arquivo /Library/LaunchDaemons/com.nodeaccess.agent.plist com o conteúdo do plist abaixo
sudo launchctl load -w /Library/LaunchDaemons/com.nodeaccess.agent.plist`
}

function windowsTaskCmd(token = '<TOKEN>') {
  return `$installDir = "C:\\Program Files\\NodeAccess"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Copy-Item ".\\nodeaccess-agent.exe" "$installDir\\nodeaccess-agent.exe" -Force
$exe = "$installDir\\nodeaccess-agent.exe"
$args = "--server ${serverUrl.value} --token ${token}"
$action  = New-ScheduledTaskAction -Execute $exe -Argument $args
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet \`
  -ExecutionTimeLimit ([TimeSpan]::Zero) \`
  -RestartCount 999 \`
  -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask \`
  -TaskName "NodeAccessAgent" \`
  -Action $action -Trigger $trigger -Settings $settings \`
  -RunLevel Highest -Force`
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

function installScriptUrl(platform: 'linux' | 'macos' | 'windows') {
  const publicServer = encodeURIComponent(serverUrl.value)
  return `${serverUrl.value}/api/v1/agents/install/${platform}?server=${publicServer}`
}

function installCmd(platform: 'linux' | 'macos', token = '<TOKEN>', service = false) {
  const args = `--token ${token}${service ? ' --service' : ''}`
  return `bash <(curl -fsSL ${installScriptUrl(platform)}) ${args}`
}

function installCmdWindows(token = '<TOKEN>', service = false) {
  const args = `-Token ${token}${service ? ' -Service' : ''}`
  return `& ([scriptblock]::Create((irm ${installScriptUrl('windows')}))) ${args}`
}

function onboardingCommand(token = '<TOKEN>') {
  if (!downloadInfo(onboardingPlatform.value).available) return t('agents.download.unavailableCommand')
  if (onboardingInstallMode.value === 'service') {
    if (onboardingPlatform.value === 'windows') return windowsTaskCmd(token)
    return installCmd(onboardingPlatform.value, token, true)
  }
  if (onboardingPlatform.value === 'windows') return windowsBinaryCommand(token)
  return installCmd(onboardingPlatform.value, token)
}

function onboardingPlatformNoteKey() {
  if (!downloadInfo(onboardingPlatform.value).available) return 'agents.download.unavailableHint'
  if (onboardingPlatform.value === 'windows') return 'agents.onboarding.windowsNote'
  if (onboardingPlatform.value === 'macos') return 'agents.onboarding.macosNote'
  return 'agents.onboarding.linuxNote'
}

function canCopyOnboardingCommand() {
  return downloadInfo(onboardingPlatform.value).available
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

function formatPrivateAccessList(values: Array<string | number> | undefined) {
  return values && values.length > 0 ? values.join(', ') : t('agents.privateAccessScopeAny')
}

function isWideOpenCidr(value: string) {
  return value.trim() === '0.0.0.0/0'
}

function hasWideOpenPrivateAccess(agent: AgentInfo) {
  return agent.privateAccess?.allowedCidrs?.some(isWideOpenCidr) ?? false
}

function formatAgentPlatform(agent: AgentInfo) {
  const parts = [agent.platform, agent.arch].filter(Boolean)
  return parts.length ? parts.join(' / ') : null
}

function formatLastAgentPlatform(agent: AgentInfo) {
  const parts = [agent.lastPlatform, agent.lastArch].filter(Boolean)
  return parts.length ? parts.join(' / ') : null
}

function hasLastAgentDiagnostic(agent: AgentInfo) {
  return Boolean(
    agent.lastHostname
    || agent.lastPlatform
    || agent.lastArch
    || agent.lastVersion
    || agent.lastRemoteIp
    || agent.lastConnectedAt
    || agent.lastDisconnectedAt
    || agent.lastDisconnectReason,
  )
}

function hasAgentDiagnostic(agent: AgentInfo) {
  return Boolean(
    agent.hostname
    || agent.platform
    || agent.arch
    || agent.version
    || agent.remoteIp
    || agent.connectedAt
    || agent.lastSeenAt
    || hasLastAgentDiagnostic(agent)
    || agent.lastOfflineReason,
  )
}

function openAgentHostTest(agent: AgentInfo) {
  testAgent.value = agent
  testHostId.value = null
  testResult.value = null
  if (hosts.value.length === 0) void loadHostsForTesting()
}

async function runAgentHostTest() {
  const agent = testAgent.value
  const host = hosts.value.find((item) => item.id === testHostId.value)
  if (!agent || !host) return

  testLoading.value = true
  testResult.value = null
  try {
    const { data } = await hostService.testConnection({
      hostId: host.id,
      agentId: agent.id,
      ip: host.ip,
      port: host.port,
      accessProtocol: host.accessProtocol ?? 'ssh',
      sshUser: host.sshUser,
      authType: host.authType,
      connectionMode: host.connectionMode === 'direct' ? 'agent_tenant_fallback' : host.connectionMode,
      pemKeyId: host.pemKeyId ?? undefined,
      bastionId: host.bastionId ?? undefined,
      groupId: host.groupId ?? undefined,
    })
    testResult.value = data
  } catch {
    testResult.value = { success: false, latencyMs: null, message: t('agents.test.error') }
  } finally {
    testLoading.value = false
  }
}
</script>

<template>
  <div class="p-6">
    <div class="max-w-4xl mx-auto flex flex-col gap-8 px-6 py-8">

      <!-- ── Page header ───────────────────────────────────────────────────── -->
      <div class="order-0 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-xl font-semibold text-white">{{ $t('agents.title') }}</h1>
          <p class="text-gray-400 mt-1">{{ $t('agents.subtitle') }}</p>
        </div>
        <NButton
          secondary
          @click="showHelp = true"
        >
          {{ $t('agents.help.action') }}
        </NButton>
      </div>

      <NAlert
        v-if="!agentsLicensed"
        class="order-1"
        type="warning"
        :show-icon="true"
        style="border-radius: 12px;"
      >
        <template #header>{{ $t('agents.license.title') }}</template>
        {{ $t('agents.license.description') }}
      </NAlert>

      <!-- ── Help / reference ─────────────────────────────────────────────── -->
      <div v-if="agentsLicensed" class="na-panel order-6 rounded-xl border p-5">
        <button
          type="button"
          class="flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 text-left"
          :aria-expanded="helpInlineOpen"
          @click="helpInlineOpen = !helpInlineOpen"
        >
          <div>
            <p class="text-sm font-semibold text-gray-200">{{ $t('agents.helpInline.title') }}</p>
            <p class="mt-1 text-xs text-gray-500">{{ $t('agents.helpInline.description') }}</p>
          </div>
          <span class="text-xs font-medium text-blue-300">
            {{ helpInlineOpen ? $t('agents.helpInline.collapse') : $t('agents.helpInline.expand') }}
          </span>
        </button>

        <div v-show="helpInlineOpen" class="mt-5 space-y-5">
          <div>
            <p class="text-sm font-semibold text-gray-200 mb-2">{{ $t('agents.howTitle') }}</p>
            <p class="text-sm text-gray-400 mb-4">{{ $t('agents.howDesc') }}</p>
            <div class="na-code font-mono text-xs rounded-lg p-4 text-center leading-loose">
              <span class="text-blue-400">NodeAccess</span>
              <span class="text-gray-600 mx-3">←── WebSocket ──→</span>
              <span class="text-green-400">{{ $t('agents.arch.agent') }}</span>
              <span class="text-gray-600 mx-3">──→</span>
              <span class="text-purple-400">{{ $t('agents.arch.host') }}</span>
            </div>
            <p class="text-xs text-gray-500 mt-3">{{ $t('agents.arch.note') }}</p>
          </div>

      <!-- ── Practical scenarios ───────────────────────────────────────────── -->
      <div>
        <p class="text-sm font-semibold text-gray-200 mb-3">{{ $t('agents.scenarios.title') }}</p>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">

          <div class="na-panel rounded-xl border p-4 space-y-2">
            <div class="flex items-center gap-2">
              <span class="text-xl">🔐</span>
              <p class="text-sm font-medium text-white">{{ $t('agents.scenarios.vpn.title') }}</p>
            </div>
            <p class="text-xs text-gray-400 leading-relaxed">{{ $t('agents.scenarios.vpn.desc') }}</p>
            <div class="na-code text-[10px] font-mono rounded p-2 text-gray-500 leading-relaxed">
              VPN Cliente A<br>
              └─ nodeaccess-agent<br>
              &nbsp;&nbsp;&nbsp;└─ SSH host
            </div>
          </div>

          <div class="na-panel rounded-xl border p-4 space-y-2">
            <div class="flex items-center gap-2">
              <span class="text-xl">🏢</span>
              <p class="text-sm font-medium text-white">{{ $t('agents.scenarios.network.title') }}</p>
            </div>
            <p class="text-xs text-gray-400 leading-relaxed">{{ $t('agents.scenarios.network.desc') }}</p>
            <div class="na-code text-[10px] font-mono rounded p-2 text-gray-500 leading-relaxed">
              Rede Interna (10.0.0.x)<br>
              └─ nodeaccess-agent<br>
              &nbsp;&nbsp;&nbsp;└─ SSH host
            </div>
          </div>

          <div class="na-panel rounded-xl border p-4 space-y-2">
            <div class="flex items-center gap-2">
              <span class="text-xl">↪</span>
              <p class="text-sm font-medium text-white">{{ $t('agents.scenarios.connectorBastion.title') }}</p>
            </div>
            <p class="text-xs text-gray-400 leading-relaxed">{{ $t('agents.scenarios.connectorBastion.desc') }}</p>
            <div class="na-code text-[10px] font-mono rounded p-2 text-gray-500 leading-relaxed">
              NodeAccess<br>
              └─ Private Access Connector<br>
              &nbsp;&nbsp;&nbsp;└─ Hosts internos
            </div>
          </div>

          <div class="na-panel rounded-xl border p-4 space-y-2">
            <div class="flex items-center gap-2">
              <span class="text-xl">💻</span>
              <p class="text-sm font-medium text-white">{{ $t('agents.scenarios.dev.title') }}</p>
            </div>
            <p class="text-xs text-gray-400 leading-relaxed">{{ $t('agents.scenarios.dev.desc') }}</p>
            <div class="na-code text-[10px] font-mono rounded p-2 text-gray-500 leading-relaxed">
              Notebook local<br>
              └─ nodeaccess-agent<br>
              &nbsp;&nbsp;&nbsp;└─ localhost:22 / WSL
            </div>
          </div>

        </div>
      </div>

        <div class="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="na-panel rounded-xl border p-4 space-y-2">
            <p class="text-sm font-semibold text-gray-200">{{ $t('agents.privateAccessHelp.proxy.title') }}</p>
            <p class="text-xs text-gray-400 leading-relaxed">{{ $t('agents.privateAccessHelp.proxy.description') }}</p>
            <div class="na-code text-[10px] font-mono rounded p-2 text-gray-500 leading-relaxed">
              {{ $t('agents.privateAccessHelp.proxy.flow1') }}<br>
              {{ $t('agents.privateAccessHelp.proxy.flow2') }}<br>
              {{ $t('agents.privateAccessHelp.proxy.flow3') }}
            </div>
          </div>

          <div class="na-panel rounded-xl border p-4 space-y-2">
            <p class="text-sm font-semibold text-gray-200">{{ $t('agents.privateAccessHelp.private.title') }}</p>
            <p class="text-xs text-gray-400 leading-relaxed">{{ $t('agents.privateAccessHelp.private.description') }}</p>
            <div class="na-code text-[10px] font-mono rounded p-2 text-gray-500 leading-relaxed">
              {{ $t('agents.privateAccessHelp.private.flow1') }}<br>
              {{ $t('agents.privateAccessHelp.private.flow2') }}<br>
              {{ $t('agents.privateAccessHelp.private.flow3') }}
            </div>
          </div>
        </div>

        <div class="mt-5 na-panel rounded-xl border p-4">
          <p class="text-sm font-semibold text-gray-200 mb-3">{{ $t('agents.privateAccessHelp.rules.title') }}</p>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div
              v-for="item in ['outbound', 'scope', 'audit']"
              :key="item"
              class="na-item rounded-lg border px-3 py-3"
            >
              <p class="text-xs font-semibold text-gray-200">{{ $t(`agents.privateAccessHelp.rules.${item}.title`) }}</p>
              <p class="mt-1 text-xs text-gray-500 leading-relaxed">{{ $t(`agents.privateAccessHelp.rules.${item}.description`) }}</p>
            </div>
          </div>
        </div>
      </div>
      </div>

      <!-- ── Download ──────────────────────────────────────────────────────── -->
      <div v-if="agentsLicensed" class="na-panel order-2 rounded-xl border p-5">
        <button
          type="button"
          class="flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 text-left"
          :aria-expanded="downloadPanelOpen"
          @click="downloadPanelOpen = !downloadPanelOpen"
        >
          <div>
            <p class="text-sm font-semibold text-gray-200">{{ $t('agents.download.title') }}</p>
            <p class="mt-1 text-xs text-gray-500">{{ $t('agents.download.panelHint') }}</p>
          </div>
          <span class="text-xs font-medium text-blue-300">
            {{ downloadPanelOpen ? $t('agents.panelCollapse') : $t('agents.panelExpand') }}
          </span>
        </button>

        <div v-show="downloadPanelOpen" class="mt-4">

        <!-- OS download cards -->
        <div class="grid grid-cols-3 gap-3 mb-4">
          <a
            :href="downloadInfo('windows').available ? downloadInfo('windows').downloadUrl : undefined"
            class="na-item na-item-hover flex flex-col items-center gap-2 rounded-xl border p-4 relative transition-colors"
            :class="downloadInfo('windows').available ? 'hover:border-gray-600' : 'opacity-60 cursor-not-allowed pointer-events-none'"
            style="text-decoration:none;"
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
            class="na-item na-item-hover flex flex-col items-center gap-2 rounded-xl border p-4 relative transition-colors"
            :class="downloadInfo('linux').available ? 'hover:border-gray-600' : 'opacity-60 cursor-not-allowed pointer-events-none'"
            style="text-decoration:none;"
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
            class="na-item na-item-hover flex flex-col items-center gap-2 rounded-xl border p-4 relative transition-colors"
            :class="downloadInfo('macos').available ? 'hover:border-gray-600' : 'opacity-60 cursor-not-allowed pointer-events-none'"
            style="text-decoration:none;"
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

        <div class="na-panel rounded-xl border border-amber-900/40 p-4 mb-4">
          <div class="flex items-center justify-between gap-3 mb-2">
            <p class="text-xs font-medium text-amber-300">{{ $t('agents.download.windowsLabel') }}</p>
            <NTag size="tiny" type="warning">{{ $t('agents.download.windowsCli') }}</NTag>
          </div>
          <p class="text-[12px] text-gray-300 leading-relaxed">
            {{ $t('agents.download.windowsHint') }}
          </p>
          <div class="mt-3 flex gap-2 items-start">
            <div class="na-code flex-1 font-mono text-xs rounded p-3 text-amber-200 break-all select-all leading-relaxed">
              {{ windowsBinaryCommand() }}
            </div>
            <NButton size="small" @click="copy(windowsBinaryCommand(), 'agents.commandCopied')">
              {{ $t('agents.copy') }}
            </NButton>
          </div>
          <p class="text-[11px] text-gray-500 mt-2">{{ $t('agents.download.windowsNote') }}</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div class="na-panel rounded-xl border p-4">
            <div class="flex items-center justify-between gap-3 mb-2">
              <p class="text-xs font-medium text-gray-200">{{ $t('agents.download.linuxLabel') }}</p>
              <NTag size="tiny">Linux</NTag>
            </div>
            <p class="text-[12px] text-gray-300 leading-relaxed">
              {{ $t('agents.download.linuxHint') }}
            </p>
            <div class="mt-3 flex gap-2 items-start">
              <div class="na-code flex-1 font-mono text-xs rounded p-3 text-gray-200 break-all select-all leading-relaxed">
                {{ unixBinaryCommand() }}
              </div>
              <NButton size="small" @click="copy(unixBinaryCommand(), 'agents.commandCopied')">
                {{ $t('agents.copy') }}
              </NButton>
            </div>
            <p class="text-[11px] text-gray-500 mt-2">{{ $t('agents.download.linuxNote') }}</p>
          </div>

          <div class="na-panel rounded-xl border p-4">
            <div class="flex items-center justify-between gap-3 mb-2">
              <p class="text-xs font-medium text-gray-200">{{ $t('agents.download.macosLabel') }}</p>
              <NTag size="tiny">macOS</NTag>
            </div>
            <p class="text-[12px] text-gray-300 leading-relaxed">
              {{ $t('agents.download.macosHint') }}
            </p>
            <div class="mt-3 flex gap-2 items-start">
              <div class="na-code flex-1 font-mono text-xs rounded p-3 text-gray-200 break-all select-all leading-relaxed">
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
        <div class="na-panel rounded-xl border border-blue-900/40 p-4">
          <div class="flex items-center justify-between mb-2">
            <p class="text-xs font-medium text-blue-300">{{ $t('agents.download.npxLabel') }}</p>
            <NTag size="tiny" type="success">{{ $t('agents.download.availableNow') }}</NTag>
          </div>
          <div class="flex gap-2 items-start">
            <div class="na-code flex-1 font-mono text-xs rounded p-3 text-blue-300 break-all select-all leading-relaxed">
              {{ npxCommand() }}
            </div>
            <NButton size="small" @click="copy(npxCommand(), 'agents.commandCopied')">
              {{ $t('agents.copy') }}
            </NButton>
          </div>
          <p class="text-[11px] text-gray-500 mt-2">{{ $t('agents.download.npxNote') }}</p>
        </div>
        </div>
      </div>

      <!-- ── Install script ─────────────────────────────────────────────── -->
      <div v-if="agentsLicensed" class="na-panel order-3 rounded-xl border p-5">
        <button
          type="button"
          class="flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 text-left"
          :aria-expanded="installPanelOpen"
          @click="installPanelOpen = !installPanelOpen"
        >
          <div>
            <p class="text-sm font-semibold text-gray-200">{{ $t('agents.install.title') }}</p>
            <p class="mt-1 text-xs text-gray-500">{{ $t('agents.install.subtitle') }}</p>
          </div>
          <span class="text-xs font-medium text-blue-300">
            {{ installPanelOpen ? $t('agents.panelCollapse') : $t('agents.panelExpand') }}
          </span>
        </button>

        <div v-show="installPanelOpen" class="mt-4 space-y-3">
          <!-- Linux -->
          <div class="na-panel rounded-xl border p-4">
            <div class="flex items-center justify-between mb-2">
              <p class="text-xs font-medium text-gray-300">Linux</p>
              <div class="flex gap-1">
                <NTag size="tiny">bash</NTag>
                <NTag size="tiny" type="success">{{ $t('agents.install.withService') }}</NTag>
              </div>
            </div>
            <div class="flex gap-2 items-start mb-2">
              <div class="na-code flex-1 font-mono text-xs rounded p-3 text-gray-300 break-all select-all leading-relaxed">{{ installCmd('linux') }}</div>
              <NButton size="small" @click="copy(installCmd('linux'), 'agents.commandCopied')">{{ $t('agents.copy') }}</NButton>
            </div>
            <p class="text-[11px] text-gray-600">{{ $t('agents.install.serviceFlag') }}: <code class="text-gray-500">--service</code></p>
          </div>

          <!-- macOS -->
          <div class="na-panel rounded-xl border p-4">
            <div class="flex items-center justify-between mb-2">
              <p class="text-xs font-medium text-gray-300">macOS</p>
              <div class="flex gap-1">
                <NTag size="tiny">bash</NTag>
                <NTag size="tiny" type="success">{{ $t('agents.install.withService') }}</NTag>
              </div>
            </div>
            <div class="flex gap-2 items-start mb-2">
              <div class="na-code flex-1 font-mono text-xs rounded p-3 text-gray-300 break-all select-all leading-relaxed">{{ installCmd('macos') }}</div>
              <NButton size="small" @click="copy(installCmd('macos'), 'agents.commandCopied')">{{ $t('agents.copy') }}</NButton>
            </div>
            <p class="text-[11px] text-gray-600">{{ $t('agents.install.serviceFlag') }}: <code class="text-gray-500">--service</code></p>
          </div>

          <!-- Windows -->
          <div class="na-panel rounded-xl border border-amber-900/40 p-4">
            <div class="flex items-center justify-between mb-2">
              <p class="text-xs font-medium text-amber-300">Windows</p>
              <div class="flex gap-1">
                <NTag size="tiny" type="warning">PowerShell</NTag>
                <NTag size="tiny" type="success">{{ $t('agents.install.withService') }}</NTag>
              </div>
            </div>
            <div class="flex gap-2 items-start mb-2">
              <div class="na-code flex-1 font-mono text-xs rounded p-3 text-amber-200 whitespace-pre-wrap break-all select-all leading-relaxed">{{ windowsTaskCmd() }}</div>
              <NButton size="small" @click="copy(windowsTaskCmd(), 'agents.commandCopied')">{{ $t('agents.copy') }}</NButton>
            </div>
            <p class="text-[11px] text-gray-600">{{ $t('agents.install.windowsNote') }}</p>
            <p class="mt-1 text-[11px] text-amber-300/80">{{ $t('agents.install.windowsTlsNote') }}</p>
          </div>
        </div>
      </div>

      <!-- ── Run as system service ──────────────────────────────────────── -->
      <div v-if="agentsLicensed" class="na-panel order-4 rounded-xl border p-5">
        <button
          type="button"
          class="flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 text-left"
          :aria-expanded="servicePanelOpen"
          @click="servicePanelOpen = !servicePanelOpen"
        >
          <div>
            <p class="text-sm font-semibold text-gray-200">{{ $t('agents.service.title') }}</p>
            <p class="mt-1 text-xs text-gray-500">{{ $t('agents.service.subtitle') }}</p>
          </div>
          <span class="text-xs font-medium text-blue-300">
            {{ servicePanelOpen ? $t('agents.panelCollapse') : $t('agents.panelExpand') }}
          </span>
        </button>

        <div v-show="servicePanelOpen" class="mt-4">
        <!-- Platform tabs -->
        <div class="flex gap-1 mb-3">
          <button
            v-for="tab in (['linux', 'windows', 'macos'] as const)"
            :key="tab"
            class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            :class="serviceTab === tab
              ? 'bg-gray-700 text-white'
              : 'bg-transparent text-gray-500 hover:text-gray-300'"
            @click="serviceTab = tab"
          >{{ tab === 'linux' ? 'Linux' : tab === 'windows' ? 'Windows' : 'macOS' }}</button>
        </div>

        <!-- Linux (systemd) -->
        <div v-if="serviceTab === 'linux'" class="space-y-3">
          <div class="na-panel rounded-xl border p-4">
            <p class="text-xs font-medium text-gray-300 mb-2">{{ $t('agents.service.linux.installTitle') }}</p>
            <p class="text-xs text-gray-500 mb-3">{{ $t('agents.service.linux.installHint') }}</p>
            <div class="flex gap-2 items-start">
              <pre class="na-code flex-1 font-mono text-xs rounded p-3 text-gray-300 whitespace-pre overflow-x-auto leading-relaxed">{{ systemdInstallCmd() }}</pre>
              <NButton size="small" @click="copy(systemdInstallCmd(), 'agents.commandCopied')">{{ $t('agents.copy') }}</NButton>
            </div>
          </div>
          <div class="na-panel rounded-xl border p-4">
            <p class="text-xs font-medium text-gray-300 mb-2">{{ $t('agents.service.linux.unitTitle') }}</p>
            <div class="flex gap-2 items-start">
              <pre class="na-code flex-1 font-mono text-xs rounded p-3 text-gray-300 whitespace-pre overflow-x-auto leading-relaxed">{{ systemdUnit() }}</pre>
              <NButton size="small" @click="copy(systemdUnit(), 'agents.commandCopied')">{{ $t('agents.copy') }}</NButton>
            </div>
            <p class="text-[11px] text-gray-600 mt-2">{{ $t('agents.service.linux.unitHint') }}</p>
          </div>
        </div>

        <!-- Windows (Task Scheduler) -->
        <div v-if="serviceTab === 'windows'" class="space-y-3">
          <div class="na-panel rounded-xl border p-4">
            <p class="text-xs font-medium text-gray-300 mb-2">{{ $t('agents.service.windows.title') }}</p>
            <p class="text-xs text-gray-500 mb-3">{{ $t('agents.service.windows.hint') }}</p>
            <div class="flex gap-2 items-start">
              <pre class="na-code flex-1 font-mono text-xs rounded p-3 text-blue-300 whitespace-pre overflow-x-auto leading-relaxed">{{ windowsTaskCmd() }}</pre>
              <NButton size="small" @click="copy(windowsTaskCmd(), 'agents.commandCopied')">{{ $t('agents.copy') }}</NButton>
            </div>
            <p class="text-[11px] text-gray-600 mt-2">{{ $t('agents.service.windows.note') }}</p>
          </div>
        </div>

        <!-- macOS (launchd) -->
        <div v-if="serviceTab === 'macos'" class="space-y-3">
          <div class="na-panel rounded-xl border p-4">
            <p class="text-xs font-medium text-gray-300 mb-2">{{ $t('agents.service.macos.installTitle') }}</p>
            <p class="text-xs text-gray-500 mb-3">{{ $t('agents.service.macos.installHint') }}</p>
            <div class="flex gap-2 items-start">
              <pre class="na-code flex-1 font-mono text-xs rounded p-3 text-gray-300 whitespace-pre overflow-x-auto leading-relaxed">{{ launchdInstallCmd() }}</pre>
              <NButton size="small" @click="copy(launchdInstallCmd(), 'agents.commandCopied')">{{ $t('agents.copy') }}</NButton>
            </div>
          </div>
          <div class="na-panel rounded-xl border p-4">
            <p class="text-xs font-medium text-gray-300 mb-2">{{ $t('agents.service.macos.plistTitle') }}</p>
            <p class="text-xs text-gray-500 mb-2">{{ $t('agents.service.macos.plistPath') }}</p>
            <div class="flex gap-2 items-start">
              <pre class="na-code flex-1 font-mono text-xs rounded p-3 text-gray-300 whitespace-pre overflow-x-auto leading-relaxed">{{ launchdPlist() }}</pre>
              <NButton size="small" @click="copy(launchdPlist(), 'agents.commandCopied')">{{ $t('agents.copy') }}</NButton>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Step-by-step setup ───────────────────────────────────────────── -->
      <div v-if="agentsLicensed" class="na-panel order-5 rounded-xl border p-5">
        <button
          type="button"
          class="flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 text-left"
          :aria-expanded="setupPanelOpen"
          @click="setupPanelOpen = !setupPanelOpen"
        >
          <div>
            <p class="text-sm font-semibold text-gray-200">{{ $t('agents.setup.title') }}</p>
            <p class="mt-1 text-xs text-gray-500">{{ $t('agents.setup.panelHint') }}</p>
          </div>
          <span class="text-xs font-medium text-blue-300">
            {{ setupPanelOpen ? $t('agents.panelCollapse') : $t('agents.panelExpand') }}
          </span>
        </button>

        <div v-show="setupPanelOpen" class="mt-4 space-y-2">
          <div
            v-for="(step, i) in [
              $t('agents.setup.step1'),
              $t('agents.setup.step2'),
              $t('agents.setup.step3'),
              $t('agents.setup.step4'),
              $t('agents.setup.step5'),
            ]"
            :key="i"
            class="na-item flex items-start gap-3 rounded-lg border px-4 py-3"
          >
            <span
              class="flex items-center justify-center rounded-full shrink-0 text-[11px] font-bold"
              style="width:22px;height:22px;background:#1e3a8a;color:#93c5fd;margin-top:1px;"
            >{{ i + 1 }}</span>
            <p class="text-sm text-gray-300">{{ step }}</p>
          </div>
        </div>
        </div>
      </div>

      <!-- ── Agent management ──────────────────────────────────────────────── -->
      <div v-if="agentsLicensed" class="na-panel order-1 rounded-xl border p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            class="min-w-0 flex-1 text-left"
            :aria-expanded="agentsPanelOpen"
            @click="agentsPanelOpen = !agentsPanelOpen"
          >
            <div>
              <p class="text-sm font-semibold text-gray-200">{{ $t('agents.myAgents') }}</p>
              <p class="mt-1 text-xs text-gray-500">
                {{ $t('agents.connectedSummary', { online: onlineAgentsCount, total: agents.length }) }}
              </p>
            </div>
          </button>
          <div class="flex flex-wrap items-center gap-2">
              <div class="na-code flex rounded-lg border p-1">
                <button
                  v-for="filter in (['all', 'online', 'offline'] as const)"
                  :key="`agent-filter-${filter}`"
                  class="rounded-md px-2.5 py-1 text-xs transition-colors"
                  :class="agentStatusFilter === filter
                    ? 'bg-gray-700 text-white'
                    : 'text-gray-500 hover:text-gray-300'"
                  @click="agentStatusFilter = filter"
                >
                  {{ $t(`agents.filters.${filter}`) }}
                </button>
              </div>
              <NButton type="primary" size="small" @click="showForm = !showForm">
                + {{ $t('agents.new') }}
              </NButton>
          </div>
        </div>

        <div v-show="agentsPanelOpen" class="mt-4">

        <!-- Create form -->
        <div v-if="showForm" class="na-panel rounded-xl border p-4 mb-4 space-y-3">
          <p class="text-xs font-medium text-gray-300">{{ $t('agents.formTitle') }}</p>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            <button
              class="rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors"
              :class="newAgentType === 'PROXY_AGENT'
                ? 'border-blue-600 bg-blue-900/30 text-blue-300'
                : 'border-gray-700 bg-transparent text-gray-400 hover:border-gray-500'"
              @click="setNewAgentType('PROXY_AGENT')"
            >
              {{ $t('agents.typeProxy') }}
              <p class="font-normal text-gray-500 mt-0.5">{{ $t('agents.typeProxyHint') }}</p>
            </button>
            <button
              class="rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors"
              :class="newAgentType === 'PRIVATE_ACCESS_CONNECTOR'
                ? 'border-emerald-600 bg-emerald-900/25 text-emerald-300'
                : 'border-gray-700 bg-transparent text-gray-400 hover:border-gray-500'"
              @click="setNewAgentType('PRIVATE_ACCESS_CONNECTOR')"
            >
              {{ $t('agents.typePrivateAccess') }}
              <p class="font-normal text-gray-500 mt-0.5">{{ $t('agents.typePrivateAccessHint') }}</p>
            </button>
          </div>
          <!-- Mode selector -->
          <div class="flex gap-2">
            <button
              class="flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors"
              :disabled="newAgentType === 'PRIVATE_ACCESS_CONNECTOR'"
              :class="newAgentMode === 'USER_BOUND'
                ? 'border-blue-600 bg-blue-900/30 text-blue-300'
                : 'border-gray-700 bg-transparent text-gray-400 hover:border-gray-500'"
              @click="newAgentMode = 'USER_BOUND'"
            >
              {{ $t('agents.modeUser') }}
              <p class="font-normal text-gray-500 mt-0.5">{{ $t('agents.modeUserHint') }}</p>
            </button>
            <button
              class="flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors"
              :class="newAgentMode === 'SERVICE_BOUND'
                ? 'border-purple-600 bg-purple-900/30 text-purple-300'
                : 'border-gray-700 bg-transparent text-gray-400 hover:border-gray-500'"
              @click="newAgentMode = 'SERVICE_BOUND'"
            >
              {{ $t('agents.modeService') }}
              <p class="font-normal text-gray-500 mt-0.5">{{ $t('agents.modeServiceHint') }}</p>
            </button>
          </div>
          <NAlert
            v-if="newAgentType === 'PRIVATE_ACCESS_CONNECTOR'"
            type="info"
            :show-icon="false"
            class="text-xs"
          >
            {{ $t('agents.privateAccessNotice') }}
          </NAlert>
          <div v-if="newAgentType === 'PRIVATE_ACCESS_CONNECTOR'" class="grid grid-cols-1 md:grid-cols-2 gap-2">
            <NInput v-model:value="privateAccessSiteName" :placeholder="$t('agents.privateAccessSitePlaceholder')" />
            <NInput v-model:value="privateAccessEnvironment" :placeholder="$t('agents.privateAccessEnvironmentPlaceholder')" />
            <NInput v-model:value="privateAccessCidrs" :placeholder="$t('agents.privateAccessCidrsPlaceholder')" />
            <NInput v-model:value="privateAccessPorts" :placeholder="$t('agents.privateAccessPortsPlaceholder')" />
          </div>
          <NAlert
            v-if="newAgentType === 'PRIVATE_ACCESS_CONNECTOR' && newPrivateAccessIsWideOpen"
            type="warning"
            :show-icon="false"
            class="text-xs"
          >
            {{ $t('agents.privateAccessWideOpenWarning') }}
          </NAlert>
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
          <NEmpty v-else-if="filteredAgents.length === 0" :description="$t('agents.emptyFiltered')" class="py-8" />
          <div
            v-for="agent in filteredAgents"
            :key="agent.id"
            class="na-panel rounded-xl border px-4 py-3 space-y-2"
          >
            <div class="flex items-center gap-3">
              <NTooltip trigger="hover" placement="top">
                <template #trigger>
                  <span
                    class="w-2.5 h-2.5 rounded-full shrink-0"
                    :class="agent.online ? 'bg-green-400' : agent.revokedAt ? 'bg-orange-500' : 'bg-gray-600'"
                  />
                </template>
                {{ agent.online ? $t('agents.online') : agent.revokedAt ? $t('agents.statusRevoked') : $t('agents.offline') }}
              </NTooltip>

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <p class="text-sm font-medium text-white">{{ agent.name }}</p>
                  <NTag
                    v-if="agent.agentType === 'PRIVATE_ACCESS_CONNECTOR'"
                    size="tiny"
                    type="success"
                  >{{ $t('agents.typePrivateAccessShort') }}</NTag>
                  <NTag
                    v-if="hasWideOpenPrivateAccess(agent)"
                    size="tiny"
                    type="warning"
                  >{{ $t('agents.privateAccessWideOpenBadge') }}</NTag>
                  <NTag
                    size="tiny"
                    :type="agent.agentMode === 'SERVICE_BOUND' ? 'info' : 'default'"
                    style="font-family:monospace;"
                  >{{ agent.agentMode === 'SERVICE_BOUND' ? $t('agents.modeService') : $t('agents.modeUser') }}</NTag>
                  <NTag v-if="agent.online" size="tiny" type="success">{{ $t('agents.connectedNow') }}</NTag>
                  <NTag v-if="agent.isDefault" size="tiny" type="success">{{ $t('agents.defaultBadge') }}</NTag>
                  <NTag v-if="agent.version" size="tiny" style="font-family:monospace;">v{{ agent.version }}</NTag>
                </div>
                <p class="text-xs text-gray-500">
                  {{ $t('agents.lastSeen') }}: {{ formatDate(agent.lastSeenAt) }}
                </p>
                <p v-if="authStore.isAdmin && agent.owner" class="text-xs text-gray-600">
                  {{ $t('agents.owner') }}: {{ agent.owner.name }} ({{ agent.owner.email }})
                </p>
                <div v-if="agent.agentType === 'PRIVATE_ACCESS_CONNECTOR'" class="mt-1 space-y-0.5 text-xs text-gray-600">
                  <p>
                    {{ $t('agents.privateAccessScope') }}:
                    {{ agent.siteName || $t('agents.privateAccessScopeUnset') }}
                    <span v-if="agent.environment">/ {{ agent.environment }}</span>
                  </p>
                  <p>
                    {{ $t('agents.privateAccessCidrs') }}:
                    <span class="font-mono">{{ formatPrivateAccessList(agent.privateAccess?.allowedCidrs) }}</span>
                  </p>
                  <p>
                    {{ $t('agents.privateAccessPorts') }}:
                    <span class="font-mono">{{ formatPrivateAccessList(agent.privateAccess?.allowedPorts) }}</span>
                  </p>
                </div>
              </div>

              <NTag v-if="agent.revokedAt" size="small" type="warning">{{ $t('agents.statusRevoked') }}</NTag>

              <NTooltip v-if="agent.online" trigger="hover" placement="left">
                <template #trigger>
                  <NButton size="small" text style="color:#60a5fa;" @click="openAgentHostTest(agent)">
                    {{ $t('agents.test.action') }}
                  </NButton>
                </template>
                {{ $t('agents.test.hint') }}
              </NTooltip>

              <!-- Set as default (SERVICE_BOUND only) -->
              <NTooltip v-if="agent.agentMode === 'SERVICE_BOUND' && !agent.isDefault && agent.active" trigger="hover" placement="left">
                <template #trigger>
                  <NButton size="small" text style="color:#a78bfa;" @click="setDefault(agent)">
                    {{ $t('agents.setDefault') }}
                  </NButton>
                </template>
                {{ $t('agents.setDefaultHint') }}
              </NTooltip>

              <!-- Reactivate (only shown when revoked) -->
              <NTooltip v-if="agent.revokedAt" trigger="hover" placement="left">
                <template #trigger>
                  <NButton size="small" text style="color:#34d399;" @click="reactivate(agent)">
                    {{ $t('agents.reactivate') }}
                  </NButton>
                </template>
                {{ $t('agents.reactivateHint') }}
              </NTooltip>

              <!-- Revoke -->
              <NTooltip v-if="!agent.revokedAt" trigger="hover" placement="left">
                <template #trigger>
                  <NButton
                    size="small" text
                    style="color:#f59e0b;"
                    @click="revoke(agent)"
                  >{{ $t('agents.revoke') }}</NButton>
                </template>
                {{ $t('agents.revokeHint') }}
              </NTooltip>

              <!-- Permanent delete -->
              <NTooltip trigger="hover" placement="left">
                <template #trigger>
                  <NButton size="small" text style="color:#ef4444;" @click="permanentDelete(agent)">
                    {{ $t('agents.delete') }}
                  </NButton>
                </template>
                {{ $t('agents.deleteHint') }}
              </NTooltip>
            </div>

            <div v-if="hasAgentDiagnostic(agent)" class="na-code rounded-lg border px-3 py-2 ml-5">
              <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div class="text-[11px] font-semibold text-gray-400">{{ $t('agents.diagnostics.title') }}</div>
                <NTag size="tiny" :type="agent.online ? 'success' : 'default'">
                  {{ agent.online ? $t('agents.diagnostics.current') : $t('agents.diagnostics.lastKnown') }}
                </NTag>
              </div>

              <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                <div v-if="agent.hostname || agent.lastHostname" class="na-item rounded border px-2.5 py-2">
                  <div class="text-[10px] uppercase text-gray-600">{{ $t('agents.hostname') }}</div>
                  <div class="mt-1 truncate font-mono text-[11px] text-gray-300">{{ agent.hostname ?? agent.lastHostname }}</div>
                </div>

                <div v-if="formatAgentPlatform(agent) || formatLastAgentPlatform(agent)" class="na-item rounded border px-2.5 py-2">
                  <div class="text-[10px] uppercase text-gray-600">{{ $t('agents.platform') }}</div>
                  <div class="mt-1 truncate font-mono text-[11px] text-gray-300">{{ formatAgentPlatform(agent) ?? formatLastAgentPlatform(agent) }}</div>
                </div>

                <div v-if="agent.version || agent.lastVersion" class="na-item rounded border px-2.5 py-2">
                  <div class="text-[10px] uppercase text-gray-600">{{ $t('agents.version') }}</div>
                  <div class="mt-1 truncate font-mono text-[11px] text-gray-300">v{{ agent.version ?? agent.lastVersion }}</div>
                </div>

                <div v-if="agent.remoteIp || agent.lastRemoteIp" class="na-item rounded border px-2.5 py-2">
                  <div class="text-[10px] uppercase text-gray-600">{{ $t('agents.remoteIp') }}</div>
                  <div class="mt-1 truncate font-mono text-[11px] text-gray-300">{{ agent.remoteIp ?? agent.lastRemoteIp }}</div>
                </div>

                <div v-if="agent.lastSeenAt" class="na-item rounded border px-2.5 py-2">
                  <div class="text-[10px] uppercase text-gray-600">{{ $t('agents.heartbeat') }}</div>
                  <div class="mt-1 text-[11px] text-gray-300">{{ formatDate(agent.lastSeenAt) }}</div>
                </div>

                <div v-if="agent.connectedAt || agent.lastConnectedAt" class="na-item rounded border px-2.5 py-2">
                  <div class="text-[10px] uppercase text-gray-600">{{ $t('agents.lastConnected') }}</div>
                  <div class="mt-1 text-[11px] text-gray-300">{{ formatDate(agent.connectedAt ?? agent.lastConnectedAt) }}</div>
                </div>

                <div v-if="agent.lastDisconnectedAt" class="na-item rounded border px-2.5 py-2">
                  <div class="text-[10px] uppercase text-gray-600">{{ $t('agents.lastDisconnected') }}</div>
                  <div class="mt-1 text-[11px] text-gray-300">{{ formatDate(agent.lastDisconnectedAt) }}</div>
                </div>

                <div v-if="agent.lastDisconnectReason || agent.lastOfflineReason" class="na-item rounded border px-2.5 py-2 md:col-span-2">
                  <div class="text-[10px] uppercase text-gray-600">{{ $t('agents.lastDisconnectReason') }}</div>
                  <div class="mt-1 break-words font-mono text-[11px] text-gray-300">
                    {{ agent.lastDisconnectReason ?? agent.lastOfflineReason }}
                    <template v-if="agent.lastOfflineAt"> · {{ formatDate(agent.lastOfflineAt) }}</template>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>

    </div>

    <NModal v-model:show="showHelp">
      <NCard
        style="width: min(900px, calc(100vw - 32px))"
        :title="$t('agents.help.title')"
        :bordered="false"
        role="dialog"
        aria-modal="true"
      >
        <div class="max-h-[78vh] overflow-y-auto pr-1">
          <div class="mb-5 rounded border border-white/10 p-4">
            <NText depth="3" class="block text-sm">{{ $t('agents.help.subtitle') }}</NText>
            <div class="mt-4 grid gap-3 md:grid-cols-3">
              <div
                v-for="item in helpQuickItems"
                :key="item"
                class="rounded bg-white/5 p-3"
              >
                <NText strong class="block text-sm">{{ $t(`agents.help.quick.${item}.title`) }}</NText>
                <NText depth="3" class="block text-xs mt-1">{{ $t(`agents.help.quick.${item}.description`) }}</NText>
              </div>
            </div>
          </div>

          <div class="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <section>
              <h2 class="text-sm font-semibold text-white mb-3">{{ $t('agents.help.fieldsTitle') }}</h2>
              <div class="overflow-hidden rounded border border-white/10">
                <div
                  v-for="field in helpFields"
                  :key="field"
                  class="grid gap-2 border-b border-white/10 p-3 last:border-b-0 md:grid-cols-[150px_1fr]"
                >
                  <NText strong class="text-sm">{{ $t(`agents.help.fields.${field}.title`) }}</NText>
                  <NText depth="3" class="text-sm">{{ $t(`agents.help.fields.${field}.description`) }}</NText>
                </div>
              </div>
            </section>

            <section class="space-y-5">
              <div>
                <h2 class="text-sm font-semibold text-white mb-3">{{ $t('agents.help.modesTitle') }}</h2>
                <div class="space-y-3">
                  <div
                    v-for="mode in helpModes"
                    :key="mode"
                    class="rounded border border-white/10 p-3"
                  >
                    <NTag size="small" :type="mode === 'service' ? 'warning' : 'info'">
                      {{ $t(`agents.help.modes.${mode}.label`) }}
                    </NTag>
                    <NText depth="3" class="block text-sm mt-2">{{ $t(`agents.help.modes.${mode}.description`) }}</NText>
                  </div>
                </div>
              </div>

              <div>
                <h2 class="text-sm font-semibold text-white mb-3">{{ $t('agents.help.statusesTitle') }}</h2>
                <div class="space-y-3">
                  <div
                    v-for="status in helpStatuses"
                    :key="status"
                    class="rounded border border-white/10 p-3"
                  >
                    <NTag size="small" :type="status === 'online' ? 'success' : status === 'revoked' ? 'error' : 'default'">
                      {{ $t(`agents.help.statuses.${status}.label`) }}
                    </NTag>
                    <NText depth="3" class="block text-sm mt-2">{{ $t(`agents.help.statuses.${status}.description`) }}</NText>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </NCard>
    </NModal>

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

        <div class="grid grid-cols-4 gap-2 text-xs">
          <div
            v-for="(step, index) in [
              $t('agents.onboarding.stepCreate'),
              $t('agents.onboarding.stepPlatform'),
              $t('agents.onboarding.stepRun'),
              $t('agents.onboarding.stepValidate'),
            ]"
            :key="`agent-onboarding-step-${index}`"
            class="rounded border px-2.5 py-2"
            :class="index === 0 || (index === 1 && newToken) || (index === 2 && newToken) || (index === 3 && agentOnline)
              ? 'border-blue-800 bg-blue-950/20 text-blue-200'
              : 'na-panel border text-gray-500'"
          >
            <div class="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              {{ $t('agents.onboarding.stepLabel', { number: index + 1 }) }}
            </div>
            {{ step }}
          </div>
        </div>

        <div>
          <p class="text-xs text-gray-400 mb-1">{{ $t('agents.tokenLabel') }}</p>
          <div class="flex gap-2">
            <div class="na-code flex-1 font-mono text-xs rounded p-2 text-green-400 break-all select-all">
              {{ newToken }}
            </div>
            <NButton size="small" @click="copy(newToken, 'agents.tokenCopied')">
              {{ $t('agents.copy') }}
            </NButton>
          </div>
        </div>

        <div class="na-panel rounded-lg border p-3">
          <p class="text-xs font-semibold text-gray-300 mb-2">{{ $t('agents.onboarding.platformTitle') }}</p>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="platform in (['windows', 'linux', 'macos'] as const)"
              :key="`agent-onboarding-platform-${platform}`"
              class="rounded-lg border px-3 py-2 text-xs font-medium transition-colors"
              :class="onboardingPlatform === platform
                ? 'border-blue-700 bg-blue-950/30 text-blue-200'
                : 'na-code border text-gray-400 hover:border-gray-600'"
              @click="onboardingPlatform = platform"
            >
              <span>{{ platform === 'windows' ? 'Windows' : platform === 'linux' ? 'Linux' : 'macOS' }}</span>
              <NTag v-if="!downloadInfo(platform).available" size="tiny" class="ml-1">
                {{ $t('agents.download.notPublished') }}
              </NTag>
            </button>
          </div>
          <p class="mt-2 text-[11px] text-gray-500">{{ $t(onboardingPlatformNoteKey()) }}</p>
        </div>

        <div class="na-panel rounded-lg border p-3">
          <p class="text-xs font-semibold text-gray-300 mb-2">{{ $t('agents.onboarding.installModeTitle') }}</p>
          <div class="grid grid-cols-2 gap-2">
            <button
              class="rounded-lg border px-3 py-2 text-left transition-colors"
              :class="onboardingInstallMode === 'run'
                ? 'border-green-700 bg-green-950/20 text-green-200'
                : 'na-code border text-gray-400 hover:border-gray-600'"
              @click="onboardingInstallMode = 'run'"
            >
              <div class="text-xs font-semibold">{{ $t('agents.onboarding.runNow') }}</div>
              <div class="mt-1 text-[11px] text-gray-500">{{ $t('agents.onboarding.runNowHint') }}</div>
            </button>
            <button
              class="rounded-lg border px-3 py-2 text-left transition-colors"
              :class="onboardingInstallMode === 'service'
                ? 'border-purple-700 bg-purple-950/20 text-purple-200'
                : 'na-code border text-gray-400 hover:border-gray-600'"
              @click="onboardingInstallMode = 'service'"
            >
              <div class="text-xs font-semibold">{{ $t('agents.onboarding.installService') }}</div>
              <div class="mt-1 text-[11px] text-gray-500">{{ $t('agents.onboarding.installServiceHint') }}</div>
            </button>
          </div>
        </div>

        <div>
          <p class="text-xs text-gray-400 mb-1">{{ $t('agents.commandLabel') }}</p>
          <div class="flex gap-2 items-start">
            <div
              class="na-code flex-1 font-mono text-xs rounded p-2 break-all select-all leading-relaxed"
              :class="onboardingPlatform === 'windows' ? 'text-amber-200' : 'text-blue-300'"
            >
              {{ onboardingCommand(newToken) }}
            </div>
            <NButton
              size="small"
              :disabled="!canCopyOnboardingCommand()"
              @click="copy(onboardingCommand(newToken), 'agents.commandCopied')"
            >
              {{ $t('agents.copy') }}
            </NButton>
          </div>
          <p class="mt-2 text-[11px] text-gray-500">{{ $t('agents.onboarding.commandHint') }}</p>
        </div>

        <!-- Connection status -->
        <div
          class="flex items-center gap-3 rounded border p-3 text-sm transition-colors"
          :class="agentOnline
            ? 'border-green-700 bg-green-900/20 text-green-400'
            : 'na-panel border text-gray-400'"
        >
          <template v-if="agentOnline">
            <span class="w-2 h-2 rounded-full bg-green-400 shrink-0" />
            {{ $t('agents.connectionReady') }}
          </template>
          <template v-else>
            <NSpin size="small" />
            {{ $t('agents.connectionWaiting') }}
          </template>
        </div>

        <div class="flex flex-wrap justify-end gap-2">
          <NButton :loading="validatingAgent" @click="validateNewAgentConnection">
            {{ $t('agents.onboarding.validate') }}
          </NButton>
          <NButton type="primary" @click="closeTokenModal">
            {{ $t('agents.tokenDone') }}
          </NButton>
        </div>
      </div>
    </NModal>

    <NModal
      :show="testAgent !== null"
      preset="card"
      style="max-width: 620px;"
      :title="$t('agents.test.title')"
      @update:show="(show) => { if (!show) testAgent = null }"
    >
      <div class="space-y-4">
        <NAlert v-if="testAgent" type="info" :show-icon="false">
          {{ $t('agents.test.description', { agent: testAgent.name }) }}
        </NAlert>

        <div>
          <p class="mb-1 text-xs font-semibold text-gray-300">{{ $t('agents.test.hostLabel') }}</p>
          <NSelect
            v-model:value="testHostId"
            :options="hostOptions"
            filterable
            :placeholder="$t('agents.test.hostPlaceholder')"
          />
        </div>

        <div
          v-if="testResult"
          class="rounded-lg border p-3 text-sm"
          :class="testResult.success
            ? 'border-green-900/50 bg-green-950/20'
            : 'border-red-900/50 bg-red-950/20'"
        >
          <div class="flex flex-wrap items-center gap-2">
            <NTag size="small" :type="testResult.success ? 'success' : 'error'">
              {{ testResult.success ? $t('agents.test.success') : $t('agents.test.failed') }}
            </NTag>
            <span class="text-gray-300">{{ testResult.message }}</span>
            <span v-if="testResult.latencyMs !== null" class="text-[11px] text-gray-500">
              {{ testResult.latencyMs }}ms
            </span>
          </div>
        </div>

        <div class="flex justify-end gap-2">
          <NButton @click="testAgent = null">{{ $t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="testLoading" :disabled="testHostId === null" @click="runAgentHostTest">
            {{ $t('agents.test.run') }}
          </NButton>
        </div>
      </div>
    </NModal>
  </div>
</template>
