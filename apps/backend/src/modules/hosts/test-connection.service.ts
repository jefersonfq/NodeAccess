import { Prisma, type PrismaClient } from '@prisma/client'
import net from 'node:net'
import type { Duplex } from 'node:stream'
import { canTestHostConnectivity, usesSshCredentials, type HostAccessProtocol, type TestConnectionDto, type TestConnectionResult } from '@nodeaccess/shared'
import { encrypt } from '../../shared/crypto.js'
import { testSshConnection, type TestCredentials } from '../../shared/ssh-tester.js'
import { agentRegistry } from '../agents/agent.registry.js'
import { describeAgentTcpError } from '../agents/agent-error-message.js'
import type { SshRepository } from '../ssh/ssh.repository.js'

type TestRoute = 'direct' | 'user_agent' | 'tenant_agent' | 'private_access_connector'
type ProtocolAwareTestConnectionDto = TestConnectionDto & { accessProtocol?: HostAccessProtocol }
type FailureStep = NonNullable<TestConnectionResult['failureStep']> | 'tcp'

function result(
  success: boolean,
  message: string,
  details: {
    latencyMs?: number | null
    route?: TestRoute
    routeLabel?: string
    agentName?: string | null
    agentSource?: 'user' | 'tenant' | 'private_access' | null
    fallbackUsed?: boolean
    failureStep?: FailureStep | null
  } = {},
): TestConnectionResult {
  return {
    success,
    latencyMs: details.latencyMs ?? null,
    message,
    ...(details.route !== undefined && { route: details.route }),
    ...(details.routeLabel !== undefined && { routeLabel: details.routeLabel }),
    ...(details.agentName !== undefined && { agentName: details.agentName }),
    ...(details.agentSource !== undefined && { agentSource: details.agentSource }),
    ...(details.fallbackUsed !== undefined && { fallbackUsed: details.fallbackUsed }),
    ...(details.failureStep !== undefined && { failureStep: details.failureStep }),
  } as TestConnectionResult
}

function routeLabel(route: TestRoute): string {
  if (route === 'user_agent') return 'via agente do usuário'
  if (route === 'tenant_agent') return 'via agente do tenant'
  if (route === 'private_access_connector') return 'via conector de acesso privado'
  return 'direta'
}

function protocolLabel(protocol: HostAccessProtocol): string {
  if (protocol === 'rdp') return 'RDP'
  if (protocol === 'telnet') return 'Telnet'
  if (protocol === 'vnc') return 'VNC'
  if (protocol === 'serial') return 'Serial'
  return 'SSH'
}

function testTcpConnection(input: { host: string; port: number; sock?: Duplex; timeoutMs?: number }): Promise<{ success: boolean; message: string; latencyMs: number | null }> {
  const startedAt = Date.now()

  if (input.sock) {
    input.sock.destroy()
    return Promise.resolve({
      success: true,
      message: 'Conectividade TCP validada',
      latencyMs: Date.now() - startedAt,
    })
  }

  return new Promise((resolve) => {
    const socket = net.createConnection({ host: input.host, port: input.port })
    const timeout = setTimeout(() => {
      socket.destroy()
      resolve({
        success: false,
        message: 'Timeout ao validar conectividade TCP',
        latencyMs: Date.now() - startedAt,
      })
    }, input.timeoutMs ?? 8_000)

    socket.once('connect', () => {
      clearTimeout(timeout)
      socket.destroy()
      resolve({
        success: true,
        message: 'Conectividade TCP validada',
        latencyMs: Date.now() - startedAt,
      })
    })

    socket.once('error', (error) => {
      clearTimeout(timeout)
      socket.destroy()
      resolve({
        success: false,
        message: `Falha TCP: ${error.message}`,
        latencyMs: Date.now() - startedAt,
      })
    })
  })
}

export class TestConnectionService {
  constructor(
    private readonly db: PrismaClient,
    private readonly sshRepo?: SshRepository,
  ) {}

  async test(
    dto: TestConnectionDto,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER' = 'USER',
  ): Promise<TestConnectionResult> {
    const input = dto as ProtocolAwareTestConnectionDto
    const accessProtocol = input.accessProtocol ?? 'ssh'
    const savedHost = dto.hostId
      ? await this.findAccessibleHost(dto.hostId, tenantId, userId, role)
      : null
    if (dto.hostId && !savedHost) {
      return result(false, 'Host não encontrado ou sem permissão para testar', { failureStep: 'validation' })
    }
    if (!canTestHostConnectivity(accessProtocol)) {
      return result(false, `Teste de conexão ${accessProtocol.toUpperCase()} ainda não está disponível`, { failureStep: 'validation' })
    }

    const effectivePemKeyId = dto.pemKeyId ?? savedHost?.pemKeyId ?? undefined

    // Resolve PEM key from DB
    let pemKey: { encryptedKey: string; iv: string; encryptedPassphrase: string | null; passphraseIv: string | null } | null = null
    if (usesSshCredentials(accessProtocol) && (dto.authType === 'pem' || dto.authType === 'pem_password') && effectivePemKeyId) {
      const pk = await this.db.pemKey.findFirst({
        where: { id: effectivePemKeyId, createdBy: { tenantId } },
        select: { encryptedKey: true, iv: true, encryptedPassphrase: true, passphraseIv: true },
      })
      if (!pk) return result(false, 'Chave PEM não encontrada', { failureStep: 'credential' })
      pemKey = pk
    }

    // Encrypt plaintext password so tester can use same buildConfig logic
    let passwordEncrypted: string | null = null
    if (usesSshCredentials(accessProtocol) && (dto.authType === 'password' || dto.authType === 'pem_password') && dto.password) {
      passwordEncrypted = JSON.stringify(encrypt(dto.password))
    } else if (usesSshCredentials(accessProtocol) && dto.authType === savedHost?.authType && (dto.authType === 'password' || dto.authType === 'pem_password')) {
      passwordEncrypted = savedHost.passwordEncrypted
    }

    const target: TestCredentials = {
      host:              dto.ip,
      port:              dto.port,
      username:          dto.sshUser,
      authType:          dto.authType === 'pem' ? 'PEM' : dto.authType === 'pem_password' ? 'PEM_PASSWORD' : 'PASSWORD',
      passwordEncrypted,
      pemKey,
    }

    let connectedViaAgent = false
    let effectiveRoute: TestRoute = 'direct'
    let agentName: string | null = null
    let agentSource: 'user' | 'tenant' | 'private_access' | null = null
    let fallbackUsed = false

    if (dto.agentId || dto.connectionMode !== 'direct') {
      const mode = dto.connectionMode.toUpperCase() as 'AGENT' | 'AGENT_USER' | 'AGENT_TENANT_FALLBACK' | 'PRIVATE_ACCESS_CONNECTOR' | 'AUTO'
      const forcedAgent = dto.agentId ? agentRegistry.getActiveById(dto.agentId) : undefined
      if (dto.agentId && (!forcedAgent || forcedAgent.tenantId !== tenantId)) {
        return result(false, 'Agente selecionado não está online ou não pertence a este tenant', {
          route: 'direct',
          routeLabel: routeLabel('direct'),
          fallbackUsed: false,
          failureStep: 'agent',
        })
      }
      if (dto.agentId && role !== 'ADMIN' && forcedAgent?.agentMode === 'USER_BOUND' && forcedAgent.userId !== userId) {
        return result(false, 'Sem permissão para testar por este agente', {
          route: 'direct',
          routeLabel: routeLabel('direct'),
          fallbackUsed: false,
          failureStep: 'agent',
        })
      }

      const resolvedAgent = mode === 'PRIVATE_ACCESS_CONNECTOR'
        ? agentRegistry.resolvePrivateAccessConnector(tenantId, dto.ip, dto.port, dto.privateAccessConnectorId ?? dto.agentId ?? null)
        : forcedAgent
          ? { agent: forcedAgent, source: forcedAgent.agentMode === 'SERVICE_BOUND' ? 'tenant' as const : 'user' as const }
          : agentRegistry.resolveForConnectionMode(mode, userId, tenantId)
      const allowsDirectFallback = !dto.agentId && mode === 'AUTO'

      if (!resolvedAgent && !allowsDirectFallback) {
        const privateAccessDiagnostic = mode === 'PRIVATE_ACCESS_CONNECTOR'
          ? agentRegistry.describePrivateAccessResolution(tenantId, dto.ip, dto.port, dto.privateAccessConnectorId ?? dto.agentId ?? null)
          : null
        const failedRoute = mode === 'PRIVATE_ACCESS_CONNECTOR' ? 'private_access_connector' : 'direct'
        return result(false, privateAccessDiagnostic?.message ?? 'Nenhum agente online disponível para este host', {
          route: failedRoute,
          routeLabel: routeLabel(failedRoute),
          fallbackUsed: false,
          failureStep: 'agent',
        })
      }

      if (resolvedAgent) {
        try {
          const connectionId = crypto.randomUUID()
          target.sock = await agentRegistry.createConnection(resolvedAgent.agent, connectionId, dto.ip, dto.port)
          connectedViaAgent = true
          effectiveRoute = mode === 'PRIVATE_ACCESS_CONNECTOR' ? 'private_access_connector' : resolvedAgent.source === 'user' ? 'user_agent' : 'tenant_agent'
          agentName = resolvedAgent.agent.name
          agentSource = mode === 'PRIVATE_ACCESS_CONNECTOR' ? 'private_access' : resolvedAgent.source
        } catch (error) {
          const message = describeAgentTcpError(error, dto.ip, dto.port)
          if (!allowsDirectFallback) {
            const failedRoute = mode === 'PRIVATE_ACCESS_CONNECTOR' ? 'private_access_connector' : resolvedAgent.source === 'user' ? 'user_agent' : 'tenant_agent'
            return result(false, message, {
              route: failedRoute,
              routeLabel: routeLabel(failedRoute),
              agentName: resolvedAgent.agent.name,
              agentSource: mode === 'PRIVATE_ACCESS_CONNECTOR' ? 'private_access' : resolvedAgent.source,
              fallbackUsed: false,
              failureStep: 'agent',
            })
          }
          delete target.sock
          fallbackUsed = true
        }
      } else if (allowsDirectFallback) {
        fallbackUsed = true
      }
    }

    if (dto.testMode === 'tcp' || !usesSshCredentials(accessProtocol)) {
      const tcpResult = await testTcpConnection({
        host: dto.ip,
        port: dto.port,
        ...(target.sock ? { sock: target.sock } : {}),
      })
      const label = dto.testMode === 'tcp' ? 'TCP' : protocolLabel(accessProtocol)

      if (!tcpResult.success) {
        return result(false, `${label}: ${tcpResult.message}`, {
          latencyMs: tcpResult.latencyMs,
          route: effectiveRoute,
          routeLabel: routeLabel(effectiveRoute),
          agentName,
          agentSource,
          fallbackUsed,
          failureStep: 'tcp',
        })
      }

      return result(true, `${label}: ${tcpResult.message} (${routeLabel(effectiveRoute)})`, {
        latencyMs: tcpResult.latencyMs,
        route: effectiveRoute,
        routeLabel: routeLabel(effectiveRoute),
        agentName,
        agentSource,
        fallbackUsed,
        failureStep: null,
      })
    }

    // Resolve bastion from DB
    let bastion: TestCredentials | null = null
    if (!connectedViaAgent && dto.bastionId) {
      const bastionAllowed = await this.bastionBelongsToTenant(dto.bastionId, tenantId)
      const b = bastionAllowed ? await this.db.bastionHost.findUnique({
        where:   { id: dto.bastionId },
        include: { pemKey: { select: { encryptedKey: true, iv: true } } },
      }) : null
      if (b) {
        bastion = {
          host:              b.ip,
          port:              b.port,
          username:          b.sshUser,
          authType:          b.authType,
          passwordEncrypted: b.passwordEncrypted,
          pemKey:            await this.findBastionSystemPemKey(b.id) ?? b.pemKey,
        }
      }
    } else if (!connectedViaAgent && dto.groupId) {
      const group = await this.db.group.findFirst({
        where: { id: dto.groupId, tenantId },
        include: {
          bastion: {
            include: { pemKey: { select: { encryptedKey: true, iv: true } } },
          },
        },
      })
      const b = group?.bastion
      if (b) {
        bastion = {
          host:              b.ip,
          port:              b.port,
          username:          b.sshUser,
          authType:          b.authType,
          passwordEncrypted: b.passwordEncrypted,
          pemKey:            await this.findBastionSystemPemKey(b.id) ?? b.pemKey,
        }
      }
    }

    const testResult = await testSshConnection(target, bastion)
    if (!testResult.success) {
      return result(false, testResult.message, {
        route: effectiveRoute,
        routeLabel: routeLabel(effectiveRoute),
        agentName,
        agentSource,
        fallbackUsed,
        failureStep: bastion ? 'bastion' : 'ssh',
      })
    }

    return result(true, `${testResult.message} (${routeLabel(effectiveRoute)})`, {
      latencyMs: testResult.latencyMs,
      route: effectiveRoute,
      routeLabel: routeLabel(effectiveRoute),
      agentName,
      agentSource,
      fallbackUsed,
      failureStep: null,
    })
  }

  private async findBastionSystemPemKey(
    bastionId: number,
  ): Promise<{ encryptedKey: string; iv: string; encryptedPassphrase: string | null; passphraseIv: string | null } | null> {
    const rows = await this.db.$queryRaw<Array<{ encryptedKey: string; iv: string; encryptedPassphrase: string | null; passphraseIv: string | null }>>(
      Prisma.sql`
        SELECT pk.encrypted_key AS encryptedKey, pk.iv,
               pk.encrypted_passphrase AS encryptedPassphrase,
               pk.passphrase_iv AS passphraseIv
        FROM bastion_hosts b
        INNER JOIN pem_keys pk ON pk.id = b.system_pem_key_id
        WHERE b.id = ${bastionId}
        LIMIT 1
      `,
    )

    return rows[0] ?? null
  }

  private async findAccessibleHost(
    hostId: number,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<{ id: number; authType: 'pem' | 'password' | 'pem_password'; pemKeyId: number | null; passwordEncrypted: string | null } | null> {
    const host = await this.db.host.findFirst({
      where: { id: hostId, tenantId, deletedAt: null },
      select: {
        id: true,
        authType: true,
        pemKeyId: true,
        passwordEncrypted: true,
      },
    })
    if (!host) return null
    if (role !== 'ADMIN' && !this.sshRepo) return null
    if (this.sshRepo && !await this.sshRepo.hasEffectiveHostPermission(host.id, tenantId, userId, 'edit', role)) return null

    return {
      id: host.id,
      authType: host.authType === 'PEM' ? 'pem' : host.authType === 'PEM_PASSWORD' ? 'pem_password' : 'password',
      pemKeyId: host.pemKeyId,
      passwordEncrypted: host.passwordEncrypted,
    }
  }

  private async bastionBelongsToTenant(bastionId: number, tenantId: number): Promise<boolean> {
    const rows = await this.db.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*) AS count
        FROM bastion_hosts
        WHERE id = ${bastionId} AND tenant_id = ${tenantId}
      `,
    )
    return Number(rows[0]?.count ?? 0) > 0
  }
}
