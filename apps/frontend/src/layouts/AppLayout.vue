<script setup lang="ts">
import { h, computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import {
  NLayout, NLayoutSider, NLayoutContent, NMenu,
  NDropdown, NText, NTooltip, NAlert, NButton, NModal, NForm, NFormItem, NInput, NSelect, NSpin, useMessage,
} from 'naive-ui'
import type { MenuOption } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useTerminalStore } from '@/stores/terminals'
import { useUiStore } from '@/stores/ui'
import { usePlatform } from '@/composables/usePlatform'
import CommandPalette from '@/components/CommandPalette.vue'
import LocaleSwitcher from '@/components/LocaleSwitcher.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { consumeRecoveredStaleReload } from '@/services/stale-reload.service'
import { consumeBackendRecoveredFlag } from '@/services/backend-recovery.service'
import { flushClientUxEvents, recordClientUxEvent } from '@/services/client-ux-telemetry.service'
import { featuresService } from '@/services/features.service'
import { feedbackService } from '@/services/feedback.service'
import {
  appEventsService,
  INVENTORY_ACL_CHANGED_EVENT,
  USER_ACL_MEMBERSHIP_CHANGED_EVENT,
} from '@/services/app-events.service'

const auth   = useAuthStore()
const router = useRouter()
const route  = useRoute()
const { t }  = useI18n()
const { shortcuts } = usePlatform()
const message = useMessage()
const ui = useUiStore()
const terminalStore = useTerminalStore()
const MOBILE_SIDEBAR_COLLAPSE_WIDTH = 768

// ── Command Palette ───────────────────────────────────────────────────────────

const showPalette = ref(false)
const showRecoveredReloadBanner = ref(false)
const showBackendRecoveredBanner = ref(false)
const sidebarCollapsed = ref(typeof window !== 'undefined' && window.innerWidth <= MOBILE_SIDEBAR_COLLAPSE_WIDTH)
const showFeedbackModal = ref(false)
const feedbackSaving = ref(false)
const agentsLicensed = ref(true)
const secretsLicensed = ref(true)
const snippetsLicensed = ref(true)
const portForwardingLicensed = ref(true)
const feedbackLicensed = ref(true)
const localAiLicensed = ref(true)
const mcpLicensed = ref(true)
const activeTerminalCount = computed(() => terminalStore.tabs.length)
const TENANT_CONTEXT_CHANGED_EVENT = 'nodeaccess:tenant-context-changed'
const FEATURES_UPDATED_EVENT = 'nodeaccess:features-updated'
const OPEN_FEEDBACK_MODAL_EVENT = 'nodeaccess:open-feedback-modal'
const feedbackForm = ref({
  type: 'suggestion' as 'suggestion' | 'problem' | 'question',
  title: '',
  message: '',
})
const pendingMenuKey = ref<string | null>(null)
const showRouteLoadingBar = ref(false)
const showAccessRefreshBar = ref(false)
const showAppLoadingBar = computed(() => showRouteLoadingBar.value || showAccessRefreshBar.value)
let routeLoadingTimer: ReturnType<typeof setTimeout> | null = null
let accessRefreshTimer: ReturnType<typeof setTimeout> | null = null
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

function clearAccessRefreshTimer() {
  if (accessRefreshTimer !== null) {
    clearTimeout(accessRefreshTimer)
    accessRefreshTimer = null
  }
}

function showAccessRefreshFeedback() {
  showAccessRefreshBar.value = true
  clearAccessRefreshTimer()
  accessRefreshTimer = setTimeout(() => {
    showAccessRefreshBar.value = false
    accessRefreshTimer = null
  }, 650)
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

function onTenantContextChanged() {
  if (!auth.isAuthenticated) return
  appEventsService.restart()
  void loadLicensedNavigation()
}

function onOpenFeedbackModal() {
  if (!feedbackLicensed.value) return
  showFeedbackModal.value = true
}

const isTerminalContext = computed(() =>
  route.name === 'terminal' || route.name === 'shared-session-view',
)

const isSidebarAutoCollapseContext = computed(() =>
  isTerminalContext.value || route.name === 'graphical-session',
)

const showActiveTerminalShortcut = computed(() =>
  activeTerminalCount.value > 0
  && !isTerminalContext.value
  && route.name !== 'hosts',
)

const activeTerminalShortcutLabel = computed(() =>
  t('nav.activeTerminalShortcut', { count: activeTerminalCount.value }),
)

function openActiveTerminals() {
  if (activeTerminalCount.value === 0) return
  void router.push({ name: 'terminal' })
}

function syncResponsiveSidebar() {
  if (window.innerWidth <= MOBILE_SIDEBAR_COLLAPSE_WIDTH) {
    sidebarCollapsed.value = true
  }
}

function scheduleResponsiveSidebarSync() {
  syncResponsiveSidebar()
  requestAnimationFrame(syncResponsiveSidebar)
  window.setTimeout(syncResponsiveSidebar, 250)
}

onMounted(() => {
  scheduleResponsiveSidebarSync()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', syncResponsiveSidebar)
  window.addEventListener(TENANT_CONTEXT_CHANGED_EVENT, onTenantContextChanged)
  window.addEventListener(FEATURES_UPDATED_EVENT, onFeaturesUpdated)
  window.addEventListener(OPEN_FEEDBACK_MODAL_EVENT, onOpenFeedbackModal)
  window.addEventListener(INVENTORY_ACL_CHANGED_EVENT, showAccessRefreshFeedback)
  window.addEventListener(USER_ACL_MEMBERSHIP_CHANGED_EVENT, showAccessRefreshFeedback)
  removeBeforeResolveGuard = router.beforeResolve((to, from) => {
    if (isMeaningfulRouteChange(to, from)) {
      startRouteLoading()
    }
  })
  removeAfterEachHook = router.afterEach(() => {
    scheduleResponsiveSidebarSync()
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
  appEventsService.start()
})
onUnmounted(() => {
  appEventsService.stop()
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', syncResponsiveSidebar)
  window.removeEventListener(TENANT_CONTEXT_CHANGED_EVENT, onTenantContextChanged)
  window.removeEventListener(FEATURES_UPDATED_EVENT, onFeaturesUpdated)
  window.removeEventListener(OPEN_FEEDBACK_MODAL_EVENT, onOpenFeedbackModal)
  window.removeEventListener(INVENTORY_ACL_CHANGED_EVENT, showAccessRefreshFeedback)
  window.removeEventListener(USER_ACL_MEMBERSHIP_CHANGED_EVENT, showAccessRefreshFeedback)
  removeBeforeResolveGuard?.()
  removeAfterEachHook?.()
  removeBeforeResolveGuard = null
  removeAfterEachHook = null
  stopRouteLoading()
  clearAccessRefreshTimer()
  showAccessRefreshBar.value = false
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

const activeKey = computed(() => {
  if (route.name === 'admin-session-audit-detail') return 'admin-session-audit'
  if (typeof route.name === 'string' && route.name.startsWith('admin-reports-')) return 'admin-reports'
  return route.name as string | null
})
watch(isSidebarAutoCollapseContext, (active, previous) => {
  if (!active || active === previous) return
  if (!ui.autoCollapseSidebarOnTerminal) return
  sidebarCollapsed.value = true
}, { immediate: true })

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
  home:     '<path d="m3 10.5 9-7 9 7"/><path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10"/>',
  hosts:    '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
  keys:     '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  dashboard:'<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  users:    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  groups:   '<path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"/>',
  bastions: '<path d="M4 20h16"/><path d="M6 20V9l6-5 6 5v11"/><path d="M10 20v-6h4v6"/><path d="M8.5 11.5h.01"/><path d="M15.5 11.5h.01"/>',
  integrations: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8H6a2 2 0 0 0-2 2v2a7 7 0 0 0 14 0v-2a2 2 0 0 0-2-2z"/>',
  tenants:      '<rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="8" width="7" height="13" rx="1"/><path d="M6 7h1"/><path d="M6 11h1"/><path d="M6 15h1"/><path d="M17 12h1"/><path d="M17 16h1"/>',
  agents:       '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="m7 9 3 3-3 3"/><path d="M12 15h5"/><path d="M8 20h8"/>',
  snippets:     '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  secrets:      '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9.5 12.5 11 14l3.5-4"/>',
  links:        '<path d="M10 13a5 5 0 0 0 7.54.54l2.92-2.92a5 5 0 0 0-7.07-7.07L11.5 5.43"/><path d="M14 11a5 5 0 0 0-7.54-.54L3.54 13.38a5 5 0 1 0 7.07 7.07l1.88-1.88"/>',
  forwardings:  '<path d="M19 7H7"/><path d="m10 4-3 3 3 3"/><path d="M5 17h12"/><path d="m14 14 3 3-3 3"/>',
  localAi: '<path d="M9.5 2A2.5 2.5 0 0 0 7 4.5V6H5a2 2 0 0 0-2 2v5"/><path d="M14.5 2A2.5 2.5 0 0 1 17 4.5V6h2a2 2 0 0 1 2 2v5"/><path d="M8 14h8"/><path d="M10 18h4"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/>',
  reports: '<path d="M3 3v18h18"/><path d="M7 15v3"/><path d="M12 9v9"/><path d="M17 12v6"/><path d="M7 11l4-4 4 3 4-6"/>',
  observability: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/><path d="M5 19h14"/>',
  nativeSshGateway: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/><rect x="12" y="4" width="8" height="8" rx="1"/><path d="M14 8h4"/>',
  sessionCommandPolicies: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/><path d="M17 4l3 3-3 3"/><path d="M14 7h6"/>',
  diagnosticPlaybooks: '<path d="M9 3h6"/><path d="M10 8h8"/><path d="M8 13h10"/><path d="M10 18h8"/><path d="M5 3h.01"/><path d="M5 8h.01"/><path d="M5 13h.01"/><path d="M5 18h.01"/>',
  mcpTokens: '<path d="M14 10V6a4 4 0 1 0-8 0v4"/><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M12 14h.01"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  feedback: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8"/><path d="M8 13h5"/>',
  webhooks: '<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>',
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

const adminItems = computed(() => [
  { key: 'admin-dashboard',    label: t('nav.dashboard'),    icon: icon(ICONS.dashboard) },
  { key: 'admin-users',        label: t('nav.users'),        icon: icon(ICONS.users) },
  { key: 'admin-groups',       label: t('nav.groups'),       icon: icon(ICONS.groups) },
  { key: 'admin-acl',          label: t('nav.acl'),          icon: icon(ICONS.keys) },
  { key: 'admin-diagnostic-playbooks', label: t('nav.diagnosticPlaybooks'), icon: icon(ICONS.diagnosticPlaybooks) },
  ...(mcpLicensed.value ? [
    { key: 'admin-mcp-tokens', label: t('nav.mcpTokens'), icon: icon(ICONS.mcpTokens) },
  ] : []),
  { key: 'admin-bastions',     label: t('nav.bastions'),     icon: icon(ICONS.bastions) },
  { key: 'admin-integrations', label: t('nav.integrations'), icon: icon(ICONS.integrations) },
  { key: 'admin-webhooks',     label: t('nav.webhooks'),     icon: icon(ICONS.webhooks) },
  ...(feedbackLicensed.value ? [
    { key: 'admin-feedback',   label: t('nav.feedbackAdmin'), icon: icon(ICONS.feedback) },
  ] : []),
  { key: 'admin-reports', label: t('nav.reports'), icon: icon(ICONS.reports) },
  { key: 'admin-native-ssh-gateway', label: t('nav.nativeSshGateway'), icon: icon(ICONS.nativeSshGateway) },
  { key: 'admin-session-command-policies', label: t('nav.sessionCommandPolicies'), icon: icon(ICONS.sessionCommandPolicies) },
  { key: 'admin-settings', label: t('nav.tenantSettings'), icon: icon(ICONS.settings) },
])

const platformItems = computed(() => auth.isPlatformAdmin ? [
  { key: 'admin-observability', label: t('nav.observability'), icon: icon(ICONS.observability) },
  { key: 'platform-tenants', label: t('nav.tenants'), icon: icon(ICONS.tenants) },
  { key: 'platform-superadmins', label: t('nav.superadmins'), icon: icon(ICONS.users) },
  { key: 'platform-high-availability', label: t('nav.highAvailability'), icon: icon(ICONS.observability) },
  { key: 'platform-settings', label: t('nav.platformSettings'), icon: icon(ICONS.settings) },
] : [])

const menuOptions = computed<MenuOption[]>(() => {
  const userItems: MenuOption[] = [
    { key: 'dashboard', label: t('nav.home'), icon: icon(ICONS.home) },
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
  ]

  // Colapsado: achatar grupos e remover dividers (eliminam espaço reservado no DOM)
  if (sidebarCollapsed.value) {
    return [
      ...userItems,
      ...(auth.isAdmin ? adminItems.value : []),
      ...(auth.isPlatformAdmin ? platformItems.value : []),
    ]
  }

  // Expandido: com dividers e grupos rotulados
  return [
    ...userItems,
    ...(auth.isAdmin ? [
      { key: 'admin-divider', type: 'divider' as const },
      { key: 'section-admin', type: 'group' as const, label: t('nav.admin'), children: adminItems.value },
    ] : []),
    ...(auth.isPlatformAdmin ? [
      { key: 'platform-divider', type: 'divider' as const },
      { key: 'section-platform', type: 'group' as const, label: t('nav.platform'), children: platformItems.value },
    ] : []),
  ]
})

// ── Navigation ────────────────────────────────────────────────────────────────

function onMenuSelect(key: string) {
  if (pendingMenuKey.value === key || route.name === key) return
  pendingMenuKey.value = key
  void router.push({ name: key }).finally(() => {
    if (pendingMenuKey.value === key) pendingMenuKey.value = null
  })
}

const userOptions = computed(() => [
  { label: t('nav.profile'), key: 'profile' },
  {
    label: ui.isDark ? t('nav.useLightTheme') : t('nav.useDarkTheme'),
    key: 'toggle-theme',
  },
  ...(feedbackLicensed.value ? [{ label: t('nav.feedback'), key: 'feedback' }] : []),
  ...(localAiLicensed.value ? [{ label: t('nav.localAi'), key: 'local-ai' }] : []),
  { key: 'user-divider', type: 'divider' as const },
  { label: t('nav.logout'),  key: 'logout'  },
])

async function onUserAction(key: string) {
  if (key === 'logout') {
    await auth.logout()
    router.push({ name: 'login' })
  } else if (key === 'toggle-theme') {
    ui.toggleTheme()
  } else {
    router.push({ name: key })
  }
}

async function exitTenantManagement() {
  await auth.exitTenantManagement()
  message.success(t('platformTenant.exitSuccess'))
  await router.push({ name: 'platform-tenants' })
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
  <NLayout has-sider class="app-layout">

    <!-- ── Sidebar ────────────────────────────────────────────────────────── -->
    <NLayoutSider
      v-model:collapsed="sidebarCollapsed"
      bordered
      collapse-mode="width"
      :collapsed-width="58"
      :width="210"
      class="app-sidebar"
      content-style="height: 100%;"
    >
      <div class="sidebar-shell">
        <!-- Logo -->
        <div
          class="sidebar-logo"
          :class="{ 'is-collapsed': sidebarCollapsed }"
          @click="sidebarCollapsed ? (sidebarCollapsed = false) : null"
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
          <span v-if="!sidebarCollapsed" class="font-semibold text-[15px] tracking-tight overflow-hidden whitespace-nowrap flex-1 sidebar-brand-text">
            NodeAccess
          </span>
          <button
            v-if="!sidebarCollapsed"
            class="sidebar-collapse-btn"
            @click.stop="sidebarCollapsed = true"
            title="Recolher menu"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
          <!-- Collapsed: expand hint -->
          <svg
            v-else
            class="sidebar-expand-hint"
            viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          >
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </div>

        <!-- Search / Command Palette trigger -->
        <div
          class="sidebar-search"
          :class="{ 'is-collapsed': sidebarCollapsed }"
          @click="showPalette = true"
        >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <span v-if="!sidebarCollapsed" class="sidebar-search-label">{{ $t('nav.search') }}</span>
          <span v-if="!sidebarCollapsed" class="sidebar-shortcut">{{ shortcuts.commandPalette }}</span>
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
          <div class="sidebar-locale">
            <LocaleSwitcher />
          </div>
          <NDropdown :options="userOptions" placement="top-start" @select="onUserAction">
            <div
              class="sidebar-user-trigger"
              :class="{ 'justify-center': sidebarCollapsed }"
              style="height: 52px;"
            >
              <UserAvatar :user="auth.user" :size="28" />
              <div v-if="!sidebarCollapsed" class="overflow-hidden flex-1 min-w-0">
                <div class="sidebar-user-name">
                  {{ auth.user?.name }}
                </div>
                <div class="sidebar-user-role">
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
      content-style="height: 100vh; overflow: auto; background: var(--na-bg);"
    >
      <div v-if="showAppLoadingBar" class="route-loading-bar" aria-hidden="true" />
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
      <div v-if="auth.isManagingTenant" class="px-4 pt-4 pb-1">
        <NAlert type="warning" :show-icon="true">
          <div class="flex items-center justify-between gap-3">
            <span>
              {{ $t('platformTenant.managingDetailed', { tenant: auth.managedTenant?.name ?? auth.user?.tenantId }) }}
            </span>
            <NButton size="small" type="warning" ghost @click="exitTenantManagement">
              {{ $t('platformTenant.exit') }}
            </NButton>
          </div>
        </NAlert>
      </div>
      <NTooltip v-if="showActiveTerminalShortcut" placement="left">
        <template #trigger>
          <button
            type="button"
            class="active-terminal-shortcut"
            :title="activeTerminalShortcutLabel"
            :aria-label="activeTerminalShortcutLabel"
            @click="openActiveTerminals"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>
              <path d="m7 9 3 3-3 3"/>
              <path d="M12 15h5"/>
            </svg>
          </button>
        </template>
        {{ activeTerminalShortcutLabel }}
      </NTooltip>
      <RouterView v-slot="{ Component, route: currentRoute }">
        <Transition name="page" mode="out-in">
          <KeepAlive include="TerminalView">
            <component
              :is="Component"
              :key="currentRoute.name === 'terminal' ? 'terminal' : currentRoute.fullPath"
            />
          </KeepAlive>
        </Transition>
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
          type="primary"
          round
          strong
          size="medium"
          :aria-label="$t('feedback.create.fabHint')"
          @click="showFeedbackModal = true"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            <path d="M8 9h8"/>
            <path d="M8 13h5"/>
          </svg>
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
    style="background: var(--na-surface);"
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
.app-layout {
  height: 100vh;
  background: var(--na-bg);
}

.app-sidebar {
  background: var(--na-sidebar-bg);
  border-right-color: var(--na-border);
}

@media (max-width: 768px) {
  .app-sidebar {
    flex: 0 0 58px !important;
    width: 58px !important;
    min-width: 58px !important;
    max-width: 58px !important;
  }

  .app-sidebar :deep(.n-layout-sider-scroll-container) {
    width: 58px !important;
  }

  .sidebar-logo,
  .sidebar-search {
    justify-content: center;
    padding-left: 0;
    padding-right: 0;
  }

  .sidebar-brand-text,
  .sidebar-collapse-btn,
  .sidebar-search-label,
  .sidebar-shortcut,
  .sidebar-user-name,
  .sidebar-user-role {
    display: none !important;
  }
}

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
  border-bottom: 1px solid var(--na-border);
}

.sidebar-brand-text {
  color: var(--na-text-strong);
}

.sidebar-logo.is-collapsed {
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 3px;
  padding: 0;
  cursor: pointer;
}

.sidebar-logo.is-collapsed:hover {
  background: var(--na-sidebar-hover);
}

.sidebar-expand-hint {
  color: var(--na-text-subtle);
  transition: color 0.15s ease;
}

.sidebar-logo.is-collapsed:hover .sidebar-expand-hint {
  color: #6366f1;
}

.sidebar-collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--na-text-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.sidebar-collapse-btn:hover {
  background: var(--na-sidebar-hover);
  color: var(--na-text-strong);
}

.sidebar-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  margin: 8px 12px 6px;
  padding: 0 10px;
  border: 1px solid var(--na-border);
  border-radius: 8px;
  background: var(--na-sidebar-search-bg);
  color: var(--na-text-subtle);
  cursor: pointer;
  transition: background-color .15s ease, border-color .15s ease;
}

.sidebar-search.is-collapsed {
  justify-content: center;
  margin-inline: 10px;
  padding: 0;
}

.sidebar-search:hover {
  border-color: var(--na-border-strong);
  background: var(--na-surface-soft);
}

.sidebar-search-label {
  flex: 1;
  color: var(--na-text-muted);
  font-size: 12px;
}

.sidebar-shortcut {
  color: var(--na-text-subtle);
  background: var(--na-shortcut-bg);
  border: 1px solid var(--na-border);
  border-radius: 4px;
  padding: 1px 5px;
  font-family: monospace;
  font-size: 10px;
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
  border-top: 1px solid var(--na-border);
  background: var(--na-sidebar-bg);
}

.sidebar-locale {
  display: flex;
  justify-content: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--na-border);
}

.sidebar-user-trigger {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.sidebar-user-trigger:hover {
  background: var(--na-sidebar-hover);
}

.sidebar-user-name {
  color: var(--na-text-strong);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-user-role {
  color: var(--na-text-muted);
  font-size: 11px;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.active-terminal-shortcut {
  position: fixed;
  right: 24px;
  bottom: 78px;
  z-index: 29;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  padding: 0;
  border: 1px solid var(--na-border);
  border-radius: 999px;
  background: var(--na-surface);
  color: var(--na-text-strong);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.16);
  cursor: pointer;
  transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
}

.active-terminal-shortcut:hover {
  border-color: #22c55e;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.2);
  transform: translateY(-1px);
}

.active-terminal-shortcut:focus-visible {
  outline: 2px solid #22c55e;
  outline-offset: 2px;
}

@media (max-width: 640px) {
  .active-terminal-shortcut {
    right: 12px;
    bottom: 72px;
    height: 34px;
    width: 34px;
  }
}
</style>
