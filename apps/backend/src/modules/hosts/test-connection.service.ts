import type { PrismaClient } from '@prisma/client'
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

    if (dto.connectionMode === 'agent') {
      const activeAgent =
        agentRegistry.getForUser(userId) ??
        agentRegistry.getForTenant(tenantId) ??
        null

      if (!activeAgent) {
        return { success: false, latencyMs: null, message: 'Nenhum agente online disponível para este host' }
      }

      try {
        const connectionId = crypto.randomUUID()
        target.sock = await agentRegistry.createConnection(activeAgent, connectionId, dto.ip, dto.port)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha ao conectar via agente'
        return { success: false, latencyMs: null, message }
      }
    }

    // Resolve bastion from DB
    let bastion: TestCredentials | null = null
    if (dto.connectionMode !== 'agent' && dto.bastionId) {
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
          pemKey:            b.pemKey,
        }
      }
    }

    return testSshConnection(target, bastion)
  }
}
