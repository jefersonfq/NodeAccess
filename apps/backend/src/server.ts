import 'dotenv/config' // deve ser o primeiro import em dev local
import Fastify from 'fastify'
import { parse as parseQueryString } from 'node:querystring'
import swagger    from '@fastify/swagger'
import swaggerUi  from '@fastify/swagger-ui'
import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { prisma } from './config/database.js'
import { redis } from './config/redis.js'
import { AppError } from './shared/errors.js'
import { container } from './container.js'
import { authRoutes }     from './modules/auth/auth.routes.js'
import { userRoutes }     from './modules/users/user.routes.js'
import { groupRoutes }    from './modules/groups/group.routes.js'
import { hostRoutes }     from './modules/hosts/host.routes.js'
import { sshRoutes }      from './modules/ssh/ssh.routes.js'
import { settingsRoutes }  from './modules/settings/settings.routes.js'
import { sessionsRoutes }  from './modules/sessions/sessions.routes.js'
import { featuresRoutes }  from './modules/features/features.routes.js'
import { folderRoutes }    from './modules/folders/folder.routes.js'
import { bastionRoutes }   from './modules/bastions/bastion.routes.js'
import { pemKeyRoutes }         from './modules/pem-keys/pem-key.routes.js'
import { integrationRoutes }    from './modules/integrations/integration.routes.js'
import { logRoutes }            from './modules/logs/log.routes.js'
import { dashboardRoutes }      from './modules/dashboard/dashboard.routes.js'
import { tagRoutes }            from './modules/tags/tag.routes.js'
import { hostLinkRoutes }       from './modules/host-links/host-link.routes.js'
import { sharedSessionRoutes }  from './modules/shared-sessions/shared-session.routes.js'
import { userDashboardRoutes }  from './modules/user-dashboard/user-dashboard.routes.js'
import { sftpRoutes }           from './modules/sftp/sftp.routes.js'
import { snippetRoutes }        from './modules/snippets/snippet.routes.js'
import { tunnelRoutes }         from './modules/tunnels/tunnel.routes.js'
import { agentRoutes }          from './modules/agents/agent.routes.js'
import { portForwardingRoutes } from './modules/port-forwardings/port-forwarding.routes.js'
import { webAccessRoutes }      from './modules/web-access/web-access.routes.js'
import { sessionAuditRoutes }   from './modules/session-audit/session-audit.routes.js'
import { sessionAuditPolicyRoutes } from './modules/session-audit/session-audit-policy.routes.js'
import { sharedSessionWsRoutes } from './modules/shared-sessions/shared-session.ws-routes.js'

// ---------------------------------------------------------------------------
// API REST (porta 3000)
// ---------------------------------------------------------------------------

async function buildApiApp() {
  const app = Fastify({ logger })

  app.addContentTypeParser(/^application\/x-www-form-urlencoded\b/i, { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, parseQueryString(typeof body === 'string' ? body : body.toString('utf8')))
    } catch (error) {
      done(error as Error)
    }
  })

  await app.register(swagger, {
    openapi: {
      info: { title: 'NodeAccess API', version: '0.1.0', description: 'API de gerenciamento de acesso SSH' },
      tags: [
        { name: 'Auth',     description: 'Autenticação e MFA' },
        { name: 'Users',    description: 'Gerenciamento de usuários (admin)' },
        { name: 'Groups',   description: 'Gerenciamento de grupos de acesso' },
        { name: 'Hosts',    description: 'Gerenciamento de hosts SSH' },
        { name: 'Settings', description: 'Configurações do sistema (admin)' },
        { name: 'Sessions', description: 'Histórico de sessões SSH (admin)' },
        { name: 'Features', description: 'Feature flags do tenant' },
        { name: 'Bastions', description: 'Gerenciamento de bastion hosts (admin)' },
        { name: 'PemKeys',      description: 'Gerenciamento de chaves PEM SSH' },
        { name: 'Integrations', description: 'Integrações externas (1Password, etc.)' },
        { name: 'Logs',         description: 'Logs de autenticação e ações administrativas' },
        { name: 'Dashboard',    description: 'Estatísticas e visão geral do sistema' },
        { name: 'HostLinks',    description: 'Links autenticados para entrada rápida em hosts' },
        { name: 'SharedSessions', description: 'Sessões compartilhadas de terminal' },
        { name: 'UserDashboard', description: 'Resumo pessoal de uso do usuário autenticado' },
        { name: 'SFTP',         description: 'Operações de arquivo via SFTP' },
        { name: 'Snippets',     description: 'Biblioteca de snippets/comandos' },
        { name: 'Tunnels',      description: 'Túneis SSH (port forwarding)' },
        { name: 'Agents',          description: 'Agentes proxy reverso (acesso via VPN local)' },
        { name: 'PortForwardings', description: 'Configuração de port forwarding por host' },
        { name: 'WebAccess',       description: 'Proxy web autenticado para serviços HTTP/HTTPS via SSH' },
        { name: 'SessionAudit',    description: 'Auditoria de sessões SSH' },
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
    uiConfig: { docExpansion: 'list', deepLinking: true },
  })

  await app.register(import('@fastify/multipart'))
  await app.register(import('./plugins/jwt.plugin.js'))

  await app.register(
    async (api) => {
      await api.register(async (r) => authRoutes(r,     container.authController),     { prefix: '/auth' })
      await api.register(async (r) => userRoutes(r,     container.userController),     { prefix: '/users' })
      await api.register(async (r) => groupRoutes(r,    container.groupController),    { prefix: '/groups' })
      await api.register(async (r) => hostRoutes(r,     container.hostController),     { prefix: '/hosts' })
      await api.register(async (r) => settingsRoutes(r,  container.settingsController),  { prefix: '/settings' })
      await api.register(async (r) => sessionsRoutes(r,  container.sessionsController),  { prefix: '/sessions' })
      await api.register(featuresRoutes, { prefix: '/features' })
      await api.register(async (r) => folderRoutes(r, container.folderController), { prefix: '/folders' })
      await api.register(async (r) => bastionRoutes(r, container.bastionController), { prefix: '/bastions' })
      await api.register(async (r) => pemKeyRoutes(r,       container.pemKeyController),       { prefix: '/pem-keys' })
      await api.register(async (r) => integrationRoutes(r,  container.integrationController),   { prefix: '/integrations' })
      await api.register(async (r) => logRoutes(r,           container.logController),           { prefix: '/logs' })
      await api.register(async (r) => dashboardRoutes(r,     container.dashboardController),     { prefix: '/dashboard' })
      await api.register(async (r) => tagRoutes(r,           container.tagController),           { prefix: '/tags' })
      await api.register(async (r) => hostLinkRoutes(r,      container.hostLinkController),      { prefix: '/host-links' })
      await api.register(async (r) => sharedSessionRoutes(r, container.sharedSessionController), { prefix: '/shared-sessions' })
      await api.register(async (r) => userDashboardRoutes(r, container.userDashboardController), { prefix: '/user-dashboard' })
      await api.register(async (r) => sftpRoutes(r,          container.sftpController),          { prefix: '/sftp' })
      await api.register(async (r) => snippetRoutes(r,       container.snippetController),       { prefix: '/snippets' })
      await api.register(async (r) => tunnelRoutes(r,        container.tunnelController),        { prefix: '/tunnels' })
      await api.register(async (r) => agentRoutes(r,         container.agentController),         { prefix: '/agents' })
      await api.register(async (r) => portForwardingRoutes(r, container.portForwardingController), { prefix: '/forwardings' })
      await api.register(async (r) => webAccessRoutes(r, container.webAccessController), { prefix: '/web-access' })
      await api.register(async (r) => sessionAuditRoutes(r, container.sessionAuditController), { prefix: '/session-audit' })
      await api.register(async (r) => sessionAuditPolicyRoutes(r, container.sessionAuditPolicyController), { prefix: '/session-audit-policy' })
    },
    { prefix: '/api/v1' },
  )

  app.get('/health', async () => ({ status: 'ok', mode: 'api', timestamp: new Date().toISOString() }))

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
  // Encerrar sessões que ficaram ativas de processos anteriores (ghost sessions)
  const ghostsCleaned = await container.sessionsService.cleanupAllGhosts().catch(() => 0)
  if (ghostsCleaned > 0) {
    logger.info({ cleaned: ghostsCleaned }, 'Sessões ghost encerradas no startup do gateway')
  }

  const repairedAudits = await container.sessionAuditService.repairOrphanedRunningSessions().catch(() => 0)
  if (repairedAudits > 0) {
    logger.info({ repaired: repairedAudits }, 'Auditorias órfãs marcadas como encerradas no startup do gateway')
  }

  const app = Fastify({ logger })

  await app.register(import('./plugins/websocket.plugin.js'))

  await app.register(
    async (ws) => sshRoutes(ws, container.sshGateway, container.agentGateway),
    { prefix: '/ws' },
  )

  await app.register(
    async (ws) => sharedSessionWsRoutes(ws, container.sharedSessionGateway),
    { prefix: '/ws' },
  )

  app.get('/health', async () => ({ status: 'ok', mode: 'gateway', timestamp: new Date().toISOString() }))
  return app
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

  const shutdown = async () => {
    logger.info('Encerrando servidor...')
    container.sessionAuditAiWorker.stop()
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
    logger.info(`Servidor iniciado — modo: ${env.APP_MODE} | porta: ${port}`)
  } catch (err) {
    logger.error(err, 'Falha ao iniciar o servidor')
    process.exit(1)
  }
}

bootstrap()
