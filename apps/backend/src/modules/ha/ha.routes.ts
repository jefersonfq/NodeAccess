import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { requirePlatformAdmin } from '../../shared/guards.js'
import { HaService, type HaAgentReport } from './ha.service.js'

export async function haRoutes(app: FastifyInstance, deps: { db: PrismaClient }): Promise<void> {
  const service = new HaService(deps.db)

  app.get('/agent/install.sh', {
    schema: { tags: ['Platform'], summary: 'Instalador público do agente HA' },
  }, async (_request, reply) => {
    const candidates = [
      '/opt/nodeaccess/current/scripts/deploy/install-ha-agent.sh',
      resolve(process.cwd(), '../../scripts/deploy/install-ha-agent.sh'),
      resolve(process.cwd(), 'scripts/deploy/install-ha-agent.sh'),
    ]
    for (const path of candidates) {
      try {
        const script = await readFile(path, 'utf8')
        return reply.type('text/x-shellscript; charset=utf-8').send(script)
      } catch {
        // Tenta o próximo caminho conhecido da release.
      }
    }
    return reply.code(404).send({ message: 'Instalador do agente HA não está disponível nesta release' })
  })

  app.get('/agent/privileged-helper.sh', {
    schema: { tags: ['Platform'], summary: 'Helper privilegiado fechado do agente HA' },
  }, async (_request, reply) => {
    const candidates = [
      '/opt/nodeaccess/current/scripts/deploy/nodeaccess-ha-privileged-helper.sh',
      resolve(process.cwd(), '../../scripts/deploy/nodeaccess-ha-privileged-helper.sh'),
      resolve(process.cwd(), 'scripts/deploy/nodeaccess-ha-privileged-helper.sh'),
    ]
    for (const path of candidates) {
      try {
        const script = await readFile(path, 'utf8')
        return reply.type('text/x-shellscript; charset=utf-8').send(script)
      } catch {
        // Tenta o próximo caminho conhecido da release.
      }
    }
    return reply.code(404).send({ message: 'Helper privilegiado HA não está disponível nesta release' })
  })

  app.get('/nodes', {
    preHandler: [requirePlatformAdmin],
    schema: { tags: ['Platform'], summary: 'Topologia HA', security: [{ bearerAuth: [] }] },
  }, async (request) => service.list(request.jwtUser!.tenantId))

  app.patch<{ Body: { enabled: boolean } }>('/entitlement', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: ['Platform'],
      summary: 'Habilitar ou desabilitar o entitlement HA',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['enabled'],
        additionalProperties: false,
        properties: {
          enabled: { type: 'boolean' },
        },
      },
    },
  }, async (request) => service.setEntitlement(request.jwtUser!.tenantId, request.body.enabled))

  app.post<{ Body: { name: string; endpoint?: string; desiredRole?: 'PRIMARY' | 'STANDBY' } }>('/enrollments', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: ['Platform'],
      summary: 'Criar matrícula de nó HA',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          endpoint: { type: 'string', maxLength: 500 },
          desiredRole: { type: 'string', enum: ['PRIMARY', 'STANDBY'] },
        },
      },
    },
  }, async (request) => service.createEnrollment(request.jwtUser!.tenantId, request.body))

  app.delete<{ Params: { id: string } }>('/nodes/:id', {
    preHandler: [requirePlatformAdmin],
    schema: { tags: ['Platform'], summary: 'Remover nó HA', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    await service.remove(request.jwtUser!.tenantId, request.params.id)
    return reply.code(204).send()
  })

  app.get('/operations', {
    preHandler: [requirePlatformAdmin],
    schema: { tags: ['Platform'], summary: 'Journal de operações HA', security: [{ bearerAuth: [] }] },
  }, async (request) => service.listOperations(request.jwtUser!.tenantId))

  app.post<{ Body: { confirmation: string } }>('/topology/reconcile-roles', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: ['Platform'],
      summary: 'Alinhar papéis configurados à topologia observada e segura',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['confirmation'],
        additionalProperties: false,
        properties: {
          confirmation: { type: 'string', const: 'RECONCILE_OBSERVED_ROLES' },
        },
      },
    },
  }, async (request) => service.reconcileObservedRoles(
    request.jwtUser!.tenantId,
    Number(request.jwtUser!.sub),
    request.body.confirmation,
  ))

  app.post<{ Params: { id: string } }>('/nodes/:id/preflight', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: ['Platform'],
      summary: 'Executar preflight somente leitura para promoção HA',
      security: [{ bearerAuth: [] }],
    },
  }, async (request) => service.runPreflight(
    request.jwtUser!.tenantId,
    request.params.id,
    Number(request.jwtUser!.sub),
  ))

  app.post<{
    Params: { id: string }
    Body: {
      confirmation: string
      witnessEvidenceFile: string
      witnessSignatureFile: string
    }
  }>('/nodes/:id/planned-switchover', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: ['Platform'],
      summary: 'Iniciar troca planejada governada entre os dois nós HA',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['confirmation', 'witnessEvidenceFile', 'witnessSignatureFile'],
        additionalProperties: false,
        properties: {
          confirmation: { type: 'string', const: 'START_PLANNED_SWITCHOVER' },
          witnessEvidenceFile: { type: 'string', minLength: 1, maxLength: 160 },
          witnessSignatureFile: { type: 'string', minLength: 1, maxLength: 160 },
        },
      },
    },
  }, async (request) => service.startPlannedSwitchover(
    request.jwtUser!.tenantId,
    request.params.id,
    Number(request.jwtUser!.sub),
    request.body,
  ))

  app.post<{ Params: { id: string } }>('/nodes/:id/rejoin-preflight', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: ['Platform'],
      summary: 'Validar retorno do nó antigo como réplica somente leitura',
      security: [{ bearerAuth: [] }],
    },
  }, async (request) => service.runRejoinPreflight(
    request.jwtUser!.tenantId,
    request.params.id,
    Number(request.jwtUser!.sub),
  ))

  app.post<{ Params: { id: string } }>('/nodes/:id/provisioning-plan', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: ['Platform'],
      summary: 'Gerar plano de provisionamento HA somente leitura',
      security: [{ bearerAuth: [] }],
    },
  }, async (request) => service.createProvisioningPlan(
    request.jwtUser!.tenantId,
    request.params.id,
    Number(request.jwtUser!.sub),
  ))

  app.post<{ Params: { id: string }; Body: { confirmation: string } }>('/nodes/:id/inventory-refresh', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: ['Platform'],
      summary: 'Enfileirar validação governada do executor HA',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['confirmation'],
        additionalProperties: false,
        properties: {
          confirmation: { type: 'string', const: 'REFRESH_INVENTORY' },
        },
      },
    },
  }, async (request) => service.queueInventoryRefresh(
    request.jwtUser!.tenantId,
    request.params.id,
    Number(request.jwtUser!.sub),
    request.body.confirmation,
  ))

  app.post<{ Params: { id: string }; Body: { confirmation: string } }>('/nodes/:id/storage/prepare', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: ['Platform'],
      summary: 'Preparar diretórios permitidos no nó HA standby',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['confirmation'],
        additionalProperties: false,
        properties: {
          confirmation: { type: 'string', const: 'PREPARE_STORAGE_DIRECTORIES' },
        },
      },
    },
  }, async (request) => service.queueStoragePreparation(
    request.jwtUser!.tenantId,
    request.params.id,
    Number(request.jwtUser!.sub),
    request.body.confirmation,
  ))

  app.post<{ Params: { id: string }; Body: { confirmation: string } }>('/nodes/:id/storage/rollback', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: ['Platform'],
      summary: 'Reverter diretórios vazios preparados pelo agente HA',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['confirmation'],
        additionalProperties: false,
        properties: {
          confirmation: { type: 'string', const: 'ROLLBACK_STORAGE_DIRECTORIES' },
        },
      },
    },
  }, async (request) => service.queueStorageRollback(
    request.jwtUser!.tenantId,
    request.params.id,
    Number(request.jwtUser!.sub),
    request.body.confirmation,
  ))

  app.post<{ Params: { id: string }; Body: { confirmation: string } }>('/nodes/:id/storage/validate-write', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: ['Platform'],
      summary: 'Validar escrita temporária nos diretórios HA do standby',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['confirmation'],
        additionalProperties: false,
        properties: {
          confirmation: { type: 'string', const: 'VALIDATE_STORAGE_WRITE_ACCESS' },
        },
      },
    },
  }, async (request) => service.queueStorageWriteValidation(
    request.jwtUser!.tenantId,
    request.params.id,
    Number(request.jwtUser!.sub),
    request.body.confirmation,
  ))

  app.post<{
    Params: { id: string }
    Body: { confirmation: string; releaseUrl: string; sha256: string }
  }>('/nodes/:id/release/install', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: ['Platform'],
      summary: 'Baixar, validar e promover uma release no standby',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['confirmation', 'releaseUrl', 'sha256'],
        additionalProperties: false,
        properties: {
          confirmation: { type: 'string', const: 'INSTALL_RELEASE' },
          releaseUrl: { type: 'string', minLength: 8, maxLength: 1000 },
          sha256: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
        },
      },
    },
  }, async (request) => service.queueReleaseInstallation(
    request.jwtUser!.tenantId,
    request.params.id,
    Number(request.jwtUser!.sub),
    request.body.confirmation,
    request.body,
  ))

  app.post<{
    Params: { id: string }
    Body: {
      confirmation: string
      secrets: Record<string, string>
    }
  }>('/nodes/:id/configuration/shared-secrets', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: ['Platform'],
      summary: 'Cifrar e aplicar segredos compartilhados no standby',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['confirmation', 'secrets'],
        additionalProperties: false,
        properties: {
          confirmation: { type: 'string', const: 'APPLY_SHARED_SECRETS' },
          secrets: {
            type: 'object',
            required: [
              'JWT_SECRET',
              'PEM_ENCRYPTION_KEY',
              'MYSQL_ROOT_PASSWORD',
              'MYSQL_PASSWORD',
              'MYSQL_REPLICATION_PASSWORD',
              'REDIS_PASSWORD',
            ],
            additionalProperties: false,
            properties: Object.fromEntries([
              'JWT_SECRET',
              'PEM_ENCRYPTION_KEY',
              'MYSQL_ROOT_PASSWORD',
              'MYSQL_PASSWORD',
              'MYSQL_REPLICATION_PASSWORD',
              'REDIS_PASSWORD',
            ].map((key) => [key, { type: 'string', minLength: 1, maxLength: 240 }])),
          },
        },
      },
    },
  }, async (request, reply) => {
    if (request.protocol !== 'https') {
      return reply.code(409).send({
        message: 'Configure HTTPS no painel antes de transportar segredos para o agente',
      })
    }
    return service.queueSharedSecrets(
      request.jwtUser!.tenantId,
      request.params.id,
      Number(request.jwtUser!.sub),
      request.body.confirmation,
      request.body.secrets,
    )
  })

  app.post<{ Params: { id: string }; Body: { confirmation: string } }>(
    '/nodes/:id/configuration/shared-secrets/rollback',
    {
      preHandler: [requirePlatformAdmin],
      schema: {
        tags: ['Platform'],
        summary: 'Restaurar backup local dos segredos compartilhados no standby',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['confirmation'],
          additionalProperties: false,
          properties: {
            confirmation: { type: 'string', const: 'ROLLBACK_SHARED_SECRETS' },
          },
        },
      },
    },
    async (request) => service.queueSharedSecretsRollback(
      request.jwtUser!.tenantId,
      request.params.id,
      Number(request.jwtUser!.sub),
      request.body.confirmation,
    ),
  )

  app.post<{ Params: { id: string } }>('/agent/nodes/:id/jobs/claim', {
    schema: { tags: ['Platform'], summary: 'Reivindicar próxima ação governada do agente HA' },
  }, async (request, reply) => {
    const header = request.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    const job = await service.claimAgentJob(request.params.id, token)
    return job ? reply.send(job) : reply.code(204).send()
  })

  app.post<{
    Params: { id: string; jobId: string }
    Body: { leaseToken: string; success: boolean; message?: string }
  }>('/agent/nodes/:id/jobs/:jobId/complete', {
    schema: {
      tags: ['Platform'],
      summary: 'Concluir ação governada do agente HA',
      body: {
        type: 'object',
        required: ['leaseToken', 'success'],
        additionalProperties: false,
        properties: {
          leaseToken: { type: 'string', minLength: 20, maxLength: 200 },
          success: { type: 'boolean' },
          message: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (request) => {
    const header = request.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    return service.completeAgentJob(
      request.params.id,
      request.params.jobId,
      token,
      request.body,
    )
  })

  app.post<{ Params: { id: string }; Body: HaAgentReport }>('/agent/nodes/:id/report', {
    schema: {
      tags: ['Platform'],
      summary: 'Heartbeat restrito do agente HA',
      body: {
        type: 'object',
        required: ['observedRole', 'ownsVip', 'components'],
        additionalProperties: false,
        properties: {
          observedRole: { type: 'string', enum: ['PRIMARY', 'STANDBY'] },
          ownsVip: { type: 'boolean' },
          virtualIp: { type: 'string', maxLength: 100 },
          encryptionPublicKeyBase64: { type: 'string', minLength: 500, maxLength: 2000 },
          components: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              required: ['status'],
              additionalProperties: false,
              properties: {
                status: { type: 'string', enum: ['ok', 'degraded', 'down', 'unknown'] },
                message: { type: 'string', maxLength: 500 },
                lagSeconds: { type: 'number', minimum: 0 },
              },
            },
          },
          inventory: {
            type: 'object',
            required: [
              'hostname', 'operatingSystem', 'architecture', 'cpuCores',
              'memoryTotalMb', 'diskFreeMb', 'dockerInstalled', 'composeInstalled',
            ],
            additionalProperties: false,
            properties: {
              hostname: { type: 'string', minLength: 1, maxLength: 255 },
              operatingSystem: { type: 'string', minLength: 1, maxLength: 255 },
              architecture: { type: 'string', minLength: 1, maxLength: 50 },
              cpuCores: { type: 'integer', minimum: 1, maximum: 4096 },
              memoryTotalMb: { type: 'integer', minimum: 1 },
              diskFreeMb: { type: 'integer', minimum: 0 },
              dockerInstalled: { type: 'boolean' },
              dockerVersion: { type: 'string', maxLength: 100 },
              composeInstalled: { type: 'boolean' },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const header = request.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    return reply.send(await service.report(request.params.id, token, request.body))
  })
}
