<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'
import { useAuthStore } from '@/stores/auth'
import { hostService }    from '@/services/host.service'
import { INVENTORY_ACL_CHANGED_EVENT, USER_ACL_MEMBERSHIP_CHANGED_EVENT } from '@/services/app-events.service'
import { featuresService } from '@/services/features.service'
import { resetTerminalLayout } from '@/services/terminal-layout.service'
import { useTerminalStore } from '@/stores/terminals'
import { getHostAccessProtocolCapabilities, type HostPublic } from '@nodeaccess/shared'
import { termSettings } from '@/composables/useTerminal'

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const router    = useRouter()
const auth      = useAuthStore()
const termStore = useTerminalStore()
const message = useMessage()

const query         = ref('')
const hosts         = ref<HostPublic[]>([])
const loading       = ref(false)
const selectedIndex = ref(0)
const inputRef      = ref<HTMLInputElement | null>(null)
const mcpLicensed   = ref(true)
const FEATURES_UPDATED_EVENT = 'nodeaccess:features-updated'
let aclReloadTimer: ReturnType<typeof setTimeout> | null = null

onMounted(async () => {
  await nextTick()
  inputRef.value?.focus()
  await loadInitialData()
  window.addEventListener(FEATURES_UPDATED_EVENT, reloadFeatures)
  window.addEventListener(INVENTORY_ACL_CHANGED_EVENT, scheduleHostsReload)
  window.addEventListener(USER_ACL_MEMBERSHIP_CHANGED_EVENT, scheduleHostsReload)
})

onUnmounted(() => {
  window.removeEventListener(FEATURES_UPDATED_EVENT, reloadFeatures)
  window.removeEventListener(INVENTORY_ACL_CHANGED_EVENT, scheduleHostsReload)
  window.removeEventListener(USER_ACL_MEMBERSHIP_CHANGED_EVENT, scheduleHostsReload)
  if (aclReloadTimer !== null) {
    clearTimeout(aclReloadTimer)
    aclReloadTimer = null
  }
})

async function loadInitialData() {
  loading.value = true
  try {
    const [{ data }, features] = await Promise.all([
      hostService.list({ limit: 200 }),
      featuresService.get().catch(() => null),
    ])
    hosts.value = data.data
    mcpLicensed.value = features?.mcpLicensed ?? true
  } finally {
    loading.value = false
  }
}

async function reloadHosts() {
  hostService.clear('acl-realtime:command-palette')
  try {
    const { data } = await hostService.list({ limit: 200 })
    hosts.value = data.data
  } catch {
    // Keep current results if a realtime refresh races with a reconnect.
  }
}

function scheduleHostsReload() {
  if (aclReloadTimer !== null) clearTimeout(aclReloadTimer)
  aclReloadTimer = setTimeout(() => {
    aclReloadTimer = null
    void reloadHosts()
  }, 150)
}

async function reloadFeatures() {
  featuresService.clear()
  const features = await featuresService.get().catch(() => null)
  mcpLicensed.value = features?.mcpLicensed ?? true
}

// ── Sections ──────────────────────────────────────────────────────────────────

interface Item {
  type:   'host' | 'nav'
  label:  string
  sub?:   string
  icon:   string
  action: () => void
}

const navLinks = computed<Item[]>(() => [
  ...(auth.isAdmin ? [
    { type: 'nav' as const, label: t('nav.dashboard'),     sub: t('nav.admin'),   icon: 'M18 20V10M12 20V4M6 20V14', action: () => go('admin-dashboard') },
    { type: 'nav' as const, label: t('nav.users'),         sub: t('nav.admin'),   icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M12 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', action: () => go('admin-users') },
    { type: 'nav' as const, label: t('nav.groups'),        sub: t('nav.admin'),   icon: 'M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z', action: () => go('admin-groups') },
    { type: 'nav' as const, label: t('nav.diagnosticPlaybooks'), sub: t('nav.admin'), icon: 'M9 3h6M10 8h8M8 13h10M10 18h8M5 3h.01M5 8h.01M5 13h.01M5 18h.01', action: () => go('admin-diagnostic-playbooks') },
    ...(mcpLicensed.value ? [
      { type: 'nav' as const, label: t('nav.mcpTokens'), sub: t('nav.admin'), icon: 'M14 10V6a4 4 0 1 0-8 0v4M4 10h16v10H4zM12 14h.01', action: () => go('admin-mcp-tokens') },
    ] : []),
    { type: 'nav' as const, label: t('nav.sessions'),      sub: t('nav.reports'), icon: 'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2', action: () => go('admin-reports-sessions') },
    { type: 'nav' as const, label: t('nav.reportsOverview'), sub: t('nav.reports'), icon: 'M3 3v18h18M7 15v3M12 9v9M17 12v6M7 11l4-4 4 3 4-6', action: () => go('admin-reports') },
    { type: 'nav' as const, label: t('nav.logs'),          sub: t('nav.reports'), icon: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7zM14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8', action: () => go('admin-logs') },
    { type: 'nav' as const, label: t('nav.sessionAudit'),  sub: t('nav.reports'), icon: 'M12 8v4l3 3M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M8 2h8', action: () => go('admin-session-audit') },
    { type: 'nav' as const, label: t('nav.sftpAudit'),     sub: t('nav.reports'), icon: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7zM14 2v4a2 2 0 0 0 2 2h4M8 13h8M8 17h5', action: () => go('admin-sftp-audit') },
    { type: 'nav' as const, label: t('nav.nativeSshGateway'), sub: t('nav.admin'), icon: 'm4 17 6-6-6-6M12 19h8M12 4h8v8h-8zM14 8h4', action: () => go('admin-native-ssh-gateway') },
    { type: 'nav' as const, label: t('nav.sessionCommandPolicies'), sub: t('nav.admin'), icon: 'm4 17 6-6-6-6M12 19h8M17 4l3 3-3 3M14 7h6', action: () => go('admin-session-command-policies') },
    { type: 'nav' as const, label: t('nav.integrations'),  sub: t('nav.admin'),   icon: 'M12 22v-5M9 8V2M15 8V2M18 8H6a2 2 0 0 0-2 2v2a7 7 0 0 0 14 0v-2a2 2 0 0 0-2-2z', action: () => go('admin-integrations') },
    { type: 'nav' as const, label: t('nav.settings'),      sub: t('nav.admin'),   icon: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', action: () => go('admin-settings') },
  ] : []),
  ...(auth.isPlatformAdmin ? [
    { type: 'nav' as const, label: t('nav.observability'), sub: t('nav.platform'), icon: 'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36', action: () => go('admin-observability') },
    { type: 'nav' as const, label: t('nav.platformSettings'), sub: t('nav.platform'), icon: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18', action: () => go('platform-settings') },
  ] : []),
  { type: 'nav' as const, label: t('nav.profile'),   sub: '', icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', action: () => go('profile') },
  { type: 'nav' as const, label: t('nav.pemKeys'),   sub: '', icon: 'M21 2l-9.6 9.6M7.5 10a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM15.5 7.5l3 3L22 7l-3-3', action: () => go('pem-keys') },
])

const q = computed(() => query.value.toLowerCase().trim())

const filteredHosts = computed(() => {
  if (!q.value) return hosts.value.slice(0, 7)
  return hosts.value.filter((h) =>
    h.name.toLowerCase().includes(q.value) || h.ip.includes(q.value),
  ).slice(0, 7)
})

const filteredNav = computed(() => {
  if (!q.value) return navLinks.value.slice(0, 4)
  return navLinks.value.filter((n) => n.label.toLowerCase().includes(q.value))
})

const hostItems = computed<Item[]>(() =>
  filteredHosts.value.map((h) => ({
    type:   'host' as const,
    label:  h.name,
    sub:    `${h.ip}:${h.port}`,
    icon:   '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
    action: () => connectHost(h),
  })),
)

const allItems = computed<Item[]>(() => [
  ...hostItems.value,
  ...filteredNav.value,
])

watch(query, () => { selectedIndex.value = 0 })

// ── Actions ───────────────────────────────────────────────────────────────────

function go(name: string) {
  router.push({ name })
  emit('close')
}

function canConnectHost(host: HostPublic): boolean {
  return auth.isAdmin || host.accessPermissions?.connect === true
}

function connectHost(host: HostPublic) {
  if (!canConnectHost(host)) {
    message.warning(t('hosts.inventoryAcl.connectRequired'))
    return
  }
  if (getHostAccessProtocolCapabilities(host.accessProtocol).graphicalGatewayPlanned && termSettings.graphicalOpenMode === 'dedicated') {
    router.push({ name: 'graphical-session', params: { hostId: host.id } })
    emit('close')
    return
  }
  termStore.add({ id: host.id, name: host.name, ip: host.ip, port: host.port, authType: host.authType, accessProtocol: host.accessProtocol })
  resetTerminalLayout()
  router.push({ name: 'terminal' })
  emit('close')
}

// ── Keyboard ──────────────────────────────────────────────────────────────────

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, allItems.value.length - 1)
    scrollActiveIntoView()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
    scrollActiveIntoView()
  } else if (e.key === 'Enter') {
    allItems.value[selectedIndex.value]?.action()
  } else if (e.key === 'Escape') {
    emit('close')
  }
}

function scrollActiveIntoView() {
  nextTick(() => {
    document.querySelector('.cmd-item--active')?.scrollIntoView({ block: 'nearest' })
  })
}
</script>

<template>
  <Teleport to="body">
    <div class="cmd-overlay" @mousedown.self="$emit('close')">
      <div class="cmd-panel" @keydown="onKey">

        <!-- Search bar -->
        <div class="cmd-search-row">
          <svg class="cmd-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            ref="inputRef"
            v-model="query"
            class="cmd-input"
            :placeholder="$t('commandPalette.placeholder')"
            autocomplete="off"
            spellcheck="false"
          />
          <kbd class="cmd-esc">Esc</kbd>
        </div>

        <!-- Results -->
        <div class="cmd-results">
          <div v-if="loading" class="cmd-empty">{{ $t('commandPalette.loading') }}</div>

          <template v-else-if="allItems.length">

            <!-- Hosts section -->
            <div v-if="hostItems.length" class="cmd-section-label">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;margin-right:4px">
                <rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/>
              </svg>
              {{ $t('commandPalette.hostsSection') }}
            </div>

            <button
              v-for="(host, i) in hostItems"
              :key="`h-${i}`"
              class="cmd-item"
              :class="{ 'cmd-item--active': selectedIndex === i }"
              @mouseenter="selectedIndex = i"
              @click="host.action()"
            >
              <svg class="cmd-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/>
                <line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
              </svg>
              <span class="cmd-item-label">{{ host.label }}</span>
              <span class="cmd-item-sub font-mono">{{ host.sub }}</span>
              <span class="cmd-item-action">{{ $t('commandPalette.connectAction') }}</span>
            </button>

            <!-- Nav section -->
            <div v-if="filteredNav.length" class="cmd-section-label" :class="{ 'cmd-section-label--top': hostItems.length }">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;margin-right:4px">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              </svg>
              {{ $t('commandPalette.navSection') }}
            </div>

            <button
              v-for="(item, i) in filteredNav"
              :key="`n-${i}`"
              class="cmd-item"
              :class="{ 'cmd-item--active': selectedIndex === hostItems.length + i }"
              @mouseenter="selectedIndex = hostItems.length + i"
              @click="item.action()"
            >
              <svg class="cmd-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path :d="item.icon" />
              </svg>
              <span class="cmd-item-label">{{ item.label }}</span>
              <span v-if="item.sub" class="cmd-item-sub">{{ item.sub }}</span>
            </button>

          </template>

          <div v-else class="cmd-empty">{{ $t('commandPalette.noResults', { query }) }}</div>
        </div>

        <!-- Footer -->
        <div class="cmd-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> {{ $t('commandPalette.footer.navigate') }}</span>
          <span><kbd>↵</kbd> {{ $t('commandPalette.footer.select') }}</span>
          <span><kbd>Esc</kbd> {{ $t('commandPalette.footer.close') }}</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cmd-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 14vh;
}

.cmd-panel {
  width: 580px;
  max-width: calc(100vw - 32px);
  background: #1a1a1e;
  border: 1px solid #2e2e3a;
  border-radius: 14px;
  box-shadow:
    0 0 0 1px rgba(0,0,0,.6),
    0 32px 64px rgba(0,0,0,.7),
    0 0 80px rgba(99,102,241,.08);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 70vh;
}

.cmd-search-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid #222228;
}

.cmd-search-icon {
  width: 18px;
  height: 18px;
  color: #6b7280;
  flex-shrink: 0;
}

.cmd-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: #fff;
  font-size: 16px;
  font-family: inherit;
  caret-color: #6366f1;
}

.cmd-input::placeholder { color: #4b4b5a; }

.cmd-esc {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: #222228;
  color: #6b7280;
  border: 1px solid #2e2e3a;
  font-family: inherit;
}

.cmd-results {
  overflow-y: auto;
  flex: 1;
  padding: 6px;
}

.cmd-section-label {
  padding: 8px 12px 4px;
  font-size: 11px;
  font-weight: 600;
  color: #4b4b5a;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.cmd-section-label--top {
  margin-top: 4px;
  border-top: 1px solid #1e1e24;
  padding-top: 10px;
}

.cmd-hint {
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  color: #3b3b4a;
}

.cmd-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 12px;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  transition: background 0.08s;
}

.cmd-item--active {
  background: rgba(99, 102, 241, 0.12);
}

.cmd-item-icon {
  width: 18px;
  height: 18px;
  color: #6b7280;
  flex-shrink: 0;
}

.cmd-item--active .cmd-item-icon {
  color: #818cf8;
}

.cmd-item-label {
  font-size: 14px;
  color: #e2e2e8;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cmd-item-sub {
  font-size: 12px;
  color: #4b4b5a;
}

.cmd-item-action {
  font-size: 12px;
  color: #4b5563;
  opacity: 0;
  transition: opacity 0.1s;
}

.cmd-item--active .cmd-item-action {
  color: #818cf8;
  opacity: 1;
}

.cmd-empty {
  padding: 32px;
  text-align: center;
  color: #4b4b5a;
  font-size: 14px;
}

.cmd-footer {
  display: flex;
  gap: 16px;
  padding: 8px 16px;
  border-top: 1px solid #1e1e24;
  font-size: 11px;
  color: #4b4b5a;
}

.cmd-footer kbd {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 4px;
  background: #222228;
  border: 1px solid #2e2e3a;
  font-family: inherit;
  font-size: 10px;
  margin-right: 3px;
}
</style>
