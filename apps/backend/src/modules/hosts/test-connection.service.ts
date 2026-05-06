import { Prisma, type PrismaClient } from '@prisma/client'
import type { TestConnectionDto, TestConnectionResult } from '@nodeaccess/shared'
import { encrypt } from '../../shared/crypto.js'
import { testSshConnection, type TestCredentials } from '../../shared/ssh-tester.js'
import { agentRegistry } from '../agents/agent.registry.js'
import { describeAgentTcpError } from '../agents/agent-error-message.js'

type TestRoute = 'direct' | 'user_agent' | 'tenant_agent'
type FailureStep = NonNullable<TestConnectionResult['failureStep']>

function result(
  success: boolean,
  message: string,
  details: {
    latencyMs?: number | null
    route?: TestRoute
    routeLabel?: string
    agentName?: string | null
    agentSource?: 'user' | 'tenant' | null
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
  }
}

function routeLabel(route: TestRoute): string {
  if (route === 'user_agent') return 'via agente do usuário'
  if (route === 'tenant_agent') return 'via agente do tenant'
  return 'direta'
}

export class TestConnectionService {
  constructor(private readonly db: PrismaClient) {}

  async test(
    dto: TestConnectionDto,
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER' = 'USER',
  ): Promise<TestConnectionResult> {
    const savedHost = dto.hostId
      ? await this.findAccessibleHost(dto.hostId, tenantId, userId, role)
      : null
    if (dto.hostId && !savedHost) {
      return result(false, 'Host não encontrado ou sem permissão para testar', { failureStep: 'validation' })
    }

    const effectivePemKeyId = dto.pemKeyId ?? savedHost?.pemKeyId ?? undefined

    // Resolve PEM key from DB
    let pemKey: { encryptedKey: string; iv: string } | null = null
    if ((dto.authType === 'pem' || dto.authType === 'pem_password') && effectivePemKeyId) {
      const pk = await this.db.pemKey.findFirst({
        where: { id: effectivePemKeyId },
        select: { encryptedKey: true, iv: true },
      })
      if (!pk) return result(false, 'Chave PEM não encontrada', { failureStep: 'credential' })
      pemKey = pk
    }

    // Encrypt plaintext password so tester can use same buildConfig logic
    let passwordEncrypted: string | null = null
    if ((dto.authType === 'password' || dto.authType === 'pem_password') && dto.password) {
      passwordEncrypted = JSON.stringify(encrypt(dto.password))
    } else if (dto.authType === savedHost?.authType && (dto.authType === 'password' || dto.authType === 'pem_password')) {
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
    let agentSource: 'user' | 'tenant' | null = null
    let fallbackUsed = false

    if (dto.agentId || dto.connectionMode !== 'direct') {
      const mode = dto.connectionMode.toUpperCase() as 'AGENT' | 'AGENT_USER' | 'AGENT_TENANT_FALLBACK' | 'AUTO'
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

      const resolvedAgent = forcedAgent
        ? { agent: forcedAgent, source: forcedAgent.agentMode === 'SERVICE_BOUND' ? 'tenant' as const : 'user' as const }
        : agentRegistry.resolveForConnectionMode(mode, userId, tenantId)
      const allowsDirectFallback = !dto.agentId && mode === 'AUTO'

      if (!resolvedAgent && !allowsDirectFallback) {
        return result(false, 'Nenhum agente online disponível para este host', {
          route: 'direct',
          routeLabel: routeLabel('direct'),
          fallbackUsed: false,
          failureStep: 'agent',
        })
      }

      if (resolvedAgent) {
        try {
          const connectionId = crypto.randomUUID()
          target.sock = await agentRegistry.createConnection(resolvedAgent.agent, connectionId, dto.ip, dto.port)
          connectedViaAgent = true
          effectiveRoute = resolvedAgent.source === 'user' ? 'user_agent' : 'tenant_agent'
          agentName = resolvedAgent.agent.name
          agentSource = resolvedAgent.source
        } catch (error) {
          const message = describeAgentTcpError(error, dto.ip, dto.port)
          if (!allowsDirectFallback) {
            return result(false, message, {
              route: resolvedAgent.source === 'user' ? 'user_agent' : 'tenant_agent',
              routeLabel: routeLabel(resolvedAgent.source === 'user' ? 'user_agent' : 'tenant_agent'),
              agentName: resolvedAgent.agent.name,
              agentSource: resolvedAgent.source,
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

    // Resolve bastion from DB
    let bastion: TestCredentials | null = null
    if (!connectedViaAgent && dto.bastionId) {
      const b = await this.db.bastionHost.findUnique({
        where:   { id: dto.bastionId },
        include: { pemKey: { select: { encryptedKey: true, iv: true } } },
      })
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
  ): Promise<{ encryptedKey: string; iv: string } | null> {
    const rows = await this.db.$queryRaw<Array<{ encryptedKey: string; iv: string }>>(
      Prisma.sql`
        SELECT pk.encrypted_key AS encryptedKey, pk.iv
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
        scope: true,
        ownerId: true,
        groupId: true,
      },
    })
    if (!host) return null
    if (role === 'ADMIN') {
      return {
        id: host.id,
        authType: host.authType === 'PEM' ? 'pem' : host.authType === 'PEM_PASSWORD' ? 'pem_password' : 'password',
        pemKeyId: host.pemKeyId,
        passwordEncrypted: host.passwordEncrypted,
      }
    }
    if (host.scope === 'PERSONAL' && host.ownerId !== userId) return null
    if (host.scope === 'TEAM') {
      if (!host.groupId) return null
      const membership = await this.db.userGroup.findUnique({
        where: { userId_groupId: { userId, groupId: host.groupId } },
        select: { userId: true },
      })
      if (!membership) return null
    }
    return {
      id: host.id,
      authType: host.authType === 'PEM' ? 'pem' : host.authType === 'PEM_PASSWORD' ? 'pem_password' : 'password',
      pemKeyId: host.pemKeyId,
      passwordEncrypted: host.passwordEncrypted,
    }
  }
}
