import { encrypt } from '../../shared/crypto.js'
import type { OnePasswordService } from '../integrations/onepassword.service.js'
import type { SessionAuditPolicyService } from '../session-audit/session-audit-policy.service.js'
import type { SessionAuditPublisher } from '../session-audit/session-audit.publisher.js'
import { SshSession, type SshCredentials, type SshSessionTransport } from './ssh.session.js'
import type { HostCredentials, SshRepository } from './ssh.repository.js'
import { AllowAllSshInputPolicy, type SshInputPolicy } from './ssh-input-policy.js'

type ManagedSessionEndedReason = 'socket_closed' | 'ssh_connect_failed'
type ManagedSessionConnectionMethod = 'direct' | 'user_agent' | 'tenant_agent' | 'native_ssh_gateway'

interface ManagedSessionUser {
  id: number
  tenantId: number
  name: string
  email: string
}

interface ManagedSessionOpenInput {
  user: ManagedSessionUser
  host: HostCredentials
  transport: SshSessionTransport
  cols: number
  rows: number
  clientIp?: string | null
  userAgent?: string | null
  connectionMethod?: ManagedSessionConnectionMethod
  source?: 'websocket_gateway' | 'native_ssh_gateway'
  inputPolicy?: SshInputPolicy
  onClose?: () => void
  onInputRejected?: (message: string) => void
}

interface ManagedResolvedSessionOpenInput {
  sessionId?: number
  user: ManagedSessionUser
  host: HostCredentials
  target: SshCredentials
  bastion: SshCredentials | null
  transport: SshSessionTransport
  cols: number
  rows: number
  source: 'websocket_gateway' | 'native_ssh_gateway'
  inputPolicy?: SshInputPolicy
  onStdout?: (data: Buffer) => Buffer | void
  onClose?: () => void
  onInputAccepted?: (data: Buffer) => void
  onInputRejected?: (message: string) => void
}

export interface ManagedSshSessionHandle {
  sessionId: number
  write(data: Buffer): void
  resize(cols: number, rows: number): void
  close(reason?: ManagedSessionEndedReason): Promise<void>
}

export interface ManagedResolvedSshSessionHandle {
  write(data: Buffer): void
  resize(cols: number, rows: number): void
  close(): void
}

export class ManagedSshSessionService {
  constructor(
    private readonly sshRepo: SshRepository,
    private readonly onePassword: OnePasswordService,
    private readonly sessionAuditPublisher: SessionAuditPublisher,
    private readonly sessionAuditPolicyService: SessionAuditPolicyService,
    private readonly defaultInputPolicy: SshInputPolicy = new AllowAllSshInputPolicy(),
  ) {}

  async open(input: ManagedSessionOpenInput): Promise<ManagedSshSessionHandle> {
    const connectionMethod = input.connectionMethod ?? 'native_ssh_gateway'
    const source = input.source ?? 'native_ssh_gateway'
    const sessionId = await this.sshRepo.startSession(input.user.id, input.host.id, {
      clientIp: input.clientIp,
      userAgent: input.userAgent,
      connectionMethod,
    })

    const userGroupIds = await this.sshRepo.getUserGroupIds(input.user.id)
    const auditEnabledForSession = await this.sessionAuditPolicyService.shouldAuditSession(
      input.user.tenantId,
      input.user.id,
      userGroupIds,
    )
    const auditContext = {
      sessionId,
      tenantId: input.user.tenantId,
      userId: input.user.id,
      hostId: input.host.id,
    }
    const publishAudit = (
      type: 'session_started' | 'stdin' | 'stdout' | 'resize' | 'session_error' | 'session_ended',
      payload: Record<string, unknown>,
    ) => {
      if (!auditEnabledForSession) return Promise.resolve()
      return this.sessionAuditPublisher.publish(type, auditContext, payload)
    }

    let ended = false
    const endSession = async (reason: ManagedSessionEndedReason = 'socket_closed') => {
      if (ended) return
      ended = true
      await this.sshRepo.endSession(sessionId, { endedReason: reason }).catch(() => {})
      await publishAudit('session_ended', { reason }).catch(() => {})
    }

    let sshSession: SshSession | null = null

    try {
      const { passwordEncrypted, pemKey } = await this.resolveHostSecret(input.host)
      sshSession = new SshSession(
        input.transport,
        toSshCredentials(input.host, passwordEncrypted, pemKey),
        input.host.bastion
          ? toSshCredentials(input.host.bastion, input.host.bastion.passwordEncrypted, input.host.bastion.pemKey)
          : null,
        {
          onStdout: (data) => {
            publishAudit('stdout', {
              encoding: 'base64',
              data: data.toString('base64'),
              bytes: data.length,
            }).catch(() => {})
            return data
          },
          onClose: () => {
            endSession().catch(() => {})
            input.onClose?.()
          },
        },
        { sendClosedControl: false },
      )

      await sshSession.connect(input.cols, input.rows)
      const activeSshSession = sshSession
      await publishAudit('session_started', {
        userName: input.user.name,
        userEmail: input.user.email,
        hostName: input.host.name,
        hostIp: input.host.ip,
        clientIp: input.clientIp ?? null,
        userAgent: input.userAgent ?? null,
        connectionMethod,
        requestedConnectionMode: input.host.connectionMode,
        cols: input.cols,
        rows: input.rows,
      }).catch(() => {})

      return {
        sessionId,
        write: (data: Buffer) => {
          this.evaluateInput(input.inputPolicy, data, {
            sessionId,
            tenantId: input.user.tenantId,
            userId: input.user.id,
            hostId: input.host.id,
            source,
          }).then((decision) => {
            if (!decision.allow) {
              if (decision.data?.length) activeSshSession.write(decision.data)
              input.onInputRejected?.(decision.message ?? 'Entrada bloqueada por política')
              return
            }
            const allowedData = decision.data ?? data
            activeSshSession.write(allowedData)
            publishAudit('stdin', {
              encoding: 'base64',
              data: allowedData.toString('base64'),
              bytes: allowedData.length,
            }).catch(() => {})
          }).catch(() => {
            input.onInputRejected?.('Entrada bloqueada por falha na política')
          })
        },
        resize: (cols: number, rows: number) => {
          activeSshSession.resize(cols, rows)
          publishAudit('resize', { cols, rows }).catch(() => {})
        },
        close: async (reason: ManagedSessionEndedReason = 'socket_closed') => {
          activeSshSession.dispose()
          await endSession(reason)
        },
      }
    } catch (err) {
      sshSession?.dispose()
      if (!ended) {
        ended = true
        await this.sshRepo.endSession(sessionId, {
          endedReason: 'ssh_connect_failed',
          errorCode: 'SSH_CONNECT_FAILED',
          errorMessage: err instanceof Error ? err.message : 'Falha ao conectar ao host',
        }).catch(() => {})
        await publishAudit('session_error', {
          code: 'SSH_CONNECT_FAILED',
          message: err instanceof Error ? err.message : 'Falha ao conectar ao host',
        }).catch(() => {})
      }
      throw err
    }
  }

  async openResolved(input: ManagedResolvedSessionOpenInput): Promise<ManagedResolvedSshSessionHandle> {
    const sshSession = new SshSession(
      input.transport,
      input.target,
      input.bastion,
      {
        ...(input.onStdout !== undefined && { onStdout: input.onStdout }),
        ...(input.onClose !== undefined && { onClose: input.onClose }),
      },
      { sendClosedControl: false },
    )

    try {
      await sshSession.connect(input.cols, input.rows)
    } catch (err) {
      sshSession.dispose()
      throw err
    }

    return {
      write: (data: Buffer) => {
        this.evaluateInput(input.inputPolicy, data, {
          ...(input.sessionId !== undefined && { sessionId: input.sessionId }),
          tenantId: input.user.tenantId,
          userId: input.user.id,
          hostId: input.host.id,
          source: input.source,
        }).then((decision) => {
          if (!decision.allow) {
            if (decision.data?.length) sshSession.write(decision.data)
            input.onInputRejected?.(decision.message ?? 'Entrada bloqueada por política')
            return
          }
          const allowedData = decision.data ?? data
          sshSession.write(allowedData)
          input.onInputAccepted?.(allowedData)
        }).catch(() => {
          input.onInputRejected?.('Entrada bloqueada por falha na política')
        })
      },
      resize: (cols: number, rows: number) => sshSession.resize(cols, rows),
      close: () => sshSession.dispose(),
    }
  }

  private async evaluateInput(
    policy: SshInputPolicy | undefined,
    data: Buffer,
    context: Parameters<SshInputPolicy['evaluate']>[1],
  ) {
    return (policy ?? this.defaultInputPolicy).evaluate(data, context)
  }

  private async resolveHostSecret(host: HostCredentials): Promise<{
    passwordEncrypted: string | null
    pemKey: { encryptedKey: string; iv: string } | null
  }> {
    let passwordEncrypted = host.passwordEncrypted
    let pemKey = host.pemKey

    if (host.onePasswordRef) {
      const secret = await this.onePassword.resolve(host.tenantId, host.onePasswordRef)
      if (host.authType === 'PASSWORD' || host.authType === 'PEM_PASSWORD') {
        passwordEncrypted = JSON.stringify(encrypt(secret))
      } else {
        const encrypted = encrypt(secret)
        pemKey = { encryptedKey: encrypted.encrypted, iv: encrypted.iv }
      }
    }

    return { passwordEncrypted, pemKey }
  }
}

function toSshCredentials(
  host: Pick<HostCredentials, 'ip' | 'port' | 'sshUser' | 'authType'> & { trustedHostKeyFingerprint?: string | null },
  passwordEncrypted: string | null,
  pemKey: { encryptedKey: string; iv: string } | null,
): SshCredentials {
  return {
    host: host.ip,
    port: host.port,
    username: host.sshUser,
    authType: host.authType,
    ...(host.trustedHostKeyFingerprint !== undefined && {
      trustedHostKeyFingerprint: host.trustedHostKeyFingerprint,
    }),
    passwordEncrypted,
    pemKey,
  }
}
