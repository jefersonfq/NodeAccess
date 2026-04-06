<script setup lang="ts">
import { h, computed, ref, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  NLayout, NLayoutSider, NLayoutContent, NMenu, NAvatar,
  NDropdown, NText, NTooltip, NAlert, useMessage,
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

const auth   = useAuthStore()
const router = useRouter()
const route  = useRoute()
const { t }  = useI18n()
const { shortcuts } = usePlatform()
useMessage()

// ── Command Palette ───────────────────────────────────────────────────────────

const showPalette = ref(false)
const showRecoveredReloadBanner = ref(false)
const showBackendRecoveredBanner = ref(false)

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault()
    showPalette.value = !showPalette.value
  }
  if (e.key === 'Escape') {
    showPalette.value = false
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  const currentPath = window.location.pathname + window.location.search
  showRecoveredReloadBanner.value = consumeRecoveredStaleReload(currentPath)
  showBackendRecoveredBanner.value = consumeBackendRecoveredFlag()
  if (showRecoveredReloadBanner.value) {
    recordClientUxEvent('CLIENT_UX_STALE_RELOAD_RECOVERED')
  }
  void flushClientUxEvents()
})
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

// ── Active route → highlight no menu ─────────────────────────────────────────

const activeKey = computed(() => route.name as string | null)

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
  agents:       '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><line x1="12" y1="15" x2="12" y2="17"/>',
  snippets:     '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  forwardings:  '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  sessions: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  logs:     '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  sessionAudit: '<path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/><path d="M8 2h8"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
}

// ── Menu options ──────────────────────────────────────────────────────────────

const menuOptions = computed<MenuOption[]>(() => [
  { key: 'dashboard', label: t('nav.home'), icon: icon(ICONS.dashboard) },
  { key: 'hosts',    label: t('nav.hosts'),   icon: icon(ICONS.hosts) },
  ...(auth.user?.canManageHosts || auth.isAdmin ? [
    { key: 'pem-keys', label: t('nav.pemKeys'), icon: icon(ICONS.keys) },
  ] : []),
  { key: 'agents',      label: t('nav.agents'),      icon: icon(ICONS.agents) },
  { key: 'snippets',    label: t('nav.snippets'),    icon: icon(ICONS.snippets) },
  { key: 'forwardings', label: t('nav.forwardings'), icon: icon(ICONS.forwardings) },
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
        { key: 'admin-bastions',     label: t('nav.bastions'),     icon: icon(ICONS.bastions) },
        { key: 'admin-integrations', label: t('nav.integrations'), icon: icon(ICONS.integrations) },
        { key: 'admin-sessions',     label: t('nav.sessions'),     icon: icon(ICONS.sessions) },
        { key: 'admin-logs',         label: t('nav.logs'),         icon: icon(ICONS.logs) },
        { key: 'admin-session-audit', label: t('nav.sessionAudit'), icon: icon(ICONS.sessionAudit) },
        { key: 'admin-settings',     label: t('nav.settings'),     icon: icon(ICONS.settings) },
      ],
    },
  ] : []),
])

// ── Navigation ────────────────────────────────────────────────────────────────

function onMenuSelect(key: string) {
  router.push({ name: key })
}

// ── Avatar color from name ────────────────────────────────────────────────────

const avatarColor = computed(() => {
  const name  = auth.user?.name ?? ''
  const hue   = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360
  return `hsl(${hue}, 55%, 45%)`
})

const userOptions = computed(() => [
  { label: t('nav.profile'), key: 'profile' },
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
</script>

<template>
  <NLayout has-sider style="height: 100vh; background: #101014;">

    <!-- ── Sidebar ────────────────────────────────────────────────────────── -->
    <NLayoutSider
      bordered
      collapse-mode="width"
      :collapsed-width="58"
      :width="210"
      show-trigger="bar"
      style="background: #16161a; border-right-color: #222228;"
    >
      <!-- Logo -->
      <div
        class="flex items-center gap-2.5 px-4 border-b"
        style="height: 56px; border-color: #222228;"
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
        <!-- Wordmark — hidden when collapsed -->
        <span class="font-semibold text-white text-[15px] tracking-tight overflow-hidden whitespace-nowrap" style="transition: opacity .15s">
          NodeAccess
        </span>
      </div>

      <!-- Search / Command Palette trigger -->
      <div
        class="mx-3 mt-3 mb-1 flex items-center gap-2 px-2.5 rounded-lg cursor-pointer transition-colors"
        style="height: 34px; background: #1e1e24; border: 1px solid #2a2a34;"
        @click="showPalette = true"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
        </svg>
        <span style="font-size:12px; color:#555; flex:1;">{{ $t('nav.search') }}</span>
        <span style="font-size:10px; color:#444; font-family:monospace; background:#15151a; border:1px solid #333; border-radius:4px; padding:1px 5px;">{{ shortcuts.commandPalette }}</span>
      </div>

      <!-- Menu -->
      <NMenu
        :value="activeKey"
        :options="menuOptions"
        :collapsed-width="58"
        :collapsed-icon-size="20"
        :indent="18"
        style="padding-top: 6px;"
        @update:value="onMenuSelect"
      />

      <!-- User footer -->
      <div
        class="absolute bottom-0 left-0 right-0 border-t"
        style="border-color: #222228;"
      >
        <!-- Language switcher -->
        <div class="flex justify-center py-1.5" style="border-bottom: 1px solid #1e1e24;">
          <LocaleSwitcher />
        </div>
        <NDropdown :options="userOptions" placement="top-start" @select="onUserAction">
          <div
            class="flex items-center gap-2.5 px-3 cursor-pointer hover:bg-white/5 transition-colors"
            style="height: 52px;"
          >
            <NAvatar
              round
              size="small"
              :style="{ background: avatarColor, color: '#fff', fontSize: '12px', fontWeight: '600', flexShrink: 0 }"
            >
              {{ auth.user?.name.charAt(0).toUpperCase() }}
            </NAvatar>
            <div class="overflow-hidden flex-1 min-w-0">
              <div class="text-[13px] font-medium text-white truncate leading-tight">
                {{ auth.user?.name }}
              </div>
              <div class="text-[11px] text-gray-500 truncate leading-tight">
                {{ auth.isAdmin ? $t('nav.roles.admin') : $t('nav.roles.user') }}
              </div>
            </div>
          </div>
        </NDropdown>
      </div>
    </NLayoutSider>

    <!-- ── Content ────────────────────────────────────────────────────────── -->
    <NLayoutContent
      content-style="height: 100vh; overflow: auto; background: #101014;"
    >
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

  <!-- ── Command Palette ────────────────────────────────────────────────────── -->
  <CommandPalette v-if="showPalette" @close="showPalette = false" />
</template>
