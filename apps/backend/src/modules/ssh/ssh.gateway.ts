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
import type { SharedSessionBroker } from '../shared-sessions/shared-session.broker.js'
import type { SharedSessionRepository } from '../shared-sessions/shared-session.repository.js'
import type { SecretService } from '../secrets/secret.service.js'
import { SecretRedactor } from '../secrets/secret-redactor.js'

interface ResizeMsg { type: 'resize'; cols: number; rows: number }
interface PingMsg   { type: 'ping' }
interface SecretInputMsg {
  type: 'secret_input'
  text: string
  snippetId?: number
  snippetName?: string
}
type ControlMsg = ResizeMsg | PingMsg | SecretInputMsg
const SESSION_HEARTBEAT_WRITE_INTERVAL_MS = 30_000

function send(ws: WebSocket, msg: object): void {
  ws.send(JSON.stringify(msg))
}

function toBuffer(raw: Buffer | ArrayBuffer | Buffer[]): Buffer {
  if (Buffer.isBuffer(raw)) return raw
  if (raw instanceof ArrayBuffer) return Buffer.from(raw)
  return Buffer.concat(raw.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
}

function agentRequiredMessage(mode: string): string {
  if (mode === 'AGENT_USER') return 'Este host exige o agente do seu usuário online para conexão'
  return 'Este host exige um agente online para conexão'
}

function closeWithError(ws: WebSocket, message: string, code = 1008): void {
  send(ws, { type: 'error', message })
  ws.close(code)
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
  ) {}

  async handleConnection(ws: WebSocket, token: string | undefined, hostId: number, cols = 80, rows = 24): Promise<void> {
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

    const sessionId = await this.sshRepo.startSession(Number(user.sub), host.id)
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
        send(ws, { type: 'error', message: 'Falha ao buscar credencial no 1Password' })
        ws.close(1011)
        await this.sshRepo.endSession(sessionId).catch(() => { /* best-effort */ })
        await publishAudit('session_error', {
          code: 'CREDENTIAL_ERROR',
          message: 'Falha ao buscar credencial no 1Password',
        }).catch(() => { /* ignore */ })
        if (auditEnabledForSession) this.sessionAuditPublisher.clearSession(sessionId)
        return
      }
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
      return closeWithError(ws, agentRequiredMessage(requestedConnectionMode))
    }

    if (wantsAgent && !resolvedAgent && allowsDirectFallback) {
      send(ws, { type: 'info', message: 'Nenhum agente disponível. Tentando conexão direta.' })
    }

    if (wantsAgent && resolvedAgent) {
      const connectionId = crypto.randomUUID()
      try {
        agentSock = await agentRegistry.createConnection(resolvedAgent.agent, connectionId, host.ip, host.port)
        usedAgent = resolvedAgent
        effectiveConnectionMethod = resolvedAgent.source === 'user' ? 'user_agent' : 'tenant_agent'
        logger.info({ agentId: resolvedAgent.agent.agentId, agentSource: resolvedAgent.source, hostId: host.id, userId }, 'SSH roteado via agente')
        const agentScope = resolvedAgent.source === 'user' ? 'do seu usuário' : 'do tenant'
        send(ws, { type: 'info', message: `Conectando via agente ${agentScope} "${resolvedAgent.agent.name}"` })
      } catch (err) {
        logger.warn({ err, agentId: resolvedAgent.agent.agentId, agentSource: resolvedAgent.source, hostId: host.id }, 'Falha ao conectar via agente')
        if (!allowsDirectFallback) {
          return closeWithError(ws, 'Falha ao conectar ao host via agente')
        }
        agentSock = undefined
        usedAgent = null
        effectiveConnectionMethod = 'direct'
        send(ws, { type: 'info', message: 'Falha ao conectar via agente. Tentando conexão direta.' })
      }
    }

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
      send(ws, { type: 'connected', sessionId, hostName: host.name })
      await publishAudit('session_started', {
        userName: userSnapshot?.name ?? `user #${user.sub}`,
        userEmail: userSnapshot?.email ?? user.email,
        hostName: host.name,
        hostIp: host.ip,
        connectionMethod: effectiveConnectionMethod,
        requestedConnectionMode,
        ...(usedAgent && {
          agentId: usedAgent.agent.agentId,
          agentName: usedAgent.agent.name,
          agentSource: usedAgent.source,
          agentOwnerUserId: usedAgent.agent.userId,
        }),
        cols,
        rows,
      }).catch(() => { /* ignore */ })

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
        await this.sshRepo.endSession(sessionId).catch(() => { /* best-effort */ })
        if (auditEnabledForSession) this.sessionAuditPublisher.clearSession(sessionId)
        return
      }

      if (err instanceof SshConnectionStepError) {
        logger.error({ err, hostId: host.id, step: err.step }, 'Falha na conexão SSH')
        this.sharedSessionBroker.publishError(sessionId, err.message)
        send(ws, { type: 'error', message: err.message })
        ws.close(1011)
        await this.sshRepo.endSession(sessionId).catch(() => { /* best-effort */ })
        await publishAudit('session_error', {
          code: err.step === 'bastion' ? 'SSH_BASTION_CONNECT_FAILED' : 'SSH_TARGET_CONNECT_FAILED',
          message: err.message,
          step: err.step,
        }).catch(() => { /* ignore */ })
        if (auditEnabledForSession) this.sessionAuditPublisher.clearSession(sessionId)
        return
      }

      logger.error({ err, hostId: host.id }, 'Falha na conexão SSH')
      this.sharedSessionBroker.publishError(sessionId, 'Falha ao conectar ao host')
      send(ws, { type: 'error', message: 'Falha ao conectar ao host' })
      ws.close(1011)
      await this.sshRepo.endSession(sessionId).catch(() => { /* best-effort */ })
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
      await this.sshRepo.endSession(sessionId).catch(() => { /* best-effort */ })
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
