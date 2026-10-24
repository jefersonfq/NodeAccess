import { createRouter, createWebHistory, type LocationQuery } from 'vue-router'
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
    { path: '/trial', name: 'trial', component: (): Promise<typeof import('@/views/TrialView.vue')> => import('@/views/TrialView.vue') },
    {
      path: '/shared-sessions/:token',
      name: 'shared-session-entry',
      component: (): Promise<typeof import('@/views/SharedSessionEntryView.vue')> => import('@/views/SharedSessionEntryView.vue'),
    },
    {
      path: '/host-links/:token',
      name: 'host-link-entry',
      component: (): Promise<typeof import('@/views/HostLinkEntryView.vue')> => import('@/views/HostLinkEntryView.vue'),
    },
    {
      path: '/jit-access/:token',
      name: 'jit-access',
      component: (): Promise<typeof import('@/views/JitAccessView.vue')> => import('@/views/JitAccessView.vue'),
    },
    {
      path: '/integrations/jira/oauth/callback',
      name: 'jira-oauth-callback',
      component: (): Promise<typeof import('@/views/integrations/JiraOAuthCallbackView.vue')> => import('@/views/integrations/JiraOAuthCallbackView.vue'),
    },
    {
      path: '/terminal/popout',
      name: 'terminal-popout',
      component: (): Promise<typeof import('@/views/TerminalPopoutView.vue')> => import('@/views/TerminalPopoutView.vue'),
      meta: { requiresAuth: true },
    },
    // Auth (guest)
    {
      path: '/auth',
      component: (): Promise<typeof import('@/layouts/AuthLayout.vue')> => import('@/layouts/AuthLayout.vue'),
      children: [
        { path: 'login',        name: 'login',        component: (): Promise<typeof import('@/views/auth/LoginView.vue')> => import('@/views/auth/LoginView.vue') },
        { path: 'setup-totp',   name: 'setup-totp',   component: (): Promise<typeof import('@/views/auth/SetupTotpView.vue')> => import('@/views/auth/SetupTotpView.vue') },
        { path: 'verify-totp',       name: 'verify-totp',       component: (): Promise<typeof import('@/views/auth/VerifyTotpView.vue')> => import('@/views/auth/VerifyTotpView.vue') },
        { path: 'verify-email-otp',  name: 'verify-email-otp',  component: (): Promise<typeof import('@/views/auth/VerifyEmailOtpView.vue')> => import('@/views/auth/VerifyEmailOtpView.vue') },
        { path: 'oidc/callback', name: 'oidc-callback', component: (): Promise<typeof import('@/views/auth/OidcCallbackView.vue')> => import('@/views/auth/OidcCallbackView.vue') },
      ],
    },

    // App (autenticado)
    {
      path: '/',
      component: (): Promise<typeof import('@/layouts/AppLayout.vue')> => import('@/layouts/AppLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '',       redirect: '/dashboard' },
        { path: 'trial/audits', name: 'trial-audits', component: (): Promise<typeof import('@/views/TrialAuditView.vue')> => import('@/views/TrialAuditView.vue') },
        { path: 'dashboard', name: 'dashboard', component: (): Promise<typeof import('@/views/DashboardView.vue')> => import('@/views/DashboardView.vue') },
        { path: 'session-supervision', name: 'session-supervision', component: (): Promise<typeof import('@/views/SessionSupervisionView.vue')> => import('@/views/SessionSupervisionView.vue') },
        { path: 'hosts',    name: 'hosts',    component: (): Promise<typeof import('@/views/HostsView.vue')> => import('@/views/HostsView.vue') },
        { path: 'access-map', redirect: { name: 'admin-reports-sessions' } },
        { path: 'hosts/:hostId/dashboard', name: 'host-dashboard', component: (): Promise<typeof import('@/views/HostDashboardView.vue')> => import('@/views/HostDashboardView.vue') },
        { path: 'my-activity', name: 'my-activity', component: (): Promise<typeof import('@/views/UserActivityView.vue')> => import('@/views/UserActivityView.vue') },
        { path: 'diagnostic-runs/:runId', name: 'diagnostic-run-detail', component: (): Promise<typeof import('@/views/DiagnosticRunDetailView.vue')> => import('@/views/DiagnosticRunDetailView.vue') },
        { path: 'ai-ssh-action-runs/:runId', name: 'ai-ssh-action-run-detail', component: (): Promise<typeof import('@/views/AiSshActionRunDetailView.vue')> => import('@/views/AiSshActionRunDetailView.vue') },
        { path: 'pem-keys', name: 'pem-keys', component: (): Promise<typeof import('@/views/PemKeysView.vue')> => import('@/views/PemKeysView.vue') },
        { path: 'agents',      name: 'agents',      component: (): Promise<typeof import('@/views/AgentsView.vue')> => import('@/views/AgentsView.vue') },
        { path: 'snippets',    name: 'snippets',    component: (): Promise<typeof import('@/views/SnippetsView.vue')> => import('@/views/SnippetsView.vue') },
        { path: 'secrets',     name: 'secrets',     component: (): Promise<typeof import('@/views/SecretsView.vue')> => import('@/views/SecretsView.vue') },
        { path: 'links',       name: 'links',       component: (): Promise<typeof import('@/views/LinksView.vue')> => import('@/views/LinksView.vue') },
        { path: 'forwardings', name: 'forwardings', component: (): Promise<typeof import('@/views/ForwardingsView.vue')> => import('@/views/ForwardingsView.vue') },
        { path: 'feedback',    name: 'feedback',    component: (): Promise<typeof import('@/views/FeedbackView.vue')> => import('@/views/FeedbackView.vue') },
        { path: 'assistant',   name: 'local-ai',    component: (): Promise<typeof import('@/views/LocalAiView.vue')> => import('@/views/LocalAiView.vue') },
        { path: 'terminal',          name: 'terminal', component: (): Promise<typeof import('@/views/TerminalView.vue')> => import('@/views/TerminalView.vue') },
        { path: 'terminal/shared/:id', name: 'shared-session-view', component: (): Promise<typeof import('@/views/SharedSessionView.vue')> => import('@/views/SharedSessionView.vue') },
        { path: 'graphical/:hostId', name: 'graphical-session', component: (): Promise<typeof import('@/views/GraphicalSessionView.vue')> => import('@/views/GraphicalSessionView.vue') },
        { path: 'files/:hostId',     name: 'files',    component: (): Promise<typeof import('@/views/FileManagerView.vue')> => import('@/views/FileManagerView.vue') },
        { path: 'manual/:chapter?', name: 'manual', component: (): Promise<typeof import('@/views/ManualView.vue')> => import('@/views/ManualView.vue') },
        { path: 'profile',           name: 'profile',  component: (): Promise<typeof import('@/views/ProfileView.vue')> => import('@/views/ProfileView.vue') },
        { path: 'profile/terminal-highlights', name: 'terminal-highlights', component: (): Promise<typeof import('@/views/TerminalHighlightsView.vue')> => import('@/views/TerminalHighlightsView.vue') },
        { path: 'platform/trials', name: 'platform-trials', component: (): Promise<typeof import('@/views/admin/TrialAdminView.vue')> => import('@/views/admin/TrialAdminView.vue'), meta: { requiresPlatformAdmin: true } },
        { path: 'platform/tenants',  name: 'platform-tenants', component: (): Promise<typeof import('@/views/admin/TenantsView.vue')> => import('@/views/admin/TenantsView.vue'), meta: { requiresPlatformAdmin: true } },
        { path: 'platform/superadmins', name: 'platform-superadmins', component: (): Promise<typeof import('@/views/admin/SuperadminsView.vue')> => import('@/views/admin/SuperadminsView.vue'), meta: { requiresPlatformAdmin: true } },
        { path: 'platform/high-availability', name: 'platform-high-availability', component: (): Promise<typeof import('@/views/admin/HighAvailabilityView.vue')> => import('@/views/admin/HighAvailabilityView.vue'), meta: { requiresPlatformAdmin: true } },
        { path: 'platform/settings', name: 'platform-settings', component: (): Promise<typeof import('@/views/admin/SettingsView.vue')> => import('@/views/admin/SettingsView.vue'), meta: { requiresPlatformAdmin: true } },

        // Admin
        {
          path: 'admin',
          meta: { requiresAdmin: true },
          children: [
            { path: 'dashboard', name: 'admin-dashboard', component: (): Promise<typeof import('@/views/admin/DashboardView.vue')> => import('@/views/admin/DashboardView.vue') },
            { path: 'ai-automation', name: 'admin-ai-automation', component: (): Promise<typeof import('@/views/admin/AiAutomationHubView.vue')> => import('@/views/admin/AiAutomationHubView.vue') },
            { path: 'tls', name: 'platform-tls', component: (): Promise<typeof import('@/views/admin/TlsView.vue')> => import('@/views/admin/TlsView.vue'), meta: { requiresPlatformAdmin: true } },
            { path: 'observability', name: 'admin-observability', component: (): Promise<typeof import('@/views/admin/ObservabilityView.vue')> => import('@/views/admin/ObservabilityView.vue'), meta: { requiresPlatformAdmin: true } },
            { path: 'dashboard/users/:userId', name: 'admin-dashboard-user', component: (): Promise<typeof import('@/views/admin/DashboardUserView.vue')> => import('@/views/admin/DashboardUserView.vue') },
            { path: 'logs',      name: 'admin-logs',     component: (): Promise<typeof import('@/views/admin/LogsView.vue')> => import('@/views/admin/LogsView.vue') },
            { path: 'sftp-audit', name: 'admin-sftp-audit', component: (): Promise<typeof import('@/views/admin/SftpAuditView.vue')> => import('@/views/admin/SftpAuditView.vue') },
            { path: 'reports', name: 'admin-reports', component: (): Promise<typeof import('@/views/admin/reports/ReportsIndexView.vue')> => import('@/views/admin/reports/ReportsIndexView.vue') },
            { path: 'reports/snippets', name: 'admin-reports-snippets', component: (): Promise<typeof import('@/views/admin/reports/SnippetUsageReportView.vue')> => import('@/views/admin/reports/SnippetUsageReportView.vue') },
            { path: 'reports/sessions', name: 'admin-reports-sessions', component: (): Promise<typeof import('@/views/admin/SessionsView.vue')> => import('@/views/admin/SessionsView.vue') },
            { path: 'reports/ssh-tunnels', name: 'admin-reports-ssh-tunnels', component: (): Promise<typeof import('@/views/admin/reports/SshTunnelReportView.vue')> => import('@/views/admin/reports/SshTunnelReportView.vue') },
            { path: 'reports/adoption', name: 'admin-reports-adoption', component: (): Promise<typeof import('@/views/admin/reports/UserAdoptionReportView.vue')> => import('@/views/admin/reports/UserAdoptionReportView.vue') },
            { path: 'reports/client-ux', name: 'admin-reports-client-ux', component: (): Promise<typeof import('@/views/admin/reports/ClientUxReportView.vue')> => import('@/views/admin/reports/ClientUxReportView.vue') },
            { path: 'reports/host-keys', name: 'admin-reports-host-keys', component: (): Promise<typeof import('@/views/admin/reports/HostKeyReportView.vue')> => import('@/views/admin/reports/HostKeyReportView.vue') },
            { path: 'session-audit', name: 'admin-session-audit', component: (): Promise<typeof import('@/views/admin/SessionAuditView.vue')> => import('@/views/admin/SessionAuditView.vue') },
            { path: 'session-audit/:sessionId', name: 'admin-session-audit-detail', component: (): Promise<typeof import('@/views/admin/SessionAuditDetailView.vue')> => import('@/views/admin/SessionAuditDetailView.vue') },
            { path: 'ai-investigations', name: 'admin-ai-investigations', component: (): Promise<typeof import('@/views/admin/AiInvestigationsView.vue')> => import('@/views/admin/AiInvestigationsView.vue') },
            { path: 'ai-investigations/:id', name: 'admin-ai-investigation-detail', component: (): Promise<typeof import('@/views/admin/AiInvestigationDetailView.vue')> => import('@/views/admin/AiInvestigationDetailView.vue') },
            { path: 'native-ssh-gateway', name: 'admin-native-ssh-gateway', component: (): Promise<typeof import('@/views/admin/NativeSshGatewayView.vue')> => import('@/views/admin/NativeSshGatewayView.vue') },
            { path: 'session-command-policies', name: 'admin-session-command-policies', component: (): Promise<typeof import('@/views/admin/SessionCommandPoliciesView.vue')> => import('@/views/admin/SessionCommandPoliciesView.vue') },
            { path: 'terminal-highlights', name: 'admin-terminal-highlights', component: (): Promise<typeof import('@/views/admin/TerminalHighlightsAdminView.vue')> => import('@/views/admin/TerminalHighlightsAdminView.vue') },
            { path: 'users',    name: 'admin-users',     component: (): Promise<typeof import('@/views/admin/UsersView.vue')> => import('@/views/admin/UsersView.vue') },
            { path: 'groups',   name: 'admin-groups',    component: (): Promise<typeof import('@/views/admin/GroupsView.vue')> => import('@/views/admin/GroupsView.vue') },
            { path: 'acl',      name: 'admin-acl',       component: (): Promise<typeof import('@/views/admin/AclPermissionsView.vue')> => import('@/views/admin/AclPermissionsView.vue') },
            { path: 'diagnostic-playbooks', name: 'admin-diagnostic-playbooks', component: (): Promise<typeof import('@/views/admin/DiagnosticPlaybooksView.vue')> => import('@/views/admin/DiagnosticPlaybooksView.vue') },
            { path: 'mcp-tokens', name: 'admin-mcp-tokens', component: (): Promise<typeof import('@/views/admin/McpTokensView.vue')> => import('@/views/admin/McpTokensView.vue') },
            { path: 'bastions',      name: 'admin-bastions',      component: (): Promise<typeof import('@/views/admin/BastionsView.vue')> => import('@/views/admin/BastionsView.vue') },
            { path: 'integrations',  name: 'admin-integrations',  component: (): Promise<typeof import('@/views/admin/IntegrationsView.vue')> => import('@/views/admin/IntegrationsView.vue') },
            { path: 'feedback', name: 'admin-feedback', component: (): Promise<typeof import('@/views/admin/FeedbackAdminView.vue')> => import('@/views/admin/FeedbackAdminView.vue') },
            { path: 'settings', name: 'admin-settings',  component: (): Promise<typeof import('@/views/admin/SettingsView.vue')> => import('@/views/admin/SettingsView.vue') },
            { path: 'settings/email-config', name: 'admin-email-config', redirect: { name: 'admin-settings', query: { section: 'email' } } },
            { path: 'sessions', name: 'admin-sessions', redirect: (to): { name: string; query: LocationQuery; } => ({ name: 'admin-reports-sessions', query: to.query }) },
            { path: 'webhooks',     name: 'admin-webhooks',      component: (): Promise<typeof import('@/views/admin/WebhooksView.vue')> => import('@/views/admin/WebhooksView.vue') },
            { path: 'email-config', redirect: (to): { name: string; query: LocationQuery; } => ({ name: 'admin-email-config', query: to.query }) },
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

  // Public trial onboarding does not redirect or mutate an existing normal session.
  if (to.name === 'trial') return

  // Rota protegida sem token → login
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login', query: buildAuthRedirectQuery(to) }
  }

  if (to.name === 'admin-settings' && to.query.section === 'network-access') {
    return { name: 'admin-integrations', query: to.query, hash: to.hash, replace: true }
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
  // Never record verification capabilities from the public onboarding URL.
  if (to.name === 'trial') return
  const auth = useAuthStore()
  if (!auth.isAuthenticated) return
  if (typeof to.name === 'string' && to.name !== 'local-ai') {
    setLocalAiLastScreen(to.name, to.fullPath)
  }
  void recordScreenView(typeof to.name === 'string' ? to.name : null)
})

export default router
