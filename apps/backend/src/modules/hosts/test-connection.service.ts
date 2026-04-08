import { Prisma, type PrismaClient } from '@prisma/client'
import type { TestConnectionDto, TestConnectionResult } from '@nodeaccess/shared'
import { encrypt } from '../../shared/crypto.js'
import { testSshConnection, type TestCredentials } from '../../shared/ssh-tester.js'
import { agentRegistry } from '../agents/agent.registry.js'

export class TestConnectionService {
  constructor(private readonly db: PrismaClient) {}

  async test(dto: TestConnectionDto, tenantId: number, userId: number): Promise<TestConnectionResult> {
    // Resolve PEM key from DB
    let pemKey: { encryptedKey: string; iv: string } | null = null
    if ((dto.authType === 'pem' || dto.authType === 'pem_password') && dto.pemKeyId) {
      const pk = await this.db.pemKey.findFirst({
        where: { id: dto.pemKeyId },
        select: { encryptedKey: true, iv: true },
      })
      if (!pk) return { success: false, latencyMs: null, message: 'Chave PEM não encontrada' }
      pemKey = pk
    }

    // Encrypt plaintext password so tester can use same buildConfig logic
    let passwordEncrypted: string | null = null
    if ((dto.authType === 'password' || dto.authType === 'pem_password') && dto.password) {
      passwordEncrypted = JSON.stringify(encrypt(dto.password))
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
    let routeLabel = 'direta'
    if (dto.connectionMode !== 'direct') {
      const mode = dto.connectionMode.toUpperCase() as 'AGENT' | 'AGENT_USER' | 'AGENT_TENANT_FALLBACK' | 'AUTO'
      const resolvedAgent = agentRegistry.resolveForConnectionMode(mode, userId, tenantId)
      const allowsDirectFallback = mode === 'AUTO'

      if (!resolvedAgent && !allowsDirectFallback) {
        return { success: false, latencyMs: null, message: 'Nenhum agente online disponível para este host' }
      }

      if (resolvedAgent) {
        try {
          const connectionId = crypto.randomUUID()
          target.sock = await agentRegistry.createConnection(resolvedAgent.agent, connectionId, dto.ip, dto.port)
          connectedViaAgent = true
          routeLabel = resolvedAgent.source === 'user' ? 'via agente do usuário' : 'via agente do tenant'
        } catch (error) {
          if (!allowsDirectFallback) {
            const message = error instanceof Error ? error.message : 'Falha ao conectar via agente'
            return { success: false, latencyMs: null, message }
          }
          delete target.sock
        }
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

    const result = await testSshConnection(target, bastion)
    if (!result.success) return result
    return { ...result, message: `${result.message} (${routeLabel})` }
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
}
