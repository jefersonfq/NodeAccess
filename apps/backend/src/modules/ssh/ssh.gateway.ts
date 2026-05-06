import jwt from 'jsonwebtoken'
import type { Duplex } from 'node:stream'
import type { WebSocket } from 'ws'
import { env } from '../../config/env.js'
import { logger } from '../../config/logger.js'
import { HostKeyVerificationError, SshConnectionStepError, SshSession } from './ssh.session.js'
import type { SshRepository } from './ssh.repository.js'
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
import { SecretRedactor } from '../secrets/secret-redactor.js'
import { DURATION_MS_BUCKETS, metrics } from '../../shared/metrics.js'

interface ResizeMsg { type: 'resize'; cols: number; rows: number }
interface PingMsg   { type: 'ping' }
interface SecretInputMsg {
  type: 'secret_input'
  text: string
  snippetId?: number
  snippetName?: string
}
interface CredentialsResponseMsg { type: 'credentials_response'; username?: string; password?: string }
type ControlMsg = ResizeMsg | PingMsg | SecretInputMsg | CredentialsResponseMsg

interface AdHocCredentials { username?: string; password?: string }
interface SshConnectionMeta { clientIp?: string; userAgent?: string }

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
  return { message: 'Este host exige um agente online para conexão', errorCode: 'AGENT_REQUIRED' }
}

function closeWithError(ws: WebSocket, message: string, wsCode = 1008, errorCode?: string): void {
  send(ws, { type: 'error', message, ...(errorCode && { code: errorCode }) })
  ws.close(wsCode)
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
  ) {}

  async handleConnection(ws: WebSocket, token: string | undefined, hostId: number, cols = 80, rows = 24, meta: SshConnectionMeta = {}): Promise<void> {
    const connectionStartedAt = Date.now()
    metrics.addGauge('nodeaccess_ssh_gateway_connections_active', 'Active SSH gateway WebSocket connections', {}, 1)
    ws.once('close', () => {
      metrics.addGauge('nodeaccess_ssh_gateway_connections_active', 'Active SSH gateway WebSocket connections', {}, -1)
    })

    // 1. Autenticação via JWT (passado como query param — único modo suportado pelo browser WebSocket)
    if (!token) return closeWithError(ws, 'Token obrigatório')

    let user: JwtPayload
    try {
      user = jwt.verify(token, env.JWT_SECRET) as JwtPayload
      if (user.stage !== 'authenticated') throw new Error('Invalid stage')
    } catch {
      return closeWithError(ws, 'Token inválido ou expirado')
    }

    // 2. Buscar host com credenciais (já decriptadas no SshSession)
    const host = await this.sshRepo.findHostWithCredentials(hostId, user.tenantId)
    if (!host) return closeWithError(ws, 'Host não encontrado')

    // 3. Verificar acesso por escopo (admin tem acesso irrestrito)
    let userGroupIds: number[] = []
    if (user.role !== 'admin') {
      if (host.scope === 'PERSONAL' && host.ownerId !== Number(user.sub)) {
        return closeWithError(ws, 'Sem acesso a este host')
      }
      if (host.scope === 'TEAM') {
        userGroupIds = await this.sshRepo.getUserGroupIds(Number(user.sub))
        if (!host.groupId || !userGroupIds.includes(host.groupId)) {
          return closeWithError(ws, 'Sem acesso a este host')
        }
      }
    }
    if (userGroupIds.length === 0) {
      userGroupIds = await this.sshRepo.getUserGroupIds(Number(user.sub))
    }

    // 4. Registrar sessão no banco
    const licenseLimits = await this.sshRepo.getSessionLimits(user.tenantId)
    const maxPerUser = licenseLimits.maxPerUser ?? env.SESSION_MAX_ACTIVE_PER_USER ?? null
    const maxPerTenant = licenseLimits.maxPerTenant ?? env.SESSION_MAX_ACTIVE_PER_TENANT ?? null

    if (maxPerUser !== null) {
      const activeByUser = await this.sshRepo.countActiveSessionsByUser(Number(user.sub))
      if (activeByUser >= maxPerUser) {
        return closeWithError(ws, `Limite de sessões ativas por usuário atingido (${maxPerUser})`)
      }
    }

    if (maxPerTenant !== null) {
      const activeByTenant = await this.sshRepo.countActiveSessionsByTenant(user.tenantId)
      if (activeByTenant >= maxPerTenant) {
        return closeWithError(ws, `Limite de sessões ativas do tenant atingido (${maxPerTenant})`)
      }
    }

    const sessionId = await this.sshRepo.startSession(Number(user.sub), host.id, {
      clientIp: meta.clientIp,
      userAgent: meta.userAgent,
    })
    let lastHeartbeatPersistedAt = Date.now()
    const userSnapshot = await this.sshRepo.findUserSnapshot(Number(user.sub), user.tenantId)
    const auditContext = {
      sessionId,
      tenantId: user.tenantId,
      userId: Number(user.sub),
      hostId: host.id,
    }
    const auditEnabledForSession = await this.sessionAuditPolicyService.shouldAuditSession(
      user.tenantId,
      Number(user.sub),
      userGroupIds,
    )
    const publishAudit = (type: 'session_started' | 'stdin' | 'stdout' | 'resize' | 'session_error' | 'session_ended', payload: Record<string, unknown>) => {
      if (!auditEnabledForSession) return Promise.resolve()
      return this.sessionAuditPublisher.publish(type, auditContext, payload)
    }

    // 5. Resolver credencial via 1Password (se configurado)
    let passwordEncrypted = host.passwordEncrypted
    let pemKey            = host.pemKey

    if (host.onePasswordRef) {
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
    const needsUsername = !host.sshUser
    const needsPassword = (host.authType === 'PASSWORD' || host.authType === 'PEM_PASSWORD')
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
    const userId = Number(user.sub)
    const requestedConnectionMode = host.connectionMode
    const wantsAgent = requestedConnectionMode !== 'DIRECT'
    const allowsDirectFallback = requestedConnectionMode === 'AUTO'
    const resolvedAgent = agentRegistry.resolveForConnectionMode(requestedConnectionMode, userId, user.tenantId)

    let agentSock: Duplex | undefined
    let effectiveConnectionMethod: 'direct' | 'user_agent' | 'tenant_agent' = 'direct'
    let usedAgent: typeof resolvedAgent = null

    if (wantsAgent && !resolvedAgent && !allowsDirectFallback) {
      const { message, errorCode } = agentRequiredMessage(requestedConnectionMode)
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
      const agentScope = resolvedAgent.source === 'user' ? 'do seu usuário' : 'do tenant'
      send(ws, {
        type: 'info',
        message: `Agente online: "${resolvedAgent.agent.name}" (${agentScope}). Tentando conectar através dele.`,
      })
      try {
        agentSock = await agentRegistry.createConnection(resolvedAgent.agent, connectionId, host.ip, host.port)
        usedAgent = resolvedAgent
        effectiveConnectionMethod = resolvedAgent.source === 'user' ? 'user_agent' : 'tenant_agent'
        logger.info({ agentId: resolvedAgent.agent.agentId, agentSource: resolvedAgent.source, hostId: host.id, userId }, 'SSH roteado via agente')
        send(ws, { type: 'info', message: `Conexão via agente estabelecida. Iniciando SSH para ${host.name}.` })
      } catch (err) {
        const agentConnectMessage = describeAgentTcpError(err, host.ip, host.port)
        logger.warn({ err, agentId: resolvedAgent.agent.agentId, agentSource: resolvedAgent.source, hostId: host.id }, 'Falha ao conectar via agente')
        if (!allowsDirectFallback) {
          await this.sshRepo.updateSessionRoute(sessionId, {
            requestedConnectionMode,
            connectionMethod: resolvedAgent.source === 'user' ? 'user_agent' : 'tenant_agent',
            agentId: resolvedAgent.agent.agentId,
            agentName: resolvedAgent.agent.name,
            agentSource: resolvedAgent.source,
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
      send(ws, { type: 'info', message: 'Tentando conexão SSH direta.' })
    }

    await this.sshRepo.updateSessionRoute(sessionId, {
      requestedConnectionMode,
      connectionMethod: effectiveConnectionMethod,
      agentId: usedAgent?.agent.agentId ?? null,
      agentName: usedAgent?.agent.name ?? null,
      agentSource: usedAgent?.source ?? null,
      agentRemoteIp: usedAgent?.agent.remoteIp ?? null,
    }).catch((err) => {
      logger.warn({ err, sessionId, hostId: host.id }, 'Falha ao persistir rota da sessão SSH')
    })

    // 7. Criar sessão SSH
    const secretRedactor = new SecretRedactor()
    const session = new SshSession(
      ws,
      {
        host:              host.ip,
        port:              host.port,
        username:          host.sshUser,
        authType:          host.authType,
        trustedHostKeyFingerprint: host.trustedHostKeyFingerprint,
        passwordEncrypted,
        pemKey,
        ...(agentSock ? { sock: agentSock } : {}),
      },
      host.bastion && !agentSock
        ? {
            host:              host.bastion.ip,
            port:              host.bastion.port,
            username:          host.bastion.sshUser,
            authType:          host.bastion.authType,
            passwordEncrypted: host.bastion.passwordEncrypted,
            pemKey:            host.bastion.pemKey,
          }
        : null,
      {
        onStdout: (data) => {
          const redacted = secretRedactor.redactBuffer(data)
          const output = redacted.data
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
        },
        onClose: () => {
          this.sharedSessionBroker.publishEnded(sessionId)
        },
      },
    )

    // 7. Conectar via SSH
    try {
      await session.connect(cols, rows)
      metrics.inc('nodeaccess_ssh_gateway_sessions_started_total', 'Total SSH sessions successfully started', { method: effectiveConnectionMethod })
      metrics.observe(
        'nodeaccess_ssh_gateway_connect_duration_ms',
        'SSH gateway connection duration in milliseconds',
        DURATION_MS_BUCKETS,
        Date.now() - connectionStartedAt,
        { method: effectiveConnectionMethod },
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
        connectionMethod: effectiveConnectionMethod,
        agentName: usedAgent?.agent.name ?? null,
      })
      if (adHocCredentials) {
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
        userName: userSnapshot?.name ?? `user #${user.sub}`,
        userEmail: userSnapshot?.email ?? user.email,
        hostName: host.name,
        hostIp: host.ip,
        clientIp: meta.clientIp ?? null,
        userAgent: meta.userAgent ?? null,
        connectionMethod: effectiveConnectionMethod,
        requestedConnectionMode,
        ...(usedAgent && {
          agentId: usedAgent.agent.agentId,
          agentName: usedAgent.agent.name,
          agentSource: usedAgent.source,
          agentOwnerUserId: usedAgent.agent.userId,
          agentRemoteIp: usedAgent.agent.remoteIp ?? null,
        }),
        cols,
        rows,
      }).catch(() => { /* ignore */ })

      void this.webhookService.publishEvent({
        tenantId:     user.tenantId,
        eventType:    'ssh_session.started',
        eventVersion: 1,
        resourceType: 'ssh_session',
        resourceId:   String(sessionId),
        occurredAt:   new Date(),
        data: {
          sessionId,
          userId:           Number(user.sub),
          hostId:           host.id,
          hostName:         host.name,
          userName:         userSnapshot?.name ?? null,
          userEmail:        userSnapshot?.email ?? null,
          connectionMethod: effectiveConnectionMethod,
          clientIp:         meta.clientIp ?? null,
        },
      }).catch(() => {})

      // Auto-start port forwarding tunnels configured for this host
      const { ok: autoTunnels, errors: tunnelErrors } =
        await this.tunnelService.autoStartForSession(String(sessionId), userId, user.tenantId, host.id)

      if (autoTunnels.length > 0 || tunnelErrors.length > 0) {
        send(ws, { type: 'tunnels', tunnels: autoTunnels, errors: tunnelErrors })
      }
    } catch (err) {
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
      await publishAudit('stdin', auditPayload ?? {
        encoding: 'base64',
        data: input.toString('base64'),
        bytes: input.length,
      }).catch(() => { /* ignore */ })
      return true
    }

    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      const data = toBuffer(raw)
      if (isBinary) {
        // Dados do terminal (teclas, paste)
        void writeOwnerInput(data)
        return
      }
      // Mensagem de controle (JSON)
      try {
        const msg = JSON.parse(data.toString()) as ControlMsg
        if (msg.type === 'resize') {
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
        } else if (msg.type === 'secret_input') {
          void (async () => {
            try {
              if (typeof msg.text !== 'string' || msg.text.length === 0) return
              const resolved = await this.secretService.resolvePlaceholders(
                userId,
                user.tenantId,
                user.role,
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
            } catch (error) {
              logger.warn({ err: error, sessionId, userId }, 'Falha ao resolver secret em snippet')
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
      session.dispose()
      this.sharedSessionBroker.unregisterSessionTransport(sessionId)
      secretRedactor.clear()
      this.sharedSessionBroker.publishEnded(sessionId)
      await this.sshRepo.endSession(sessionId, {
        endedReason: 'socket_closed',
      }).catch(() => { /* best-effort */ })
      void this.webhookService.publishEvent({
        tenantId:     user.tenantId,
        eventType:    'ssh_session.ended',
        eventVersion: 1,
        resourceType: 'ssh_session',
        resourceId:   String(sessionId),
        occurredAt:   new Date(),
        data: {
          sessionId,
          userId:   Number(user.sub),
          hostId:   host.id,
          hostName: host.name,
        },
      }).catch(() => {})
      await this.tunnelService.closeForSession(String(sessionId)).catch(() => { /* best-effort */ })
      await publishAudit('session_ended', {
        reason: 'socket_closed',
      }).catch(() => { /* ignore */ })
      if (auditEnabledForSession) this.sessionAuditPublisher.clearSession(sessionId)
    }

    ws.on('close', cleanup)
    ws.on('error', cleanup)
  }
}
