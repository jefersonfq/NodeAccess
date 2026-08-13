import 'dotenv/config' // deve ser o primeiro import em dev local
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import type { Redis } from 'ioredis'
import { parse as parseQueryString } from 'node:querystring'
import swagger    from '@fastify/swagger'
import swaggerUi  from '@fastify/swagger-ui'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { TestConnectionResultSchema, TestConnectionSchema } from '@nodeaccess/shared'
import type { TestConnectionDto } from '@nodeaccess/shared'
import { env } from './config/env.js'
import { logger, sanitizeLogUrl } from './config/logger.js'
import { prisma } from './config/database.js'
import { redis } from './config/redis.js'
import { AppError } from './shared/errors.js'
import { requireAuth } from './shared/guards.js'
import { metrics } from './shared/metrics.js'
import { getClientIpInfo } from './shared/request-ip.js'
import { registerHealthRoutes } from './shared/health.js'
import { GatewayDrainState, waitForGatewayDrain } from './shared/gateway-drain.js'
import { container } from './container.js'
import { authRoutes }     from './modules/auth/auth.routes.js'
import { userRoutes }     from './modules/users/user.routes.js'
import { groupRoutes }    from './modules/groups/group.routes.js'
import { hostRoutes }     from './modules/hosts/host.routes.js'
import { sshRoutes }      from './modules/ssh/ssh.routes.js'
import { graphicalRoutes } from './modules/graphical/graphical.routes.js'
import { settingsRoutes }  from './modules/settings/settings.routes.js'
import { sessionsRoutes }  from './modules/sessions/sessions.routes.js'
import { featuresRoutes }  from './modules/features/features.routes.js'
import { folderRoutes }    from './modules/folders/folder.routes.js'
import { inventoryRoutes } from './modules/inventory/inventory.routes.js'
import { inventoryAclRoutes } from './modules/inventory/inventory-acl.routes.js'
import { hostImportRoutes } from './modules/host-imports/host-import.routes.js'
import { bastionRoutes }   from './modules/bastions/bastion.routes.js'
import { pemKeyRoutes }         from './modules/pem-keys/pem-key.routes.js'
import { integrationRoutes }    from './modules/integrations/integration.routes.js'
import { logRoutes }            from './modules/logs/log.routes.js'
import { dashboardRoutes }      from './modules/dashboard/dashboard.routes.js'
import { reportsRoutes }        from './modules/reports/reports.routes.js'
import { hostDashboardRoutes }  from './modules/host-dashboard/host-dashboard.routes.js'
import { diagnosticPlaybookAdminRoutes, diagnosticPlaybookRoutes } from './modules/diagnostic-playbooks/diagnostic-playbook.routes.js'
import { diagnosticRunHostRoutes, diagnosticRunRoutes } from './modules/diagnostic-playbooks/diagnostic-run.routes.js'
import { tagRoutes }            from './modules/tags/tag.routes.js'
import { hostLinkRoutes }       from './modules/host-links/host-link.routes.js'
import { sharedSessionRoutes }  from './modules/shared-sessions/shared-session.routes.js'
import { userDashboardRoutes }  from './modules/user-dashboard/user-dashboard.routes.js'
import { sftpRoutes }           from './modules/sftp/sftp.routes.js'
import { snippetRoutes }        from './modules/snippets/snippet.routes.js'
import { snippetGroupRoutes }   from './modules/snippets/snippet-group.routes.js'
import { tunnelRoutes }         from './modules/tunnels/tunnel.routes.js'
import { agentRoutes }          from './modules/agents/agent.routes.js'
import { portForwardingRoutes } from './modules/port-forwardings/port-forwarding.routes.js'
import { webAccessRoutes }      from './modules/web-access/web-access.routes.js'
import { sessionAuditRoutes }   from './modules/session-audit/session-audit.routes.js'
import { sessionAuditPolicyRoutes } from './modules/session-audit/session-audit-policy.routes.js'
import { tenantAuthPolicyRoutes } from './modules/auth/tenant-auth-policy.routes.js'
import { oidcConfigRoutes } from './modules/auth/oidc-config.routes.js'
import { oidcAuthRoutes } from './modules/auth/oidc-auth.routes.js'
import { externalIdentityAdminRoutes } from './modules/auth/external-identity-admin.routes.js'
import { oidcGroupMappingRoutes } from './modules/auth/oidc-group-mapping.routes.js'
import { scimAdminRoutes, scimRoutes } from './modules/auth/scim.routes.js'
import { sharedSessionWsRoutes } from './modules/shared-sessions/shared-session.ws-routes.js'
import { appEventRoutes } from './modules/app-events/app-event.routes.js'
import { secretRoutes } from './modules/secrets/secret.routes.js'
import { tenantRoutes } from './modules/tenants/tenant.routes.js'
import { platformAdminRoutes } from './modules/platform-admins/platform-admin.routes.js'
import { feedbackRoutes } from './modules/feedback/feedback.routes.js'
import { localAiRoutes } from './modules/local-ai/local-ai.routes.js'
import { mcpRoutes } from './modules/mcp/mcp.routes.js'
import { mcpTokenAdminRoutes } from './modules/mcp/mcp-token.routes.js'
import { aiSshActionHostRoutes, aiSshActionRoutes } from './modules/ai-ssh-actions/ai-ssh-action.routes.js'
import { aiSshActionCommandPolicyRoutes } from './modules/ai-ssh-actions/ai-ssh-action-command-policy.routes.js'
import { sessionCommandPolicyRoutes } from './modules/session-command-policy/session-command-policy.routes.js'
import { webhookRoutes } from './modules/webhooks/webhook.routes.js'
import { inboundWebhookRoutes } from './modules/inbound-webhooks/inbound-webhook.routes.js'
import { emailConfigRoutes } from './modules/email/email-config.routes.js'
import { nativeSshGatewayRoutes } from './modules/native-ssh-gateway/native-ssh-gateway.routes.js'
import { observabilityRoutes } from './modules/observability/observability.routes.js'
import { haRoutes } from './modules/ha/ha.routes.js'

// ---------------------------------------------------------------------------
// API REST (porta 3000)
// ---------------------------------------------------------------------------

const swaggerDocsMetricsCss = `
.nodeaccess-docs-metrics {
  max-width: 1460px;
  margin: 8px auto 24px;
  padding: 0 20px;
  font-family: sans-serif;
}

.nodeaccess-docs-metrics__panel {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid #e5e9f0;
  border-radius: 8px;
  background: #fbfcfe;
}

.nodeaccess-docs-metrics__header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px 16px;
}

.nodeaccess-docs-metrics__title {
  margin: 0;
  color: #334155;
  font-size: 15px;
  font-weight: 700;
}

.nodeaccess-docs-metrics__subtitle {
  margin: 0;
  color: #596579;
  font-size: 13px;
}

.nodeaccess-docs-metrics__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}

.nodeaccess-docs-metrics__item {
  min-height: 64px;
  padding: 10px;
  border: 1px solid #e5e9f0;
  border-radius: 8px;
  background: #ffffff;
}

.nodeaccess-docs-metrics__value {
  display: block;
  color: #111827;
  font-size: 20px;
  font-weight: 800;
  line-height: 1.1;
}

.nodeaccess-docs-metrics__label {
  display: block;
  margin-top: 5px;
  color: #5b6678;
  font-size: 12px;
  line-height: 1.35;
}

.nodeaccess-docs-metrics__methods,
.nodeaccess-docs-metrics__groups {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.nodeaccess-docs-metrics__section {
  display: grid;
  gap: 8px;
}

.nodeaccess-docs-metrics__section-title {
  margin: 0;
  color: #596579;
  font-size: 12px;
  font-weight: 700;
}

.nodeaccess-docs-metrics__pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 5px 9px;
  border: 1px solid #d7dde7;
  border-radius: 999px;
  background: #ffffff;
  color: #334155;
  font-size: 12px;
  line-height: 1;
}

.nodeaccess-docs-metrics__pill strong {
  color: #111827;
  font-weight: 800;
}

@media (max-width: 640px) {
  .nodeaccess-docs-metrics {
    margin-top: 12px;
    padding: 0 12px;
  }

  .nodeaccess-docs-metrics__panel {
    padding: 12px;
  }
}
`

const swaggerDocsMetricsJs = `
(function () {
  var httpMethods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']

  function createElement(tagName, className, textContent) {
    var element = document.createElement(tagName)
    if (className) element.className = className
    if (typeof textContent === 'string') element.textContent = textContent
    return element
  }

  function getOperationTags(operation) {
    if (!operation || !Array.isArray(operation.tags) || operation.tags.length === 0) {
      return ['Sem grupo']
    }

    return operation.tags
  }

  function collectMetrics(spec) {
    var paths = spec && spec.paths ? spec.paths : {}
    var declaredTags = Array.isArray(spec && spec.tags) ? spec.tags.map(function (tag) { return tag.name }) : []
    var groupCounts = new Map()
    var methodCounts = new Map()
    var totalEndpoints = 0

    declaredTags.forEach(function (tagName) {
      groupCounts.set(tagName, 0)
    })

    Object.keys(paths).forEach(function (path) {
      var pathDefinition = paths[path] || {}

      httpMethods.forEach(function (method) {
        var operation = pathDefinition[method]
        if (!operation) return

        totalEndpoints += 1
        methodCounts.set(method.toUpperCase(), (methodCounts.get(method.toUpperCase()) || 0) + 1)

        getOperationTags(operation).forEach(function (tagName) {
          groupCounts.set(tagName, (groupCounts.get(tagName) || 0) + 1)
        })
      })
    })

    var groupsWithEndpoints = Array.from(groupCounts.entries()).filter(function (entry) {
      return entry[1] > 0
    })

    return {
      declaredGroups: declaredTags.length,
      groupsWithEndpoints: groupsWithEndpoints.length,
      totalEndpoints: totalEndpoints,
      averageEndpointsPerGroup: groupsWithEndpoints.length ? Math.round((totalEndpoints / groupsWithEndpoints.length) * 10) / 10 : 0,
      methodCounts: Array.from(methodCounts.entries()).sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]) }),
      topGroups: groupsWithEndpoints.sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]) }).slice(0, 8)
    }
  }

  function createMetricItem(value, label) {
    var item = createElement('div', 'nodeaccess-docs-metrics__item')
    item.appendChild(createElement('span', 'nodeaccess-docs-metrics__value', String(value)))
    item.appendChild(createElement('span', 'nodeaccess-docs-metrics__label', label))
    return item
  }

  function createPill(label, value) {
    var pill = createElement('span', 'nodeaccess-docs-metrics__pill')
    pill.appendChild(createElement('strong', '', String(value)))
    pill.appendChild(document.createTextNode(label))
    return pill
  }

  function renderMetrics(metrics) {
    if (document.querySelector('.nodeaccess-docs-metrics')) return

    var root = document.querySelector('#swagger-ui')
    if (!root || !root.parentNode) return

    var wrapper = createElement('section', 'nodeaccess-docs-metrics')
    wrapper.setAttribute('aria-label', 'Resumo da documentacao da API')

    var panel = createElement('div', 'nodeaccess-docs-metrics__panel')
    var header = createElement('div', 'nodeaccess-docs-metrics__header')
    var title = createElement('h2', 'nodeaccess-docs-metrics__title', 'Resumo da API')
    var subtitle = createElement('p', 'nodeaccess-docs-metrics__subtitle', 'Contadores gerados automaticamente a partir do OpenAPI carregado.')
    var grid = createElement('div', 'nodeaccess-docs-metrics__grid')
    var methodsSection = createElement('div', 'nodeaccess-docs-metrics__section')
    var groupsSection = createElement('div', 'nodeaccess-docs-metrics__section')
    var methodsTitle = createElement('p', 'nodeaccess-docs-metrics__section-title', 'Endpoints por metodo HTTP')
    var groupsTitle = createElement('p', 'nodeaccess-docs-metrics__section-title', 'Top grupos por endpoints')
    var methods = createElement('div', 'nodeaccess-docs-metrics__methods')
    var groups = createElement('div', 'nodeaccess-docs-metrics__groups')

    header.appendChild(title)
    header.appendChild(subtitle)

    grid.appendChild(createMetricItem(metrics.declaredGroups, 'grupos declarados'))
    grid.appendChild(createMetricItem(metrics.groupsWithEndpoints, 'grupos com endpoints'))
    grid.appendChild(createMetricItem(metrics.totalEndpoints, 'endpoints totais'))
    grid.appendChild(createMetricItem(metrics.averageEndpointsPerGroup, 'media por grupo ativo'))

    metrics.methodCounts.forEach(function (entry) {
      methods.appendChild(createPill(entry[0], entry[1]))
    })

    metrics.topGroups.forEach(function (entry) {
      groups.appendChild(createPill(entry[0], entry[1]))
    })

    methodsSection.appendChild(methodsTitle)
    methodsSection.appendChild(methods)
    groupsSection.appendChild(groupsTitle)
    groupsSection.appendChild(groups)

    panel.appendChild(header)
    panel.appendChild(grid)
    if (metrics.methodCounts.length > 0) panel.appendChild(methodsSection)
    if (metrics.topGroups.length > 0) panel.appendChild(groupsSection)
    wrapper.appendChild(panel)

    root.parentNode.appendChild(wrapper)
  }

  function getOpenApiJsonUrl() {
    var pathname = window.location.pathname
    var staticIndex = pathname.indexOf('/static/')
    var docsBasePath = staticIndex >= 0 ? pathname.slice(0, staticIndex) : pathname.replace(/\\/$/, '')
    return (docsBasePath || '/docs') + '/json'
  }

  function loadMetrics() {
    fetch(getOpenApiJsonUrl(), { headers: { accept: 'application/json' } })
      .then(function (response) {
        if (!response.ok) throw new Error('OpenAPI indisponivel')
        return response.json()
      })
      .then(function (spec) {
        renderMetrics(collectMetrics(spec))
      })
      .catch(function () {
        return undefined
      })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadMetrics)
  } else {
    loadMetrics()
  }
}())
`

async function buildApiApp() {
  const app = Fastify({ logger, disableRequestLogging: true, trustProxy: env.TRUST_PROXY })
  registerSanitizedRequestLogging(app)

  app.addContentTypeParser(/^application\/x-www-form-urlencoded\b/i, { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, parseQueryString(typeof body === 'string' ? body : body.toString('utf8')))
    } catch (error) {
      done(error as Error)
    }
  })

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'NodeAccess API',
        version: '0.1.0',
        description: [
          'API REST do NodeAccess para administracao, operacao e integracao com a plataforma.',
          'As rotas exigem JWT Bearer quando indicado em Security. Rotas administrativas tambem exigem papel ou permissao administrativa no tenant.',
          'Endpoints marcados como gateway, auditoria, secrets, JIT, MCP ou IA devem ser integrados com cuidado porque podem acionar controles de seguranca, logs e politicas operacionais.',
        ].join('\n\n'),
      },
      tags: [
        { name: 'Auth',                 description: 'Login, refresh token, logout, MFA/TOTP e autenticacao Google.' },
        { name: 'Users',                description: 'Usuarios do tenant, status, permissoes operacionais e associacao a grupos.' },
        { name: 'Groups',               description: 'Grupos de acesso usados para visibilidade, permissoes e organizacao de hosts.' },
        { name: 'Hosts',                description: 'Catalogo de hosts SSH, escopos, tags, pastas, bulk actions, teste de conexao e host key trust.' },
        { name: 'Folders',              description: 'Pastas pessoais para organizar hosts na experiencia do usuario.' },
        { name: 'Tags',                 description: 'Tags de hosts para classificacao, filtro e organizacao operacional.' },
        { name: 'Bastions',             description: 'Bastion hosts e jump servers usados para alcancar redes privadas.' },
        { name: 'PemKeys',              description: 'Chaves PEM cadastradas no tenant para uso em hosts e bastions.' },
        { name: 'HostLinks',            description: 'Links internos e JIT para abrir acesso a hosts com expiracao, revogacao e auditoria.' },
        { name: 'NativeSshGateway',     description: 'Configuracao administrativa do SSH Gateway nativo usado por clientes SSH externos.' },
        { name: 'Sessions',             description: 'Sessoes SSH, encerramento administrativo e limpeza de sessoes stale.' },
        { name: 'SharedSessions',       description: 'Compartilhamento de terminal, presenca, pedido de controle e colaboracao auditavel.' },
        { name: 'SFTP',                 description: 'Operacoes de arquivo via SFTP: listar, baixar, enviar, criar, mover, ler e escrever arquivos.' },
        { name: 'PortForwardings',      description: 'Acessos locais salvos por host, auto-start e configuracao de port forwarding.' },
        { name: 'Tunnels',              description: 'Tunneis SSH ativos em runtime, teste de destino interno e encerramento.' },
        { name: 'WebAccess',            description: 'Proxy web autenticado para servicos HTTP/HTTPS acessados via SSH.' },
        { name: 'Snippets',             description: 'Snippets, grupos de snippets, macros e comandos reutilizaveis.' },
        { name: 'Secrets',              description: 'Vault de secrets cifrados, rotacao, revogacao e uso seguro sem expor valores.' },
        { name: 'SessionAudit',         description: 'Auditoria de sessoes SSH, politicas de captura, comandos derivados, resumos e evidencias.' },
        { name: 'CommandPolicies',      description: 'Politicas administrativas de comandos SSH, regras, simulacao e vinculos por escopo.' },
        { name: 'DiagnosticPlaybooks',  description: 'Playbooks de diagnostico, execucoes controladas, exportacao e resumo por IA.' },
        { name: 'AiSshActions',         description: 'Action runs SSH por IA com policy, aprovacao, rejeicao, cancelamento e auditoria.' },
        { name: 'MCP',                  description: 'MCP, tokens tecnicos, resources, tools governadas e sessoes interativas autorizadas.' },
        { name: 'LocalAI',              description: 'Assistente local opcional, conversa, conhecimento e acoes propostas.' },
        { name: 'Integrations',         description: 'Integracoes externas como 1Password, Google, Jira, OpenAI e provedores locais.' },
        { name: 'Webhooks',             description: 'Subscriptions, assinaturas HMAC, entregas, retentativas e teste de webhooks.' },
        { name: 'InboundWebhooks',      description: 'Recebimento governado de eventos externos por token opaco, assinatura, idempotencia e receipts.' },
        { name: 'Email',                description: 'Configuracao SMTP por tenant, pre-validacao, envio de teste e suporte a OTP.' },
        { name: 'Agents',               description: 'Agentes proxy reverso, scripts de instalacao, binarios publicados e status online.' },
        { name: 'Dashboard',            description: 'Resumo administrativo operacional da plataforma no tenant.' },
        { name: 'UserDashboard',        description: 'Resumo pessoal de uso, favoritos, recentes e indicadores do usuario autenticado.' },
        { name: 'Observability',        description: 'Saude operacional, recursos do servidor e metricas consolidadas de containers.' },
        { name: 'Reports',              description: 'Relatorios administrativos de uso, adocao, UX, snippets, sessoes, tuneis e host keys.' },
        { name: 'Logs',                 description: 'Logs de autenticacao e acoes administrativas para investigacao e auditoria.' },
        { name: 'Settings',             description: 'Configuracoes gerais do tenant, licenca, entitlements, sessoes, senha e JIT.' },
        { name: 'Features',             description: 'Feature flags e disponibilidade de funcionalidades por tenant.' },
        { name: 'Feedback',             description: 'Feedback de usuarios, inbox administrativo, status e resposta curta.' },
        { name: 'Platform',             description: 'Administracao da plataforma, tenants e superadmins. Uso restrito a platform admin.' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
  })

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    theme: {
      title: 'NodeAccess API Docs',
      css: [{ filename: 'nodeaccess-docs-metrics.css', content: swaggerDocsMetricsCss }],
      js: [{ filename: 'nodeaccess-docs-metrics.js', content: swaggerDocsMetricsJs }],
    },
    uiConfig: {
      deepLinking: true,
      displayRequestDuration: true,
      docExpansion: 'none',
      operationsSorter: 'alpha',
      tagsSorter: 'alpha',
    },
  })

  await app.register(import('@fastify/multipart'))
  await app.register(import('./plugins/jwt.plugin.js'))

  await app.register(
    async (api) => {
      await api.register(async (r) => authRoutes(r,     container.authController),     { prefix: '/auth' })
      await api.register(async (r) => oidcAuthRoutes(r, container.oidcAuthController), { prefix: '/auth/oidc' })
      await api.register(async (r) => userRoutes(r,     container.userController),     { prefix: '/users' })
      await api.register(async (r) => groupRoutes(r,    container.groupController),    { prefix: '/groups' })
      await api.register(async (r) => hostRoutes(r,     container.hostController),     { prefix: '/hosts' })
      await api.register(async (r) => hostDashboardRoutes(r, container.hostDashboardController), { prefix: '/hosts' })
      await api.register(async (r) => diagnosticPlaybookRoutes(r, container.diagnosticPlaybookController), { prefix: '/hosts' })
      await api.register(async (r) => diagnosticPlaybookAdminRoutes(r, container.diagnosticPlaybookController), { prefix: '/diagnostic-playbooks' })
      await api.register(async (r) => diagnosticRunHostRoutes(r, container.diagnosticRunController), { prefix: '/hosts' })
      await api.register(async (r) => diagnosticRunRoutes(r, container.diagnosticRunController), { prefix: '/diagnostic-runs' })
      await api.register(async (r) => settingsRoutes(r,  container.settingsController),  { prefix: '/settings' })
      await api.register(async (r) => sessionsRoutes(r,  container.sessionsController),  { prefix: '/sessions' })
      await api.register(featuresRoutes, { prefix: '/features' })
      await api.register(async (r) => folderRoutes(r, container.folderController), { prefix: '/folders' })
      await api.register(async (r) => inventoryRoutes(r, container.inventoryController), { prefix: '/inventory' })
      await api.register(async (r) => hostImportRoutes(r, container.hostImportController), { prefix: '/host-imports' })
      await api.register(async (r) => inventoryAclRoutes(r, container.inventoryAclController), { prefix: '/inventory' })
      await api.register(async (r) => bastionRoutes(r, container.bastionController), { prefix: '/bastions' })
      await api.register(async (r) => pemKeyRoutes(r,       container.pemKeyController),       { prefix: '/pem-keys' })
      await api.register(async (r) => integrationRoutes(r,  container.integrationController),   { prefix: '/integrations' })
      await api.register(async (r) => oidcConfigRoutes(r, container.oidcConfigController), { prefix: '/integrations/oidc' })
      await api.register(async (r) => externalIdentityAdminRoutes(r, container.externalIdentityAdminController), { prefix: '/integrations/oidc' })
      await api.register(async (r) => oidcGroupMappingRoutes(r, container.oidcGroupMappingController), { prefix: '/integrations/oidc' })
      await api.register(async (r) => scimAdminRoutes(r, container.scimService), { prefix: '/integrations/scim' })
      await api.register(async (r) => scimRoutes(r, container.scimService), { prefix: '/scim/v2' })
      await api.register(async (r) => logRoutes(r,           container.logController),           { prefix: '/logs' })
      await api.register(async (r) => dashboardRoutes(r,     container.dashboardController),     { prefix: '/dashboard' })
      await api.register(async (r) => reportsRoutes(r,       container.reportsController),       { prefix: '/reports' })
      await api.register(async (r) => tagRoutes(r,           container.tagController),           { prefix: '/tags' })
      await api.register(async (r) => hostLinkRoutes(r,      container.hostLinkController),      { prefix: '/host-links' })
      await api.register(async (r) => sharedSessionRoutes(r, container.sharedSessionController), { prefix: '/shared-sessions' })
      await api.register(async (r) => userDashboardRoutes(r, container.userDashboardController), { prefix: '/user-dashboard' })
      await api.register(async (r) => sftpRoutes(r,          container.sftpController),          { prefix: '/sftp' })
      await api.register(async (r) => snippetRoutes(r,       container.snippetController),       { prefix: '/snippets' })
      await api.register(async (r) => snippetGroupRoutes(r,  container.snippetGroupController),  { prefix: '/snippet-groups' })
      await api.register(async (r) => tunnelRoutes(r,        container.tunnelController),        { prefix: '/tunnels' })
      await api.register(async (r) => agentRoutes(r,         container.agentController),         { prefix: '/agents' })
      await api.register(async (r) => portForwardingRoutes(r, container.portForwardingController), { prefix: '/forwardings' })
      await api.register(async (r) => webAccessRoutes(r, container.webAccessController), { prefix: '/web-access' })
      await api.register(async (r) => sessionAuditRoutes(r, container.sessionAuditController), { prefix: '/session-audit' })
      await api.register(async (r) => sessionAuditPolicyRoutes(r, container.sessionAuditPolicyController), { prefix: '/session-audit-policy' })
      await api.register(async (r) => tenantAuthPolicyRoutes(r, container.tenantAuthPolicyController), { prefix: '/tenant-auth-policy' })
      await api.register(async (r) => secretRoutes(r, container.secretController), { prefix: '/secrets' })
      await api.register(async (r) => tenantRoutes(r, container.tenantController), { prefix: '/platform/tenants' })
      await api.register(async (r) => platformAdminRoutes(r, container.platformAdminController), { prefix: '/platform/superadmins' })
      await api.register(async (r) => feedbackRoutes(r, container.feedbackController), { prefix: '/feedback' })
      await api.register(async (r) => localAiRoutes(r, container.localAiController), { prefix: '/local-ai' })
      await api.register(async (r) => mcpRoutes(r, container.mcpController), { prefix: '/mcp' })
      await api.register(async (r) => mcpTokenAdminRoutes(r, container.mcpTokenController), { prefix: '/mcp/admin' })
      await api.register(async (r) => aiSshActionHostRoutes(r, container.aiSshActionController), { prefix: '/hosts' })
      await api.register(async (r) => aiSshActionRoutes(r, container.aiSshActionController), { prefix: '/ai-ssh-action-runs' })
      await api.register(async (r) => aiSshActionCommandPolicyRoutes(r, container.aiSshActionCommandPolicyController), { prefix: '/ai-ssh-action-command-policy' })
      await api.register(async (r) => sessionCommandPolicyRoutes(r, container.sessionCommandPolicyController), { prefix: '/session-command-policies' })
      await api.register(async (r) => webhookRoutes(r, container.webhookController), { prefix: '/webhooks' })
      await api.register(async (r) => inboundWebhookRoutes(r, container.inboundWebhookController), { prefix: '/inbound-webhooks' })
      await api.register(async (r) => emailConfigRoutes(r, container.emailConfigController), { prefix: '/email-config' })
      await api.register(async (r) => observabilityRoutes(r, { db: prisma, redis }), { prefix: '/admin/observability' })
      await api.register(async (r) => haRoutes(r, { db: prisma }), { prefix: '/ha' })
      await api.register(nativeSshGatewayRoutes, { prefix: '/native-ssh-gateway' })
    },
    { prefix: '/api/v1' },
  )

  registerHealthRoutes(app, 'api', { db: prisma, redis })
  registerMetricsRoute(app as MetricsRouteApp, redis)

  // ── Webhook dispatcher ───────────────────────────────────────────────────────
  container.webhookDispatcher.start()

  // ── Google Directory Sync periódico ──────────────────────────────────────────
  startGoogleDirectorySync()
  if (env.FEATURE_SESSION_AUDIT_AI_SUMMARY) {
    container.sessionAuditAiWorker.start()
  }

  return app
}

async function startGoogleDirectorySync(): Promise<void> {
  async function runSync() {
    try {
      const tenants = await container.prisma.tenant.findMany({ where: { active: true }, select: { id: true } })
      for (const { id } of tenants) {
        const config = await container.googleService.getConfig(id)
        if (!config?.serviceAccountEncrypted || !config.adminEmail) continue

        const result = await container.googleService.syncDirectory(id)
        if (result.deactivated > 0) {
          logger.info({ tenantId: id, ...result }, 'Google Workspace sync concluído')
        }
      }
    } catch (err) {
      logger.error(err, 'Erro no Google Directory Sync periódico')
    } finally {
      setTimeout(runSync, env.GOOGLE_DIRECTORY_SYNC_INTERVAL_MS)
    }
  }

  // Delay first run to allow server to fully start.
  setTimeout(runSync, env.GOOGLE_DIRECTORY_SYNC_INITIAL_DELAY_MS)
}

// ---------------------------------------------------------------------------
// SSH Gateway / WebSocket (porta 3001)
// ---------------------------------------------------------------------------

async function buildGatewayApp() {
  const drainState = new GatewayDrainState()
  // Encerrar sessões que ficaram ativas de processos anteriores (ghost sessions)
  const ghostsCleaned = await container.sessionsService.cleanupAllGhosts().catch(() => 0)
  if (ghostsCleaned > 0) {
    logger.info({ cleaned: ghostsCleaned }, 'Sessões ghost encerradas no startup do gateway')
  }

  const repairedAudits = await container.sessionAuditService.repairOrphanedRunningSessions().catch(() => 0)
  if (repairedAudits > 0) {
    logger.info({ repaired: repairedAudits }, 'Auditorias órfãs marcadas como encerradas no startup do gateway')
  }
  await container.jitSessionRevocationBus.start().catch((err) => {
    logger.warn({ err }, 'Gateway iniciou sem subscriber Redis de revogação JIT')
  })
  await container.sessionRuntimeControlBus.start().catch((err) => {
    logger.warn({ err }, 'Gateway iniciou sem subscriber Redis de controle de sessões')
  })
  await container.appEventBus.start().catch((err) => {
    logger.warn({ err }, 'Gateway iniciou sem subscriber Redis de eventos do app')
  })

  const app = Fastify({ logger, disableRequestLogging: true, trustProxy: env.TRUST_PROXY })
  registerSanitizedRequestLogging(app)

  await app.register(import('./plugins/websocket.plugin.js'))
  await app.register(import('./plugins/jwt.plugin.js'))

  app.post<{ Body: TestConnectionDto }>('/api/v1/hosts/test-connection', {
    preHandler: [requireAuth],
    schema: {
      tags: ['Hosts'],
      summary: 'Testar conexão SSH via gateway',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(TestConnectionSchema),
      response: { 200: zodToJsonSchema(TestConnectionResultSchema) },
    },
  }, (request, reply) => container.hostController.testConnection(request, reply))

  await app.register(
    async (api) => tunnelRoutes(api, container.tunnelController),
    { prefix: '/api/v1/tunnels' },
  )

  await app.register(
    async (api) => webAccessRoutes(api, container.webAccessController),
    { prefix: '/api/v1/web-access' },
  )

  await app.register(
    async (ws) => sshRoutes(ws, container.sshGateway, container.agentGateway, drainState),
    { prefix: '/ws' },
  )

  await app.register(
    async (ws) => graphicalRoutes(ws, container.graphicalGateway),
    { prefix: '/ws' },
  )

  await app.register(
    async (ws) => sharedSessionWsRoutes(ws, container.sharedSessionGateway),
    { prefix: '/ws' },
  )

  await app.register(
    async (ws) => appEventRoutes(ws, container.appEventBus),
    { prefix: '/ws' },
  )

  registerHealthRoutes(app, 'gateway', { db: prisma, redis }, { isDraining: () => drainState.isDraining() })
  app.decorate('gatewayDrainState', drainState)
  registerMetricsRoute(app as MetricsRouteApp, redis)
  return app
}

interface RequestLoggingApp {
  addHook(
    name: 'onResponse',
    hook: (request: FastifyRequest, reply: FastifyReply, done: () => void) => void,
  ): void
}

function registerSanitizedRequestLogging(app: RequestLoggingApp): void {
  app.addHook('onResponse', (request, reply, done) => {
    const ipInfo = getClientIpInfo(request, env.TRUST_PROXY)
    request.log.info({
      req: {
        method: request.method,
        url: sanitizeLogUrl(request.raw.url ?? request.url),
        hostname: request.hostname,
        clientIp: ipInfo.clientIp,
        remoteAddress: ipInfo.remoteAddress ?? request.ip,
        forwardedFor: ipInfo.forwardedFor,
        realIp: ipInfo.realIp,
        cfConnectingIp: ipInfo.cfConnectingIp,
        trustedProxy: ipInfo.trustedProxy,
      },
      res: {
        statusCode: reply.statusCode,
      },
      responseTime: reply.elapsedTime,
    }, 'request completed')
    done()
  })
}

interface MetricsRouteApp {
  get(
    path: string,
    handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
  ): unknown
}

function registerMetricsRoute(app: MetricsRouteApp, redis: Redis): void {
  if (!env.FEATURE_METRICS && env.NODE_ENV === 'production') return

  app.get('/metrics', async (request: FastifyRequest, reply: FastifyReply) => {
    if (env.METRICS_TOKEN) {
      const expected = `Bearer ${env.METRICS_TOKEN}`
      if (request.headers.authorization !== expected) {
        return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'Unauthorized' })
      }
    }

    metrics.setGauge(
      'nodeaccess_dependency_up',
      'Whether a required NodeAccess dependency is reachable',
      { dependency: 'redis' },
      await redisAvailable(redis) ? 1 : 0,
    )

    return reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(metrics.render())
  })
}

async function redisAvailable(redis: Redis): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      redis.ping(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Redis metrics probe timeout')), 1_000)
      }),
    ])
    return String(result).toUpperCase() === 'PONG'
  } catch {
    return false
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function bootstrap(): Promise<void> {
  const port = env.APP_MODE === 'api' ? env.APP_PORT_API : env.APP_PORT_GATEWAY
  const app  = env.APP_MODE === 'api' ? await buildApiApp() : await buildGatewayApp()

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ code: error.code, message: error.message })
    }
    if (error.statusCode === 400) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: error.message })
    }
    logger.error(error)
    return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Erro interno do servidor' })
  })

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info('Encerrando servidor...')
    if (env.APP_MODE === 'gateway') {
      const drainState = (app as typeof app & { gatewayDrainState: GatewayDrainState }).gatewayDrainState
      drainState.begin()
      const activeSessions = await waitForGatewayDrain(
        () => drainState.activeCount(),
        env.GATEWAY_DRAIN_TIMEOUT_SECONDS * 1_000,
      )
      logger.info({ activeSessions }, 'Drenagem do gateway concluída')
    }
    container.sessionAuditAiWorker.stop()
    await container.sessionRuntimeControlBus.stop().catch((err) => logger.warn({ err }, 'Falha ao encerrar subscriber de controle de sessões'))
    await container.jitSessionRevocationBus.stop().catch((err) => logger.warn({ err }, 'Falha ao encerrar subscriber JIT'))
    await container.appEventBus.stop().catch((err) => logger.warn({ err }, 'Falha ao encerrar subscriber de eventos do app'))
    await container.nativeSshGateway.stop().catch((err) => logger.warn({ err }, 'Falha ao encerrar Native SSH Gateway'))
    await app.close()
    await prisma.$disconnect()
    redis.disconnect()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  try {
    await redis.connect()
    await app.listen({ port, host: '0.0.0.0' })
    if (env.APP_MODE === 'gateway') {
      await container.nativeSshGateway.start()
    }
    logger.info(`Servidor iniciado — modo: ${env.APP_MODE} | porta: ${port}`)
  } catch (err) {
    logger.error(err, 'Falha ao iniciar o servidor')
    process.exit(1)
  }
}

bootstrap()
