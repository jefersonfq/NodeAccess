import { randomUUID, createHash } from 'node:crypto'
import type { Duplex } from 'node:stream'
import { Prisma, type PrismaClient } from '@prisma/client'
import { Client, type ConnectConfig } from 'ssh2'
import { env } from '../../config/env.js'
import { AppError, ForbiddenError, NotFoundError } from '../../shared/errors.js'
import { decrypt, encrypt, type EncryptedPayload } from '../../shared/crypto.js'
import type { JwtPayload } from '../../shared/guards.js'
import type { OnePasswordService } from '../integrations/onepassword.service.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { HostCredentials, SshRepository } from '../ssh/ssh.repository.js'
import type { WebhookService } from '../webhooks/webhook.service.js'

const MIN_TTL_SECONDS = 60
const MAX_BUFFER_CHARS = 512_000
const MAX_READ_BYTES = 64_000
const MAX_WRITE_CHARS = 16_000
const MAX_REASON_CHARS = 500

interface McpAuditContext {
  mode?: 'jwt' | 'persisted_token' | 'static_token'
  tokenId?: number
}

interface InteractiveSshSession {
  id: string
  tenantId: number
  userId: number
  tokenId?: number
  hostId: number
  hostName: string
  conn: Client
  bastionConn: Client | null
  shell: Duplex & { setWindow?: (rows: number, cols: number, height: number, width: number) => void }
  output: string
  baseCursor: number
  closed: boolean
  expiresAt: Date
  timer: NodeJS.Timeout
}

export class McpInteractiveSshService {
  private readonly sessions = new Map<string, InteractiveSshSession>()

  constructor(
    private readonly sshRepository: SshRepository,
    private readonly onePassword: OnePasswordService,
    private readonly logRepository: LogRepository,
    private readonly db: PrismaClient,
    private readonly webhookService: WebhookService,
  ) {}

  async open(user: JwtPayload, input: {
    hostId: number
    reason: string
    ttlSeconds?: number
    cols?: number
    rows?: number
  }, auditContext?: McpAuditContext) {
    this.assertAdminPersistedFullAccess(user, auditContext)

    const hostId = this.requirePositiveInteger(input.hostId, 'hostId')
    const reason = String(input.reason ?? '').trim()
    if (!reason) throw new AppError('Justificativa obrigatoria para abrir sessao SSH interativa via MCP', 400, 'MCP_INTERACTIVE_SSH_REASON_REQUIRED')
    this.assertSessionLimits(user, auditContext)
    const ttlSeconds = this.clampInteger(input.ttlSeconds ?? this.defaultTtlSeconds(), MIN_TTL_SECONDS, this.maxTtlSeconds())
    const cols = this.clampInteger(input.cols ?? 120, 40, 240)
    const rows = this.clampInteger(input.rows ?? 32, 10, 80)

    const host = await this.sshRepository.findHostWithCredentials(hostId, user.tenantId)
    if (!host) throw new NotFoundError('Host nao encontrado')
    const normalizedRole = user.role === 'admin' ? 'ADMIN' : 'USER'
    if (!await this.sshRepository.hasEffectiveHostPermission(host.id, user.tenantId, Number(user.sub), 'connect', normalizedRole)) {
      throw new ForbiddenError('Sem permissão para conectar a este host')
    }
    if (host.connectionMode !== 'DIRECT') {
      throw new AppError('Sessao SSH interativa via MCP ainda suporta apenas hosts com rota direta', 400, 'MCP_INTERACTIVE_SSH_DIRECT_ONLY')
    }

    const resolved = await this.resolveHostCredentials(host)
    const targetConfig = this.buildConnectConfig(resolved.target, true)
    const bastionConfig = resolved.bastion ? this.buildConnectConfig(resolved.bastion, false) : null
    const connection = bastionConfig
      ? await this.connectViaBastion(targetConfig, bastionConfig)
      : await this.connectDirect(targetConfig)

    try {
      const shell = await this.openShell(connection.conn, cols, rows)
      const id = randomUUID()
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
      const timer = setTimeout(() => {
        void this.closeById(id, 'ttl_expired')
      }, ttlSeconds * 1000)
      timer.unref?.()

      const session: InteractiveSshSession = {
        id,
        tenantId: user.tenantId,
        userId: Number(user.sub),
        ...(auditContext?.tokenId ? { tokenId: auditContext.tokenId } : {}),
        hostId: host.id,
        hostName: host.name,
        conn: connection.conn,
        bastionConn: connection.bastionConn,
        shell,
        output: '',
        baseCursor: 0,
        closed: false,
        expiresAt,
        timer,
      }

      shell.on('data', (chunk: Buffer | string) => {
        this.appendOutput(session, chunk.toString())
      })
      shell.on('close', () => {
        session.closed = true
      })
      shell.on('error', (error) => {
        this.appendOutput(session, `\n[MCP SSH shell error: ${error.message}]\n`)
        session.closed = true
      })
      connection.conn.on('close', () => {
        session.closed = true
      })

      this.sessions.set(id, session)
      await this.recordSessionOpened({
        session,
        reason: this.truncate(reason, MAX_REASON_CHARS),
      })
      void this.webhookService.publishEvent({
        tenantId: user.tenantId,
        eventType: 'mcp_interactive_ssh_session.opened', eventVersion: 1,
        resourceType: 'mcp_interactive_ssh_session', resourceId: id,
        occurredAt: new Date(),
        data: { hostId: host.id, hostName: host.name, userId: Number(user.sub), ttlSeconds },
      }).catch(() => {})
      await this.audit(user, 'MCP_INTERACTIVE_SSH_OPENED', host.id, {
        capability: 'open_interactive_ssh_session',
        sessionId: id,
        hostId: host.id,
        hostName: host.name,
        ttlSeconds,
        expiresAt: expiresAt.toISOString(),
        reason: this.truncate(reason, MAX_REASON_CHARS),
      }, auditContext)

      return {
        capability: 'open_interactive_ssh_session' as const,
        sessionId: id,
        hostId: host.id,
        hostName: host.name,
        expiresAt: expiresAt.toISOString(),
        cursor: session.baseCursor + session.output.length,
      }
    } catch (error) {
      try { connection.conn.end() } catch {}
      try { connection.bastionConn?.end() } catch {}
      throw error
    }
  }

  async write(user: JwtPayload, input: { sessionId: string; data: string }, auditContext?: McpAuditContext) {
    const session = this.getAuthorizedSession(user, String(input.sessionId ?? ''), auditContext)
    const data = String(input.data ?? '')
    if (!data) throw new AppError('Dados obrigatorios para escrita na sessao SSH interativa', 400, 'MCP_INTERACTIVE_SSH_DATA_REQUIRED')
    if (data.length > MAX_WRITE_CHARS) {
      throw new AppError(`Escrita limitada a ${MAX_WRITE_CHARS} caracteres por chamada`, 400, 'MCP_INTERACTIVE_SSH_WRITE_TOO_LARGE')
    }

    session.shell.write(data)
    const inputBytes = Buffer.byteLength(data)
    await this.recordSessionInput(session.id, inputBytes)
    await this.audit(user, 'MCP_INTERACTIVE_SSH_INPUT', session.hostId, {
      capability: 'write_interactive_ssh_session',
      sessionId: session.id,
      hostId: session.hostId,
      inputBytes,
      inputPreview: this.truncate(data.replace(/\s+/g, ' '), 200),
    }, auditContext)

    return {
      capability: 'write_interactive_ssh_session' as const,
      sessionId: session.id,
      acceptedBytes: inputBytes,
      cursor: session.baseCursor + session.output.length,
      closed: session.closed,
    }
  }

  async read(user: JwtPayload, input: { sessionId: string; cursor?: number; maxBytes?: number }, auditContext?: McpAuditContext) {
    const session = this.getAuthorizedSession(user, String(input.sessionId ?? ''), auditContext)
    const absoluteStart = Math.max(Number(input.cursor ?? session.baseCursor), session.baseCursor)
    const relativeStart = Math.max(0, absoluteStart - session.baseCursor)
    const maxBytes = this.clampInteger(input.maxBytes ?? 16_000, 1, MAX_READ_BYTES)
    const output = session.output.slice(relativeStart, relativeStart + maxBytes)
    const nextCursor = session.baseCursor + relativeStart + output.length
    const outputBytes = Buffer.byteLength(output)

    await this.recordSessionOutputRead(session.id, outputBytes)
    await this.audit(user, 'MCP_INTERACTIVE_SSH_OUTPUT_READ', session.hostId, {
      capability: 'read_interactive_ssh_session',
      sessionId: session.id,
      hostId: session.hostId,
      outputBytes,
      nextCursor,
      closed: session.closed,
    }, auditContext)

    return {
      capability: 'read_interactive_ssh_session' as const,
      sessionId: session.id,
      output,
      cursor: nextCursor,
      bufferStartCursor: session.baseCursor,
      closed: session.closed,
      expiresAt: session.expiresAt.toISOString(),
    }
  }

  async resize(user: JwtPayload, input: { sessionId: string; cols: number; rows: number }, auditContext?: McpAuditContext) {
    const session = this.getAuthorizedSession(user, String(input.sessionId ?? ''), auditContext)
    const cols = this.clampInteger(input.cols, 40, 240)
    const rows = this.clampInteger(input.rows, 10, 80)
    session.shell.setWindow?.(rows, cols, 0, 0)

    await this.audit(user, 'MCP_INTERACTIVE_SSH_RESIZED', session.hostId, {
      capability: 'resize_interactive_ssh_session',
      sessionId: session.id,
      hostId: session.hostId,
      cols,
      rows,
    }, auditContext)

    return {
      capability: 'resize_interactive_ssh_session' as const,
      sessionId: session.id,
      cols,
      rows,
      closed: session.closed,
    }
  }

  async close(user: JwtPayload, input: { sessionId: string }, auditContext?: McpAuditContext) {
    const session = this.getAuthorizedSession(user, String(input.sessionId ?? ''), auditContext)
    await this.closeSession(session, user, 'client_closed', auditContext)
    return {
      capability: 'close_interactive_ssh_session' as const,
      sessionId: session.id,
      closed: true,
    }
  }

  async closeAsAdmin(user: JwtPayload, input: { sessionId: string }) {
    if (user.role !== 'admin') {
      throw new ForbiddenError('Encerramento administrativo de sessao MCP exige perfil administrativo')
    }
    const sessionId = String(input.sessionId ?? '').trim()
    if (!sessionId) {
      throw new AppError('sessionId obrigatorio', 400, 'MCP_INTERACTIVE_SSH_SESSION_ID_REQUIRED')
    }
    const session = this.sessions.get(sessionId)
    if (!session || session.tenantId !== user.tenantId) {
      throw new NotFoundError('Sessao SSH interativa MCP nao encontrada')
    }
    await this.closeSession(session, user, 'admin_closed')
    return {
      sessionId: session.id,
      closed: true,
      reason: 'admin_closed' as const,
    }
  }

  private assertAdminPersistedFullAccess(user: JwtPayload, auditContext?: McpAuditContext): void {
    if (user.role !== 'admin') {
      throw new ForbiddenError('Sessao SSH interativa via MCP exige perfil administrativo')
    }
    if (auditContext?.mode !== 'persisted_token' || !auditContext.tokenId) {
      throw new ForbiddenError('Sessao SSH interativa via MCP exige token MCP persistido')
    }
  }

  private assertSessionLimits(user: JwtPayload, auditContext?: McpAuditContext): void {
    const tokenId = auditContext?.tokenId
    const tenantSessions = Array.from(this.sessions.values()).filter((session) => (
      session.tenantId === user.tenantId && !session.closed
    ))
    if (tenantSessions.length >= env.MCP_INTERACTIVE_SSH_MAX_SESSIONS_PER_TENANT) {
      throw new AppError('Limite de sessoes SSH interativas MCP do tenant atingido', 429, 'MCP_INTERACTIVE_SSH_TENANT_SESSION_LIMIT')
    }

    const tokenSessions = tenantSessions.filter((session) => tokenId !== undefined && session.tokenId === tokenId)
    if (tokenSessions.length >= env.MCP_INTERACTIVE_SSH_MAX_SESSIONS_PER_TOKEN) {
      throw new AppError('Limite de sessoes SSH interativas MCP do token atingido', 429, 'MCP_INTERACTIVE_SSH_TOKEN_SESSION_LIMIT')
    }
  }

  private getAuthorizedSession(user: JwtPayload, sessionId: string, auditContext?: McpAuditContext): InteractiveSshSession {
    this.assertAdminPersistedFullAccess(user, auditContext)
    if (!sessionId.trim()) {
      throw new AppError('sessionId obrigatorio', 400, 'MCP_INTERACTIVE_SSH_SESSION_ID_REQUIRED')
    }
    const session = this.sessions.get(sessionId)
    if (!session || session.tenantId !== user.tenantId || session.userId !== Number(user.sub)) {
      throw new NotFoundError('Sessao SSH interativa MCP nao encontrada')
    }
    if (session.tokenId && auditContext?.tokenId !== session.tokenId) {
      throw new ForbiddenError('Sessao SSH interativa MCP pertence a outro token')
    }
    return session
  }

  private async resolveHostCredentials(host: HostCredentials): Promise<{
    target: HostCredentials
    bastion: HostCredentials['bastion']
  }> {
    let passwordEncrypted = host.passwordEncrypted
    let pemKey = host.pemKey

    if (host.onePasswordRef) {
      const secret = await this.onePassword.resolve(host.tenantId, host.onePasswordRef)
      if (host.authType === 'PASSWORD' || host.authType === 'PEM_PASSWORD') {
        passwordEncrypted = JSON.stringify(encrypt(secret))
      } else {
        const enc = encrypt(secret)
        pemKey = { encryptedKey: enc.encrypted, iv: enc.iv }
      }
    }

    return {
      target: {
        ...host,
        passwordEncrypted,
        pemKey,
      },
      bastion: host.bastion,
    }
  }

  private buildConnectConfig(creds: {
    ip: string
    port: number
    sshUser: string
    authType: 'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
    passwordEncrypted: string | null
    pemKey: { encryptedKey: string; iv: string } | null
    trustedHostKeyFingerprint?: string | null
    sock?: Duplex
  }, verifyHostKey: boolean): ConnectConfig {
    const config: ConnectConfig = {
      host: creds.ip,
      port: creds.port,
      username: creds.sshUser,
      readyTimeout: 15_000,
      keepaliveInterval: 10_000,
      ...(creds.sock ? { sock: creds.sock } : {}),
    }

    if (verifyHostKey) {
      config.hostVerifier = (key: Buffer) => {
        const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64')}`
        return !!creds.trustedHostKeyFingerprint && creds.trustedHostKeyFingerprint === fingerprint
      }
    }

    if ((creds.authType === 'PASSWORD' || creds.authType === 'PEM_PASSWORD') && creds.passwordEncrypted) {
      const payload = JSON.parse(creds.passwordEncrypted) as EncryptedPayload
      config.password = decrypt(payload)
    }

    if ((creds.authType === 'PEM' || creds.authType === 'PEM_PASSWORD') && creds.pemKey) {
      config.privateKey = decrypt({ encrypted: creds.pemKey.encryptedKey, iv: creds.pemKey.iv })
    }

    return config
  }

  private connectDirect(config: ConnectConfig): Promise<{ conn: Client; bastionConn: null }> {
    return new Promise((resolve, reject) => {
      const conn = new Client()
      conn.on('ready', () => resolve({ conn, bastionConn: null }))
      conn.on('error', (err) => {
        try { conn.end() } catch {}
        reject(err)
      })
      conn.connect(config)
    })
  }

  private connectViaBastion(targetConfig: ConnectConfig, bastionConfig: ConnectConfig): Promise<{ conn: Client; bastionConn: Client }> {
    return new Promise((resolve, reject) => {
      const bastionConn = new Client()
      bastionConn.on('ready', () => {
        bastionConn.forwardOut('127.0.0.1', 0, targetConfig.host as string, targetConfig.port as number, (err, stream) => {
          if (err) {
            try { bastionConn.end() } catch {}
            return reject(err)
          }
          const conn = new Client()
          conn.on('ready', () => resolve({ conn, bastionConn }))
          conn.on('error', (error) => {
            try { conn.end() } catch {}
            try { bastionConn.end() } catch {}
            reject(error)
          })
          conn.connect({ ...targetConfig, sock: stream })
        })
      })
      bastionConn.on('error', (err) => {
        try { bastionConn.end() } catch {}
        reject(err)
      })
      bastionConn.connect(bastionConfig)
    })
  }

  private openShell(conn: Client, cols: number, rows: number): Promise<InteractiveSshSession['shell']> {
    return new Promise((resolve, reject) => {
      conn.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) return reject(err)
        resolve(stream as InteractiveSshSession['shell'])
      })
    })
  }

  private appendOutput(session: InteractiveSshSession, chunk: string): void {
    session.output += chunk
    if (session.output.length <= MAX_BUFFER_CHARS) return
    const overflow = session.output.length - MAX_BUFFER_CHARS
    session.output = session.output.slice(overflow)
    session.baseCursor += overflow
  }

  private async closeById(sessionId: string, reason: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    await this.closeSession(session, null, reason)
  }

  private async closeSession(
    session: InteractiveSshSession,
    user: JwtPayload | null,
    reason: string,
    auditContext?: McpAuditContext,
  ): Promise<void> {
    this.sessions.delete(session.id)
    clearTimeout(session.timer)
    session.closed = true
    try { session.shell.end() } catch {}
    try { session.conn.end() } catch {}
    try { session.bastionConn?.end() } catch {}
    await this.recordSessionClosed(session.id, reason)

    void this.webhookService.publishEvent({
      tenantId: session.tenantId,
      eventType: 'mcp_interactive_ssh_session.closed',
      eventVersion: 1,
      resourceType: 'mcp_interactive_ssh_session',
      resourceId: session.id,
      occurredAt: new Date(),
      data: { hostId: session.hostId, hostName: session.hostName, reason, userId: session.userId },
    }).catch(() => {})

    const actor = user ?? {
      sub: String(session.userId),
      tenantId: session.tenantId,
      role: 'admin',
    } as JwtPayload
    await this.audit(actor, 'MCP_INTERACTIVE_SSH_CLOSED', session.hostId, {
      capability: 'close_interactive_ssh_session',
      sessionId: session.id,
      hostId: session.hostId,
      reason,
    }, auditContext ?? (session.tokenId ? { mode: 'persisted_token', tokenId: session.tokenId } : undefined))
  }

  private async audit(
    user: JwtPayload,
    action: string,
    targetId: number,
    details: Record<string, unknown>,
    auditContext?: McpAuditContext,
  ): Promise<void> {
    await this.logRepository.logAdminEvent({
      adminId: Number(user.sub),
      action,
      targetType: 'MCP_INTERACTIVE_SSH',
      targetId,
      details: JSON.stringify({
        tenantId: user.tenantId,
        authMode: auditContext?.mode ?? 'jwt',
        ...(auditContext?.tokenId ? { tokenId: auditContext.tokenId } : {}),
        ...details,
      }),
    }).catch(() => {})
  }

  private async recordSessionOpened(input: {
    session: InteractiveSshSession
    reason: string
  }): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      INSERT INTO mcp_interactive_ssh_sessions (
        session_id,
        tenant_id,
        user_id,
        token_id,
        host_id,
        host_name,
        reason,
        status,
        opened_at,
        last_activity_at,
        expires_at,
        created_at,
        updated_at
      ) VALUES (
        ${input.session.id},
        ${input.session.tenantId},
        ${input.session.userId},
        ${input.session.tokenId ?? null},
        ${input.session.hostId},
        ${input.session.hostName},
        ${input.reason},
        'open',
        NOW(3),
        NOW(3),
        ${input.session.expiresAt},
        NOW(3),
        NOW(3)
      )
    `).catch(() => {})
  }

  private async recordSessionInput(sessionId: string, inputBytes: number): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE mcp_interactive_ssh_sessions
      SET
        input_bytes = input_bytes + ${inputBytes},
        last_activity_at = NOW(3),
        updated_at = NOW(3)
      WHERE session_id = ${sessionId}
    `).catch(() => {})
  }

  private async recordSessionOutputRead(sessionId: string, outputBytes: number): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE mcp_interactive_ssh_sessions
      SET
        output_bytes_read = output_bytes_read + ${outputBytes},
        last_activity_at = NOW(3),
        updated_at = NOW(3)
      WHERE session_id = ${sessionId}
    `).catch(() => {})
  }

  private async recordSessionClosed(sessionId: string, reason: string): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE mcp_interactive_ssh_sessions
      SET
        status = 'closed',
        closed_at = COALESCE(closed_at, NOW(3)),
        close_reason = ${reason},
        last_activity_at = NOW(3),
        updated_at = NOW(3)
      WHERE session_id = ${sessionId}
    `).catch(() => {})
  }

  private requirePositiveInteger(value: unknown, field: string): number {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new AppError(`${field} invalido`, 400, 'MCP_INTERACTIVE_SSH_INVALID_INPUT')
    }
    return parsed
  }

  private clampInteger(value: unknown, min: number, max: number): number {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return min
    return Math.max(min, Math.min(Math.trunc(parsed), max))
  }

  private defaultTtlSeconds(): number {
    return Math.min(env.MCP_INTERACTIVE_SSH_DEFAULT_TTL_SECONDS, this.maxTtlSeconds())
  }

  private maxTtlSeconds(): number {
    return Math.max(MIN_TTL_SECONDS, env.MCP_INTERACTIVE_SSH_MAX_TTL_SECONDS)
  }

  private truncate(value: string, max: number): string {
    return value.length > max ? `${value.slice(0, max)}...[truncado]` : value
  }
}
