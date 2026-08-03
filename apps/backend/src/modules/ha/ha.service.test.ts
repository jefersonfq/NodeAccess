import { describe, expect, it, vi } from 'vitest'
import { createHash, generateKeyPairSync, privateDecrypt, constants } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { HaService } from './ha.service.js'

const healthyComponents = {
  mysql: { status: 'ok', lagSeconds: 0 },
  redis: { status: 'ok' },
  files: { status: 'ok' },
  api: { status: 'ok' },
  frontend: { status: 'ok' },
  sshGateway: { status: 'ok' },
  guacd: { status: 'ok' },
}

function standbyRow(ownsVip = false, inventory: Record<string, unknown> | null = null) {
  const now = new Date()
  return {
    id: 'standby-b',
    tenantId: 1,
    name: 'nodeaccess-b',
    endpoint: '192.168.1.101',
    desiredRole: 'STANDBY',
    observedRole: 'STANDBY',
    ownsVip,
    virtualIp: '192.168.1.105',
    status: 'HEALTHY',
    promotionReady: !ownsVip,
    blockersJson: '[]',
    componentsJson: JSON.stringify(healthyComponents),
    inventoryJson: inventory ? JSON.stringify(inventory) : null,
    enrollmentHash: 'hash',
    enrollmentExpires: now,
    enrolledAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  }
}

function serviceWith(topology: {
  primaryCount: bigint
  vipOwnerCount: bigint
  primaryVipOwnerCount: bigint
}, ownsVip = false) {
  const db = {
    $queryRaw: vi.fn()
      .mockResolvedValueOnce([{
        featureEntitlementsJson: JSON.stringify({ ha: true }),
        integrationEntitlementsJson: '{}',
      }])
      .mockResolvedValueOnce([standbyRow(ownsVip)])
      .mockResolvedValueOnce([topology]),
    $executeRaw: vi.fn().mockResolvedValue(1),
  }
  return {
    service: new HaService(db as unknown as PrismaClient),
    executeRaw: db.$executeRaw,
  }
}

describe('HaService.runPreflight', () => {
  it('aprova um standby saudável quando existe um único PRIMARY dono da VIP', async () => {
    const { service, executeRaw } = serviceWith({
      primaryCount: BigInt(1),
      vipOwnerCount: BigInt(1),
      primaryVipOwnerCount: BigInt(1),
    })

    const operation = await service.runPreflight(1, 'standby-b', 10)

    expect(operation.status).toBe('READY')
    expect(operation.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'single-primary', status: 'ok' }),
      expect.objectContaining({ key: 'single-vip-owner', status: 'ok' }),
      expect.objectContaining({ key: 'primary-owns-vip', status: 'ok' }),
      expect.objectContaining({ key: 'standby-without-vip', status: 'ok' }),
    ]))
    expect(executeRaw).toHaveBeenCalledOnce()
  })

  it('bloqueia promoção quando a topologia indica possível split-brain', async () => {
    const { service } = serviceWith({
      primaryCount: BigInt(2),
      vipOwnerCount: BigInt(2),
      primaryVipOwnerCount: BigInt(2),
    }, true)

    const operation = await service.runPreflight(1, 'standby-b', 10)

    expect(operation.status).toBe('BLOCKED')
    expect(operation.errorLayer).toBe('readiness')
    expect(operation.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'single-primary', status: 'failed' }),
      expect.objectContaining({ key: 'single-vip-owner', status: 'failed' }),
      expect.objectContaining({ key: 'primary-owns-vip', status: 'failed' }),
      expect.objectContaining({ key: 'standby-without-vip', status: 'failed' }),
    ]))
  })
})

describe('HaService.startPlannedSwitchover', () => {
  it('arma primeiro a promoção local no STANDBY', async () => {
    const primary = {
      ...standbyRow(false),
      id: 'primary-a',
      name: 'nodeaccess-a',
      endpoint: '192.168.1.100',
      desiredRole: 'PRIMARY',
      observedRole: 'PRIMARY',
      ownsVip: true,
      promotionReady: false,
    }
    const transaction = vi.fn().mockResolvedValue([1, 1])
    const executeRaw = vi.fn().mockResolvedValue(1)
    const db = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{
          featureEntitlementsJson: JSON.stringify({ ha: true }),
          integrationEntitlementsJson: '{}',
        }])
        .mockResolvedValueOnce([standbyRow(false)])
        .mockResolvedValueOnce([primary])
        .mockResolvedValueOnce([{ id: 'preflight-ready' }])
        .mockResolvedValueOnce([{ count: BigInt(0) }]),
      $executeRaw: executeRaw,
      $transaction: transaction,
    }
    const service = new HaService(db as unknown as PrismaClient)

    const operation = await service.startPlannedSwitchover(1, 'standby-b', 10, {
      confirmation: 'START_PLANNED_SWITCHOVER',
      witnessEvidenceFile: 'switchover.json',
      witnessSignatureFile: 'switchover.json.sig',
    })

    expect(operation).toEqual(expect.objectContaining({
      type: 'PROMOTION',
      status: 'RUNNING',
      currentStage: 'PROMOTION_ARM_QUEUED',
    }))
    expect(operation.id).toHaveLength(36)
    expect(transaction).toHaveBeenCalledOnce()
    expect(executeRaw).toHaveBeenCalledTimes(2)
  })
})

describe('telemetria operacional HA', () => {
  it('expõe idade e qualidade do heartbeat sem apresentar posse antiga como telemetria atual', async () => {
    const stale = standbyRow(true)
    stale.lastSeenAt = new Date(Date.now() - 120_000)
    const db = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{
          featureEntitlementsJson: JSON.stringify({ ha: true }),
          integrationEntitlementsJson: '{}',
        }])
        .mockResolvedValueOnce([stale]),
    }
    const service = new HaService(db as unknown as PrismaClient)

    const [node] = await service.list(1)

    expect(node.heartbeatState).toBe('STALE')
    expect(node.heartbeatAgeSeconds).toBeGreaterThanOrEqual(120)
    expect(node.blockers).toContain('Heartbeat do agente HA está atrasado')
  })

  it('expõe mensagem de orquestração como aviso transitório separado de bloqueadores', async () => {
    const transitioning = standbyRow(false)
    transitioning.componentsJson = JSON.stringify({
      ...healthyComponents,
      orchestration: {
        status: 'degraded',
        message: 'VIP sendo direcionada durante troca controlada.',
      },
    })
    const db = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{
          featureEntitlementsJson: JSON.stringify({ ha: true }),
          integrationEntitlementsJson: '{}',
        }])
        .mockResolvedValueOnce([transitioning]),
    }
    const service = new HaService(db as unknown as PrismaClient)

    const [node] = await service.list(1)

    expect(node.notices).toEqual(['VIP sendo direcionada durante troca controlada.'])
    expect(node.blockers).toEqual([])
  })
})

describe('HaService.reconcileObservedRoles', () => {
  function reconciliationService(rows: Array<Record<string, unknown>>, runningCount = BigInt(0)) {
    const executeRaw = vi.fn().mockReturnValue(Promise.resolve(1))
    const transaction = vi.fn().mockResolvedValue([1, 1])
    const db = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{
          featureEntitlementsJson: JSON.stringify({ ha: true }),
          integrationEntitlementsJson: '{}',
        }])
        .mockResolvedValueOnce([{ runningCount }])
        .mockResolvedValueOnce(rows),
      $executeRaw: executeRaw,
      $transaction: transaction,
    }
    return {
      service: new HaService(db as unknown as PrismaClient),
      executeRaw,
      transaction,
    }
  }

  it('alinha os papéis quando há um PRIMARY com VIP e um STANDBY sem VIP', async () => {
    const now = new Date()
    const { service, transaction } = reconciliationService([
      {
        id: 'node-a',
        name: 'nodeaccess-a',
        observedRole: 'PRIMARY',
        ownsVip: true,
        virtualIp: '192.168.1.105',
        lastSeenAt: now,
      },
      {
        id: 'node-b',
        name: 'nodeaccess-b',
        observedRole: 'STANDBY',
        ownsVip: false,
        virtualIp: '192.168.1.105',
        lastSeenAt: now,
      },
    ])

    const operation = await service.reconcileObservedRoles(
      1,
      10,
      'RECONCILE_OBSERVED_ROLES',
    )

    expect(operation.status).toBe('COMPLETED')
    expect(operation.type).toBe('ROLE_RECONCILIATION')
    expect(transaction).toHaveBeenCalledOnce()
  })

  it('recusa reconciliação quando a VIP não pertence ao PRIMARY', async () => {
    const now = new Date()
    const { service, transaction } = reconciliationService([
      {
        id: 'node-a',
        name: 'nodeaccess-a',
        observedRole: 'PRIMARY',
        ownsVip: false,
        virtualIp: '192.168.1.105',
        lastSeenAt: now,
      },
      {
        id: 'node-b',
        name: 'nodeaccess-b',
        observedRole: 'STANDBY',
        ownsVip: true,
        virtualIp: '192.168.1.105',
        lastSeenAt: now,
      },
    ])

    await expect(service.reconcileObservedRoles(
      1,
      10,
      'RECONCILE_OBSERVED_ROLES',
    )).rejects.toThrow('Topologia insegura')
    expect(transaction).not.toHaveBeenCalled()
  })
})

describe('HaService.createProvisioningPlan', () => {
  function provisioningService(inventory: Record<string, unknown> | null) {
    const db = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{
          featureEntitlementsJson: JSON.stringify({ ha: true }),
          integrationEntitlementsJson: '{}',
        }])
        .mockResolvedValueOnce([standbyRow(false, inventory)]),
      $executeRaw: vi.fn().mockResolvedValue(1),
    }
    return new HaService(db as unknown as PrismaClient)
  }

  it('cria plano somente leitura com recomendações quando o inventário é compatível', async () => {
    const service = provisioningService({
      hostname: 'nodeaccess-c',
      operatingSystem: 'Rocky Linux 9.6',
      architecture: 'x86_64',
      cpuCores: 4,
      memoryTotalMb: 8192,
      diskFreeMb: 20480,
      dockerInstalled: false,
      composeInstalled: false,
    })

    const operation = await service.createProvisioningPlan(1, 'standby-b', 10)

    expect(operation.status).toBe('READY')
    expect(operation.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'inventory', status: 'ok' }),
      expect.objectContaining({ key: 'docker', status: 'required' }),
      expect.objectContaining({ key: 'docker-compose', status: 'required' }),
      expect.objectContaining({ key: 'nodeaccess-stack', status: 'ok' }),
      expect.objectContaining({ key: 'state-replication', status: 'ok' }),
      expect.objectContaining({ key: 'traffic', status: 'required' }),
      expect.objectContaining({ key: 'approval', status: 'required' }),
    ]))
  })

  it('bloqueia o plano enquanto o agente não enviou inventário', async () => {
    const service = provisioningService(null)

    const operation = await service.createProvisioningPlan(1, 'standby-b', 10)

    expect(operation.status).toBe('BLOCKED')
    expect(operation.errorLayer).toBe('inventory')
    expect(operation.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'inventory', status: 'failed' }),
      expect.objectContaining({ key: 'operating-system', status: 'failed' }),
      expect.objectContaining({ key: 'architecture', status: 'failed' }),
    ]))
  })
})

describe('executor governado do agente HA', () => {
  it('enfileira somente a ação catalogada após um plano READY', async () => {
    const db = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{
          featureEntitlementsJson: JSON.stringify({ ha: true }),
          integrationEntitlementsJson: '{}',
        }])
        .mockResolvedValueOnce([standbyRow()])
        .mockResolvedValueOnce([{ id: 'plan-ready' }])
        .mockResolvedValueOnce([{ count: BigInt(0) }]),
      $executeRaw: vi.fn().mockResolvedValue(1),
      $transaction: vi.fn().mockResolvedValue([1, 1]),
    }
    const service = new HaService(db as unknown as PrismaClient)

    const operation = await service.queueInventoryRefresh(
      1,
      'standby-b',
      10,
      'REFRESH_INVENTORY',
    )

    expect(operation.type).toBe('PROVISIONING')
    expect(operation.status).toBe('RUNNING')
    expect(operation.currentStage).toBe('QUEUED')
    expect(db.$transaction).toHaveBeenCalledOnce()
  })

  it('enfileira preparação de diretórios somente para standby sem VIP', async () => {
    const db = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{
          featureEntitlementsJson: JSON.stringify({ ha: true }),
          integrationEntitlementsJson: '{}',
        }])
        .mockResolvedValueOnce([standbyRow()])
        .mockResolvedValueOnce([{ id: 'plan-ready' }])
        .mockResolvedValueOnce([{ count: BigInt(0) }]),
      $executeRaw: vi.fn().mockResolvedValue(1),
      $transaction: vi.fn().mockResolvedValue([1, 1]),
    }
    const service = new HaService(db as unknown as PrismaClient)

    const operation = await service.queueStoragePreparation(
      1,
      'standby-b',
      10,
      'PREPARE_STORAGE_DIRECTORIES',
    )

    expect(operation.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'prepare-storage', status: 'required' }),
    ]))
    expect(db.$transaction).toHaveBeenCalledOnce()
  })

  it('recusa alteração de diretórios quando o nó possui a VIP', async () => {
    const db = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{
          featureEntitlementsJson: JSON.stringify({ ha: true }),
          integrationEntitlementsJson: '{}',
        }])
        .mockResolvedValueOnce([standbyRow(true)]),
    }
    const service = new HaService(db as unknown as PrismaClient)

    await expect(service.queueStoragePreparation(
      1,
      'standby-b',
      10,
      'PREPARE_STORAGE_DIRECTORIES',
    )).rejects.toThrow('só pode ser executada em um nó STANDBY que não possui a VIP')
  })

  it('enfileira probe temporário de escrita sob as mesmas proteções do storage', async () => {
    const db = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{
          featureEntitlementsJson: JSON.stringify({ ha: true }),
          integrationEntitlementsJson: '{}',
        }])
        .mockResolvedValueOnce([standbyRow()])
        .mockResolvedValueOnce([{ id: 'plan-ready' }])
        .mockResolvedValueOnce([{ count: BigInt(0) }]),
      $executeRaw: vi.fn().mockResolvedValue(1),
      $transaction: vi.fn().mockResolvedValue([1, 1]),
    }
    const service = new HaService(db as unknown as PrismaClient)

    const operation = await service.queueStorageWriteValidation(
      1,
      'standby-b',
      10,
      'VALIDATE_STORAGE_WRITE_ACCESS',
    )

    expect(operation.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'validate-storage-write', status: 'required' }),
    ]))
  })

  it('enfileira instalação de release com URL e checksum validados', async () => {
    const db = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([{
          featureEntitlementsJson: JSON.stringify({ ha: true }),
          integrationEntitlementsJson: '{}',
        }])
        .mockResolvedValueOnce([standbyRow()])
        .mockResolvedValueOnce([{ id: 'plan-ready' }])
        .mockResolvedValueOnce([{ count: BigInt(0) }]),
      $executeRaw: vi.fn().mockResolvedValue(1),
      $transaction: vi.fn().mockResolvedValue([1, 1]),
    }
    const service = new HaService(db as unknown as PrismaClient)

    const operation = await service.queueReleaseInstallation(
      1,
      'standby-b',
      10,
      'INSTALL_RELEASE',
      {
        releaseUrl: 'https://releases.example/nodeaccess-release-2.0.28.tar.gz',
        sha256: 'a'.repeat(64),
      },
    )

    expect(operation.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'install-release', status: 'required' }),
    ]))
    expect(db.$transaction).toHaveBeenCalledOnce()
  })

  it('persiste somente os segredos cifrados para a chave pública do agente', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const row = {
      ...standbyRow(),
      agentPublicKey: Buffer.from(publicKey.export({ type: 'spki', format: 'pem' })).toString('base64'),
    }
    const db = {
      $queryRaw: vi.fn().mockResolvedValueOnce([row]),
    }
    const service = new HaService(db as unknown as PrismaClient)
    const queueGovernedAction = vi.spyOn(service as never, 'queueGovernedAction' as never)
      .mockResolvedValue({ steps: [{ key: 'apply-shared-secrets', status: 'required' }] } as never)
    const secrets = {
      JWT_SECRET: 'jwt-secret-123',
      PEM_ENCRYPTION_KEY: 'a'.repeat(64),
      MYSQL_ROOT_PASSWORD: 'mysql-root-123',
      MYSQL_PASSWORD: 'mysql-app-123',
      MYSQL_REPLICATION_PASSWORD: 'mysql-replica-123',
      REDIS_PASSWORD: 'redis-123',
    }

    const operation = await service.queueSharedSecrets(
      1, 'standby-b', 10, 'APPLY_SHARED_SECRETS', secrets,
    )

    expect(operation.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'apply-shared-secrets', status: 'required' }),
    ]))
    const encryptedParams = queueGovernedAction.mock.calls[0]?.[5] as Record<string, string>
    expect(JSON.stringify(encryptedParams)).not.toContain('jwt-secret-123')
    const encryptedJwt = encryptedParams.JWT_SECRET
    expect(encryptedJwt).toBeTruthy()
    expect(privateDecrypt({
      key: privateKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    }, Buffer.from(encryptedJwt!, 'base64')).toString()).toBe('jwt-secret-123')
  })

  it('entrega lease curto ao agente autenticado sem expor ação arbitrária', async () => {
    const token = 'agent-secret'
    const row = standbyRow()
    row.enrollmentHash = createHash('sha256').update(token).digest('hex')
    const db = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([{
          id: 'job-1',
          operationId: 'operation-1',
          action: 'REFRESH_INVENTORY',
          status: 'PENDING',
          leaseHash: null,
          paramsJson: JSON.stringify({ releaseUrl: 'https://releases.example/release.tar.gz' }),
        }])
        .mockResolvedValueOnce([{ endpoint: '192.0.2.11' }]),
      $executeRaw: vi.fn()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1),
    }
    const service = new HaService(db as unknown as PrismaClient)

    const job = await service.claimAgentJob('standby-b', token)

    expect(job).toEqual(expect.objectContaining({
      id: 'job-1',
      operationId: 'operation-1',
      action: 'REFRESH_INVENTORY',
      params: { releaseUrl: 'https://releases.example/release.tar.gz' },
      completionBaseUrl: 'https://192.0.2.11/api/v1',
    }))
    expect(job?.leaseToken.length).toBeGreaterThan(20)
  })
})
