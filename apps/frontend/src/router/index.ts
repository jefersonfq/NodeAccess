import { createRouter, createWebHistory } from 'vue-router'
import { createDiscreteApi } from 'naive-ui'
import { useAuthStore } from '@/stores/auth'
import { i18n } from '@/plugins/i18n'
import { buildAuthRedirectQuery, getSafeRedirectTarget } from '@/services/auth-redirect.service'
import { clearStaleReloadTarget, getStaleReloadTarget, markStaleReloadTarget } from '@/services/stale-reload.service'
import { recordClientUxEvent } from '@/services/client-ux-telemetry.service'
import { recordScreenView } from '@/services/user-productivity-telemetry.service'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/shared-sessions/:token',
      name: 'shared-session-entry',
      component: () => import('@/views/SharedSessionEntryView.vue'),
    },
    {
      path: '/host-links/:token',
      name: 'host-link-entry',
      component: () => import('@/views/HostLinkEntryView.vue'),
    },
    // Auth (guest)
    {
      path: '/auth',
      component: () => import('@/layouts/AuthLayout.vue'),
      children: [
        { path: 'login',        name: 'login',        component: () => import('@/views/auth/LoginView.vue') },
        { path: 'setup-totp',   name: 'setup-totp',   component: () => import('@/views/auth/SetupTotpView.vue') },
        { path: 'verify-totp',  name: 'verify-totp',  component: () => import('@/views/auth/VerifyTotpView.vue') },
      ],
    },

    // App (autenticado)
    {
      path: '/',
      component: () => import('@/layouts/AppLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '',       redirect: '/dashboard' },
        { path: 'dashboard', name: 'dashboard', component: () => import('@/views/DashboardView.vue') },
        { path: 'hosts',    name: 'hosts',    component: () => import('@/views/HostsView.vue') },
        { path: 'pem-keys', name: 'pem-keys', component: () => import('@/views/PemKeysView.vue') },
        { path: 'agents',      name: 'agents',      component: () => import('@/views/AgentsView.vue') },
        { path: 'snippets',    name: 'snippets',    component: () => import('@/views/SnippetsView.vue') },
        { path: 'forwardings', name: 'forwardings', component: () => import('@/views/ForwardingsView.vue') },
        { path: 'terminal',          name: 'terminal', component: () => import('@/views/TerminalView.vue') },
        { path: 'terminal/shared/:id', name: 'shared-session-view', component: () => import('@/views/SharedSessionView.vue') },
        { path: 'files/:hostId',     name: 'files',    component: () => import('@/views/FileManagerView.vue') },
        { path: 'profile',           name: 'profile',  component: () => import('@/views/ProfileView.vue') },

        // Admin
        {
          path: 'admin',
          meta: { requiresAdmin: true },
          children: [
            { path: 'dashboard', name: 'admin-dashboard', component: () => import('@/views/admin/DashboardView.vue') },
            { path: 'dashboard/users/:userId', name: 'admin-dashboard-user', component: () => import('@/views/admin/DashboardUserView.vue') },
            { path: 'logs',      name: 'admin-logs',     component: () => import('@/views/admin/LogsView.vue') },
            { path: 'session-audit', name: 'admin-session-audit', component: () => import('@/views/admin/SessionAuditView.vue') },
            { path: 'session-audit/:sessionId', name: 'admin-session-audit-detail', component: () => import('@/views/admin/SessionAuditDetailView.vue') },
            { path: 'users',    name: 'admin-users',     component: () => import('@/views/admin/UsersView.vue') },
            { path: 'groups',   name: 'admin-groups',    component: () => import('@/views/admin/GroupsView.vue') },
            { path: 'bastions',      name: 'admin-bastions',      component: () => import('@/views/admin/BastionsView.vue') },
            { path: 'integrations',  name: 'admin-integrations',  component: () => import('@/views/admin/IntegrationsView.vue') },
            { path: 'settings', name: 'admin-settings',  component: () => import('@/views/admin/SettingsView.vue') },
            { path: 'sessions', name: 'admin-sessions',  component: () => import('@/views/admin/SessionsView.vue') },
          ],
        },
      ],
    },

    // Fallback
    { path: '/:pathMatch(.*)*', redirect: '/hosts' },
  ],
})

const { message } = createDiscreteApi(['message'])

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

router.beforeEach((to) => {
  const auth = useAuthStore()

  // Rota protegida sem token → login
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login', query: buildAuthRedirectQuery(to) }
  }

  // Rota admin sem permissão → hosts
  if (to.meta.requiresAdmin && !auth.isAdmin) {
    return { name: 'hosts' }
  }

  // Usuário já autenticado tentando acessar login
  if (to.path.startsWith('/auth') && auth.isAuthenticated) {
    return getSafeRedirectTarget(to.query)
  }

  // Forçar troca de senha
  if (auth.isAuthenticated && auth.user?.forcePasswordChange && to.name !== 'profile') {
    return { name: 'profile' }
  }
})

router.onError((error) => {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const isChunkError =
    text.includes('ChunkLoadError')
    || text.includes('Failed to fetch dynamically imported module')
    || text.includes('Importing a module script failed')

  if (!isChunkError) return

  const currentPath = window.location.pathname + window.location.search
  const lastReloadTarget = getStaleReloadTarget()

  if (lastReloadTarget === currentPath) {
    clearStaleReloadTarget()
    recordClientUxEvent('CLIENT_UX_STALE_RELOAD_FAILED')
    message.error(i18n.global.t('auth.appReloadFailed'))
    return
  }

  markStaleReloadTarget(currentPath)
  message.warning(i18n.global.t('auth.appReloading'))
  window.setTimeout(() => {
    window.location.reload()
  }, 150)
})

router.afterEach((to) => {
  const auth = useAuthStore()
  if (!auth.isAuthenticated) return
  void recordScreenView(typeof to.name === 'string' ? to.name : null)
})

export default router
