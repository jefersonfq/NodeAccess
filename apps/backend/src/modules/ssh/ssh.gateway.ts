import jwt from 'jsonwebtoken'
import type { Duplex } from 'node:stream'
import type { WebSocket } from 'ws'
import { env } from '../../config/env.js'
import { logger } from '../../config/logger.js'
import { HostKeyVerificationError, SshConnectionStepError } from './ssh.session.js'
import type { RouteSnapshot, SshRepository } from './ssh.repository.js'
import type { ManagedSshSessionService } from './managed-ssh-session.service.js'
import type { OnePasswordService } from '../integrations/onepassword.service.js'
import type { JwtPayload } from '../../shared/guards.js'
import type { TunnelService } from '../tunnels/tunnel.service.js'
import type { SessionAuditPublisher } from '../session-audit/session-audit.publisher.js'
import type { SessionAuditPolicyService } from '../session-audit/session-audit-policy.service.js'
import { encrypt } from '../../shared/crypto.js'
import { agentRegistry } from '../agents/agent.registry.js'
import { describeAgentTcpError } from '../agents/agent-error-message.js'
import type { SharedSessionBroker } from '../shared-sessions/shared-session.broker.js'
import type { SharedSessionRepository } from '../shared-sessions/shared-session.repository.js'
import type { SecretService } from '../secrets/secret.service.js'
import type { WebhookService } from '../webhooks/webhook.service.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { SnippetExecutionEventService } from '../snippets/snippet-execution-event.service.js'
import type { AppEventBus } from '../app-events/app-event.bus.js'
import { SecretRedactor } from '../secrets/secret-redactor.js'
import { DURATION_MS_BUCKETS, metrics } from '../../shared/metrics.js'
import type { SshSessionRuntimeRegistry } from './ssh-session-runtime.registry.js'
import { openTelnetSession, type TelnetSessionOpener } from './telnet.session.js'

interface ResizeMsg { type: 'resize'; cols: number; rows: number }
interface PingMsg   { type: 'ping' }
interface SnippetExecutionMsg {
  type: 'snippet_execution'
  snippetId: number
  snippetName?: string
  executionId: string
}
interface SnippetInputMsg {
  type: 'snippet_input'
  text: string
  snippetId: number
  snippetName?: string
  executionId: string
}
interface SecretInputMsg {
  type: 'secret_input'
  text: string
  snippetId?: number
  snippetName?: string
  executionId?: string
}
interface CredentialsResponseMsg { type: 'credentials_response'; username?: string; password?: string }
type ControlMsg = ResizeMsg | PingMsg | SnippetExecutionMsg | SnippetInputMsg | SecretInputMsg | CredentialsResponseMsg
type TerminalSessionHandle = {
  write(data: Buffer): void
  resize(cols: number, rows: number): void
  close(): void | Promise<void>
}

interface AdHocCredentials { username?: string; password?: string }
interface SshConnectionMeta { clientIp?: string; userAgent?: string }
interface JitHostAccessPayload {
  stage: 'jit_host_access'
  sub: string
  tenantId: number
  hostId: number
  linkId: number
  guestName: string
  exp?: number
}
interface SshConnectionPrincipal {
  userId: number
  tenantId: number
  role: 'admin' | 'user'
  email?: string
  isJit: boolean
  jitLinkId?: number
  guestName?: string
}

function waitForCredentialsResponse(ws: WebSocket, timeoutMs = 60_000): Promise<AdHocCredentials | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', onMessage)
      resolve(null)
    }, timeoutMs)

    const onMessage = (...args: unknown[]) => {
      try {
        const raw = args[0] as Buffer | ArrayBuffer | Buffer[]
        const msg = JSON.parse(toBuffer(raw).toString()) as ControlMsg
        if (msg.type === 'credentials_response') {
          const creds: AdHocCredentials = {}
          if (typeof msg.username === 'string' && msg.username.trim().length > 0) creds.username = msg.username.trim()
          if (typeof msg.password === 'string' && msg.password.length > 0) creds.password = msg.password
          clearTimeout(timer)
          ws.removeListener('message', onMessage)
          resolve(creds)
        }
      } catch { /* ignore non-JSON */ }
    }

    ws.on('message', onMessage)
    ws.once('close', () => {
      clearTimeout(timer)
      ws.removeListener('message', onMessage)
      resolve(null)
    })
  })
}
const SESSION_HEARTBEAT_WRITE_INTERVAL_MS = 30_000

function send(ws: WebSocket, msg: object): void {
  ws.send(JSON.stringify(msg))
}

function toBuffer(raw: Buffer | ArrayBuffer | Buffer[]): Buffer {
  if (Buffer.isBuffer(raw)) return raw
  if (raw instanceof ArrayBuffer) return Buffer.from(raw)
  return Buffer.concat(raw.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
}

function agentRequiredMessage(mode: string): { message: string; errorCode: string } {
  if (mode === 'AGENT_USER') return { message: 'Este host exige o agente do seu usuário online para conexão', errorCode: 'AGENT_REQUIRED_USER' }
  if (mode === 'PRIVATE_ACCESS_CONNECTOR') return { message: 'Este host exige um conector de acesso privado online e dentro do escopo configurado', errorCode: 'PRIVATE_ACCESS_CONNECTOR_REQUIRED' }
  return { message: 'Este host exige um agente online para conexão', errorCode: 'AGENT_REQUIRED' }
}

function closeWithError(ws: WebSocket, message: string, wsCode = 1008, errorCode?: string): void {
  send(ws, { type: 'error', message, ...(errorCode && { code: errorCode }) })
  ws.close(wsCode)
}

function telnetConnectionMethod(method: 'direct' | 'user_agent' | 'tenant_agent' | 'private_access_connector'): 'telnet_direct' | 'telnet_user_agent' | 'telnet_tenant_agent' {
  if (method === 'user_agent') return 'telnet_user_agent'
  if (method === 'tenant_agent') return 'telnet_tenant_agent'
  if (method === 'private_access_connector') return 'telnet_tenant_agent'
  return 'telnet_direct'
}

export class SshGateway {
  constructor(
    private readonly sshRepo:       SshRepository,
    private readonly onePassword:   OnePasswordService,
    private readonly tunnelService: TunnelService,
    private readonly sessionAuditPublisher: SessionAuditPublisher,
    private readonly sessionAuditPolicyService: SessionAuditPolicyService,
    private readonly sharedSessionBroker: SharedSessionBroker,
    private readonly sharedSessionRepo: SharedSessionRepository,
    private readonly secretService: SecretService,
    private readonly webhookService: WebhookService,
    private readonly managedSshSessionService: ManagedSshSessionService,
    private readonly runtimeRegistry?: SshSessionRuntimeRegistry,
    private readonly logRepo?: LogRepository,
    private readonly snippetExecutionEvents?: SnippetExecutionEventService,
    private readonly appEventBus?: AppEventBus,
    private readonly telnetSessionOpener: TelnetSessionOpener = openTelnetSession,
  ) {}

  private publishSessionPresenceChanged(event: {
    tenantId: number
    hostId: number
    sessionId: number | null
    userId: number | null
    action: 'started' | 'ended' | 'timeout' | 'cleanup' | 'reconnected'
  }): void {
    void this.appEventBus?.publish({
      type: 'session_presence_changed',
      ...event,
      changedAt: new Date().toISOString(),
    }).catch(() => {})
  }

  async handleConnection(ws: WebSocket, token: string | undefined, hostId: number, cols = 80, rows = 24, meta: SshConnectionMeta = {}): Promise<void> {
    const connectionStartedAt = Date.now()
    metrics.addGauge('nodeaccess_ssh_gateway_connections_active', 'Active SSH gateway WebSocket connections', {}, 1)
    ws.once('close', () => {
      metrics.addGauge('nodeaccess_ssh_gateway_connections_active', 'Active SSH gateway WebSocket connections', {}, -1)
    })

    // 1. Autenticação via JWT (passado como query param — único modo suportado pelo browser WebSocket)
    if (!token) return closeWithError(ws, 'Token obrigatório')

    let principal: SshConnectionPrincipal
    let jitExpiresAtMs: number | null = null
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload | JitHostAccessPayload
      if (payload.stage === 'authenticated') {
        principal = {
          userId: Number(payload.sub),
          tenantId: payload.tenantId,
          role: payload.role,
          email: payload.email,
          isJit: false,
        }
      } else if (payload.stage === 'jit_host_access') {
        if (payload.hostId !== hostId) throw new Error('Invalid host')
        jitExpiresAtMs = typeof payload.exp === 'number' ? payload.exp * 1000 : null
        principal = {
          userId: Number(payload.sub),
          tenantId: payload.tenantId,
          role: 'user',
          isJit: true,
          jitLinkId: payload.linkId,
          guestName: payload.guestName,
        }
      } else {
        throw new Error('Invalid stage')
      }
    } catch {
      return closeWithError(ws, 'Token inválido ou expirado')
    }

    // 2. Buscar host com credenciais (já decriptadas no SshSession)
    const host = await this.sshRepo.findHostWithCredentials(hostId, principal.tenantId)
    if (!host) return closeWithError(ws, 'Host não encontrado')

    // 3. Verificar permissão efetiva. Links JIT são concessões temporárias próprias.
    let userGroupIds: number[] = []
    if (!principal.isJit && !await this.sshRepo.hasEffectiveHostPermission(
      host.id,
      principal.tenantId,
      principal.userId,
      'connect',
      principal.role.toUpperCase() as 'ADMIN' | 'USER',
    )) {
      return closeWithError(ws, 'Sem permissão para conectar a este host')
    }
    if (!principal.isJit && userGroupIds.length === 0) {
      userGroupIds = await this.sshRepo.getUserGroupIds(principal.userId)
    }

    if (host.accessProtocol !== 'SSH' && host.accessProtocol !== 'TELNET') {
      return closeWithError(ws, `Protocolo ${host.accessProtocol} ainda não é suportado no terminal web`, 1008, 'PROTOCOL_NOT_SUPPORTED')
    }

    // 4. Registrar sessão no banco
    const licenseLimits = await this.sshRepo.getSessionLimits(principal.tenantId)
    const maxPerUser = licenseLimits.multiConnect
      ? (licenseLimits.maxPerUser ?? env.SESSION_MAX_ACTIVE_PER_USER ?? null)
      : 1
    const maxPerTenant = licenseLimits.maxPerTenant ?? env.SESSION_MAX_ACTIVE_PER_TENANT ?? null

    if (!principal.isJit && maxPerUser !== null) {
      const activeByUser = await this.sshRepo.countActiveSessionsByUser(principal.userId)
      if (activeByUser >= maxPerUser) {
        return closeWithError(ws, licenseLimits.multiConnect
          ? `Limite de sessões ativas por usuário atingido (${maxPerUser})`
          : 'Multi-connect não está habilitado para este tenant')
      }
    }

    if (maxPerTenant !== null) {
      const activeByTenant = await this.sshRepo.countActiveSessionsByTenant(principal.tenantId)
      if (activeByTenant >= maxPerTenant) {
        return closeWithError(ws, `Limite de sessões ativas do tenant atingido (${maxPerTenant})`)
      }
    }

    const sessionId = await this.sshRepo.startSession(principal.userId, host.id, {
      clientIp: meta.clientIp,
      userAgent: meta.userAgent,
      accessType: principal.isJit ? 'jit_public_link' : 'authenticated',
      jitLinkId: principal.jitLinkId ?? null,
      jitGuestName: principal.guestName ?? null,
    })
    let forcedEndedReason: 'jit_link_revoked' | 'jit_link_expired' | 'remote_closed' | 'admin_closed' | 'acl_revoked' | null = null
    let jitExpiryTimer: ReturnType<typeof setTimeout> | null = null
    let lastHeartbeatPersistedAt = Date.now()
    const userSnapshot = await this.sshRepo.findUserSnapshot(principal.userId, principal.tenantId)
    const auditContext = {
      sessionId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      hostId: host.id,
    }
    const auditEnabledForSession = principal.isJit
      ? await this.sessionAuditPolicyService.shouldAuditJitSession(principal.tenantId)
      : await this.sessionAuditPolicyService.shouldAuditSession(
        principal.tenantId,
        principal.userId,
        userGroupIds,
      )
    const publishAudit = (type: 'session_started' | 'stdin' | 'stdout' | 'resize' | 'session_error' | 'session_ended', payload: Record<string, unknown>) => {
      if (!auditEnabledForSession) return Promise.resolve()
      return this.sessionAuditPublisher.publish(type, auditContext, payload)
    }

    // 5. Resolver credencial via 1Password (se configurado)
    let passwordEncrypted = host.passwordEncrypted
    let pemKey            = host.pemKey

    if (host.accessProtocol === 'SSH' && host.onePasswordRef) {
      try {
        const secret = await this.onePassword.resolve(host.tenantId, host.onePasswordRef)
        if (host.authType === 'PASSWORD' || host.authType === 'PEM_PASSWORD') {
          passwordEncrypted = JSON.stringify(encrypt(secret))
        } else {
          // PEM: o secret é o conteúdo da chave privada
          pemKey            = { encryptedKey: encrypt(secret).encrypted, iv: encrypt(secret).iv }
        }
      } catch (err) {
        logger.error({ err, hostId: host.id }, '1Password: falha ao resolver credencial')
        send(ws, { type: 'error', message: 'Falha ao buscar credencial no 1Password', code: 'CREDENTIAL_ERROR' })
        ws.close(1011)
        await this.sshRepo.endSession(sessionId, {
          endedReason: 'credential_error',
          errorCode: 'CREDENTIAL_ERROR',
          errorMessage: 'Falha ao buscar credencial no 1Password',
        }).catch(() => { /* best-effort */ })
        await publishAudit('session_error', {
          code: 'CREDENTIAL_ERROR',
          message: 'Falha ao buscar credencial no 1Password',
        }).catch(() => { /* ignore */ })
        if (auditEnabledForSession) this.sessionAuditPublisher.clearSession(sessionId)
        return
      }
    }

    // 5.5 Solicitar credenciais interativas quando o host não tem usuário ou senha configurados
    let adHocCredentials: AdHocCredentials | null = null
    const needsUsername = host.accessProtocol === 'SSH' && !host.sshUser
    const needsPassword = host.accessProtocol === 'SSH'
      && (host.authType === 'PASSWORD' || host.authType === 'PEM_PASSWORD')
      && !passwordEncrypted
      && !host.onePasswordRef

    if (needsUsername || needsPassword) {
      send(ws, { type: 'credentials_required', hostName: host.name, needsUsername, needsPassword })
      const creds = await waitForCredentialsResponse(ws)
      if (!creds || (needsUsername && !creds.username) || (needsPassword && !creds.password)) {
        send(ws, { type: 'error', message: 'Credenciais não fornecidas a tempo', code: 'CREDENTIALS_TIMEOUT' })
        ws.close(1008)
        await this.sshRepo.endSession(sessionId, {
          endedReason: 'credential_error',
          errorCode: 'CREDENTIALS_TIMEOUT',
          errorMessage: 'Credenciais não fornecidas a tempo',
        }).catch(() => { /* best-effort */ })
        if (auditEnabledForSession) this.sessionAuditPublisher.clearSession(sessionId)
        return
      }
      if (creds.username) (host as { sshUser: string }).sshUser = creds.username
      if (creds.password) passwordEncrypted = JSON.stringify(encrypt(creds.password))
      adHocCredentials = creds
    }

    // 6. Resolver modo de conexão do host
    const userId = principal.userId
    const requestedConnectionMode = host.connectionMode
    const wantsAgent = requestedConnectionMode !== 'DIRECT'
    const wantsPrivateAccess = requestedConnectionMode === 'PRIVATE_ACCESS_CONNECTOR'
    const allowsDirectFallback = requestedConnectionMode === 'AUTO'
    const resolvedAgent = wantsPrivateAccess
      ? agentRegistry.resolvePrivateAccessConnector(principal.tenantId, host.ip, host.port, host.privateAccessConnectorId)
      : agentRegistry.resolveForConnectionMode(requestedConnectionMode, userId, principal.tenantId)

    let agentSock: Duplex | undefined
    let effectiveConnectionMethod: 'direct' | 'user_agent' | 'tenant_agent' | 'private_access_connector' = 'direct'
    let usedAgent: typeof resolvedAgent = null

    if (wantsAgent && !resolvedAgent && !allowsDirectFallback) {
      const { message, errorCode } = wantsPrivateAccess
        ? agentRegistry.describePrivateAccessResolution(principal.tenantId, host.ip, host.port, host.privateAccessConnectorId)
        : agentRequiredMessage(requestedConnectionMode)
      await this.sshRepo.updateSessionRoute(sessionId, {
        requestedConnectionMode,
        connectionMethod: 'direct',
        agentRemoteIp: null,
      }).catch(() => { /* best-effort */ })
      await this.sshRepo.endSession(sessionId, {
        endedReason: 'agent_required',
        errorCode,
        errorMessage: message,
      }).catch(() => { /* best-effort */ })
      return closeWithError(ws, message, 1008, errorCode)
    }

    if (wantsAgent && !resolvedAgent && allowsDirectFallback) {
      send(ws, { type: 'info', message: 'Nenhum agente online disponível. Tentando conexão direta.' })
    }

    if (wantsAgent && resolvedAgent) {
      const connectionId = crypto.randomUUID()
      const agentScope = wantsPrivateAccess
        ? 'de acesso privado'
        : resolvedAgent.source === 'user' ? 'do seu usuário' : 'do tenant'
      send(ws, {
        type: 'info',
        message: `${wantsPrivateAccess ? 'Conector' : 'Agente'} online: "${resolvedAgent.agent.name}" (${agentScope}). Tentando conectar através dele.`,
      })
      try {
        agentSock = await agentRegistry.createConnection(resolvedAgent.agent, connectionId, host.ip, host.port)
        usedAgent = resolvedAgent
        effectiveConnectionMethod = wantsPrivateAccess
          ? 'private_access_connector'
          : resolvedAgent.source === 'user' ? 'user_agent' : 'tenant_agent'
        logger.info({ agentId: resolvedAgent.agent.agentId, agentSource: resolvedAgent.source, hostId: host.id, userId }, 'SSH roteado via agente')
        send(ws, { type: 'info', message: `Conexão via ${wantsPrivateAccess ? 'conector de acesso privado' : 'agente'} estabelecida. Iniciando SSH para ${host.name}.` })
      } catch (err) {
        const agentConnectMessage = describeAgentTcpError(err, host.ip, host.port)
        logger.warn({ err, agentId: resolvedAgent.agent.agentId, agentSource: resolvedAgent.source, hostId: host.id }, 'Falha ao conectar via agente')
        if (!allowsDirectFallback) {
          await this.sshRepo.updateSessionRoute(sessionId, {
            requestedConnectionMode,
            connectionMethod: wantsPrivateAccess ? 'private_access_connector' : resolvedAgent.source === 'user' ? 'user_agent' : 'tenant_agent',
            agentId: resolvedAgent.agent.agentId,
            agentName: resolvedAgent.agent.name,
            agentSource: wantsPrivateAccess ? 'private_access' : resolvedAgent.source,
            agentRemoteIp: resolvedAgent.agent.remoteIp ?? null,
          }).catch(() => { /* best-effort */ })
          await this.sshRepo.endSession(sessionId, {
            endedReason: 'agent_connect_failed',
            errorCode: 'AGENT_CONNECT_FAILED',
            errorMessage: agentConnectMessage,
          }).catch(() => { /* best-effort */ })
          return closeWithError(ws, agentConnectMessage, 1008, 'AGENT_CONNECT_FAILED')
        }
        agentSock = undefined
        usedAgent = null
        effectiveConnectionMethod = 'direct'
        send(ws, { type: 'info', message: `${agentConnectMessage} Tentando conexão direta como fallback.` })
      }
    }

    if (!agentSock && effectiveConnectionMethod === 'direct') {
      send(ws, { type: 'info', message: `Tentando conexão ${host.accessProtocol === 'TELNET' ? 'Telnet' : 'SSH'} direta.` })
    }

    const persistedConnectionMethod = host.accessProtocol === 'TELNET'
      ? telnetConnectionMethod(effectiveConnectionMethod)
      : effectiveConnectionMethod
    const routeSnapshot: RouteSnapshot = {
      requestedConnectionMode,
      connectionMethod: persistedConnectionMethod,
      agentId: usedAgent?.agent.agentId ?? null,
      agentName: usedAgent?.agent.name ?? null,
      agentType: usedAgent?.agent.agentType ?? null,
      agentMode: usedAgent?.agent.agentMode ?? null,
      agentSource: effectiveConnectionMethod === 'private_access_connector' ? 'private_access' : usedAgent?.source ?? null,
      agentOwnerUserId: usedAgent?.agent.userId ?? null,
      agentRemoteIp: usedAgent?.agent.remoteIp ?? null,
      privateAccess: effectiveConnectionMethod === 'private_access_connector' && usedAgent
        ? {
            hostConnectorId: host.privateAccessConnectorId,
            selectedBy: host.privateAccessConnectorId ? 'host_binding' : 'scope_auto',
            siteName: usedAgent.agent.privateAccess?.siteName ?? null,
            environment: usedAgent.agent.privateAccess?.environment ?? null,
            allowedCidrs: usedAgent.agent.privateAccess?.allowedCidrs ?? [],
            allowedHostnames: usedAgent.agent.privateAccess?.allowedHostnames ?? [],
            allowedPorts: usedAgent.agent.privateAccess?.allowedPorts ?? [],
            allowedHostTags: usedAgent.agent.privateAccess?.allowedHostTags ?? [],
            allowFallback: usedAgent.agent.privateAccess?.allowFallback ?? false,
          }
        : null,
    }

    await this.sshRepo.updateSessionRoute(sessionId, {
      requestedConnectionMode,
      connectionMethod: persistedConnectionMethod,
      agentId: usedAgent?.agent.agentId ?? null,
      agentName: usedAgent?.agent.name ?? null,
      agentSource: effectiveConnectionMethod === 'private_access_connector' ? 'private_access' : usedAgent?.source ?? null,
      agentRemoteIp: usedAgent?.agent.remoteIp ?? null,
      routeSnapshot,
    }).catch((err) => {
      logger.warn({ err, sessionId, hostId: host.id }, 'Falha ao persistir rota da sessão SSH')
    })

    // 7. Criar sessão SSH
    const secretRedactor = new SecretRedactor()
    const terminalStats = {
      remoteBytes: 0,
      remoteMessageCount: 0,
      clientBytes: 0,
      clientMessageCount: 0,
      resizeCount: 0,
      lastClientEvent: null as string | null,
      lastRemoteEvent: null as string | null,
      closeSource: null as 'client' | 'remote' | 'error' | null,
    }
    let session: TerminalSessionHandle

    // 7. Conectar ao terminal remoto
    try {
      const handleRemoteOutput = (data: Buffer): Buffer => {
        const redacted = secretRedactor.redactBuffer(data)
        const output = redacted.data
        terminalStats.remoteBytes += data.length
        terminalStats.remoteMessageCount += 1
        terminalStats.lastRemoteEvent = 'stdout'
        this.sharedSessionBroker.publishOutput(sessionId, output)
        publishAudit('stdout', {
          encoding: 'base64',
          data: output.toString('base64'),
          bytes: data.length,
          ...(redacted.redactedAliases.length > 0 && {
            sensitive: true,
            redactedSecretAliases: redacted.redactedAliases,
          }),
        }).catch(() => { /* ignore */ })
        return output
      }
      const handleRemoteClose = () => {
        terminalStats.closeSource = terminalStats.closeSource ?? 'remote'
        forcedEndedReason = 'remote_closed'
        logger.info({
          event: host.accessProtocol === 'TELNET' ? 'terminal.telnet.remote.close' : 'terminal.ssh.remote.close',
          sessionId,
          hostId: host.id,
          remoteBytes: terminalStats.remoteBytes,
          remoteMessageCount: terminalStats.remoteMessageCount,
          clientBytes: terminalStats.clientBytes,
          clientMessageCount: terminalStats.clientMessageCount,
          resizeCount: terminalStats.resizeCount,
        }, host.accessProtocol === 'TELNET' ? 'Telnet remote side closed session' : 'SSH remote side closed session')
        if (ws.readyState === 1) {
          send(ws, { type: 'closed' })
          setTimeout(() => {
            if (ws.readyState === 1) ws.close(1000)
          }, 20)
        }
        this.sharedSessionBroker.publishEnded(sessionId)
      }

      if (host.accessProtocol === 'TELNET') {
        logger.info({
          event: 'terminal.telnet.open.start',
          sessionId,
          hostId: host.id,
          tenantId: principal.tenantId,
          userId,
          remoteHost: host.ip,
          remotePort: host.port,
          connectionMethod: persistedConnectionMethod,
          viaAgent: !!agentSock,
          cols,
          rows,
        }, 'opening Telnet terminal session')
        session = await this.telnetSessionOpener({
          host: host.ip,
          port: host.port,
          cols,
          rows,
          ...(agentSock ? { sock: agentSock } : {}),
          onData: (data) => {
            const output = handleRemoteOutput(data)
            if (ws.readyState === 1) ws.send(output)
          },
          onClose: handleRemoteClose,
          onError: (error) => {
            logger.warn({
              err: error,
              event: 'terminal.telnet.session.error',
              hostId: host.id,
              sessionId,
            }, 'Erro na sessão Telnet')
            publishAudit('session_error', {
              code: 'TELNET_SESSION_ERROR',
              message: error.message,
            }).catch(() => { /* ignore */ })
          },
        })
        logger.info({
          event: 'terminal.telnet.open.ready',
          sessionId,
          hostId: host.id,
          connectionMethod: persistedConnectionMethod,
        }, 'Telnet terminal session ready')
      } else {
        session = await this.managedSshSessionService.openResolved({
          sessionId,
          user: {
            id: userId,
            tenantId: principal.tenantId,
            name: principal.isJit ? `JIT: ${principal.guestName}` : userSnapshot?.name ?? `user #${principal.userId}`,
            email: principal.email ?? userSnapshot?.email ?? '',
          },
          host,
          transport: { send: (data) => ws.send(data) },
          target: {
            host:              host.ip,
            port:              host.port,
            username:          host.sshUser,
            authType:          host.authType,
            trustedHostKeyFingerprint: host.trustedHostKeyFingerprint,
            passwordEncrypted,
            pemKey,
            ...(agentSock ? { sock: agentSock } : {}),
          },
          bastion: host.bastion && !agentSock
            ? {
              host:              host.bastion.ip,
              port:              host.bastion.port,
              username:          host.bastion.sshUser,
              authType:          host.bastion.authType,
              passwordEncrypted: host.bastion.passwordEncrypted,
              pemKey:            host.bastion.pemKey,
            }
            : null,
          cols,
          rows,
          source: 'websocket_gateway',
          onStdout: handleRemoteOutput,
          onClose: handleRemoteClose,
          onInputRejected: (message) => {
            send(ws, { type: 'error', message, code: 'SSH_INPUT_BLOCKED' })
          },
        })
      }
      metrics.inc('nodeaccess_ssh_gateway_sessions_started_total', 'Total SSH sessions successfully started', { method: persistedConnectionMethod })
      metrics.observe(
        'nodeaccess_ssh_gateway_connect_duration_ms',
        'SSH gateway connection duration in milliseconds',
        DURATION_MS_BUCKETS,
        Date.now() - connectionStartedAt,
        { method: persistedConnectionMethod },
      )
      this.sharedSessionBroker.registerSessionTransport(sessionId, {
        writeInput: (data) => session.write(data),
        auditInput: (actorUserId, data) => {
          publishAudit('stdin', {
            encoding: 'base64',
            data: data.toString('base64'),
            bytes: data.length,
            actorUserId,
          }).catch(() => { /* ignore */ })
        },
      })
      send(ws, {
        type: 'connected',
        sessionId,
        hostName: host.name,
        connectionMethod: persistedConnectionMethod,
        agentName: usedAgent?.agent.name ?? null,
      })
      if (principal.isJit) {
        void this.logRepo?.logAdminEvent({
          adminId: principal.userId,
          action: 'JIT_SESSION_STARTED',
          targetType: 'Session',
          targetId: sessionId,
          details: JSON.stringify({
            hostId: host.id,
            hostName: host.name,
            jitLinkId: principal.jitLinkId ?? null,
            guestName: principal.guestName ?? null,
            clientIp: meta.clientIp ?? null,
            userAgent: meta.userAgent ?? null,
          }),
        }).catch(() => {})
      }
      this.runtimeRegistry?.register(sessionId, {
        ...(principal.jitLinkId !== undefined && { jitLinkId: principal.jitLinkId }),
        close: (reason) => {
          if (reason === 'jit_link_revoked') forcedEndedReason = 'jit_link_revoked'
          if (reason === 'jit_link_expired') forcedEndedReason = 'jit_link_expired'
          if (reason === 'admin_closed') forcedEndedReason = 'admin_closed'
          if (reason === 'acl_revoked') forcedEndedReason = 'acl_revoked'
          const expired = reason === 'jit_link_expired'
          const adminClosed = reason === 'admin_closed'
          const aclRevoked = reason === 'acl_revoked'
          send(ws, {
            type: 'error',
            message: aclRevoked
              ? 'Sessão encerrada porque a permissão de conectar foi removida'
              : adminClosed ? 'Sessão encerrada pelo administrador' : expired ? 'Acesso JIT expirado' : 'Acesso JIT revogado pelo administrador',
            code: aclRevoked
              ? 'SESSION_ACL_REVOKED'
              : adminClosed ? 'SESSION_ADMIN_CLOSED' : expired ? 'JIT_LINK_EXPIRED' : 'JIT_LINK_REVOKED',
            reason,
          })
          ws.close(1008)
        },
      })
      if (principal.isJit && jitExpiresAtMs) {
        const delayMs = jitExpiresAtMs - Date.now()
        const expireJitSession = () => {
          if (ws.readyState !== 1) return
          forcedEndedReason = 'jit_link_expired'
          send(ws, {
            type: 'error',
            message: 'Acesso JIT expirado',
            code: 'JIT_LINK_EXPIRED',
            reason: 'jit_link_expired',
          })
          ws.close(1008)
        }
        if (delayMs <= 0) {
          queueMicrotask(expireJitSession)
        } else {
          jitExpiryTimer = setTimeout(expireJitSession, delayMs)
        }
      }
      if (adHocCredentials && !principal.isJit) {
        send(ws, {
          type: 'save_password_offer',
          hostId:       host.id,
          hostName:     host.name,
          secretName:   `secret-ssh-${host.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
          scope:        host.scope,
          savedUsername: adHocCredentials.username ?? null,
        })
      }
      await publishAudit('session_started', {
        userName: principal.isJit ? `JIT: ${principal.guestName}` : userSnapshot?.name ?? `user #${principal.userId}`,
        userEmail: principal.email ?? userSnapshot?.email ?? null,
        accessType: principal.isJit ? 'jit_public_link' : 'authenticated',
        ...(principal.isJit && {
          jitLinkId: principal.jitLinkId,
          jitGuestName: principal.guestName,
        }),
        hostName: host.name,
        hostIp: host.ip,
        clientIp: meta.clientIp ?? null,
        userAgent: meta.userAgent ?? null,
        connectionMethod: persistedConnectionMethod,
        requestedConnectionMode,
        routeSnapshot,
        accessProtocol: host.accessProtocol.toLowerCase(),
        ...(usedAgent && {
          agentId: usedAgent.agent.agentId,
          agentName: usedAgent.agent.name,
          agentType: usedAgent.agent.agentType,
          agentMode: usedAgent.agent.agentMode,
          agentSource: effectiveConnectionMethod === 'private_access_connector' ? 'private_access' : usedAgent.source,
          agentOwnerUserId: usedAgent.agent.userId,
          agentRemoteIp: usedAgent.agent.remoteIp ?? null,
        }),
        cols,
        rows,
      }).catch(() => { /* ignore */ })

      void this.webhookService.publishEvent({
        tenantId:     principal.tenantId,
        eventType:    'ssh_session.started',
        eventVersion: 1,
        resourceType: 'ssh_session',
        resourceId:   String(sessionId),
        occurredAt:   new Date(),
        data: {
          sessionId,
          userId,
          hostId:           host.id,
          hostName:         host.name,
          userName:         principal.isJit ? `JIT: ${principal.guestName}` : userSnapshot?.name ?? null,
          userEmail:        principal.email ?? userSnapshot?.email ?? null,
          accessType:       principal.isJit ? 'jit_public_link' : 'authenticated',
          jitLinkId:        principal.jitLinkId ?? null,
          jitGuestName:     principal.guestName ?? null,
          connectionMethod: persistedConnectionMethod,
          accessProtocol:   host.accessProtocol.toLowerCase(),
          clientIp:         meta.clientIp ?? null,
        },
      }).catch(() => {})
      this.publishSessionPresenceChanged({
        tenantId: principal.tenantId,
        hostId: host.id,
        sessionId,
        userId,
        action: 'started',
      })

      // Auto-start port forwarding tunnels configured for this host
      const { ok: autoTunnels, errors: tunnelErrors } = principal.isJit || host.accessProtocol !== 'SSH'
        ? { ok: [], errors: [] }
        : await this.tunnelService.autoStartForSession(String(sessionId), userId, principal.tenantId, host.id, principal.role)

      if (autoTunnels.length > 0 || tunnelErrors.length > 0) {
        send(ws, { type: 'tunnels', tunnels: autoTunnels, errors: tunnelErrors })
      }
    } catch (err) {
      if (host.accessProtocol === 'TELNET') {
        logger.error({ err, hostId: host.id }, 'Falha na conexão Telnet')
        this.sharedSessionBroker.publishError(sessionId, 'Falha ao conectar ao host Telnet')
        send(ws, { type: 'error', message: 'Falha ao conectar ao host Telnet', code: 'TELNET_CONNECT_FAILED' })
        ws.close(1011)
        await this.sshRepo.endSession(sessionId, {
          endedReason: 'ssh_connect_failed',
          errorCode: 'TELNET_CONNECT_FAILED',
          errorMessage: 'Falha ao conectar ao host Telnet',
        }).catch(() => { /* best-effort */ })
        await publishAudit('session_error', {
          code: 'TELNET_CONNECT_FAILED',
          message: 'Falha ao conectar ao host Telnet',
        }).catch(() => { /* ignore */ })
        if (auditEnabledForSession) this.sessionAuditPublisher.clearSession(sessionId)
        return
      }

      if (err instanceof HostKeyVerificationError) {
        send(ws, {
          type: 'host_key_verification_required',
          reason: err.reason,
          presentedFingerprint: err.presentedFingerprint,
          trustedFingerprint: err.trustedFingerprint,
        })
        ws.close(1008)
        await this.sshRepo.endSession(sessionId, {
          endedReason: 'host_key_verification_required',
          errorCode: 'HOST_KEY_VERIFICATION_REQUIRED',
          errorMessage: 'Host key precisa ser verificada antes da conexão',
        }).catch(() => { /* best-effort */ })
        if (auditEnabledForSession) this.sessionAuditPublisher.clearSession(sessionId)
        return
      }

      if (err instanceof SshConnectionStepError) {
        logger.error({ err, hostId: host.id, step: err.step }, 'Falha na conexão SSH')
        this.sharedSessionBroker.publishError(sessionId, err.message)
        send(ws, { type: 'error', message: err.message, code: err.errorCode })
        ws.close(1011)
        const code = err.step === 'bastion' ? 'SSH_BASTION_CONNECT_FAILED' : 'SSH_TARGET_CONNECT_FAILED'
        await this.sshRepo.endSession(sessionId, {
          endedReason: err.step === 'bastion' ? 'ssh_bastion_connect_failed' : 'ssh_target_connect_failed',
          errorCode: code,
          errorMessage: err.message,
        }).catch(() => { /* best-effort */ })
        await publishAudit('session_error', {
          code,
          message: err.message,
          step: err.step,
        }).catch(() => { /* ignore */ })
        if (auditEnabledForSession) this.sessionAuditPublisher.clearSession(sessionId)
        return
      }

      logger.error({ err, hostId: host.id }, 'Falha na conexão SSH')
      this.sharedSessionBroker.publishError(sessionId, 'Falha ao conectar ao host')
      send(ws, { type: 'error', message: 'Falha ao conectar ao host', code: 'CONNECT_FAILED' })
      ws.close(1011)
      await this.sshRepo.endSession(sessionId, {
        endedReason: 'ssh_connect_failed',
        errorCode: 'SSH_CONNECT_FAILED',
        errorMessage: 'Falha ao conectar ao host',
      }).catch(() => { /* best-effort */ })
      await publishAudit('session_error', {
        code: 'SSH_CONNECT_FAILED',
        message: 'Falha ao conectar ao host',
      }).catch(() => { /* ignore */ })
      if (auditEnabledForSession) this.sessionAuditPublisher.clearSession(sessionId)
      return
    }

    // 8. Broker: WebSocket ↔ SSH
    const writeOwnerInput = async (
      input: Buffer,
      auditPayload?: Record<string, unknown>,
    ): Promise<boolean> => {
      if (!this.sharedSessionBroker.canOwnerSendInput(sessionId, userId)) {
        const linkedSharedSessions = await this.sharedSessionRepo.listActiveBySessionId(sessionId).catch(() => [])
        const activeLeases = await Promise.all(
          linkedSharedSessions.map((item) => this.sharedSessionRepo.findActiveControlLease(item.id).catch(() => null)),
        )

        const hasAnyActiveLease = activeLeases.some((lease) => !!lease && lease.expiresAt.getTime() > Date.now())
        if (hasAnyActiveLease) {
          send(ws, { type: 'shared_session_input_locked' })
          return false
        }

        this.sharedSessionBroker.forceClearControlBySessionId(sessionId)
      }

      session.write(input)
      terminalStats.clientBytes += input.length
      terminalStats.clientMessageCount += 1
      terminalStats.lastClientEvent = 'stdin'
      if (auditPayload) {
        await publishAudit('stdin', auditPayload).catch(() => { /* ignore */ })
      }
      return true
    }

    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      const data = toBuffer(raw)
      if (isBinary) {
        // Dados do terminal (teclas, paste)
        void writeOwnerInput(data, {
          encoding: 'base64',
          data: data.toString('base64'),
          bytes: data.length,
        })
        return
      }
      // Mensagem de controle (JSON)
      try {
        const msg = JSON.parse(data.toString()) as ControlMsg
        if (msg.type === 'resize') {
          terminalStats.resizeCount += 1
          terminalStats.lastClientEvent = 'resize'
          session.resize(msg.cols, msg.rows)
          publishAudit('resize', {
            cols: msg.cols,
            rows: msg.rows,
          }).catch(() => { /* ignore */ })
        } else if (msg.type === 'ping') {
          const now = Date.now()
          if (now - lastHeartbeatPersistedAt >= SESSION_HEARTBEAT_WRITE_INTERVAL_MS) {
            lastHeartbeatPersistedAt = now
            this.sshRepo.touchSession(sessionId).catch(() => { /* best-effort heartbeat */ })
          }
          send(ws, { type: 'pong' })
        } else if (msg.type === 'snippet_execution') {
          if (principal.isJit) return
          void this.snippetExecutionEvents?.record({
            tenantId: principal.tenantId,
            userId,
            snippetId: msg.snippetId,
            executionId: msg.executionId,
            source: 'TERMINAL',
            status: 'SENT',
            hostId: host.id,
            sessionId,
            metadata: typeof msg.snippetName === 'string' && msg.snippetName.trim().length > 0
              ? { snippetName: msg.snippetName.trim().slice(0, 200) }
              : undefined,
          }).catch((error) => {
            logger.warn({ err: error, sessionId, userId, snippetId: msg.snippetId }, 'Falha ao registrar uso de snippet')
          })
        } else if (msg.type === 'snippet_input') {
          if (principal.isJit) {
            send(ws, { type: 'error', message: 'Snippets não estão disponíveis em acesso JIT', code: 'JIT_SNIPPET_INPUT_DISABLED' })
            return
          }
          void (async () => {
            try {
              if (typeof msg.text !== 'string' || msg.text.length === 0) return
              const input = Buffer.from(msg.text, 'utf8')
              await writeOwnerInput(input, {
                encoding: 'base64',
                data: input.toString('base64'),
                bytes: input.length,
                resourceType: 'snippet',
                resourceId: msg.snippetId,
              })
              await this.snippetExecutionEvents?.record({
                tenantId: principal.tenantId,
                userId,
                snippetId: msg.snippetId,
                executionId: msg.executionId,
                source: 'TERMINAL',
                status: 'SENT',
                hostId: host.id,
                sessionId,
                metadata: typeof msg.snippetName === 'string' && msg.snippetName.trim().length > 0
                  ? { snippetName: msg.snippetName.trim().slice(0, 200) }
                  : undefined,
              })
            } catch (error) {
              logger.warn({ err: error, sessionId, userId, snippetId: msg.snippetId }, 'Falha ao enviar snippet ao terminal')
              send(ws, { type: 'error', message: 'Falha ao enviar snippet ao terminal' })
            }
          })()
        } else if (msg.type === 'secret_input') {
          if (principal.isJit) {
            send(ws, { type: 'error', message: 'Snippets e secrets não estão disponíveis em acesso JIT', code: 'JIT_SECRET_INPUT_DISABLED' })
            return
          }
          void (async () => {
            try {
              if (typeof msg.text !== 'string' || msg.text.length === 0) return
              const resolved = await this.secretService.resolvePlaceholders(
                userId,
                principal.tenantId,
                principal.role,
                msg.text,
                {
                  resourceType: 'snippet',
                  ...(typeof msg.snippetId === 'number' && { resourceId: msg.snippetId }),
                  sessionId,
                  hostId: host.id,
                },
              )
              secretRedactor.addMany(resolved.redactions)
              const input = Buffer.from(resolved.text, 'utf8')
              const maskedInput = Buffer.from(resolved.maskedText, 'utf8')
              await writeOwnerInput(input, {
                encoding: 'base64',
                data: maskedInput.toString('base64'),
                bytes: input.length,
                sensitive: true,
                secretAliases: resolved.aliases,
                resourceType: 'snippet',
                ...(typeof msg.snippetId === 'number' && { resourceId: msg.snippetId }),
              })
              if (typeof msg.snippetId === 'number' && typeof msg.executionId === 'string') {
                await this.snippetExecutionEvents?.record({
                  tenantId: principal.tenantId,
                  userId,
                  snippetId: msg.snippetId,
                  executionId: msg.executionId,
                  source: 'TERMINAL',
                  status: 'SENT',
                  hostId: host.id,
                  sessionId,
                  metadata: typeof msg.snippetName === 'string' && msg.snippetName.trim().length > 0
                    ? { snippetName: msg.snippetName.trim().slice(0, 200) }
                    : undefined,
                })
              }
            } catch (error) {
              logger.warn({ err: error, sessionId, userId }, 'Falha ao resolver secret em snippet')
              if (typeof msg.snippetId === 'number' && typeof msg.executionId === 'string') {
                this.snippetExecutionEvents?.record({
                  tenantId: principal.tenantId,
                  userId,
                  snippetId: msg.snippetId,
                  executionId: msg.executionId,
                  source: 'TERMINAL',
                  status: 'FAILED_SECRET_RESOLUTION',
                  hostId: host.id,
                  sessionId,
                  metadata: typeof msg.snippetName === 'string' && msg.snippetName.trim().length > 0
                    ? { snippetName: msg.snippetName.trim().slice(0, 200) }
                    : undefined,
                }).catch(() => { /* best-effort usage update */ })
              }
              send(ws, { type: 'error', message: 'Falha ao resolver secret do snippet' })
            }
          })()
        }
      } catch {
        // JSON inválido — ignorar
      }
    })

    let cleanedUp = false
    const cleanup = async () => {
      if (cleanedUp) return
      cleanedUp = true
      terminalStats.closeSource = terminalStats.closeSource ?? (forcedEndedReason === 'remote_closed' ? 'remote' : 'client')
      logger.info({
        event: host.accessProtocol === 'TELNET' ? 'terminal.telnet.session.cleanup' : 'terminal.ssh.session.cleanup',
        sessionId,
        hostId: host.id,
        protocol: host.accessProtocol.toLowerCase(),
        reason: forcedEndedReason ?? 'socket_closed',
        closeSource: terminalStats.closeSource,
        remoteBytes: terminalStats.remoteBytes,
        remoteMessageCount: terminalStats.remoteMessageCount,
        clientBytes: terminalStats.clientBytes,
        clientMessageCount: terminalStats.clientMessageCount,
        resizeCount: terminalStats.resizeCount,
        lastRemoteEvent: terminalStats.lastRemoteEvent,
        lastClientEvent: terminalStats.lastClientEvent,
      }, host.accessProtocol === 'TELNET' ? 'cleaning up Telnet terminal session' : 'cleaning up SSH terminal session')
      this.runtimeRegistry?.unregister(sessionId)
      if (jitExpiryTimer) {
        clearTimeout(jitExpiryTimer)
        jitExpiryTimer = null
      }
      await session.close()
      this.sharedSessionBroker.unregisterSessionTransport(sessionId)
      secretRedactor.clear()
      this.sharedSessionBroker.publishEnded(sessionId)
      await this.sshRepo.endSession(sessionId, {
        endedReason: forcedEndedReason ?? 'socket_closed',
      }).catch(() => { /* best-effort */ })
      if (principal.isJit) {
        void this.logRepo?.logAdminEvent({
          adminId: principal.userId,
          action: 'JIT_SESSION_TERMINATED',
          targetType: 'Session',
          targetId: sessionId,
          details: JSON.stringify({
            hostId: host.id,
            hostName: host.name,
            jitLinkId: principal.jitLinkId ?? null,
            guestName: principal.guestName ?? null,
            reason: forcedEndedReason ?? 'socket_closed',
          }),
        }).catch(() => {})
      }
      void this.webhookService.publishEvent({
        tenantId:     principal.tenantId,
        eventType:    'ssh_session.ended',
        eventVersion: 1,
        resourceType: 'ssh_session',
        resourceId:   String(sessionId),
        occurredAt:   new Date(),
        data: {
          sessionId,
          userId,
          hostId:   host.id,
          hostName: host.name,
        },
      }).catch(() => {})
      this.publishSessionPresenceChanged({
        tenantId: principal.tenantId,
        hostId: host.id,
        sessionId,
        userId,
        action: 'ended',
      })
      await this.tunnelService.closeForSession(String(sessionId)).catch(() => { /* best-effort */ })
      await publishAudit('session_ended', {
        reason: forcedEndedReason ?? 'socket_closed',
      }).catch(() => { /* ignore */ })
      if (auditEnabledForSession) this.sessionAuditPublisher.clearSession(sessionId)
    }

    ws.on('close', cleanup)
    ws.on('error', () => {
      terminalStats.closeSource = 'error'
      void cleanup()
    })
  }
}
