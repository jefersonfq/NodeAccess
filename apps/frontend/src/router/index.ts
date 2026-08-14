import { createRouter, createWebHistory } from 'vue-router'
import { createDiscreteApi } from 'naive-ui'
import { useAuthStore } from '@/stores/auth'
import { i18n } from '@/plugins/i18n'
import { buildAuthRedirectQuery, getSafeRedirectTarget } from '@/services/auth-redirect.service'
import { clearStaleReloadTarget, getStaleReloadTarget, markStaleReloadTarget } from '@/services/stale-reload.service'
import { recordClientUxEvent } from '@/services/client-ux-telemetry.service'
import { recordScreenView } from '@/services/user-productivity-telemetry.service'
import { setLocalAiLastScreen } from '@/services/local-ai-context.service'

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
    {
      path: '/jit-access/:token',
      name: 'jit-access',
      component: () => import('@/views/JitAccessView.vue'),
    },
    {
      path: '/integrations/jira/oauth/callback',
      name: 'jira-oauth-callback',
      component: () => import('@/views/integrations/JiraOAuthCallbackView.vue'),
    },
    {
      path: '/terminal/popout',
      name: 'terminal-popout',
      component: () => import('@/views/TerminalPopoutView.vue'),
      meta: { requiresAuth: true },
    },
    // Auth (guest)
    {
      path: '/auth',
      component: () => import('@/layouts/AuthLayout.vue'),
      children: [
        { path: 'login',        name: 'login',        component: () => import('@/views/auth/LoginView.vue') },
        { path: 'setup-totp',   name: 'setup-totp',   component: () => import('@/views/auth/SetupTotpView.vue') },
        { path: 'verify-totp',       name: 'verify-totp',       component: () => import('@/views/auth/VerifyTotpView.vue') },
        { path: 'verify-email-otp',  name: 'verify-email-otp',  component: () => import('@/views/auth/VerifyEmailOtpView.vue') },
        { path: 'oidc/callback', name: 'oidc-callback', component: () => import('@/views/auth/OidcCallbackView.vue') },
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
        { path: 'access-map', redirect: { name: 'admin-reports-sessions' } },
        { path: 'hosts/:hostId/dashboard', name: 'host-dashboard', component: () => import('@/views/HostDashboardView.vue') },
        { path: 'my-activity', name: 'my-activity', component: () => import('@/views/UserActivityView.vue') },
        { path: 'diagnostic-runs/:runId', name: 'diagnostic-run-detail', component: () => import('@/views/DiagnosticRunDetailView.vue') },
        { path: 'ai-ssh-action-runs/:runId', name: 'ai-ssh-action-run-detail', component: () => import('@/views/AiSshActionRunDetailView.vue') },
        { path: 'pem-keys', name: 'pem-keys', component: () => import('@/views/PemKeysView.vue') },
        { path: 'agents',      name: 'agents',      component: () => import('@/views/AgentsView.vue') },
        { path: 'snippets',    name: 'snippets',    component: () => import('@/views/SnippetsView.vue') },
        { path: 'secrets',     name: 'secrets',     component: () => import('@/views/SecretsView.vue') },
        { path: 'links',       name: 'links',       component: () => import('@/views/LinksView.vue') },
        { path: 'forwardings', name: 'forwardings', component: () => import('@/views/ForwardingsView.vue') },
        { path: 'feedback',    name: 'feedback',    component: () => import('@/views/FeedbackView.vue') },
        { path: 'assistant',   name: 'local-ai',    component: () => import('@/views/LocalAiView.vue') },
        { path: 'terminal',          name: 'terminal', component: () => import('@/views/TerminalView.vue') },
        { path: 'terminal/shared/:id', name: 'shared-session-view', component: () => import('@/views/SharedSessionView.vue') },
        { path: 'graphical/:hostId', name: 'graphical-session', component: () => import('@/views/GraphicalSessionView.vue') },
        { path: 'files/:hostId',     name: 'files',    component: () => import('@/views/FileManagerView.vue') },
        { path: 'profile',           name: 'profile',  component: () => import('@/views/ProfileView.vue') },
        { path: 'platform/tenants',  name: 'platform-tenants', component: () => import('@/views/admin/TenantsView.vue'), meta: { requiresPlatformAdmin: true } },
        { path: 'platform/superadmins', name: 'platform-superadmins', component: () => import('@/views/admin/SuperadminsView.vue'), meta: { requiresPlatformAdmin: true } },
        { path: 'platform/high-availability', name: 'platform-high-availability', component: () => import('@/views/admin/HighAvailabilityView.vue'), meta: { requiresPlatformAdmin: true } },

        // Admin
        {
          path: 'admin',
          meta: { requiresAdmin: true },
          children: [
            { path: 'dashboard', name: 'admin-dashboard', component: () => import('@/views/admin/DashboardView.vue') },
            { path: 'observability', name: 'admin-observability', component: () => import('@/views/admin/ObservabilityView.vue') },
            { path: 'dashboard/users/:userId', name: 'admin-dashboard-user', component: () => import('@/views/admin/DashboardUserView.vue') },
            { path: 'logs',      name: 'admin-logs',     component: () => import('@/views/admin/LogsView.vue') },
            { path: 'sftp-audit', name: 'admin-sftp-audit', component: () => import('@/views/admin/SftpAuditView.vue') },
            { path: 'reports', name: 'admin-reports', component: () => import('@/views/admin/reports/ReportsIndexView.vue') },
            { path: 'reports/snippets', name: 'admin-reports-snippets', component: () => import('@/views/admin/reports/SnippetUsageReportView.vue') },
            { path: 'reports/sessions', name: 'admin-reports-sessions', component: () => import('@/views/admin/SessionsView.vue') },
            { path: 'reports/ssh-tunnels', name: 'admin-reports-ssh-tunnels', component: () => import('@/views/admin/reports/SshTunnelReportView.vue') },
            { path: 'reports/adoption', name: 'admin-reports-adoption', component: () => import('@/views/admin/reports/UserAdoptionReportView.vue') },
            { path: 'reports/client-ux', name: 'admin-reports-client-ux', component: () => import('@/views/admin/reports/ClientUxReportView.vue') },
            { path: 'reports/host-keys', name: 'admin-reports-host-keys', component: () => import('@/views/admin/reports/HostKeyReportView.vue') },
            { path: 'session-audit', name: 'admin-session-audit', component: () => import('@/views/admin/SessionAuditView.vue') },
            { path: 'session-audit/:sessionId', name: 'admin-session-audit-detail', component: () => import('@/views/admin/SessionAuditDetailView.vue') },
            { path: 'native-ssh-gateway', name: 'admin-native-ssh-gateway', component: () => import('@/views/admin/NativeSshGatewayView.vue') },
            { path: 'session-command-policies', name: 'admin-session-command-policies', component: () => import('@/views/admin/SessionCommandPoliciesView.vue') },
            { path: 'users',    name: 'admin-users',     component: () => import('@/views/admin/UsersView.vue') },
            { path: 'groups',   name: 'admin-groups',    component: () => import('@/views/admin/GroupsView.vue') },
            { path: 'acl',      name: 'admin-acl',       component: () => import('@/views/admin/AclPermissionsView.vue') },
            { path: 'diagnostic-playbooks', name: 'admin-diagnostic-playbooks', component: () => import('@/views/admin/DiagnosticPlaybooksView.vue') },
            { path: 'mcp-tokens', name: 'admin-mcp-tokens', component: () => import('@/views/admin/McpTokensView.vue') },
            { path: 'bastions',      name: 'admin-bastions',      component: () => import('@/views/admin/BastionsView.vue') },
            { path: 'integrations',  name: 'admin-integrations',  component: () => import('@/views/admin/IntegrationsView.vue') },
            { path: 'feedback', name: 'admin-feedback', component: () => import('@/views/admin/FeedbackAdminView.vue') },
            { path: 'settings', name: 'admin-settings',  component: () => import('@/views/admin/SettingsView.vue') },
            { path: 'settings/email-config', name: 'admin-email-config', redirect: { name: 'admin-settings', query: { section: 'email' } } },
            { path: 'sessions', name: 'admin-sessions', redirect: (to) => ({ name: 'admin-reports-sessions', query: to.query }) },
            { path: 'webhooks',     name: 'admin-webhooks',      component: () => import('@/views/admin/WebhooksView.vue') },
            { path: 'email-config', redirect: (to) => ({ name: 'admin-email-config', query: to.query }) },
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

  if (to.meta.requiresLiveSessionsViewer && !auth.isAdmin && auth.user?.canViewLiveSessions !== true) {
    return { name: 'hosts' }
  }

  // Rota platform admin sem permissão → hosts
  if (to.meta.requiresPlatformAdmin && !auth.isPlatformAdmin) {
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
  if (typeof to.name === 'string' && to.name !== 'local-ai') {
    setLocalAiLastScreen(to.name, to.fullPath)
  }
  void recordScreenView(typeof to.name === 'string' ? to.name : null)
})

export default router
