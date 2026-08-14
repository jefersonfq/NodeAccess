import { prisma } from './config/database.js'
import { redis } from './config/redis.js'
import { logger } from './config/logger.js'

// Repositórios
import { UserRepository }    from './modules/users/user.repository.js'
import { GroupRepository }   from './modules/groups/group.repository.js'
import { HostRepository }    from './modules/hosts/host.repository.js'
import { HostBulkActionRepository } from './modules/hosts/host-bulk-action.repository.js'
import { SshRepository }     from './modules/ssh/ssh.repository.js'
import { BastionRepository } from './modules/bastions/bastion.repository.js'
import { PemKeyRepository }      from './modules/pem-keys/pem-key.repository.js'
import { IntegrationRepository } from './modules/integrations/integration.repository.js'
import { LogRepository }         from './modules/logs/log.repository.js'
import { DashboardRepository }   from './modules/dashboard/dashboard.repository.js'
import { SnippetUsageReportRepository } from './modules/reports/snippet-usage-report.repository.js'
import { SessionUsageReportRepository } from './modules/reports/session-usage-report.repository.js'
import { SshTunnelReportRepository } from './modules/reports/ssh-tunnel-report.repository.js'
import { UserAdoptionReportRepository } from './modules/reports/user-adoption-report.repository.js'
import { ClientUxReportRepository } from './modules/reports/client-ux-report.repository.js'
import { HostKeyReportRepository } from './modules/reports/host-key-report.repository.js'
import { HostDashboardRepository } from './modules/host-dashboard/host-dashboard.repository.js'
import { DiagnosticPlaybookRepository } from './modules/diagnostic-playbooks/diagnostic-playbook.repository.js'
import { DiagnosticRunRepository } from './modules/diagnostic-playbooks/diagnostic-run.repository.js'
import { TagRepository }         from './modules/tags/tag.repository.js'
import { HostLinkRepository }    from './modules/host-links/host-link.repository.js'
import { SharedSessionRepository } from './modules/shared-sessions/shared-session.repository.js'
import { SharedSessionBroker } from './modules/shared-sessions/shared-session.broker.js'
import { AppEventBus } from './modules/app-events/app-event.bus.js'
import { UserDashboardRepository } from './modules/user-dashboard/user-dashboard.repository.js'
import { SecretRepository } from './modules/secrets/secret.repository.js'
import { TenantRepository } from './modules/tenants/tenant.repository.js'
import { InventoryRepository } from './modules/inventory/inventory.repository.js'
import { InventoryAclRepository } from './modules/inventory/inventory-acl.repository.js'
import { InventoryAclSessionRevocationService } from './modules/inventory/inventory-acl-session-revocation.service.js'
import { PlatformAdminRepository } from './modules/platform-admins/platform-admin.repository.js'
import { FeedbackRepository } from './modules/feedback/feedback.repository.js'
import { LicenseEntitlementService } from './modules/license/license-entitlement.service.js'

// Serviços
import { TotpService }    from './modules/auth/totp.service.js'
import { AuthService }    from './modules/auth/auth.service.js'
import { AuthRateLimitService } from './modules/auth/auth-rate-limit.service.js'
import { GoogleService }  from './modules/auth/google.service.js'
import { UserService }    from './modules/users/user.service.js'
import { GroupService }   from './modules/groups/group.service.js'
import { HostService }            from './modules/hosts/host.service.js'
import { HostBulkActionService }  from './modules/hosts/host-bulk-action.service.js'
import { TestConnectionService } from './modules/hosts/test-connection.service.js'
import { SshGateway }     from './modules/ssh/ssh.gateway.js'
import { GraphicalGateway } from './modules/graphical/graphical.gateway.js'
import {
  GuacdGraphicalSessionAdapter,
  PendingGraphicalSessionAdapter,
  type GraphicalSessionAdapter,
} from './modules/graphical/graphical-session.adapter.js'
import { SshSessionRuntimeRegistry } from './modules/ssh/ssh-session-runtime.registry.js'
import { GraphicalSessionRuntimeRegistry } from './modules/graphical/graphical-session-runtime.registry.js'
import { JitSessionRevocationBus } from './modules/ssh/jit-session-revocation.bus.js'
import { SessionRuntimeControlBus } from './modules/sessions/session-runtime-control.bus.js'
import { ManagedSshSessionService } from './modules/ssh/managed-ssh-session.service.js'
import { NativeSshGatewayService, type NativeSshGatewayConfig } from './modules/native-ssh-gateway/native-ssh-gateway.service.js'
import { SessionCommandPolicyRepository } from './modules/session-command-policy/session-command-policy.repository.js'
import { RepositorySessionCommandRuleProvider, SessionCommandSshInputPolicy } from './modules/session-command-policy/session-command-ssh-input-policy.js'
import { SessionCommandPolicyService } from './modules/session-command-policy/session-command-policy.service.js'
import { BastionService } from './modules/bastions/bastion.service.js'
import { PemKeyService }        from './modules/pem-keys/pem-key.service.js'
import { OnePasswordService }   from './modules/integrations/onepassword.service.js'
import { OpenAiIntegrationService } from './modules/integrations/openai.service.js'
import { LocalAiIntegrationService } from './modules/integrations/local-ai.service.js'
import { LdapIntegrationService } from './modules/integrations/ldap.service.js'
import { JiraIntegrationService } from './modules/integrations/jira.service.js'
import { IntegrationService }   from './modules/integrations/integration.service.js'
import { LogService }           from './modules/logs/log.service.js'
import { DashboardService }     from './modules/dashboard/dashboard.service.js'
import { SnippetUsageReportService } from './modules/reports/snippet-usage-report.service.js'
import { SessionUsageReportService } from './modules/reports/session-usage-report.service.js'
import { SshTunnelReportService } from './modules/reports/ssh-tunnel-report.service.js'
import { UserAdoptionReportService } from './modules/reports/user-adoption-report.service.js'
import { ClientUxReportService } from './modules/reports/client-ux-report.service.js'
import { HostKeyReportService } from './modules/reports/host-key-report.service.js'
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
import { LocalIdentityProvider } from './modules/auth/local-identity.provider.js'
import { LdapIdentityProvider } from './modules/auth/ldap-identity.provider.js'
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
import { ReportsController }     from './modules/reports/reports.controller.js'
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
import { SnippetExecutionEventService } from './modules/snippets/snippet-execution-event.service.js'
import { SnippetGroupService }   from './modules/snippets/snippet-group.service.js'
import { SnippetGroupController } from './modules/snippets/snippet-group.controller.js'
import { TunnelService }         from './modules/tunnels/tunnel.service.js'
import { TunnelController }      from './modules/tunnels/tunnel.controller.js'
import { AgentService }          from './modules/agents/agent.service.js'
import { AgentController }       from './modules/agents/agent.controller.js'
import { AgentGateway }          from './modules/agents/agent.gateway.js'
import { PortForwardingService }    from './modules/port-forwardings/port-forwarding.service.js'
import { SshTunnelEventService }   from './modules/port-forwardings/ssh-tunnel-event.service.js'
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
import { TenantAuthPolicyRepository } from './modules/auth/tenant-auth-policy.repository.js'
import { TenantAuthPolicyService } from './modules/auth/tenant-auth-policy.service.js'
import { TenantAuthPolicyController } from './modules/auth/tenant-auth-policy.controller.js'
import { OidcService } from './modules/auth/oidc.service.js'
import { OidcConfigService } from './modules/auth/oidc-config.service.js'
import { OidcConfigController } from './modules/auth/oidc-config.controller.js'
import { OidcFlowService } from './modules/auth/oidc-flow.service.js'
import { ExternalIdentityRepository } from './modules/auth/external-identity.repository.js'
import { ExternalIdentityService } from './modules/auth/external-identity.service.js'
import { ExternalIdentityAdminService } from './modules/auth/external-identity-admin.service.js'
import { ExternalIdentityAdminController } from './modules/auth/external-identity-admin.controller.js'
import { OidcGroupMappingRepository } from './modules/auth/oidc-group-mapping.repository.js'
import { OidcGroupMappingService } from './modules/auth/oidc-group-mapping.service.js'
import { OidcGroupMappingController } from './modules/auth/oidc-group-mapping.controller.js'
import { OidcAuthService } from './modules/auth/oidc-auth.service.js'
import { OidcAuthController } from './modules/auth/oidc-auth.controller.js'
import { ScimService } from './modules/auth/scim.service.js'
import { SessionAuditPublisher }    from './modules/session-audit/session-audit.publisher.js'
import { SessionAuditStorage }      from './modules/session-audit/session-audit.storage.js'
import { SessionAuditService }      from './modules/session-audit/session-audit.service.js'
import { SessionAuditController }   from './modules/session-audit/session-audit.controller.js'
import { SecretService }      from './modules/secrets/secret.service.js'
import { SecretController }   from './modules/secrets/secret.controller.js'
import { TenantService }      from './modules/tenants/tenant.service.js'
import { InventoryService } from './modules/inventory/inventory.service.js'
import { InventoryAclService } from './modules/inventory/inventory-acl.service.js'
import { HostImportService } from './modules/host-imports/host-import.service.js'
import { HostImportController } from './modules/host-imports/host-import.controller.js'
import { PlatformAdminService } from './modules/platform-admins/platform-admin.service.js'
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
import { InventoryController } from './modules/inventory/inventory.controller.js'
import { InventoryAclController } from './modules/inventory/inventory-acl.controller.js'
import { PlatformAdminController } from './modules/platform-admins/platform-admin.controller.js'
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
import { InboundWebhookRepository } from './modules/inbound-webhooks/inbound-webhook.repository.js'
import { InboundWebhookSignatureService } from './modules/inbound-webhooks/inbound-webhook-signature.service.js'
import { InboundWebhookService } from './modules/inbound-webhooks/inbound-webhook.service.js'
import { InboundWebhookController } from './modules/inbound-webhooks/inbound-webhook.controller.js'
import { EmailService }                from './modules/email/email.service.js'
import { EmailConfigRepository }       from './modules/email/email-config.repository.js'
import { EmailConfigService }          from './modules/email/email-config.service.js'
import { EmailConfigController }       from './modules/email/email-config.controller.js'
import { SessionCommandPolicyController } from './modules/session-command-policy/session-command-policy.controller.js'
import { env } from './config/env.js'

// ---------------------------------------------------------------------------
// Repositórios
// ---------------------------------------------------------------------------
const userRepository         = new UserRepository(prisma)
const groupRepository        = new GroupRepository(prisma)
const settingsRepository     = new SettingsRepository(prisma)
const sessionsRepository     = new SessionsRepository(prisma)
const folderRepository       = new FolderRepository(prisma)
const inventoryRepository    = new InventoryRepository(prisma)
const inventoryAclRepository = new InventoryAclRepository(prisma)
const sshRepository          = new SshRepository(prisma, inventoryAclRepository)
const bastionRepository      = new BastionRepository(prisma)
const pemKeyRepository       = new PemKeyRepository(prisma)
const integrationRepository  = new IntegrationRepository(prisma)
const logRepository          = new LogRepository(prisma)
const dashboardRepository    = new DashboardRepository(prisma)
const snippetUsageReportRepository = new SnippetUsageReportRepository(prisma)
const sessionUsageReportRepository = new SessionUsageReportRepository(prisma)
const sshTunnelReportRepository = new SshTunnelReportRepository(prisma)
const userAdoptionReportRepository = new UserAdoptionReportRepository(prisma)
const clientUxReportRepository = new ClientUxReportRepository(prisma)
const hostKeyReportRepository = new HostKeyReportRepository(prisma)
const hostDashboardRepository = new HostDashboardRepository(prisma)
const diagnosticPlaybookRepository = new DiagnosticPlaybookRepository(prisma)
const diagnosticRunRepository = new DiagnosticRunRepository(prisma)
const tagRepository          = new TagRepository(prisma)
const hostLinkRepository     = new HostLinkRepository(prisma)
const sharedSessionRepository = new SharedSessionRepository(prisma)
const appEventBus = new AppEventBus(redis)
const userDashboardRepository = new UserDashboardRepository(prisma)
const hostRepository         = new HostRepository(prisma, tagRepository)
const hostBulkActionRepository = new HostBulkActionRepository(prisma)
const sessionAuditRepository = new SessionAuditRepository(prisma)
const sessionAuditAiRepository = new SessionAuditAiRepository(prisma)
const sessionAuditPolicyRepository = new SessionAuditPolicyRepository(prisma)
const tenantAuthPolicyRepository = new TenantAuthPolicyRepository(prisma)
const externalIdentityRepository = new ExternalIdentityRepository(prisma)
const oidcGroupMappingRepository = new OidcGroupMappingRepository(prisma)
const secretRepository       = new SecretRepository(prisma)
const tenantRepository       = new TenantRepository(prisma)
const platformAdminRepository = new PlatformAdminRepository(prisma)
const feedbackRepository     = new FeedbackRepository(prisma)
const localAiKnowledgeRepository = new LocalAiKnowledgeRepository(prisma)
const localAiProposedActionRepository = new LocalAiProposedActionRepository(prisma)
const mcpTokenRepository = new McpTokenRepository(prisma)
const aiSshActionRepository = new AiSshActionRepository(prisma)
const aiSshActionCommandPolicyRepository = new AiSshActionCommandPolicyRepository(prisma)
const sessionCommandPolicyRepository = new SessionCommandPolicyRepository(prisma)
const licenseEntitlementService = new LicenseEntitlementService(prisma)
const webhookRepository          = new WebhookRepository(prisma)
const webhookSigner          = new WebhookSignerService()
const webhookService         = new WebhookService(webhookRepository, webhookSigner, logRepository)
const webhookDispatcher      = new WebhookDispatcherService(webhookRepository, webhookSigner)
const inboundWebhookRepository = new InboundWebhookRepository(prisma)
const inboundWebhookSignature = new InboundWebhookSignatureService()
const inboundWebhookService = new InboundWebhookService(inboundWebhookRepository, inboundWebhookSignature, logRepository)
const emailConfigRepository  = new EmailConfigRepository(prisma)
const emailService           = new EmailService()
const emailConfigService     = new EmailConfigService(emailConfigRepository, emailService)
const tenantAuthPolicyService = new TenantAuthPolicyService(tenantAuthPolicyRepository, logRepository, userRepository)

// ---------------------------------------------------------------------------
// Serviços / Gateways
// ---------------------------------------------------------------------------
const totpService        = new TotpService()
const userService        = new UserService(userRepository, webhookService, appEventBus)
const onePasswordService = new OnePasswordService(integrationRepository, secretRepository)
const openAiIntegrationService = new OpenAiIntegrationService()
const localAiIntegrationService = new LocalAiIntegrationService()
const ldapIntegrationService = new LdapIntegrationService()
const jiraIntegrationService   = new JiraIntegrationService()
const sharedSessionBroker   = new SharedSessionBroker()
const sshSessionRuntimeRegistry = new SshSessionRuntimeRegistry()
const graphicalSessionRuntimeRegistry = new GraphicalSessionRuntimeRegistry()
const jitSessionRevocationBus = new JitSessionRevocationBus(redis, sshSessionRuntimeRegistry)
const sessionRuntimeControlBus = new SessionRuntimeControlBus(redis, sshSessionRuntimeRegistry, graphicalSessionRuntimeRegistry)
const sshTunnelEventService = new SshTunnelEventService(prisma)
const tunnelService          = new TunnelService(sshRepository, onePasswordService, logRepository, sshTunnelEventService)
const inventoryAclSessionRevocationService = new InventoryAclSessionRevocationService(appEventBus, sessionsRepository, sshRepository, sessionRuntimeControlBus, logRepository, tunnelService)
const googleService      = new GoogleService(integrationRepository, userRepository)
const localIdentityProvider = new LocalIdentityProvider(userRepository)
const ldapIdentityProvider = new LdapIdentityProvider(integrationRepository, ldapIntegrationService, userRepository)
const authService        = new AuthService(userRepository, totpService, redis, googleService, emailConfigService, emailService, localIdentityProvider, ldapIdentityProvider, tenantAuthPolicyService)
const authRateLimitService = new AuthRateLimitService(redis, {
  windowSeconds: env.AUTH_RATE_LIMIT_WINDOW_SECONDS,
  ip: env.AUTH_RATE_LIMIT_IP_MAX_REQUESTS,
  tenant: env.AUTH_RATE_LIMIT_TENANT_MAX_REQUESTS,
  identity: env.AUTH_RATE_LIMIT_IDENTITY_MAX_REQUESTS,
  keySecret: env.JWT_SECRET,
})
const hostService            = new HostService(hostRepository, sshRepository, logRepository, onePasswordService, webhookService, redis, appEventBus)
const hostBulkActionService  = new HostBulkActionService(hostBulkActionRepository, logRepository, appEventBus)
const testConnectionService  = new TestConnectionService(prisma, sshRepository)
const integrationService     = new IntegrationService(integrationRepository, onePasswordService, googleService, ldapIntegrationService, openAiIntegrationService, localAiIntegrationService, jiraIntegrationService, licenseEntitlementService, logRepository, sshRepository, inventoryRepository)
const dashboardService       = new DashboardService(dashboardRepository)
const snippetUsageReportService = new SnippetUsageReportService(snippetUsageReportRepository)
const sessionUsageReportService = new SessionUsageReportService(sessionUsageReportRepository)
const sshTunnelReportService = new SshTunnelReportService(sshTunnelReportRepository)
const userAdoptionReportService = new UserAdoptionReportService(userAdoptionReportRepository)
const clientUxReportService = new ClientUxReportService(clientUxReportRepository)
const hostKeyReportService = new HostKeyReportService(hostKeyReportRepository)
const hostDashboardService   = new HostDashboardService(hostDashboardRepository, sshRepository, redis)
const diagnosticPlaybookService = new DiagnosticPlaybookService(diagnosticPlaybookRepository, hostDashboardRepository, sshRepository, logRepository)
const diagnosticRunAiService = new DiagnosticRunAiService(
  integrationRepository,
  diagnosticRunRepository,
  openAiIntegrationService,
  localAiIntegrationService,
)
const diagnosticRunService = new DiagnosticRunService(
  diagnosticRunRepository,
  diagnosticPlaybookRepository,
  sshRepository,
  onePasswordService,
  logRepository,
  diagnosticRunAiService,
  webhookService,
)
const tagService             = new TagService(tagRepository)
const hostLinkService        = new HostLinkService(hostLinkRepository, hostRepository, sshRepository, logRepository, settingsRepository, sshSessionRuntimeRegistry, jitSessionRevocationBus)
const sharedSessionService   = new SharedSessionService(sharedSessionRepository, hostRepository, sshRepository, logRepository, settingsRepository, sharedSessionBroker)
const userDashboardService   = new UserDashboardService(userDashboardRepository, redis, sshRepository)
const sessionAuditStorage    = new SessionAuditStorage()
const sessionAuditPolicyService = new SessionAuditPolicyService(sessionAuditPolicyRepository, redis)
const oidcService = new OidcService()
const oidcConfigService = new OidcConfigService(integrationRepository, oidcService, logRepository, licenseEntitlementService)
const oidcFlowService = new OidcFlowService(redis, oidcConfigService, oidcService)
const externalIdentityService = new ExternalIdentityService(externalIdentityRepository, oidcConfigService, tenantAuthPolicyService, oidcGroupMappingRepository)
const externalIdentityAdminService = new ExternalIdentityAdminService(externalIdentityRepository, userRepository)
const oidcGroupMappingService = new OidcGroupMappingService(oidcGroupMappingRepository, userRepository)
const oidcAuthService = new OidcAuthService(userRepository, oidcConfigService, oidcFlowService, externalIdentityService, authService, tenantAuthPolicyService)
const scimService = new ScimService(prisma, licenseEntitlementService)
const sessionAuditAiService  = new SessionAuditAiService(integrationRepository, sessionAuditAiRepository, localAiIntegrationService)
const sessionAuditPublisher  = new SessionAuditPublisher(sessionAuditRepository, sessionAuditStorage, sessionAuditAiService)
const sessionAuditService    = new SessionAuditService(sessionAuditRepository, sessionAuditStorage, sessionAuditAiRepository, sessionAuditAiService, integrationService, sharedSessionRepository)
const sessionAuditAiWorker   = new SessionAuditAiWorker(sessionAuditAiRepository, integrationRepository, openAiIntegrationService, localAiIntegrationService, sessionAuditService)
const secretService          = new SecretService(secretRepository, logRepository, licenseEntitlementService)
const tenantService          = new TenantService(tenantRepository)
const platformAdminService   = new PlatformAdminService(platformAdminRepository)
const feedbackService        = new FeedbackService(feedbackRepository, licenseEntitlementService)
const localAiToolsService    = new LocalAiToolsService(prisma, licenseEntitlementService, localAiKnowledgeRepository, sshRepository)
const localAiKnowledgeService = new LocalAiKnowledgeService(localAiKnowledgeRepository, licenseEntitlementService, logRepository)
const localAiProposedActionService = new LocalAiProposedActionService(localAiProposedActionRepository, prisma, licenseEntitlementService, logRepository, sshRepository)
const localAiService         = new LocalAiService(integrationRepository, licenseEntitlementService, localAiToolsService)
const sessionCommandRuleProvider = new RepositorySessionCommandRuleProvider(sessionCommandPolicyRepository)
const sshInputPolicy = new SessionCommandSshInputPolicy(sessionCommandRuleProvider)
const managedSshSessionService = new ManagedSshSessionService(sshRepository, onePasswordService, sessionAuditPublisher, sessionAuditPolicyService, sshInputPolicy)
const snippetExecutionEventService = new SnippetExecutionEventService(prisma)
const sshGateway             = new SshGateway(sshRepository, onePasswordService, tunnelService, sessionAuditPublisher, sessionAuditPolicyService, sharedSessionBroker, sharedSessionRepository, secretService, webhookService, managedSshSessionService, sshSessionRuntimeRegistry, logRepository, snippetExecutionEventService, appEventBus, integrationRepository, inventoryRepository)
function createGraphicalSessionAdapter(): GraphicalSessionAdapter {
  if (env.GRAPHICAL_GATEWAY_ADAPTER === 'guacd') {
    logger.info({
      host: env.GUACD_HOST,
      port: env.GUACD_PORT,
      connectTimeoutMs: env.GUACD_CONNECT_TIMEOUT_MS,
      imageMimeTypes: env.GUACD_IMAGE_MIMETYPES,
      enableAudioStreams: env.GUACD_ENABLE_AUDIO_STREAMS,
      enableVideoStreams: env.GUACD_ENABLE_VIDEO_STREAMS,
      rdpSecurity: env.GUACD_RDP_SECURITY,
      rdpIgnoreCert: env.GUACD_RDP_IGNORE_CERT,
      rdpResizeMethod: env.GUACD_RDP_RESIZE_METHOD,
      rdpColorDepth: env.GUACD_RDP_COLOR_DEPTH,
      rdpForceLossless: env.GUACD_RDP_FORCE_LOSSLESS,
      rdpServerLayout: env.GUACD_RDP_SERVER_LAYOUT,
      rdpEnableWallpaper: env.GUACD_RDP_ENABLE_WALLPAPER,
      rdpEnableTheming: env.GUACD_RDP_ENABLE_THEMING,
      rdpEnableFontSmoothing: env.GUACD_RDP_ENABLE_FONT_SMOOTHING,
      rdpEnableFullWindowDrag: env.GUACD_RDP_ENABLE_FULL_WINDOW_DRAG,
      rdpEnableDesktopComposition: env.GUACD_RDP_ENABLE_DESKTOP_COMPOSITION,
      rdpEnableMenuAnimations: env.GUACD_RDP_ENABLE_MENU_ANIMATIONS,
      rdpDisableGfx: env.GUACD_RDP_DISABLE_GFX,
      rdpDisableBitmapCaching: env.GUACD_RDP_DISABLE_BITMAP_CACHING,
      rdpDisableOffscreenCaching: env.GUACD_RDP_DISABLE_OFFSCREEN_CACHING,
      vncColorDepth: env.GUACD_VNC_COLOR_DEPTH,
      vncReadOnly: env.GUACD_VNC_READ_ONLY,
      vncSwapRedBlue: env.GUACD_VNC_SWAP_RED_BLUE,
      vncCursor: env.GUACD_VNC_CURSOR,
    }, 'Graphical gateway configured for guacd adapter')
    return new GuacdGraphicalSessionAdapter({
      host: env.GUACD_HOST,
      port: env.GUACD_PORT,
      connectTimeoutMs: env.GUACD_CONNECT_TIMEOUT_MS,
      imageMimeTypes: env.GUACD_IMAGE_MIMETYPES.split(','),
      enableAudioStreams: env.GUACD_ENABLE_AUDIO_STREAMS,
      enableVideoStreams: env.GUACD_ENABLE_VIDEO_STREAMS,
      rdpDefaults: {
        security: env.GUACD_RDP_SECURITY,
        ignoreCert: env.GUACD_RDP_IGNORE_CERT,
        resizeMethod: env.GUACD_RDP_RESIZE_METHOD,
        colorDepth: env.GUACD_RDP_COLOR_DEPTH as 8 | 16 | 24,
        forceLossless: env.GUACD_RDP_FORCE_LOSSLESS,
        enableWallpaper: env.GUACD_RDP_ENABLE_WALLPAPER,
        enableTheming: env.GUACD_RDP_ENABLE_THEMING,
        enableFontSmoothing: env.GUACD_RDP_ENABLE_FONT_SMOOTHING,
        enableFullWindowDrag: env.GUACD_RDP_ENABLE_FULL_WINDOW_DRAG,
        enableDesktopComposition: env.GUACD_RDP_ENABLE_DESKTOP_COMPOSITION,
        enableMenuAnimations: env.GUACD_RDP_ENABLE_MENU_ANIMATIONS,
        serverLayout: env.GUACD_RDP_SERVER_LAYOUT,
        disableGfx: env.GUACD_RDP_DISABLE_GFX,
        disableBitmapCaching: env.GUACD_RDP_DISABLE_BITMAP_CACHING,
        disableOffscreenCaching: env.GUACD_RDP_DISABLE_OFFSCREEN_CACHING,
      },
      vncDefaults: {
        colorDepth: env.GUACD_VNC_COLOR_DEPTH as 8 | 16 | 24 | 32,
        readOnly: env.GUACD_VNC_READ_ONLY,
        swapRedBlue: env.GUACD_VNC_SWAP_RED_BLUE,
        cursor: env.GUACD_VNC_CURSOR,
      },
    })
  }

  return new PendingGraphicalSessionAdapter()
}
const graphicalSessionAdapter = createGraphicalSessionAdapter()
const graphicalGateway       = new GraphicalGateway(sshRepository, sessionAuditPublisher, sessionAuditPolicyService, graphicalSessionAdapter, graphicalSessionRuntimeRegistry)
async function loadNativeSshGatewayRuntimeConfig(): Promise<NativeSshGatewayConfig | null> {
  const rows = await prisma.$queryRaw<Array<{
    enabled: boolean | number | bigint
    bindHost: string
    port: number
    hostKeyPath: string | null
  }>>`
    SELECT
      enabled,
      bind_host AS bindHost,
      port,
      host_key_path AS hostKeyPath
    FROM native_ssh_gateway_configs
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `

  const row = rows[0]
  if (!row) return null

  return {
    enabled: row.enabled === true || row.enabled === 1 || row.enabled === BigInt(1),
    host: row.bindHost,
    port: row.port,
    ...(row.hostKeyPath !== null && { hostKeyPath: row.hostKeyPath }),
  }
}
const nativeSshGateway       = new NativeSshGatewayService({
  enabled: env.FEATURE_NATIVE_SSH_GATEWAY,
  port: env.NATIVE_SSH_GATEWAY_PORT,
  host: env.NATIVE_SSH_GATEWAY_HOST,
  hostKeyPath: env.NATIVE_SSH_GATEWAY_HOST_KEY_PATH,
}, sshRepository, totpService, redis, emailConfigService, emailService, managedSshSessionService, logRepository, loadNativeSshGatewayRuntimeConfig)
const sftpService            = new SftpService(sshRepository, onePasswordService)
const snippetService         = new SnippetService(prisma, licenseEntitlementService)
const snippetGroupService    = new SnippetGroupService(prisma, licenseEntitlementService)
const aiSshActionPolicyService = new AiSshActionPolicyService(licenseEntitlementService)
const aiSshActionCommandPolicyService = new AiSshActionCommandPolicyService(aiSshActionCommandPolicyRepository, licenseEntitlementService, logRepository)
const sessionCommandPolicyService = new SessionCommandPolicyService(sessionCommandPolicyRepository)
const aiSshActionService     = new AiSshActionService(aiSshActionRepository, aiSshActionPolicyService, sshRepository, onePasswordService, logRepository, aiSshActionCommandPolicyRepository, webhookService)
const mcpInteractiveSshService = new McpInteractiveSshService(sshRepository, onePasswordService, logRepository, prisma, webhookService)
const logService             = new LogService(logRepository, mcpInteractiveSshService)
const mcpService             = new McpService(prisma, hostDashboardService, diagnosticRunService, snippetService, aiSshActionService, aiSshActionCommandPolicyService, logRepository, mcpInteractiveSshService, sshRepository)
const mcpTokenService        = new McpTokenService(mcpTokenRepository, logRepository, licenseEntitlementService, webhookService)
const agentService           = new AgentService(prisma, licenseEntitlementService)
const settingsService  = new SettingsService(settingsRepository)
const sessionsService  = new SessionsService(sessionsRepository, sshSessionRuntimeRegistry, graphicalSessionRuntimeRegistry, sessionRuntimeControlBus, sshRepository, appEventBus)
const folderService    = new FolderService(folderRepository, logRepository)
const inventoryService = new InventoryService(inventoryRepository, logRepository, appEventBus)
const inventoryAclService = new InventoryAclService(inventoryAclRepository, logRepository, appEventBus, inventoryRepository)
const hostImportService = new HostImportService(redis, hostService, inventoryService, inventoryAclService, secretService)
const bastionService   = new BastionService(bastionRepository, logRepository)
const pemKeyService          = new PemKeyService(pemKeyRepository, logRepository)
const groupService     = new GroupService(groupRepository, logRepository)

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------
const authController      = new AuthController(authService, authRateLimitService)
const userController      = new UserController(userService)
const groupController     = new GroupController(groupService)
const hostController      = new HostController(hostService, testConnectionService, folderService, groupService, tagService, hostBulkActionService)
const settingsController  = new SettingsController(settingsService)
const sessionsController  = new SessionsController(sessionsService)
const folderController    = new FolderController(folderService)
const inventoryController = new InventoryController(inventoryService)
const inventoryAclController = new InventoryAclController(inventoryAclService)
const hostImportController = new HostImportController(hostImportService)
const bastionController   = new BastionController(bastionService)
const pemKeyController       = new PemKeyController(pemKeyService)
const integrationController  = new IntegrationController(integrationService)
const logController          = new LogController(logService)
const dashboardController    = new DashboardController(dashboardService)
const reportsController      = new ReportsController(snippetUsageReportService, sessionUsageReportService, sshTunnelReportService, userAdoptionReportService, clientUxReportService, hostKeyReportService)
const hostDashboardController = new HostDashboardController(hostDashboardService)
const diagnosticPlaybookController = new DiagnosticPlaybookController(diagnosticPlaybookService)
const diagnosticRunController = new DiagnosticRunController(diagnosticRunService)
const tagController          = new TagController(tagService)
const hostLinkController     = new HostLinkController(hostLinkService)
const sharedSessionController = new SharedSessionController(sharedSessionService)
const userDashboardController = new UserDashboardController(userDashboardService)
const sharedSessionGateway   = new SharedSessionGateway(sharedSessionService, sharedSessionBroker)
const sftpController         = new SftpController(sftpService, logRepository, settingsRepository)
const snippetController      = new SnippetController(snippetService)
const snippetGroupController = new SnippetGroupController(snippetGroupService)
const tunnelController       = new TunnelController(tunnelService)
const agentController        = new AgentController(agentService)
const agentGateway           = new AgentGateway(agentService)
const portForwardingService    = new PortForwardingService(prisma, licenseEntitlementService, webhookService, sshRepository)
const portForwardingController = new PortForwardingController(portForwardingService)
const webAccessService         = new WebAccessService(portForwardingService, tunnelService, logRepository, sshTunnelEventService)
const webAccessController      = new WebAccessController(webAccessService)
const sessionAuditController   = new SessionAuditController(sessionAuditService)
const sessionAuditPolicyController = new SessionAuditPolicyController(sessionAuditPolicyService)
const tenantAuthPolicyController = new TenantAuthPolicyController(tenantAuthPolicyService)
const oidcConfigController = new OidcConfigController(oidcConfigService)
const oidcAuthController = new OidcAuthController(oidcAuthService, authRateLimitService)
const externalIdentityAdminController = new ExternalIdentityAdminController(externalIdentityAdminService)
const oidcGroupMappingController = new OidcGroupMappingController(oidcGroupMappingService)
const secretController         = new SecretController(secretService)
const tenantController         = new TenantController(tenantService)
const platformAdminController  = new PlatformAdminController(platformAdminService)
const feedbackController       = new FeedbackController(feedbackService)
const localAiController        = new LocalAiController(localAiService, localAiKnowledgeService, localAiProposedActionService)
const mcpController            = new McpController(mcpService)
const mcpTokenController       = new McpTokenController(mcpTokenService)
const aiSshActionController    = new AiSshActionController(aiSshActionService)
const aiSshActionCommandPolicyController = new AiSshActionCommandPolicyController(aiSshActionCommandPolicyService)
const sessionCommandPolicyController = new SessionCommandPolicyController(sessionCommandPolicyService)
const webhookController      = new WebhookController(webhookService)
const inboundWebhookController = new InboundWebhookController(inboundWebhookService)
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
  nativeSshGateway,
  jitSessionRevocationBus,
  sessionRuntimeControlBus,
  sshSessionRuntimeRegistry,
  inventoryAclSessionRevocationService,
  appEventBus,
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
  inventoryController,
  inventoryAclController,
  hostImportController,
  bastionController,
  pemKeyController,
  integrationController,
  logController,
  dashboardController,
  reportsController,
  hostDashboardController,
  diagnosticPlaybookController,
  diagnosticRunController,
  tagController,
  hostLinkController,
  sharedSessionController,
  userDashboardController,
  // WebSocket
  sshGateway,
  graphicalGateway,
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
  tenantAuthPolicyController,
  oidcConfigController,
  oidcAuthController,
  externalIdentityAdminController,
  oidcGroupMappingController,
  scimService,
  // Secrets
  secretController,
  // Platform
  tenantController,
  platformAdminController,
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
  sessionCommandPolicyController,
  // Webhooks
  webhookController,
  webhookDispatcher,
  inboundWebhookController,
  // Email
  emailConfigController,
} as const

export type Container = typeof container
