<script setup lang="ts">
import { h, computed, ref, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import {
  NLayout, NLayoutSider, NLayoutContent, NMenu, NAvatar,
  NDropdown, NText, NTooltip, NAlert, NButton, NModal, NForm, NFormItem, NInput, NSelect, NSpin, useMessage,
} from 'naive-ui'
import type { MenuOption } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { usePlatform } from '@/composables/usePlatform'
import CommandPalette from '@/components/CommandPalette.vue'
import LocaleSwitcher from '@/components/LocaleSwitcher.vue'
import { consumeRecoveredStaleReload } from '@/services/stale-reload.service'
import { consumeBackendRecoveredFlag } from '@/services/backend-recovery.service'
import { flushClientUxEvents, recordClientUxEvent } from '@/services/client-ux-telemetry.service'
import { featuresService } from '@/services/features.service'
import { feedbackService } from '@/services/feedback.service'

const auth   = useAuthStore()
const router = useRouter()
const route  = useRoute()
const { t }  = useI18n()
const { shortcuts } = usePlatform()
const message = useMessage()

// ── Command Palette ───────────────────────────────────────────────────────────

const showPalette = ref(false)
const showRecoveredReloadBanner = ref(false)
const showBackendRecoveredBanner = ref(false)
const sidebarCollapsed = ref(false)
const showFeedbackModal = ref(false)
const feedbackSaving = ref(false)
const agentsLicensed = ref(true)
const secretsLicensed = ref(true)
const snippetsLicensed = ref(true)
const portForwardingLicensed = ref(true)
const feedbackLicensed = ref(true)
const localAiLicensed = ref(true)
const mcpLicensed = ref(true)
const FEATURES_UPDATED_EVENT = 'nodeaccess:features-updated'
const OPEN_FEEDBACK_MODAL_EVENT = 'nodeaccess:open-feedback-modal'
const feedbackForm = ref({
  type: 'suggestion' as 'suggestion' | 'problem' | 'question',
  title: '',
  message: '',
})
const pendingMenuKey = ref<string | null>(null)
const showRouteLoadingBar = ref(false)
let routeLoadingTimer: ReturnType<typeof setTimeout> | null = null
let removeBeforeResolveGuard: (() => void) | null = null
let removeAfterEachHook: (() => void) | null = null

function clearRouteLoadingTimer() {
  if (routeLoadingTimer !== null) {
    clearTimeout(routeLoadingTimer)
    routeLoadingTimer = null
  }
}

function startRouteLoading() {
  clearRouteLoadingTimer()
  routeLoadingTimer = setTimeout(() => {
    showRouteLoadingBar.value = true
    routeLoadingTimer = null
  }, 120)
}

function stopRouteLoading() {
  clearRouteLoadingTimer()
  showRouteLoadingBar.value = false
}

function isMeaningfulRouteChange(to: RouteLocationNormalizedLoaded, from: RouteLocationNormalizedLoaded) {
  return to.fullPath !== from.fullPath
}

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault()
    showPalette.value = !showPalette.value
  }
  if (e.key === 'Escape') {
    showPalette.value = false
  }
}

function onFeaturesUpdated() {
  featuresService.clear()
  void loadLicensedNavigation()
}

function onOpenFeedbackModal() {
  if (!feedbackLicensed.value) return
  showFeedbackModal.value = true
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener(FEATURES_UPDATED_EVENT, onFeaturesUpdated)
  window.addEventListener(OPEN_FEEDBACK_MODAL_EVENT, onOpenFeedbackModal)
  removeBeforeResolveGuard = router.beforeResolve((to, from) => {
    if (isMeaningfulRouteChange(to, from)) {
      startRouteLoading()
    }
  })
  removeAfterEachHook = router.afterEach(() => {
    stopRouteLoading()
  })
  const currentPath = window.location.pathname + window.location.search
  showRecoveredReloadBanner.value = consumeRecoveredStaleReload(currentPath)
  showBackendRecoveredBanner.value = consumeBackendRecoveredFlag()
  if (showRecoveredReloadBanner.value) {
    recordClientUxEvent('CLIENT_UX_STALE_RELOAD_RECOVERED')
  }
  void flushClientUxEvents()
  void loadLicensedNavigation()
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener(FEATURES_UPDATED_EVENT, onFeaturesUpdated)
  window.removeEventListener(OPEN_FEEDBACK_MODAL_EVENT, onOpenFeedbackModal)
  removeBeforeResolveGuard?.()
  removeAfterEachHook?.()
  removeBeforeResolveGuard = null
  removeAfterEachHook = null
  stopRouteLoading()
})

async function loadLicensedNavigation() {
  try {
    const features = await featuresService.get()
    agentsLicensed.value = features.agentsLicensed
    secretsLicensed.value = features.secretsLicensed
    snippetsLicensed.value = features.snippetsLicensed
    portForwardingLicensed.value = features.portForwardingLicensed
    feedbackLicensed.value = features.feedbackLicensed
    localAiLicensed.value = features.localAiLicensed
    mcpLicensed.value = features.mcpLicensed
  } catch {
    agentsLicensed.value = true
    secretsLicensed.value = true
    snippetsLicensed.value = true
    portForwardingLicensed.value = true
    feedbackLicensed.value = true
    localAiLicensed.value = true
    mcpLicensed.value = true
  }
}

// ── Active route → highlight no menu ─────────────────────────────────────────

const activeKey = computed(() => route.name as string | null)
const isTerminalContext = computed(() =>
  route.name === 'terminal' || route.name === 'shared-session-view',
)

// ── SVG icon helper ───────────────────────────────────────────────────────────

function icon(inner: string) {
  return () => h('svg', {
    xmlns:            'http://www.w3.org/2000/svg',
    viewBox:          '0 0 24 24',
    width:            '18',
    height:           '18',
    fill:             'none',
    stroke:           'currentColor',
    'stroke-width':   '1.75',
    'stroke-linecap': 'round',
    'stroke-linejoin':'round',
    style:            'display:block; flex-shrink:0;',
    innerHTML:        inner,
  })
}

// Lucide paths
const ICONS = {
  hosts:    '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
  keys:     '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  dashboard:'<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  users:    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  groups:   '<path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"/>',
  bastions: '<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>',
  integrations: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8H6a2 2 0 0 0-2 2v2a7 7 0 0 0 14 0v-2a2 2 0 0 0-2-2z"/>',
  tenants:      '<rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="8" width="7" height="13" rx="1"/><path d="M6 7h1"/><path d="M6 11h1"/><path d="M6 15h1"/><path d="M17 12h1"/><path d="M17 16h1"/>',
  agents:       '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="m7 9 3 3-3 3"/><path d="M12 15h5"/><path d="M8 20h8"/>',
  snippets:     '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  secrets:      '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9.5 12.5 11 14l3.5-4"/>',
  links:        '<path d="M10 13a5 5 0 0 0 7.54.54l2.92-2.92a5 5 0 0 0-7.07-7.07L11.5 5.43"/><path d="M14 11a5 5 0 0 0-7.54-.54L3.54 13.38a5 5 0 1 0 7.07 7.07l1.88-1.88"/>',
  forwardings:  '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  localAi: '<path d="M9.5 2A2.5 2.5 0 0 0 7 4.5V6H5a2 2 0 0 0-2 2v5"/><path d="M14.5 2A2.5 2.5 0 0 1 17 4.5V6h2a2 2 0 0 1 2 2v5"/><path d="M8 14h8"/><path d="M10 18h4"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/>',
  sessions: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  logs:     '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  sessionAudit: '<path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/><path d="M8 2h8"/>',
  diagnosticPlaybooks: '<path d="M9 3h6"/><path d="M10 8h8"/><path d="M8 13h10"/><path d="M10 18h8"/><path d="M5 3h.01"/><path d="M5 8h.01"/><path d="M5 13h.01"/><path d="M5 18h.01"/>',
  mcpTokens: '<path d="M14 10V6a4 4 0 1 0-8 0v4"/><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M12 14h.01"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  feedback: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8"/><path d="M8 13h5"/>',
  webhooks: '<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>',
  emailConfig: '<path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h8"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/><path d="M16 19h6"/><path d="M19 16v6"/>',
}

function renderMenuLabel(key: string, label: string) {
  return () => h('div', {
    class: 'sidebar-menu-option-label',
  }, [
    h('span', {
      class: pendingMenuKey.value === key ? 'sidebar-menu-option-label__text is-pending' : 'sidebar-menu-option-label__text',
    }, label),
    ...(pendingMenuKey.value === key
      ? [h(NSpin, { size: 12, stroke: 'var(--n-color-target)' })]
      : []),
  ])
}

// ── Menu options ──────────────────────────────────────────────────────────────

const menuOptions = computed<MenuOption[]>(() => [
  { key: 'dashboard', label: t('nav.home'), icon: icon(ICONS.dashboard) },
  { key: 'hosts', label: renderMenuLabel('hosts', t('nav.hosts')), icon: icon(ICONS.hosts) },
  ...(auth.user?.canManageHosts || auth.isAdmin ? [
    { key: 'pem-keys', label: t('nav.pemKeys'), icon: icon(ICONS.keys) },
  ] : []),
  ...(agentsLicensed.value ? [
    { key: 'agents', label: t('nav.agents'), icon: icon(ICONS.agents) },
  ] : []),
  ...(snippetsLicensed.value ? [
    { key: 'snippets', label: t('nav.snippets'), icon: icon(ICONS.snippets) },
  ] : []),
  ...(secretsLicensed.value ? [
    { key: 'secrets', label: t('nav.secrets'), icon: icon(ICONS.secrets) },
  ] : []),
  { key: 'links', label: t('nav.links'), icon: icon(ICONS.links) },
  ...(portForwardingLicensed.value ? [
    { key: 'forwardings', label: t('nav.forwardings'), icon: icon(ICONS.forwardings) },
  ] : []),
  ...(feedbackLicensed.value ? [
    { key: 'feedback', label: t('nav.feedback'), icon: icon(ICONS.feedback) },
  ] : []),
  ...(localAiLicensed.value ? [
    { key: 'local-ai', label: t('nav.localAi'), icon: icon(ICONS.localAi) },
  ] : []),
  ...(auth.isAdmin ? [
    {
      key:  'admin-divider',
      type: 'divider' as const,
    },
    {
      key:   'section-admin',
      type:  'group' as const,
      label: t('nav.admin'),
      children: [
        { key: 'admin-dashboard',    label: t('nav.dashboard'),    icon: icon(ICONS.dashboard) },
        { key: 'admin-users',        label: t('nav.users'),        icon: icon(ICONS.users) },
        { key: 'admin-groups',       label: t('nav.groups'),       icon: icon(ICONS.groups) },
        { key: 'admin-diagnostic-playbooks', label: t('nav.diagnosticPlaybooks'), icon: icon(ICONS.diagnosticPlaybooks) },
        ...(mcpLicensed.value ? [
          { key: 'admin-mcp-tokens', label: t('nav.mcpTokens'), icon: icon(ICONS.mcpTokens) },
        ] : []),
        { key: 'admin-bastions',     label: t('nav.bastions'),     icon: icon(ICONS.bastions) },
        { key: 'admin-integrations',  label: t('nav.integrations'),  icon: icon(ICONS.integrations) },
        { key: 'admin-webhooks',      label: t('nav.webhooks'),      icon: icon(ICONS.webhooks) },
        { key: 'admin-email-config',  label: t('nav.emailConfig'),   icon: icon(ICONS.emailConfig) },
        ...(feedbackLicensed.value ? [
          { key: 'admin-feedback', label: t('nav.feedbackAdmin'), icon: icon(ICONS.feedback) },
        ] : []),
        { key: 'admin-sessions',     label: t('nav.sessions'),     icon: icon(ICONS.sessions) },
        { key: 'admin-logs',         label: t('nav.logs'),         icon: icon(ICONS.logs) },
        { key: 'admin-session-audit', label: t('nav.sessionAudit'), icon: icon(ICONS.sessionAudit) },
        { key: 'admin-settings',     label: t('nav.settings'),     icon: icon(ICONS.settings) },
      ],
    },
  ] : []),
  ...(auth.isPlatformAdmin ? [
    {
      key:  'platform-divider',
      type: 'divider' as const,
    },
    {
      key:   'section-platform',
      type:  'group' as const,
      label: t('nav.platform'),
      children: [
        { key: 'platform-tenants', label: t('nav.tenants'), icon: icon(ICONS.tenants) },
      ],
    },
  ] : []),
])

// ── Navigation ────────────────────────────────────────────────────────────────

function onMenuSelect(key: string) {
  if (pendingMenuKey.value === key || route.name === key) return
  pendingMenuKey.value = key
  void router.push({ name: key }).finally(() => {
    if (pendingMenuKey.value === key) pendingMenuKey.value = null
  })
}

// ── Avatar color from name ────────────────────────────────────────────────────

const avatarColor = computed(() => {
  const name  = auth.user?.name ?? ''
  const hue   = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360
  return `hsl(${hue}, 55%, 45%)`
})

const userOptions = computed(() => [
  { label: t('nav.profile'), key: 'profile' },
  ...(feedbackLicensed.value ? [{ label: t('nav.feedback'), key: 'feedback' }] : []),
  ...(localAiLicensed.value ? [{ label: t('nav.localAi'), key: 'local-ai' }] : []),
  { label: t('nav.logout'),  key: 'logout'  },
])

async function onUserAction(key: string) {
  if (key === 'logout') {
    await auth.logout()
    router.push({ name: 'login' })
  } else {
    router.push({ name: key })
  }
}

const feedbackTypeOptions = computed(() => [
  { label: t('feedback.types.suggestion'), value: 'suggestion' },
  { label: t('feedback.types.problem'), value: 'problem' },
  { label: t('feedback.types.question'), value: 'question' },
])

function validateQuickFeedbackForm() {
  const title = feedbackForm.value.title.trim()
  const body = feedbackForm.value.message.trim()

  if (title.length < 4) {
    message.warning(t('feedback.validation.titleMin'))
    return false
  }

  if (body.length < 10) {
    message.warning(t('feedback.validation.messageMin'))
    return false
  }

  return true
}

async function submitQuickFeedback() {
  if (!feedbackLicensed.value) return
  if (!validateQuickFeedbackForm()) return
  feedbackSaving.value = true
  try {
    await feedbackService.create({
      type: feedbackForm.value.type,
      title: feedbackForm.value.title.trim(),
      message: feedbackForm.value.message.trim(),
      contextRoute: route.fullPath,
      contextScreen: typeof route.name === 'string' ? route.name : null,
    })
    feedbackForm.value = { type: 'suggestion', title: '', message: '' }
    showFeedbackModal.value = false
    message.success(t('feedback.create.success'))
  } catch {
    message.error(t('feedback.create.error'))
  } finally {
    feedbackSaving.value = false
  }
}
</script>

<template>
  <NLayout has-sider style="height: 100vh; background: #101014;">

    <!-- ── Sidebar ────────────────────────────────────────────────────────── -->
    <NLayoutSider
      v-model:collapsed="sidebarCollapsed"
      bordered
      collapse-mode="width"
      :collapsed-width="58"
      :width="210"
      show-trigger="bar"
      style="background: #16161a; border-right-color: #222228;"
      content-style="height: 100%;"
    >
      <div class="sidebar-shell">
        <!-- Logo -->
        <div
          class="sidebar-logo"
          :class="{ 'is-collapsed': sidebarCollapsed }"
        >
          <!-- Icon mark -->
          <div
            class="flex items-center justify-center rounded-lg shrink-0"
            style="width:28px; height:28px; background: linear-gradient(135deg,#3b82f6,#6366f1);"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="2" width="20" height="8" rx="2"/>
              <line x1="6" y1="6" x2="6.01" y2="6"/>
            </svg>
          </div>
          <span v-if="!sidebarCollapsed" class="font-semibold text-white text-[15px] tracking-tight overflow-hidden whitespace-nowrap">
            NodeAccess
          </span>
        </div>

        <!-- Search / Command Palette trigger -->
        <div
          class="sidebar-search"
          :class="{ 'is-collapsed': sidebarCollapsed }"
          @click="showPalette = true"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <span v-if="!sidebarCollapsed" style="font-size:12px; color:#555; flex:1;">{{ $t('nav.search') }}</span>
          <span v-if="!sidebarCollapsed" style="font-size:10px; color:#444; font-family:monospace; background:#15151a; border:1px solid #333; border-radius:4px; padding:1px 5px;">{{ shortcuts.commandPalette }}</span>
        </div>

        <!-- Menu -->
        <div class="sidebar-menu">
          <NMenu
            :value="activeKey"
            :options="menuOptions"
            :collapsed="sidebarCollapsed"
            :collapsed-width="58"
            :collapsed-icon-size="20"
            :indent="18"
            style="padding-top: 6px;"
            @update:value="onMenuSelect"
          />
        </div>

        <!-- User footer -->
        <div class="sidebar-footer">
          <!-- Language switcher -->
          <div class="flex justify-center py-1.5" style="border-bottom: 1px solid #1e1e24;">
            <LocaleSwitcher />
          </div>
          <NDropdown :options="userOptions" placement="top-start" @select="onUserAction">
            <div
              class="flex items-center gap-2.5 px-3 cursor-pointer hover:bg-white/5 transition-colors"
              :class="{ 'justify-center': sidebarCollapsed }"
              style="height: 52px;"
            >
              <NAvatar
                round
                size="small"
                :style="{ background: avatarColor, color: '#fff', fontSize: '12px', fontWeight: '600', flexShrink: 0 }"
              >
                {{ auth.user?.name.charAt(0).toUpperCase() }}
              </NAvatar>
              <div v-if="!sidebarCollapsed" class="overflow-hidden flex-1 min-w-0">
                <div class="text-[13px] font-medium text-white truncate leading-tight">
                  {{ auth.user?.name }}
                </div>
                <div class="text-[11px] text-gray-500 truncate leading-tight">
                  {{ auth.isPlatformAdmin ? $t('nav.roles.platformAdmin') : auth.isAdmin ? $t('nav.roles.admin') : $t('nav.roles.user') }}
                </div>
              </div>
            </div>
          </NDropdown>
        </div>
      </div>
    </NLayoutSider>

    <!-- ── Content ────────────────────────────────────────────────────────── -->
    <NLayoutContent
      content-style="height: 100vh; overflow: auto; background: #101014;"
    >
      <div v-if="showRouteLoadingBar" class="route-loading-bar" aria-hidden="true" />
      <div v-if="showRecoveredReloadBanner" class="px-4 pt-4 pb-1">
        <NAlert type="info" closable @close="showRecoveredReloadBanner = false">
          {{ $t('auth.appReloadRecovered') }}
        </NAlert>
      </div>
      <div v-if="showBackendRecoveredBanner" class="px-4 pt-1 pb-1">
        <NAlert type="success" closable @close="showBackendRecoveredBanner = false">
          {{ $t('auth.backendRecovered') }}
        </NAlert>
      </div>
      <RouterView v-slot="{ Component, route: currentRoute }">
        <KeepAlive include="TerminalView">
          <component
            :is="Component"
            :key="currentRoute.name === 'terminal' ? 'terminal' : currentRoute.fullPath"
          />
        </KeepAlive>
      </RouterView>
    </NLayoutContent>

  </NLayout>

  <div
    v-if="feedbackLicensed && !isTerminalContext"
    class="feedback-fab"
    :class="{ 'feedback-fab-terminal': isTerminalContext }"
  >
    <NTooltip placement="left">
      <template #trigger>
        <NButton
          :type="isTerminalContext ? 'default' : 'primary'"
          :secondary="isTerminalContext"
          round
          :strong="!isTerminalContext"
          :size="isTerminalContext ? 'small' : 'medium'"
          @click="showFeedbackModal = true"
        >
          <template v-if="isTerminalContext">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              <path d="M8 9h8"/>
              <path d="M8 13h5"/>
            </svg>
          </template>
          <template v-else>
            {{ $t('feedback.create.fab') }}
          </template>
        </NButton>
      </template>
      {{ $t('feedback.create.fabHint') }}
    </NTooltip>
  </div>

  <!-- ── Command Palette ────────────────────────────────────────────────────── -->
  <CommandPalette v-if="showPalette" @close="showPalette = false" />

  <NModal
    v-model:show="showFeedbackModal"
    preset="card"
    :title="$t('feedback.create.title')"
    class="max-w-2xl"
    style="background: #18181c;"
  >
    <NForm label-placement="top" @submit.prevent="submitQuickFeedback">
      <NFormItem :label="$t('feedback.fields.type')">
        <NSelect v-model:value="feedbackForm.type" :options="feedbackTypeOptions" />
      </NFormItem>
      <NFormItem :label="$t('feedback.fields.title')">
        <NInput v-model:value="feedbackForm.title" :placeholder="$t('feedback.placeholders.title')" />
      </NFormItem>
      <NFormItem :label="$t('feedback.fields.message')">
        <NInput
          v-model:value="feedbackForm.message"
          type="textarea"
          :rows="5"
          :placeholder="$t('feedback.placeholders.message')"
        />
      </NFormItem>
      <div class="flex justify-end gap-2">
        <NButton @click="showFeedbackModal = false">{{ $t('common.cancel') }}</NButton>
        <NButton type="primary" :loading="feedbackSaving" @click="submitQuickFeedback">
          {{ $t('feedback.create.submit') }}
        </NButton>
      </div>
    </NForm>
  </NModal>
</template>

<style scoped>
.sidebar-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 56px;
  padding: 0 16px;
  border-bottom: 1px solid #222228;
}

.sidebar-logo.is-collapsed {
  justify-content: center;
  padding: 0;
}

.sidebar-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  margin: 12px 12px 4px;
  padding: 0 10px;
  border: 1px solid #2a2a34;
  border-radius: 8px;
  background: #1e1e24;
  cursor: pointer;
  transition: background-color .15s ease, border-color .15s ease;
}

.sidebar-search.is-collapsed {
  justify-content: center;
  margin-inline: 10px;
  padding: 0;
}

.sidebar-menu {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.sidebar-menu-option-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.sidebar-menu-option-label__text {
  min-width: 0;
}

.sidebar-menu-option-label__text.is-pending {
  opacity: 0.78;
}

.sidebar-footer {
  flex: 0 0 auto;
  border-top: 1px solid #222228;
  background: #16161a;
}

.route-loading-bar {
  position: sticky;
  top: 0;
  z-index: 40;
  height: 3px;
  width: 100%;
  overflow: hidden;
  background: rgba(59, 130, 246, 0.1);
}

.route-loading-bar::before {
  content: '';
  display: block;
  height: 100%;
  width: 38%;
  background: linear-gradient(90deg, #22c55e 0%, #3b82f6 55%, #60a5fa 100%);
  box-shadow: 0 0 14px rgba(59, 130, 246, 0.45);
  animation: route-loading-slide 1s ease-in-out infinite;
}

@keyframes route-loading-slide {
  0% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(320%);
  }
}

.feedback-fab {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 30;
}

.feedback-fab-terminal {
  right: 14px;
  bottom: 14px;
  opacity: 0.82;
}
</style>
