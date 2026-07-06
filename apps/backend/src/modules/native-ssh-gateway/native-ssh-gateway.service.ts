import bcrypt from 'bcrypt'
import type { AuthEventType } from '@prisma/client'
import type { Redis } from 'ioredis'
import { randomInt, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { AuthContext, ClientInfo, Connection, PseudoTtyInfo, Server as Ssh2Server, ServerChannel } from 'ssh2'
import { logger } from '../../config/logger.js'
import { HostKeyVerificationError, SshConnectionStepError, type SshSessionTransport } from '../ssh/ssh.session.js'
import type { NativeSshHostSummary, NativeSshUser, SshRepository } from '../ssh/ssh.repository.js'
import type { TotpService } from '../auth/totp.service.js'
import type { EmailConfigService } from '../email/email-config.service.js'
import type { EmailService } from '../email/email.service.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { ManagedSshSessionService } from '../ssh/managed-ssh-session.service.js'
import { parseLoginCandidates, parseTarget, type ParsedLogin } from './native-ssh-gateway.login-parser.js'
import {
  NATIVE_SSH_GATEWAY_STATUS_KEY,
  NATIVE_SSH_GATEWAY_STATUS_TTL_SECONDS,
  type NativeSshGatewayRuntimeState,
  type NativeSshGatewayRuntimeStatus,
} from './native-ssh-gateway.status.js'

const require = createRequire(import.meta.url)
const { Server } = require('ssh2') as typeof import('ssh2')

const EMAIL_OTP_KEY_PREFIX = 'native-ssh-gateway:otp:email:'
const EMAIL_OTP_RATE_KEY_PREFIX = 'native-ssh-gateway:otp:rate:'
const EMAIL_OTP_TTL_SECONDS = 10 * 60
const EMAIL_OTP_MAX_ATTEMPTS = 3
const EMAIL_OTP_RATE_WINDOW_SECONDS = 15 * 60
const EMAIL_OTP_RATE_MAX = 5
const EMAIL_OTP_RESEND_COOLDOWN_SECONDS = 60
const EMAIL_OTP_PROMPT_TIMEOUT_MS = 2500
const SSHS_SELECTOR_PAGE_SIZE = 10
const SSHS_SELECTOR_SEARCH_LIMIT = 100
const RUNTIME_STATUS_WRITE_INTERVAL_MS = 15_000
const AUTH_FAILURE_DELAY_MS = 650
const AUTH_RATE_WINDOW_SECONDS = 5 * 60
const AUTH_BLOCK_SECONDS = 15 * 60
const AUTH_IP_MAX_FAILURES = 10
const AUTH_LOGIN_MAX_FAILURES = 8
const AUTH_RATE_KEY_PREFIX = 'native-ssh-gateway:auth-rate:'

export interface NativeSshGatewayConfig {
  enabled: boolean
  port: number
  host: string
  hostKeyPath?: string | undefined
}

type NativeSshGatewayConfigProvider = () => Promise<NativeSshGatewayConfig | null>

interface AuthenticatedClient {
  user: NativeSshUser
  parsedLogin: ParsedLogin
  mfaVerified: boolean
}

interface NativeSshAuthResult {
  client: AuthenticatedClient
  requiresMfa: boolean
}

interface TerminalSize {
  cols: number
  rows: number
}

class SshChannelTransport implements SshSessionTransport {
  constructor(private readonly channel: ServerChannel) {}

  send(data: Buffer | string): void {
    this.channel.write(data)
  }
}

export class NativeSshGatewayService {
  private server: Ssh2Server | null = null
  private activeConfig: NativeSshGatewayConfig | null = null
  private runtimeStatus: NativeSshGatewayRuntimeStatus | null = null
  private runtimeStatusTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly config: NativeSshGatewayConfig,
    private readonly sshRepo: SshRepository,
    private readonly totpService: TotpService,
    private readonly redis: Redis,
    private readonly emailConfigService: EmailConfigService,
    private readonly emailService: EmailService,
    private readonly managedSshSessionService: ManagedSshSessionService,
    private readonly logRepository?: LogRepository,
    private readonly configProvider?: NativeSshGatewayConfigProvider,
  ) {}

  async start(): Promise<void> {
    if (this.server) return

    const runtimeConfig = await this.loadRuntimeConfig()
    this.activeConfig = runtimeConfig

    if (!runtimeConfig.enabled) {
      logger.info('Native SSH Gateway desabilitado')
      this.startRuntimeHeartbeat('disabled', runtimeConfig)
      return
    }

    if (!runtimeConfig.hostKeyPath) {
      logger.warn('Native SSH Gateway não iniciado: NATIVE_SSH_GATEWAY_HOST_KEY_PATH não configurado')
      this.startRuntimeHeartbeat('error', runtimeConfig, 'Host key não configurada')
      return
    }

    let hostKey: Buffer
    try {
      hostKey = readFileSync(runtimeConfig.hostKeyPath)
    } catch (err) {
      logger.error({ err, hostKeyPath: runtimeConfig.hostKeyPath }, 'Native SSH Gateway não iniciado: falha ao ler host key')
      this.startRuntimeHeartbeat('error', runtimeConfig, errorMessage(err))
      return
    }
    this.server = new Server({
      hostKeys: [hostKey],
      ident: 'SSH-2.0-NodeAccess',
      algorithms: {
        kex: [
          'curve25519-sha256',
          'curve25519-sha256@libssh.org',
          'ecdh-sha2-nistp256',
          'ecdh-sha2-nistp384',
          'ecdh-sha2-nistp521',
          'diffie-hellman-group14-sha256',
          'diffie-hellman-group16-sha512',
          'diffie-hellman-group18-sha512',
        ],
      },
    }, (client, info) => this.handleClient(client, info))

    this.server.on('error', (err: Error) => {
      logger.error({ err }, 'Native SSH Gateway error')
      this.updateRuntimeHeartbeat('error', err.message)
    })

    this.server.listen(runtimeConfig.port, runtimeConfig.host, () => {
      this.startRuntimeHeartbeat('online', runtimeConfig)
      logger.info({
        host: runtimeConfig.host,
        port: runtimeConfig.port,
      }, 'Native SSH Gateway iniciado')
    })
  }

  async stop(): Promise<void> {
    await this.stopRuntimeHeartbeat()
    if (!this.server) return
    await new Promise<void>((resolve, reject) => {
      this.server?.close((err?: Error) => err ? reject(err) : resolve())
    })
    this.server = null
    this.activeConfig = null
  }

  private async loadRuntimeConfig(): Promise<NativeSshGatewayConfig> {
    if (!this.configProvider) return this.config

    try {
      const savedConfig = await this.configProvider()
      if (!savedConfig) return this.config
      return savedConfig
    } catch (err) {
      logger.warn({ err }, 'Native SSH Gateway: falha ao carregar configuração salva; usando .env')
      return this.config
    }
  }

  private startRuntimeHeartbeat(state: NativeSshGatewayRuntimeState, config: NativeSshGatewayConfig, failureMessage: string | null = null): void {
    const now = new Date().toISOString()
    this.runtimeStatus = {
      state,
      host: config.host,
      port: config.port,
      enabled: config.enabled,
      hostKeyConfigured: !!config.hostKeyPath,
      startedAt: now,
      lastSeenAt: now,
      lastFailureAt: failureMessage ? now : null,
      lastFailureMessage: failureMessage,
    }

    void this.writeRuntimeStatus()

    if (this.runtimeStatusTimer) clearInterval(this.runtimeStatusTimer)
    this.runtimeStatusTimer = setInterval(() => {
      void this.writeRuntimeStatus()
    }, RUNTIME_STATUS_WRITE_INTERVAL_MS)
  }

  private updateRuntimeHeartbeat(state: NativeSshGatewayRuntimeState, failureMessage: string | null = null): void {
    if (!this.runtimeStatus && this.activeConfig) {
      this.startRuntimeHeartbeat(state, this.activeConfig, failureMessage)
      return
    }
    if (!this.runtimeStatus) return

    const now = new Date().toISOString()
    this.runtimeStatus = {
      ...this.runtimeStatus,
      state,
      lastSeenAt: now,
      lastFailureAt: failureMessage ? now : this.runtimeStatus.lastFailureAt,
      lastFailureMessage: failureMessage ?? this.runtimeStatus.lastFailureMessage,
    }
    void this.writeRuntimeStatus()
  }

  private async writeRuntimeStatus(): Promise<void> {
    if (!this.runtimeStatus) return

    this.runtimeStatus.lastSeenAt = new Date().toISOString()
    try {
      await this.redis.set(
        NATIVE_SSH_GATEWAY_STATUS_KEY,
        JSON.stringify(this.runtimeStatus),
        'EX',
        NATIVE_SSH_GATEWAY_STATUS_TTL_SECONDS,
      )
    } catch (err) {
      logger.warn({ err }, 'Native SSH Gateway: falha ao persistir heartbeat operacional')
    }
  }

  private async stopRuntimeHeartbeat(): Promise<void> {
    if (this.runtimeStatusTimer) {
      clearInterval(this.runtimeStatusTimer)
      this.runtimeStatusTimer = null
    }

    if (!this.runtimeStatus) return

    this.runtimeStatus = {
      ...this.runtimeStatus,
      state: 'stopped',
      lastSeenAt: new Date().toISOString(),
    }

    try {
      await this.redis.set(
        NATIVE_SSH_GATEWAY_STATUS_KEY,
        JSON.stringify(this.runtimeStatus),
        'EX',
        NATIVE_SSH_GATEWAY_STATUS_TTL_SECONDS,
      )
    } catch {
      // best-effort shutdown status
    }
  }

  private auditAuthEvent(userId: number | undefined, eventType: AuthEventType, success: boolean, info: ClientInfo | undefined): void {
    if (!this.logRepository) return

    void this.logRepository.logAuthEvent({
      ...(userId !== undefined && { userId }),
      eventType,
      success,
      ...(info?.ip !== undefined && { ip: info.ip }),
      userAgent: 'native-ssh-gateway',
    }).catch((err) => {
      logger.warn({ err, userId, eventType }, 'Native SSH Gateway: falha ao registrar auth log')
    })
  }

  private auditGatewayEvent(userId: number, action: string, details: Record<string, unknown>, targetId = 0): void {
    if (!this.logRepository) return

    void this.logRepository.logAdminEvent({
      adminId: userId,
      action,
      targetType: 'NativeSshGateway',
      targetId,
      details: JSON.stringify(details),
    }).catch((err) => {
      logger.warn({ err, userId, action }, 'Native SSH Gateway: falha ao registrar evento de auditoria')
    })
  }

  private async checkAuthRateLimit(username: string, info: ClientInfo): Promise<{ limited: boolean; scope: 'ip' | 'login' | 'ip_login' | null }> {
    const [ipBlocked, loginBlocked] = await Promise.all([
      this.hasRedisKey(this.authBlockKey('ip', info.ip)),
      this.hasRedisKey(this.authBlockKey('login', normalizeRateLimitPart(username))),
    ])

    return {
      limited: ipBlocked || loginBlocked,
      scope: ipBlocked && loginBlocked ? 'ip_login' : ipBlocked ? 'ip' : loginBlocked ? 'login' : null,
    }
  }

  private async recordAuthFailure(username: string, info: ClientInfo, userId?: number): Promise<void> {
    const loginKeyPart = normalizeRateLimitPart(username)
    const [ipCount, loginCount] = await Promise.all([
      this.incrementRateCounter(this.authCountKey('ip', info.ip)),
      this.incrementRateCounter(this.authCountKey('login', loginKeyPart)),
    ])

    const blockScopes: Array<'ip' | 'login'> = []
    if (ipCount > AUTH_IP_MAX_FAILURES) {
      await this.setRateBlock(this.authBlockKey('ip', info.ip))
      blockScopes.push('ip')
    }
    if (loginCount > AUTH_LOGIN_MAX_FAILURES) {
      await this.setRateBlock(this.authBlockKey('login', loginKeyPart))
      blockScopes.push('login')
    }

    if (blockScopes.length > 0) {
      const scope = blockScopes.length === 2 ? 'ip_login' : blockScopes[0]!
      this.auditAuthEvent(userId, 'LOGIN_BLOCKED', false, info)
      this.auditRateLimited(userId, username, info, scope)
    }
  }

  private async clearAuthFailures(username: string, info: ClientInfo): Promise<void> {
    const loginKeyPart = normalizeRateLimitPart(username)
    await this.redis.del(
      this.authCountKey('ip', info.ip),
      this.authCountKey('login', loginKeyPart),
    ).catch(() => {})
  }

  private async incrementRateCounter(key: string): Promise<number> {
    try {
      const count = await this.redis.incr(key)
      if (count === 1) await this.redis.expire(key, AUTH_RATE_WINDOW_SECONDS)
      return count
    } catch (err) {
      logger.warn({ err }, 'Native SSH Gateway: falha ao incrementar rate limit')
      return 0
    }
  }

  private async setRateBlock(key: string): Promise<void> {
    try {
      await this.redis.set(key, '1', 'EX', AUTH_BLOCK_SECONDS)
    } catch (err) {
      logger.warn({ err }, 'Native SSH Gateway: falha ao aplicar bloqueio temporário')
    }
  }

  private async hasRedisKey(key: string): Promise<boolean> {
    try {
      return await this.redis.exists(key) > 0
    } catch (err) {
      logger.warn({ err }, 'Native SSH Gateway: falha ao consultar rate limit')
      return false
    }
  }

  private authCountKey(scope: 'ip' | 'login', value: string): string {
    return `${AUTH_RATE_KEY_PREFIX}${scope}:${value}:count`
  }

  private authBlockKey(scope: 'ip' | 'login', value: string): string {
    return `${AUTH_RATE_KEY_PREFIX}${scope}:${value}:blocked`
  }

  private auditRateLimited(userId: number | undefined, username: string, info: ClientInfo, scope: 'ip' | 'login' | 'ip_login' | null): void {
    if (userId !== undefined) {
      this.auditGatewayEvent(userId, 'NATIVE_SSH_GATEWAY_LOGIN_RATE_LIMITED', {
        username,
        clientIp: info.ip,
        scope,
        blockSeconds: AUTH_BLOCK_SECONDS,
      })
    }
    logger.warn({
      username,
      clientIp: info.ip,
      scope,
      blockSeconds: AUTH_BLOCK_SECONDS,
    }, 'Native SSH Gateway: login bloqueado por rate limit')
  }

  private handleClient(client: Connection, info: ClientInfo): void {
    let authenticated: AuthenticatedClient | null = null
    let pendingMfa: AuthenticatedClient | null = null

    client.on('authentication', (ctx) => {
      this.authenticate(ctx, pendingMfa, info)
        .then((result) => {
          if (!result) {
            logger.warn({
              username: ctx.username,
              method: ctx.method,
              clientIp: info.ip,
              mfaPending: !!pendingMfa,
            }, 'Native SSH Gateway: autenticação recusada')
            ctx.reject(pendingMfa ? ['keyboard-interactive'] : ['password', 'keyboard-interactive'], !!pendingMfa)
            return
          }
          if (result.requiresMfa) {
            logger.info({
              userId: result.client.user.id,
              username: ctx.username,
              clientIp: info.ip,
            }, 'Native SSH Gateway: senha aceita, MFA será solicitado no canal')
            pendingMfa = null
            authenticated = result.client
            ctx.accept()
            return
          }
          pendingMfa = null
          authenticated = result.client
          ctx.accept()
        })
        .catch((err) => {
          logger.warn({ err, username: ctx.username, clientIp: info.ip }, 'Falha na autenticação Native SSH Gateway')
          ctx.reject(pendingMfa ? ['keyboard-interactive'] : ['password', 'keyboard-interactive'], !!pendingMfa)
        })
    })

    client.on('ready', () => {
      logger.info({
        userId: authenticated?.user.id,
        clientIp: info.ip,
      }, 'Cliente autenticado no Native SSH Gateway')

      client.on('session', (accept, reject) => {
        if (!authenticated) {
          reject()
          return
        }
        const clientAuth = authenticated
        const session = accept()
        let size: TerminalSize = { cols: 80, rows: 24 }

        session.on('pty', (acceptPty, _rejectPty, ptyInfo: PseudoTtyInfo) => {
          size = {
            cols: ptyInfo.cols || 80,
            rows: ptyInfo.rows || 24,
          }
          acceptPty()
        })

        session.on('window-change', (acceptWindow, _rejectWindow, windowInfo) => {
          size = {
            cols: windowInfo.cols || size.cols,
            rows: windowInfo.rows || size.rows,
          }
          if (typeof acceptWindow === 'function') acceptWindow()
        })

        session.on('shell', (acceptShell, rejectShell) => {
          const channel = acceptShell()
          this.handleShell(channel, clientAuth, info, size).catch((err) => {
            logger.error({ err, userId: clientAuth.user.id }, 'Erro no shell Native SSH Gateway')
            channel.write('\r\nErro interno no NodeAccess SSH Gateway.\r\n')
            channel.end()
          })
        })

        session.on('exec', (acceptExec, rejectExec, execInfo) => {
          if (!clientAuth.parsedLogin.target) {
            rejectExec()
            return
          }
          const channel = acceptExec()
          this.connectToTarget(channel, clientAuth, info, size, execInfo.command).catch((err) => {
            logger.error({ err, userId: clientAuth.user.id }, 'Erro no exec Native SSH Gateway')
            channel.stderr.write('Erro interno no NodeAccess SSH Gateway.\n')
            channel.exit(1)
            channel.end()
          })
        })

        session.on('subsystem', (_acceptSubsystem, rejectSubsystem, subsystemInfo) => {
          rejectSubsystem()
        })
      })
    })

    client.on('error', (err) => {
      logger.warn({ err, clientIp: info.ip }, 'Conexão Native SSH Gateway com erro')
    })
  }

  private async authenticate(ctx: AuthContext, pendingMfa: AuthenticatedClient | null, info: ClientInfo): Promise<NativeSshAuthResult | null> {
    if (ctx.method === 'keyboard-interactive') {
      return this.authenticateMfa(ctx, pendingMfa, info)
    }

    if (ctx.method !== 'password') {
      this.auditAuthEvent(undefined, 'LOGIN_FAILED', false, info)
      return null
    }

    const rateLimit = await this.checkAuthRateLimit(ctx.username, info)
    if (rateLimit.limited) {
      this.auditAuthEvent(undefined, 'LOGIN_BLOCKED', false, info)
      this.auditRateLimited(undefined, ctx.username, info, rateLimit.scope)
      await delay(AUTH_FAILURE_DELAY_MS)
      return null
    }

    const resolvedLogin = await this.resolveLogin(ctx.username)
    if (!resolvedLogin) {
      this.auditAuthEvent(undefined, 'LOGIN_FAILED', false, info)
      await this.recordAuthFailure(ctx.username, info)
      await delay(AUTH_FAILURE_DELAY_MS)
      return null
    }
    const { user, parsedLogin } = resolvedLogin
    if (!user.active || !user.passwordHash) {
      this.auditAuthEvent(user.id, 'LOGIN_BLOCKED', false, info)
      this.auditGatewayEvent(user.id, 'NATIVE_SSH_GATEWAY_LOGIN_DENIED', {
        username: ctx.username,
        clientIp: info.ip,
        reason: !user.active ? 'user_inactive' : 'password_unavailable',
      })
      await this.recordAuthFailure(ctx.username, info, user.id)
      await delay(AUTH_FAILURE_DELAY_MS)
      return null
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      this.auditAuthEvent(user.id, 'LOGIN_BLOCKED', false, info)
      this.auditGatewayEvent(user.id, 'NATIVE_SSH_GATEWAY_LOGIN_DENIED', {
        username: ctx.username,
        clientIp: info.ip,
        reason: 'user_locked',
      })
      await this.recordAuthFailure(ctx.username, info, user.id)
      await delay(AUTH_FAILURE_DELAY_MS)
      return null
    }

    const valid = await bcrypt.compare(ctx.password, user.passwordHash)
    if (!valid) {
      this.auditAuthEvent(user.id, 'LOGIN_FAILED', false, info)
      this.auditGatewayEvent(user.id, 'NATIVE_SSH_GATEWAY_LOGIN_DENIED', {
        username: ctx.username,
        clientIp: info.ip,
        reason: 'invalid_password',
      })
      await this.recordAuthFailure(ctx.username, info, user.id)
      await delay(AUTH_FAILURE_DELAY_MS)
      return null
    }

    await this.clearAuthFailures(ctx.username, info)

    if (!user.mfaEnabled) {
      this.auditAuthEvent(user.id, 'LOGIN', true, info)
      this.auditGatewayEvent(user.id, 'NATIVE_SSH_GATEWAY_LOGIN_ACCEPTED', {
        username: ctx.username,
        clientIp: info.ip,
        mfaRequired: false,
      })
    } else {
      this.auditGatewayEvent(user.id, 'NATIVE_SSH_GATEWAY_LOGIN_ACCEPTED', {
        username: ctx.username,
        clientIp: info.ip,
        mfaRequired: true,
      })
    }

    return {
      client: { user, parsedLogin, mfaVerified: !user.mfaEnabled },
      requiresMfa: user.mfaEnabled,
    }
  }

  private async authenticateMfa(ctx: AuthContext, pendingMfa: AuthenticatedClient | null, info: ClientInfo): Promise<NativeSshAuthResult | null> {
    if (ctx.method !== 'keyboard-interactive' || !pendingMfa?.user.mfaEnabled) {
      return null
    }

    logger.info({
      userId: pendingMfa.user.id,
      username: ctx.username,
    }, 'Native SSH Gateway: solicitando MFA via keyboard-interactive')

    const emailOtpSent = await this.issueEmailOtpIfAvailable(pendingMfa.user).catch((err) => {
      logger.warn({ err, userId: pendingMfa.user.id }, 'Native SSH Gateway: falha ao emitir email OTP')
      return false
    })

    return new Promise((resolve) => {
      const instructions = emailOtpSent
        ? 'Informe o código do authenticator ou o código enviado por email.'
        : 'Informe o código do authenticator.'

      ctx.prompt({ prompt: 'MFA code: ', echo: false }, 'NodeAccess MFA', instructions, (answers) => {
        const code = answers[0]?.trim() ?? ''
        const secret = pendingMfa.user.mfaSecret
        const validTotp = !!secret && this.totpService.verify(secret, code)

        this.verifyEmailOtp(pendingMfa.user.id, code)
          .then((validEmailOtp) => {
            if (!validTotp && !validEmailOtp) {
              logger.warn({
                userId: pendingMfa.user.id,
                username: ctx.username,
              }, 'Native SSH Gateway: MFA inválido')
              this.auditAuthEvent(pendingMfa.user.id, 'MFA_FAILED', false, info)
              this.auditGatewayEvent(pendingMfa.user.id, 'NATIVE_SSH_GATEWAY_MFA_DENIED', {
                username: ctx.username,
                clientIp: info.ip,
                reason: 'invalid_mfa_code',
              })
              resolve(null)
              return
            }
            logger.info({
              userId: pendingMfa.user.id,
              username: ctx.username,
            }, 'Native SSH Gateway: MFA validado')
            this.auditAuthEvent(pendingMfa.user.id, 'MFA_VERIFIED', true, info)
            this.auditAuthEvent(pendingMfa.user.id, 'LOGIN', true, info)
            this.auditGatewayEvent(pendingMfa.user.id, 'NATIVE_SSH_GATEWAY_MFA_ACCEPTED', {
              username: ctx.username,
              clientIp: info.ip,
            })
            pendingMfa.mfaVerified = true
            resolve({
              client: pendingMfa,
              requiresMfa: false,
            })
          })
          .catch((err) => {
            logger.warn({ err, userId: pendingMfa.user.id }, 'Native SSH Gateway: falha ao validar email OTP')
            this.auditAuthEvent(pendingMfa.user.id, 'MFA_FAILED', false, info)
            this.auditGatewayEvent(pendingMfa.user.id, 'NATIVE_SSH_GATEWAY_MFA_DENIED', {
              username: ctx.username,
              clientIp: info.ip,
              reason: 'mfa_validation_error',
            })
            resolve(null)
          })
      })
    })
  }

  private async handleShell(
    channel: ServerChannel,
    authenticated: AuthenticatedClient,
    info: ClientInfo,
    size: TerminalSize,
  ): Promise<void> {
    if (authenticated.parsedLogin.target) {
      if (!await this.ensureChannelMfa(channel, authenticated, info)) return
      await this.connectToTarget(channel, authenticated, info, size)
      return
    }

    if (!await this.ensureChannelMfa(channel, authenticated, info)) return

    channel.write('\r\nNodeAccess SSH Gateway\r\n')
    channel.write('Digite `sshs`, `hosts`, `connect <host>` ou `exit`.\r\n\r\n')
    channel.write('nodeaccess> ')

    this.bindCommandLoop(channel, authenticated, info, size)
  }

  private bindCommandLoop(
    channel: ServerChannel,
    authenticated: AuthenticatedClient,
    info: ClientInfo,
    size: TerminalSize,
  ): void {
    let buffer = ''
    channel.on('data', (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) {
          buffer = ''
          channel.write('^C\r\nnodeaccess> ')
          continue
        }

        if (byte === 8 || byte === 127) {
          if (buffer.length > 0) {
            buffer = buffer.slice(0, -1)
            channel.write('\b \b')
          }
          continue
        }

        if (byte === 13 || byte === 10) {
          const command = buffer.trim()
          buffer = ''
          channel.write('\r\n')
          void this.handleCommand(channel, authenticated, info, size, command)
          continue
        }

        if (byte >= 32 && byte <= 126) {
          const char = String.fromCharCode(byte)
          buffer += char
          channel.write(char)
        }
      }
    })
  }

  private async handleCommand(
    channel: ServerChannel,
    authenticated: AuthenticatedClient,
    info: ClientInfo,
    size: TerminalSize,
    command: string,
  ): Promise<void> {
    if (!command) {
      channel.write('nodeaccess> ')
      return
    }

    if (command === 'exit' || command === 'quit') {
      channel.write('bye\r\n')
      channel.end()
      return
    }

    if (command === 'help') {
      channel.write('Comandos:\r\n')
      channel.write('  sshs [busca]               abre seletor interativo de hosts\r\n')
      channel.write('  hosts [busca]              lista hosts acessiveis por nome, IP, grupo, pasta ou tag\r\n')
      channel.write('  connect [usuario@]host     conecta no host cadastrado por nome, IP ou #ID\r\n')
      channel.write('  exit                       encerra o shell do NodeAccess\r\n\r\n')
      channel.write('Acesso direto no Linux:\r\n')
      channel.write("  ssh -p 2222 -o IdentitiesOnly=yes -l 'usuario_nodeaccess@host' ip_nodeaccess\r\n")
      channel.write("  ssh -p 2222 -o IdentitiesOnly=yes -l 'usuario_nodeaccess@usuario_host@host' ip_nodeaccess\r\n")
      channel.write("  ssh -p 2222 -o IdentitiesOnly=yes 'usuario_nodeaccess@host'@ip_nodeaccess\r\n")
      channel.write("  ssh -p 2222 -o IdentitiesOnly=yes 'usuario_nodeaccess@usuario_host@host'@ip_nodeaccess\r\n")
      channel.write('  Use -o IdentitiesOnly=yes; -O e um comando de multiplexacao do OpenSSH.\r\n')
      channel.write('nodeaccess> ')
      return
    }

    if (command === 'sshs' || command.startsWith('sshs ')) {
      const query = command.startsWith('sshs ') ? command.slice('sshs '.length).trim() : ''
      await this.openHostSelector(channel, authenticated, info, size, query)
      return
    }

    if (command === 'hosts' || command.startsWith('hosts ')) {
      const query = command.startsWith('hosts ') ? command.slice('hosts '.length) : undefined
      const hosts = await this.sshRepo.listAccessibleHosts(
        authenticated.user.id,
        authenticated.user.tenantId,
        authenticated.user.role,
        query,
      )
      if (hosts.length === 0) {
        channel.write('Nenhum host acessível encontrado.\r\n')
      } else {
        for (const host of hosts) {
          channel.write(`${formatNativeSshHostSummary(host)}\r\n`)
        }
      }
      channel.write('nodeaccess> ')
      return
    }

    if (command.startsWith('connect ')) {
      const target = parseTarget(command.slice('connect '.length).trim())
      if (!target.target) {
        channel.write('Uso: connect [usuario@]host\r\nnodeaccess> ')
        return
      }
      await this.connectToTarget(channel, {
        ...authenticated,
        parsedLogin: {
          nodeAccessLogin: authenticated.parsedLogin.nodeAccessLogin,
          target: target.target,
          ...(target.targetUser !== undefined && { targetUser: target.targetUser }),
        },
      }, info, size, undefined, { closeOnFailure: false, returnToShell: true })
      return
    }

    channel.write(`Comando desconhecido: ${command}\r\n`)
    channel.write('nodeaccess> ')
  }

  private async connectToTarget(
    channel: ServerChannel,
    authenticated: AuthenticatedClient,
    info: ClientInfo,
    size: TerminalSize,
    execCommand?: string,
    options?: { closeOnFailure?: boolean; returnToShell?: boolean },
  ): Promise<void> {
    const closeOnFailure = options?.closeOnFailure ?? true
    const returnToShell = options?.returnToShell ?? false
    if (!await this.ensureChannelMfa(channel, authenticated, info)) return

    const target = authenticated.parsedLogin.target
    if (!target) {
      channel.write('Destino não informado.\r\n')
      if (closeOnFailure) channel.end()
      else channel.write('nodeaccess> ')
      return
    }

    this.auditGatewayEvent(authenticated.user.id, 'NATIVE_SSH_GATEWAY_HOST_REQUESTED', {
      clientIp: info.ip,
      target,
      targetUser: authenticated.parsedLogin.targetUser ?? null,
      exec: !!execCommand,
    })

    const host = await this.sshRepo.resolveAccessibleHost(
      target,
      authenticated.user.id,
      authenticated.user.tenantId,
      authenticated.user.role,
    )

    if (!host) {
      const deniedMessage = nativeSshGatewayFailureMessage('HOST_DENIED', target)
      this.auditGatewayEvent(authenticated.user.id, 'NATIVE_SSH_GATEWAY_HOST_DENIED', {
        clientIp: info.ip,
        target,
        targetUser: authenticated.parsedLogin.targetUser ?? null,
        reason: 'not_found_or_permission_denied',
        userMessage: deniedMessage.trim(),
      })
      channel.write(deniedMessage)
      if (closeOnFailure) channel.end()
      else channel.write('nodeaccess> ')
      return
    }

    const effectiveHost = {
      ...host,
      sshUser: authenticated.parsedLogin.targetUser ?? host.sshUser,
    }

    channel.write(`Conectando em ${effectiveHost.sshUser}@${host.name} (${host.ip})...\r\n`)
    let channelClosed = false
    const handleChannelClose = () => {
      channelClosed = true
    }
    channel.once('close', handleChannelClose)
    let connectionClosedAudited = false
    const auditConnectionClosed = () => {
      if (connectionClosedAudited) return
      connectionClosedAudited = true
      this.auditGatewayEvent(authenticated.user.id, 'NATIVE_SSH_GATEWAY_CONNECTION_CLOSED', {
        clientIp: info.ip,
        hostId: host.id,
        hostName: host.name,
        hostIp: host.ip,
        hostPort: host.port,
      }, host.id)
    }

    try {
      const managedSession = await this.managedSshSessionService.open({
        user: {
          id: authenticated.user.id,
          tenantId: authenticated.user.tenantId,
          name: authenticated.user.name,
          email: authenticated.user.email,
        },
        host: effectiveHost,
        transport: new SshChannelTransport(channel),
        cols: size.cols,
        rows: size.rows,
        clientIp: info.ip,
        userAgent: 'native-ssh-gateway',
        connectionMethod: 'native_ssh_gateway',
        source: 'native_ssh_gateway',
        onInputRejected: (message) => {
          channel.write(`\r\n${message}\r\n`)
        },
        onClose: () => {
          auditConnectionClosed()
          channel.off('close', handleChannelClose)
          if (channelClosed) return
          if (returnToShell) {
            channel.removeAllListeners('data')
            channel.write('\r\nSessao SSH final encerrada.\r\nnodeaccess> ')
            this.bindCommandLoop(channel, authenticated, info, size)
            return
          }
          channel.end()
        },
      })

      this.auditGatewayEvent(authenticated.user.id, 'NATIVE_SSH_GATEWAY_CONNECTION_OPENED', {
        clientIp: info.ip,
        hostId: host.id,
        hostName: host.name,
        hostIp: host.ip,
        hostPort: host.port,
        sshUser: effectiveHost.sshUser,
        exec: !!execCommand,
      }, host.id)

      channel.removeAllListeners('data')
      const handleTargetData = (data: Buffer) => managedSession.write(data)
      const closeManagedSession = () => {
        channelClosed = true
        auditConnectionClosed()
        managedSession.close().catch(() => {})
      }
      channel.on('data', handleTargetData)
      channel.once('close', closeManagedSession)

      if (execCommand) {
        managedSession.write(Buffer.from(`${execCommand}\n`, 'utf8'))
      }
    } catch (err) {
      channel.off('close', handleChannelClose)
      const failure = classifyNativeSshGatewayFailure(err)
      logger.error({ err, hostId: host.id }, 'Falha ao abrir sessão Native SSH Gateway')
      this.auditGatewayEvent(authenticated.user.id, 'NATIVE_SSH_GATEWAY_CONNECTION_FAILED', {
        clientIp: info.ip,
        hostId: host.id,
        hostName: host.name,
        hostIp: host.ip,
        hostPort: host.port,
        reason: failure.reason,
        technicalReason: errorMessage(err),
        userMessage: failure.message.trim(),
      }, host.id)
      channel.write(failure.message)
      if (closeOnFailure) channel.end()
      else channel.write('nodeaccess> ')
    }
  }

  private async openHostSelector(
    channel: ServerChannel,
    authenticated: AuthenticatedClient,
    info: ClientInfo,
    size: TerminalSize,
    initialQuery = '',
  ): Promise<void> {
    channel.removeAllListeners('data')
    let query = initialQuery
    let selectedIndex = 0
    let page = 0
    let hosts: NativeSshHostSummary[] = []
    let loading = false
    let closed = false
    let loadSeq = 0

    const visibleHosts = () => hosts.slice(
      page * SSHS_SELECTOR_PAGE_SIZE,
      page * SSHS_SELECTOR_PAGE_SIZE + SSHS_SELECTOR_PAGE_SIZE,
    )

    const totalPages = () => Math.max(1, Math.ceil(hosts.length / SSHS_SELECTOR_PAGE_SIZE))

    const clampSelection = () => {
      page = Math.min(page, totalPages() - 1)
      selectedIndex = Math.min(selectedIndex, Math.max(0, visibleHosts().length - 1))
    }

    const loadHosts = async () => {
      const seq = ++loadSeq
      loading = true
      render()
      const loadedHosts = await this.sshRepo.listAccessibleHosts(
        authenticated.user.id,
        authenticated.user.tenantId,
        authenticated.user.role,
        query,
        SSHS_SELECTOR_SEARCH_LIMIT,
      )
      if (seq !== loadSeq || closed) return
      hosts = loadedHosts
      clampSelection()
      loading = false
      render()
    }

    const closeSelector = (restorePrompt = true) => {
      closed = true
      channel.removeAllListeners('data')
      channel.write('\r\n')
      if (restorePrompt) {
        channel.write('nodeaccess> ')
        this.bindCommandLoop(channel, authenticated, info, size)
      }
    }

    const connectSelected = async () => {
      const selected = visibleHosts()[selectedIndex]
      if (!selected) return
      closed = true
      channel.removeAllListeners('data')
      channel.write('\x1b[2J\x1b[H')
      await this.connectToTarget(channel, {
        ...authenticated,
        parsedLogin: {
          nodeAccessLogin: authenticated.parsedLogin.nodeAccessLogin,
          target: selected.ip,
        },
      }, info, size, undefined, { closeOnFailure: false, returnToShell: true })
    }

    const handleData = (chunk: Buffer) => {
      if (closed) return
      for (let index = 0; index < chunk.length; index += 1) {
        const byte = chunk[index]
        const nextByte = chunk[index + 1]
        const thirdByte = chunk[index + 2]

        if (byte === 3 || byte === 27 && nextByte !== 91) {
          closeSelector()
          return
        }

        if (byte === 27 && nextByte === 91 && thirdByte === 65) {
          if (selectedIndex > 0) {
            selectedIndex -= 1
          } else if (page > 0) {
            page -= 1
            selectedIndex = Math.max(0, visibleHosts().length - 1)
          }
          index += 2
          render()
          continue
        }

        if (byte === 27 && nextByte === 91 && thirdByte === 66) {
          if (selectedIndex < visibleHosts().length - 1) {
            selectedIndex += 1
          } else if (page < totalPages() - 1) {
            page += 1
            selectedIndex = 0
          }
          index += 2
          render()
          continue
        }

        if (byte === 27 && nextByte === 91 && thirdByte === 67) {
          if (page < totalPages() - 1) {
            page += 1
            selectedIndex = 0
            render()
          }
          index += 2
          continue
        }

        if (byte === 27 && nextByte === 91 && thirdByte === 68) {
          if (page > 0) {
            page -= 1
            selectedIndex = 0
            render()
          }
          index += 2
          continue
        }

        if (byte === 27 && nextByte === 91 && thirdByte === 53 && chunk[index + 3] === 126) {
          if (page > 0) {
            page -= 1
            selectedIndex = 0
            render()
          }
          index += 3
          continue
        }

        if (byte === 27 && nextByte === 91 && thirdByte === 54 && chunk[index + 3] === 126) {
          if (page < totalPages() - 1) {
            page += 1
            selectedIndex = 0
            render()
          }
          index += 3
          continue
        }

        if (byte === 13 || byte === 10) {
          void connectSelected()
          return
        }

        if (byte === 8 || byte === 127) {
          if (query.length > 0) {
            query = query.slice(0, -1)
            selectedIndex = 0
            page = 0
            void loadHosts()
          }
          continue
        }

        if (byte === 18) {
          void loadHosts()
          continue
        }

        if (byte !== undefined && byte >= 32 && byte <= 126) {
          query += String.fromCharCode(byte)
          selectedIndex = 0
          page = 0
          void loadHosts()
        }
      }
    }

    const render = () => {
      channel.write('\x1b[2J\x1b[H')
      channel.write('NodeAccess host selector\r\n')
      channel.write('Digite para buscar. Setas navegam, Enter conecta, Esc/Ctrl+C cancela.\r\n')
      channel.write('Direita/PageDown proxima pagina, Esquerda/PageUp pagina anterior, Ctrl+R atualiza.\r\n\r\n')
      channel.write(`Busca: ${query || ''}\r\n\r\n`)

      if (loading && hosts.length === 0) {
        channel.write('Carregando hosts...\r\n')
        return
      }

      if (hosts.length === 0) {
        channel.write(loading ? 'Buscando...\r\n' : 'Nenhum host acessivel encontrado.\r\n')
        return
      }

      channel.write(`Pagina ${page + 1}/${totalPages()} - ${hosts.length} resultado(s) carregado(s)\r\n\r\n`)
      visibleHosts().forEach((host, index) => {
        const marker = index === selectedIndex ? '>' : ' '
        channel.write(`${marker} ${formatNativeSshHostSummary(host)}\r\n`)
      })
      if (hosts.length >= SSHS_SELECTOR_SEARCH_LIMIT) {
        channel.write('\r\nHa mais resultados possiveis. Refine a busca para reduzir a lista.\r\n')
      }
      if (loading) channel.write('\r\nAtualizando...\r\n')
    }

    channel.on('data', handleData)
    await loadHosts()
  }

  private async ensureChannelMfa(channel: ServerChannel, authenticated: AuthenticatedClient, info: ClientInfo): Promise<boolean> {
    if (authenticated.mfaVerified) return true

    channel.write('\r\n\r\nNodeAccess MFA obrigatorio\r\n')
    channel.write('Preparando verificacao MFA...\r\n')

    const emailOtpSent = await this.issueEmailOtpWithPromptTimeout(authenticated.user)
    channel.write(emailOtpSent
      ? 'Informe o codigo do authenticator ou o codigo enviado por email.\r\n'
      : 'Informe o codigo do authenticator.\r\n')

    for (let attempt = 1; attempt <= EMAIL_OTP_MAX_ATTEMPTS; attempt += 1) {
      const code = await this.readSecretLine(channel, 'MFA code: ')
      const secret = authenticated.user.mfaSecret
      const validTotp = !!secret && this.totpService.verify(secret, code)
      const validEmailOtp = await this.verifyEmailOtp(authenticated.user.id, code).catch((err) => {
        logger.warn({ err, userId: authenticated.user.id }, 'Native SSH Gateway: falha ao validar email OTP no canal')
        return false
      })

      if (validTotp || validEmailOtp) {
        authenticated.mfaVerified = true
        logger.info({ userId: authenticated.user.id }, 'Native SSH Gateway: MFA validado no canal')
        this.auditAuthEvent(authenticated.user.id, 'MFA_VERIFIED', true, info)
        this.auditAuthEvent(authenticated.user.id, 'LOGIN', true, info)
        this.auditGatewayEvent(authenticated.user.id, 'NATIVE_SSH_GATEWAY_MFA_ACCEPTED', {
          clientIp: info.ip,
          reason: 'channel_mfa',
        })
        channel.write('\r\n')
        return true
      }

      logger.warn({ userId: authenticated.user.id, attempt }, 'Native SSH Gateway: MFA inválido no canal')
      this.auditAuthEvent(authenticated.user.id, 'MFA_FAILED', false, info)
      this.auditGatewayEvent(authenticated.user.id, 'NATIVE_SSH_GATEWAY_MFA_DENIED', {
        clientIp: info.ip,
        reason: 'invalid_channel_mfa_code',
        attempt,
      })
      channel.write('\r\nCódigo MFA inválido.\r\n')
    }

    channel.write('MFA não validado. Encerrando conexão.\r\n')
    channel.end()
    return false
  }

  private async issueEmailOtpWithPromptTimeout(user: NativeSshUser): Promise<boolean> {
    let timedOut = false
    const timeout = new Promise<boolean>((resolve) => {
      setTimeout(() => {
        timedOut = true
        resolve(false)
      }, EMAIL_OTP_PROMPT_TIMEOUT_MS)
    })

    const issueOtp = this.issueEmailOtpIfAvailable(user)
      .then((sent) => {
        if (timedOut && sent) {
          logger.info({ userId: user.id }, 'Native SSH Gateway: email OTP emitido após timeout do prompt')
        }
        return sent
      })
      .catch((err) => {
        logger.warn({ err, userId: user.id }, 'Native SSH Gateway: falha ao emitir email OTP no canal')
        return false
      })

    return Promise.race([issueOtp, timeout])
  }

  private readSecretLine(channel: ServerChannel, prompt: string): Promise<string> {
    channel.write(prompt)

    return new Promise((resolve) => {
      let buffer = ''

      const onClose = () => {
        channel.off('data', onData)
        resolve('')
      }

      const onData = (chunk: Buffer) => {
        for (const byte of chunk) {
          if (byte === 3) {
            cleanup()
            channel.write('^C\r\n')
            resolve('')
            return
          }

          if (byte === 8 || byte === 127) {
            buffer = buffer.slice(0, -1)
            continue
          }

          if (byte === 13 || byte === 10) {
            cleanup()
            resolve(buffer.trim())
            return
          }

          if (byte >= 32 && byte <= 126) {
            buffer += String.fromCharCode(byte)
          }
        }
      }

      const cleanup = () => {
        channel.off('data', onData)
        channel.off('close', onClose)
      }

      channel.on('data', onData)
      channel.once('close', onClose)
    })
  }

  private async issueEmailOtpIfAvailable(user: NativeSshUser): Promise<boolean> {
    const transport = await this.emailConfigService.getTransportConfig(user.tenantId)
    if (!transport) return false

    const rateKey = `${EMAIL_OTP_RATE_KEY_PREFIX}${user.id}`
    const count = await this.redis.incr(rateKey)
    if (count === 1) await this.redis.expire(rateKey, EMAIL_OTP_RATE_WINDOW_SECONDS)
    if (count > EMAIL_OTP_RATE_MAX) return false

    const otpKey = `${EMAIL_OTP_KEY_PREFIX}${user.id}`
    const existingTtl = await this.redis.ttl(otpKey)
    if (existingTtl > EMAIL_OTP_TTL_SECONDS - EMAIL_OTP_RESEND_COOLDOWN_SECONDS) return true

    const code = String(randomInt(100000, 1000000))
    await this.redis.set(
      otpKey,
      JSON.stringify({ code, attempts: EMAIL_OTP_MAX_ATTEMPTS }),
      'EX',
      EMAIL_OTP_TTL_SECONDS,
    )

    await this.emailService.send(transport, {
      to: user.email,
      subject: 'Seu código de acesso SSH - NodeAccess',
      text: `Seu código de verificação para acesso SSH é: ${code}\n\nEle expira em 10 minutos. Não compartilhe com ninguém.`,
    })

    return true
  }

  private async verifyEmailOtp(userId: number, code: string): Promise<boolean> {
    const otpKey = `${EMAIL_OTP_KEY_PREFIX}${userId}`
    const raw = await this.redis.get(otpKey)
    if (!raw) return false

    const stored = JSON.parse(raw) as { code: string; attempts: number }
    const inputBuf = Buffer.from(code.padEnd(6))
    const storedBuf = Buffer.from(stored.code.padEnd(6))
    const match = inputBuf.length === storedBuf.length && timingSafeEqual(inputBuf, storedBuf)

    if (match) {
      await this.redis.del(otpKey)
      return true
    }

    stored.attempts -= 1
    if (stored.attempts <= 0) {
      await this.redis.del(otpKey)
    } else {
      await this.redis.set(otpKey, JSON.stringify(stored), 'EX', EMAIL_OTP_TTL_SECONDS)
    }

    return false
  }

  private async resolveLogin(username: string): Promise<{ user: NativeSshUser; parsedLogin: ParsedLogin } | null> {
    for (const parsedLogin of parseLoginCandidates(username)) {
      const user = await this.sshRepo.findNativeSshUserByLogin(parsedLogin.nodeAccessLogin)
      if (user) return { user, parsedLogin }
    }
    return null
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function classifyNativeSshGatewayFailure(err: unknown): { reason: string; message: string } {
  if (err instanceof HostKeyVerificationError) {
    return {
      reason: err.reason === 'changed' ? 'host_key_changed' : 'host_key_not_trusted',
      message: nativeSshGatewayFailureMessage(err.reason === 'changed' ? 'HOST_KEY_CHANGED' : 'HOST_KEY_UNKNOWN'),
    }
  }

  if (err instanceof SshConnectionStepError) {
    const reason = err.errorCode
    if (reason === 'AUTH_FAILED' || reason === 'BASTION_AUTH_FAILED') {
      return { reason, message: nativeSshGatewayFailureMessage('CREDENTIAL_FAILED') }
    }
    if (reason === 'HOST_UNREACHABLE'
      || reason === 'HOST_PORT_REFUSED'
      || reason === 'DNS_FAILED'
      || reason === 'SSH_HANDSHAKE_TIMEOUT') {
      return { reason, message: nativeSshGatewayFailureMessage('HOST_UNAVAILABLE') }
    }
    if (reason.startsWith('BASTION_')) {
      return { reason, message: nativeSshGatewayFailureMessage('BASTION_UNAVAILABLE') }
    }
    return { reason, message: nativeSshGatewayFailureMessage('CONNECT_FAILED') }
  }

  const message = errorMessage(err)
  if (/auth|authentication|all configured authentication methods failed/i.test(message)) {
    return { reason: 'credential_failed', message: nativeSshGatewayFailureMessage('CREDENTIAL_FAILED') }
  }
  if (/host key/i.test(message)) {
    return { reason: 'host_key_verification_required', message: nativeSshGatewayFailureMessage('HOST_KEY_UNKNOWN') }
  }
  if (/timed out|timeout|econnrefused|enotfound|unreachable|handshake/i.test(message)) {
    return { reason: 'host_unavailable', message: nativeSshGatewayFailureMessage('HOST_UNAVAILABLE') }
  }
  return { reason: 'connect_failed', message: nativeSshGatewayFailureMessage('CONNECT_FAILED') }
}

function nativeSshGatewayFailureMessage(kind:
  | 'HOST_DENIED'
  | 'CREDENTIAL_FAILED'
  | 'HOST_UNAVAILABLE'
  | 'BASTION_UNAVAILABLE'
  | 'HOST_KEY_UNKNOWN'
  | 'HOST_KEY_CHANGED'
  | 'CONNECT_FAILED',
  target?: string,
): string {
  switch (kind) {
    case 'HOST_DENIED':
      return [
        `Host não cadastrado ou sem permissão: ${target ?? 'destino informado'}.`,
        'Confira o nome/IP usado no comando ou solicite acesso ao administrador.',
        '',
      ].join('\r\n')
    case 'CREDENTIAL_FAILED':
      return [
        'Credencial SSH do host recusada.',
        'A credencial cadastrada no NodeAccess não foi aceita pelo destino.',
        '',
      ].join('\r\n')
    case 'HOST_UNAVAILABLE':
      return [
        'Host indisponível para conexão SSH.',
        'Verifique rede, DNS, porta SSH, firewall ou disponibilidade do destino.',
        '',
      ].join('\r\n')
    case 'BASTION_UNAVAILABLE':
      return [
        'Falha ao conectar pelo bastion configurado.',
        'Verifique rede, credencial e disponibilidade do jump server.',
        '',
      ].join('\r\n')
    case 'HOST_KEY_UNKNOWN':
      return [
        'Host key do destino ainda não foi confiada.',
        'Valide a chave do host no NodeAccess antes de conectar via SSH Gateway.',
        '',
      ].join('\r\n')
    case 'HOST_KEY_CHANGED':
      return [
        'Host key do destino mudou.',
        'Por segurança, valide a nova chave no NodeAccess antes de conectar.',
        '',
      ].join('\r\n')
    case 'CONNECT_FAILED':
      return [
        'Falha ao abrir a conexão SSH final.',
        'Consulte os logs do SSH Gateway para o motivo técnico.',
        '',
      ].join('\r\n')
  }
}

function formatNativeSshHostSummary(host: NativeSshHostSummary): string {
  const metadata = [
    `#${host.id}`,
    host.name,
    `${host.ip}:${host.port}`,
    `sshUser=${host.sshUser}`,
    `scope=${host.scope}`,
    host.groupName ? `group=${host.groupName}` : null,
    host.folderName ? `folder=${host.folderName}` : null,
    host.tags.length > 0 ? `tags=${host.tags.join(',')}` : null,
  ].filter(Boolean)

  return metadata.join('  ')
}

function normalizeRateLimitPart(value: string): string {
  const normalized = value.trim().toLowerCase() || 'empty'
  return Buffer.from(normalized).toString('base64url')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
