import { prisma } from './config/database.js'
import { redis } from './config/redis.js'
import { logger } from './config/logger.js'

// Repositórios
import { UserRepository }    from './modules/users/user.repository.js'
import { GroupRepository }   from './modules/groups/group.repository.js'
import { HostRepository }    from './modules/hosts/host.repository.js'
import { SshRepository }     from './modules/ssh/ssh.repository.js'
import { BastionRepository } from './modules/bastions/bastion.repository.js'
import { PemKeyRepository }      from './modules/pem-keys/pem-key.repository.js'
import { IntegrationRepository } from './modules/integrations/integration.repository.js'
import { LogRepository }         from './modules/logs/log.repository.js'
import { DashboardRepository }   from './modules/dashboard/dashboard.repository.js'
import { HostDashboardRepository } from './modules/host-dashboard/host-dashboard.repository.js'
import { DiagnosticPlaybookRepository } from './modules/diagnostic-playbooks/diagnostic-playbook.repository.js'
import { DiagnosticRunRepository } from './modules/diagnostic-playbooks/diagnostic-run.repository.js'
import { TagRepository }         from './modules/tags/tag.repository.js'
import { HostLinkRepository }    from './modules/host-links/host-link.repository.js'
import { SharedSessionRepository } from './modules/shared-sessions/shared-session.repository.js'
import { SharedSessionBroker } from './modules/shared-sessions/shared-session.broker.js'
import { UserDashboardRepository } from './modules/user-dashboard/user-dashboard.repository.js'
import { SecretRepository } from './modules/secrets/secret.repository.js'
import { TenantRepository } from './modules/tenants/tenant.repository.js'
import { FeedbackRepository } from './modules/feedback/feedback.repository.js'
import { LicenseEntitlementService } from './modules/license/license-entitlement.service.js'

// Serviços
import { TotpService }    from './modules/auth/totp.service.js'
import { AuthService }    from './modules/auth/auth.service.js'
import { GoogleService }  from './modules/auth/google.service.js'
import { UserService }    from './modules/users/user.service.js'
import { GroupService }   from './modules/groups/group.service.js'
import { HostService }            from './modules/hosts/host.service.js'
import { TestConnectionService } from './modules/hosts/test-connection.service.js'
import { SshGateway }     from './modules/ssh/ssh.gateway.js'
import { BastionService } from './modules/bastions/bastion.service.js'
import { PemKeyService }        from './modules/pem-keys/pem-key.service.js'
import { OnePasswordService }   from './modules/integrations/onepassword.service.js'
import { OpenAiIntegrationService } from './modules/integrations/openai.service.js'
import { LocalAiIntegrationService } from './modules/integrations/local-ai.service.js'
import { JiraIntegrationService } from './modules/integrations/jira.service.js'
import { IntegrationService }   from './modules/integrations/integration.service.js'
import { LogService }           from './modules/logs/log.service.js'
import { DashboardService }     from './modules/dashboard/dashboard.service.js'
import { HostDashboardService } from './modules/host-dashboard/host-dashboard.service.js'
import { DiagnosticPlaybookService } from './modules/diagnostic-playbooks/diagnostic-playbook.service.js'
import { DiagnosticRunAiService } from './modules/diagnostic-playbooks/diagnostic-run-ai.service.js'
import { DiagnosticRunService } from './modules/diagnostic-playbooks/diagnostic-run.service.js'
import { TagService }           from './modules/tags/tag.service.js'
import { HostLinkService }      from './modules/host-links/host-link.service.js'
import { SharedSessionService } from './modules/shared-sessions/shared-session.service.js'
import { UserDashboardService } from './modules/user-dashboard/user-dashboard.service.js'

// Controllers
import { AuthController }      from './modules/auth/auth.controller.js'
import { UserController }      from './modules/users/user.controller.js'
import { GroupController }     from './modules/groups/group.controller.js'
import { HostController }      from './modules/hosts/host.controller.js'
import { SettingsRepository }  from './modules/settings/settings.repository.js'
import { SettingsService }     from './modules/settings/settings.service.js'
import { SettingsController }  from './modules/settings/settings.controller.js'
import { SessionsRepository }  from './modules/sessions/sessions.repository.js'
import { SessionsService }     from './modules/sessions/sessions.service.js'
import { SessionsController }  from './modules/sessions/sessions.controller.js'
import { FolderRepository }    from './modules/folders/folder.repository.js'
import { FolderService }       from './modules/folders/folder.service.js'
import { FolderController }    from './modules/folders/folder.controller.js'
import { BastionController }   from './modules/bastions/bastion.controller.js'
import { PemKeyController }      from './modules/pem-keys/pem-key.controller.js'
import { IntegrationController } from './modules/integrations/integration.controller.js'
import { LogController }         from './modules/logs/log.controller.js'
import { DashboardController }   from './modules/dashboard/dashboard.controller.js'
import { HostDashboardController } from './modules/host-dashboard/host-dashboard.controller.js'
import { DiagnosticPlaybookController } from './modules/diagnostic-playbooks/diagnostic-playbook.controller.js'
import { DiagnosticRunController } from './modules/diagnostic-playbooks/diagnostic-run.controller.js'
import { TagController }         from './modules/tags/tag.controller.js'
import { HostLinkController }    from './modules/host-links/host-link.controller.js'
import { SharedSessionController } from './modules/shared-sessions/shared-session.controller.js'
import { SharedSessionGateway } from './modules/shared-sessions/shared-session.gateway.js'
import { UserDashboardController } from './modules/user-dashboard/user-dashboard.controller.js'
import { SftpService }           from './modules/sftp/sftp.service.js'
import { SftpController }        from './modules/sftp/sftp.controller.js'
import { SnippetService }        from './modules/snippets/snippet.service.js'
import { SnippetController }     from './modules/snippets/snippet.controller.js'
import { SnippetGroupService }   from './modules/snippets/snippet-group.service.js'
import { SnippetGroupController } from './modules/snippets/snippet-group.controller.js'
import { TunnelService }         from './modules/tunnels/tunnel.service.js'
import { TunnelController }      from './modules/tunnels/tunnel.controller.js'
import { AgentService }          from './modules/agents/agent.service.js'
import { AgentController }       from './modules/agents/agent.controller.js'
import { AgentGateway }          from './modules/agents/agent.gateway.js'
import { PortForwardingService }    from './modules/port-forwardings/port-forwarding.service.js'
import { PortForwardingController } from './modules/port-forwardings/port-forwarding.controller.js'
import { WebAccessService }         from './modules/web-access/web-access.service.js'
import { WebAccessController }      from './modules/web-access/web-access.controller.js'
import { SessionAuditRepository }   from './modules/session-audit/session-audit.repository.js'
import { SessionAuditAiRepository } from './modules/session-audit/session-audit-ai.repository.js'
import { SessionAuditAiService } from './modules/session-audit/session-audit-ai.service.js'
import { SessionAuditAiWorker } from './modules/session-audit/session-audit-ai.worker.js'
import { SessionAuditPolicyRepository } from './modules/session-audit/session-audit-policy.repository.js'
import { SessionAuditPolicyService } from './modules/session-audit/session-audit-policy.service.js'
import { SessionAuditPolicyController } from './modules/session-audit/session-audit-policy.controller.js'
import { SessionAuditPublisher }    from './modules/session-audit/session-audit.publisher.js'
import { SessionAuditStorage }      from './modules/session-audit/session-audit.storage.js'
import { SessionAuditService }      from './modules/session-audit/session-audit.service.js'
import { SessionAuditController }   from './modules/session-audit/session-audit.controller.js'
import { SecretService }      from './modules/secrets/secret.service.js'
import { SecretController }   from './modules/secrets/secret.controller.js'
import { TenantService }      from './modules/tenants/tenant.service.js'
import { FeedbackService }      from './modules/feedback/feedback.service.js'
import { LocalAiService } from './modules/local-ai/local-ai.service.js'
import { LocalAiToolsService } from './modules/local-ai/local-ai-tools.service.js'
import { LocalAiKnowledgeRepository } from './modules/local-ai/local-ai-knowledge.repository.js'
import { LocalAiKnowledgeService } from './modules/local-ai/local-ai-knowledge.service.js'
import { LocalAiProposedActionRepository } from './modules/local-ai/local-ai-proposed-action.repository.js'
import { LocalAiProposedActionService } from './modules/local-ai/local-ai-proposed-action.service.js'
import { McpService } from './modules/mcp/mcp.service.js'
import { McpInteractiveSshService } from './modules/mcp/mcp-interactive-ssh.service.js'
import { McpTokenRepository } from './modules/mcp/mcp-token.repository.js'
import { AiSshActionRepository } from './modules/ai-ssh-actions/ai-ssh-action.repository.js'
import { TenantController }   from './modules/tenants/tenant.controller.js'
import { FeedbackController }   from './modules/feedback/feedback.controller.js'
import { LocalAiController } from './modules/local-ai/local-ai.controller.js'
import { McpController } from './modules/mcp/mcp.controller.js'
import { McpTokenService } from './modules/mcp/mcp-token.service.js'
import { McpTokenController } from './modules/mcp/mcp-token.controller.js'
import { AiSshActionPolicyService } from './modules/ai-ssh-actions/ai-ssh-action.policy.js'
import { AiSshActionService } from './modules/ai-ssh-actions/ai-ssh-action.service.js'
import { AiSshActionController } from './modules/ai-ssh-actions/ai-ssh-action.controller.js'
import { AiSshActionCommandPolicyRepository } from './modules/ai-ssh-actions/ai-ssh-action-command-policy.repository.js'
import { AiSshActionCommandPolicyService } from './modules/ai-ssh-actions/ai-ssh-action-command-policy.service.js'
import { AiSshActionCommandPolicyController } from './modules/ai-ssh-actions/ai-ssh-action-command-policy.controller.js'
import { WebhookRepository }          from './modules/webhooks/webhook.repository.js'
import { WebhookSignerService }        from './modules/webhooks/webhook-signer.service.js'
import { WebhookService }              from './modules/webhooks/webhook.service.js'
import { WebhookDispatcherService }    from './modules/webhooks/webhook-dispatcher.service.js'
import { WebhookController }           from './modules/webhooks/webhook.controller.js'
import { EmailService }                from './modules/email/email.service.js'
import { EmailConfigRepository }       from './modules/email/email-config.repository.js'
import { EmailConfigService }          from './modules/email/email-config.service.js'
import { EmailConfigController }       from './modules/email/email-config.controller.js'

// ---------------------------------------------------------------------------
// Repositórios
// ---------------------------------------------------------------------------
const userRepository         = new UserRepository(prisma)
const groupRepository        = new GroupRepository(prisma)
const sshRepository          = new SshRepository(prisma)
const settingsRepository     = new SettingsRepository(prisma)
const sessionsRepository     = new SessionsRepository(prisma)
const folderRepository       = new FolderRepository(prisma)
const bastionRepository      = new BastionRepository(prisma)
const pemKeyRepository       = new PemKeyRepository(prisma)
const integrationRepository  = new IntegrationRepository(prisma)
const logRepository          = new LogRepository(prisma)
const dashboardRepository    = new DashboardRepository(prisma)
const hostDashboardRepository = new HostDashboardRepository(prisma)
const diagnosticPlaybookRepository = new DiagnosticPlaybookRepository(prisma)
const diagnosticRunRepository = new DiagnosticRunRepository(prisma)
const tagRepository          = new TagRepository(prisma)
const hostLinkRepository     = new HostLinkRepository(prisma)
const sharedSessionRepository = new SharedSessionRepository(prisma)
const userDashboardRepository = new UserDashboardRepository(prisma)
const hostRepository         = new HostRepository(prisma, tagRepository)
const sessionAuditRepository = new SessionAuditRepository(prisma)
const sessionAuditAiRepository = new SessionAuditAiRepository(prisma)
const sessionAuditPolicyRepository = new SessionAuditPolicyRepository(prisma)
const secretRepository       = new SecretRepository(prisma)
const tenantRepository       = new TenantRepository(prisma)
const feedbackRepository     = new FeedbackRepository(prisma)
const localAiKnowledgeRepository = new LocalAiKnowledgeRepository(prisma)
const localAiProposedActionRepository = new LocalAiProposedActionRepository(prisma)
const mcpTokenRepository = new McpTokenRepository(prisma)
const aiSshActionRepository = new AiSshActionRepository(prisma)
const aiSshActionCommandPolicyRepository = new AiSshActionCommandPolicyRepository(prisma)
const licenseEntitlementService = new LicenseEntitlementService(prisma)
const webhookRepository          = new WebhookRepository(prisma)
const webhookSigner          = new WebhookSignerService()
const webhookService         = new WebhookService(webhookRepository, webhookSigner, logRepository)
const webhookDispatcher      = new WebhookDispatcherService(webhookRepository, webhookSigner)
const emailConfigRepository  = new EmailConfigRepository(prisma)
const emailService           = new EmailService()
const emailConfigService     = new EmailConfigService(emailConfigRepository, emailService)

// ---------------------------------------------------------------------------
// Serviços / Gateways
// ---------------------------------------------------------------------------
const totpService        = new TotpService()
const userService        = new UserService(userRepository, webhookService)
const onePasswordService = new OnePasswordService(integrationRepository)
const openAiIntegrationService = new OpenAiIntegrationService()
const localAiIntegrationService = new LocalAiIntegrationService()
const jiraIntegrationService   = new JiraIntegrationService()
const sharedSessionBroker   = new SharedSessionBroker()
const googleService      = new GoogleService(integrationRepository, userRepository)
const authService        = new AuthService(userRepository, totpService, redis, googleService, emailConfigService, emailService)
const hostService            = new HostService(hostRepository, userRepository, logRepository, onePasswordService, webhookService)
const testConnectionService  = new TestConnectionService(prisma)
const integrationService     = new IntegrationService(integrationRepository, onePasswordService, googleService, openAiIntegrationService, localAiIntegrationService, jiraIntegrationService, licenseEntitlementService, logRepository)
const dashboardService       = new DashboardService(dashboardRepository)
const hostDashboardService   = new HostDashboardService(hostDashboardRepository, userRepository, redis)
const diagnosticPlaybookService = new DiagnosticPlaybookService(diagnosticPlaybookRepository, hostDashboardRepository, userRepository, logRepository)
const diagnosticRunAiService = new DiagnosticRunAiService(
  integrationRepository,
  diagnosticRunRepository,
  openAiIntegrationService,
  localAiIntegrationService,
)
const diagnosticRunService = new DiagnosticRunService(
  diagnosticRunRepository,
  diagnosticPlaybookRepository,
  hostDashboardRepository,
  userRepository,
  sshRepository,
  onePasswordService,
  logRepository,
  diagnosticRunAiService,
  webhookService,
)
const tagService             = new TagService(tagRepository)
const hostLinkService        = new HostLinkService(hostLinkRepository, hostRepository, userRepository, logRepository)
const sharedSessionService   = new SharedSessionService(sharedSessionRepository, hostRepository, userRepository, logRepository, sharedSessionBroker)
const userDashboardService   = new UserDashboardService(userDashboardRepository, redis)
const tunnelService          = new TunnelService(sshRepository, onePasswordService, logRepository)
const sessionAuditStorage    = new SessionAuditStorage()
const sessionAuditPolicyService = new SessionAuditPolicyService(sessionAuditPolicyRepository, redis)
const sessionAuditAiService  = new SessionAuditAiService(integrationRepository, sessionAuditAiRepository, localAiIntegrationService)
const sessionAuditPublisher  = new SessionAuditPublisher(sessionAuditRepository, sessionAuditStorage, sessionAuditAiService)
const sessionAuditService    = new SessionAuditService(sessionAuditRepository, sessionAuditStorage, sessionAuditAiRepository, sessionAuditAiService, integrationService, sharedSessionRepository)
const sessionAuditAiWorker   = new SessionAuditAiWorker(sessionAuditAiRepository, integrationRepository, openAiIntegrationService, localAiIntegrationService, sessionAuditService)
const secretService          = new SecretService(secretRepository, logRepository, licenseEntitlementService)
const tenantService          = new TenantService(tenantRepository)
const feedbackService        = new FeedbackService(feedbackRepository, licenseEntitlementService)
const localAiToolsService    = new LocalAiToolsService(prisma, licenseEntitlementService, localAiKnowledgeRepository)
const localAiKnowledgeService = new LocalAiKnowledgeService(localAiKnowledgeRepository, licenseEntitlementService, logRepository)
const localAiProposedActionService = new LocalAiProposedActionService(localAiProposedActionRepository, prisma, licenseEntitlementService, logRepository)
const localAiService         = new LocalAiService(integrationRepository, licenseEntitlementService, localAiToolsService)
const sshGateway             = new SshGateway(sshRepository, onePasswordService, tunnelService, sessionAuditPublisher, sessionAuditPolicyService, sharedSessionBroker, sharedSessionRepository, secretService, webhookService)
const sftpService            = new SftpService(sshRepository, onePasswordService)
const snippetService         = new SnippetService(prisma, licenseEntitlementService)
const snippetGroupService    = new SnippetGroupService(prisma, licenseEntitlementService)
const aiSshActionPolicyService = new AiSshActionPolicyService(licenseEntitlementService)
const aiSshActionCommandPolicyService = new AiSshActionCommandPolicyService(aiSshActionCommandPolicyRepository, licenseEntitlementService, logRepository)
const aiSshActionService     = new AiSshActionService(aiSshActionRepository, aiSshActionPolicyService, hostDashboardRepository, userRepository, sshRepository, onePasswordService, logRepository, aiSshActionCommandPolicyRepository, webhookService)
const mcpInteractiveSshService = new McpInteractiveSshService(sshRepository, onePasswordService, logRepository, prisma, webhookService)
const logService             = new LogService(logRepository, mcpInteractiveSshService)
const mcpService             = new McpService(prisma, hostDashboardService, diagnosticRunService, snippetService, aiSshActionService, aiSshActionCommandPolicyService, logRepository, mcpInteractiveSshService)
const mcpTokenService        = new McpTokenService(mcpTokenRepository, logRepository, licenseEntitlementService, webhookService)
const agentService           = new AgentService(prisma, licenseEntitlementService)
const settingsService  = new SettingsService(settingsRepository)
const sessionsService  = new SessionsService(sessionsRepository)
const folderService    = new FolderService(folderRepository, logRepository)
const bastionService   = new BastionService(bastionRepository, logRepository)
const pemKeyService          = new PemKeyService(pemKeyRepository, logRepository)
const groupService     = new GroupService(groupRepository, logRepository)

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------
const authController      = new AuthController(authService)
const userController      = new UserController(userService)
const groupController     = new GroupController(groupService)
const hostController      = new HostController(hostService, testConnectionService, folderService, groupService, tagService)
const settingsController  = new SettingsController(settingsService)
const sessionsController  = new SessionsController(sessionsService)
const folderController    = new FolderController(folderService)
const bastionController   = new BastionController(bastionService)
const pemKeyController       = new PemKeyController(pemKeyService)
const integrationController  = new IntegrationController(integrationService)
const logController          = new LogController(logService)
const dashboardController    = new DashboardController(dashboardService)
const hostDashboardController = new HostDashboardController(hostDashboardService)
const diagnosticPlaybookController = new DiagnosticPlaybookController(diagnosticPlaybookService)
const diagnosticRunController = new DiagnosticRunController(diagnosticRunService)
const tagController          = new TagController(tagService)
const hostLinkController     = new HostLinkController(hostLinkService)
const sharedSessionController = new SharedSessionController(sharedSessionService)
const userDashboardController = new UserDashboardController(userDashboardService)
const sharedSessionGateway   = new SharedSessionGateway(sharedSessionService, sharedSessionBroker)
const sftpController         = new SftpController(sftpService)
const snippetController      = new SnippetController(snippetService)
const snippetGroupController = new SnippetGroupController(snippetGroupService)
const tunnelController       = new TunnelController(tunnelService)
const agentController        = new AgentController(agentService)
const agentGateway           = new AgentGateway(agentService)
const portForwardingService    = new PortForwardingService(prisma, licenseEntitlementService, webhookService)
const portForwardingController = new PortForwardingController(portForwardingService)
const webAccessService         = new WebAccessService(portForwardingService, tunnelService, logRepository)
const webAccessController      = new WebAccessController(webAccessService)
const sessionAuditController   = new SessionAuditController(sessionAuditService)
const sessionAuditPolicyController = new SessionAuditPolicyController(sessionAuditPolicyService)
const secretController         = new SecretController(secretService)
const tenantController         = new TenantController(tenantService)
const feedbackController       = new FeedbackController(feedbackService)
const localAiController        = new LocalAiController(localAiService, localAiKnowledgeService, localAiProposedActionService)
const mcpController            = new McpController(mcpService)
const mcpTokenController       = new McpTokenController(mcpTokenService)
const aiSshActionController    = new AiSshActionController(aiSshActionService)
const aiSshActionCommandPolicyController = new AiSshActionCommandPolicyController(aiSshActionCommandPolicyService)
const webhookController      = new WebhookController(webhookService)
const emailConfigController  = new EmailConfigController(emailConfigService)

// ---------------------------------------------------------------------------
// Container exportado
// ---------------------------------------------------------------------------
export const container = {
  prisma,
  redis,
  logger,
  // Serviços expostos para uso interno (ex: startup hooks)
  sessionsService,
  googleService,
  sessionAuditAiWorker,
  sessionAuditService,
  // HTTP
  authController,
  userController,
  groupController,
  hostController,
  settingsController,
  sessionsController,
  folderController,
  bastionController,
  pemKeyController,
  integrationController,
  logController,
  dashboardController,
  hostDashboardController,
  diagnosticPlaybookController,
  diagnosticRunController,
  tagController,
  hostLinkController,
  sharedSessionController,
  userDashboardController,
  // WebSocket
  sshGateway,
  sharedSessionGateway,
  // SFTP
  sftpController,
  // Snippets
  snippetController,
  snippetGroupController,
  // Tunnels
  tunnelController,
  // Agents
  agentController,
  agentGateway,
  // Port Forwardings
  portForwardingController,
  // Web Access
  webAccessController,
  // Session Audit
  sessionAuditController,
  sessionAuditPolicyController,
  // Secrets
  secretController,
  // Platform
  tenantController,
  // Feedback
  feedbackController,
  // Local AI
  localAiController,
  // MCP
  mcpController,
  mcpTokenController,
  // AI SSH Actions
  aiSshActionController,
  aiSshActionCommandPolicyController,
  // Webhooks
  webhookController,
  webhookDispatcher,
  // Email
  emailConfigController,
} as const

export type Container = typeof container
