import {
  constants,
  createHash,
  createPublicKey,
  publicEncrypt,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors.js'
import { LicenseEntitlementService } from '../license/license-entitlement.service.js'

const HEARTBEAT_STALE_MS = 90_000
const HEARTBEAT_DELAYED_MS = 45_000
const ENROLLMENT_TTL_MS = 15 * 60_000
const REQUIRED_COMPONENTS = ['mysql', 'redis', 'files', 'api', 'frontend', 'sshGateway', 'guacd'] as const

export interface HaComponentReport {
  status: 'ok' | 'degraded' | 'down' | 'unknown'
  message?: string
  lagSeconds?: number
}

export interface HaAgentReport {
  observedRole: 'PRIMARY' | 'STANDBY'
  ownsVip: boolean
  virtualIp?: string
  components: Record<string, HaComponentReport>
  inventory?: HaNodeInventory
  encryptionPublicKeyBase64?: string
}

export interface HaNodeInventory {
  hostname: string
  operatingSystem: string
  architecture: string
  cpuCores: number
  memoryTotalMb: number
  diskFreeMb: number
  dockerInstalled: boolean
  dockerVersion?: string
  composeInstalled: boolean
}

interface HaNodeRow {
  id: string
  tenantId: number
  name: string
  endpoint: string | null
  desiredRole: string
  observedRole: string | null
  ownsVip: boolean | number | bigint
  virtualIp: string | null
  status: string
  promotionReady: boolean | number | bigint
  blockersJson: unknown
  componentsJson: unknown
  inventoryJson: unknown
  agentPublicKey: string | null
  enrollmentHash: string
  enrollmentExpires: Date
  enrolledAt: Date | null
  lastSeenAt: Date | null
  createdAt: Date
  updatedAt: Date
}

interface HaOperationRow {
  id: string
  nodeId: string
  nodeName: string
  type: string
  status: string
  currentStage: string
  stepsJson: unknown
  errorLayer: string | null
  errorMessage: string | null
  initiatedById: number
  startedAt: Date
  finishedAt: Date | null
}

interface HaTopologyGuardRow {
  primaryCount: bigint
  vipOwnerCount: bigint
  primaryVipOwnerCount: bigint
}

interface HaRoleReconciliationRow {
  id: string
  name: string
  observedRole: string | null
  ownsVip: boolean | number | bigint
  virtualIp: string | null
  lastSeenAt: Date | null
}

interface HaAgentJobRow {
  id: string
  operationId: string
  action: string
  status: string
  leaseHash: string | null
  paramsJson: unknown
}

type HaAgentAction =
  | 'REFRESH_INVENTORY'
  | 'PREPARE_STORAGE_DIRECTORIES'
  | 'ROLLBACK_STORAGE_DIRECTORIES'
  | 'VALIDATE_STORAGE_WRITE_ACCESS'
  | 'INSTALL_RELEASE'
  | 'APPLY_SHARED_SECRETS'
  | 'ROLLBACK_SHARED_SECRETS'
  | 'ARM_PROMOTION'
  | 'QUIESCE_PRIMARY'
  | 'PROMOTE_STANDBY'

const AGENT_ACTIONS: Record<HaAgentAction, {
  stepKey: string
  stepLabel: string
  queuedMessage: string
  successMessage: string
}> = {
  REFRESH_INVENTORY: {
    stepKey: 'agent-execution',
    stepLabel: 'Execução pelo agente',
    queuedMessage: 'Aguardando o agente reivindicar a ação.',
    successMessage: 'Inventário atualizado pelo agente.',
  },
  PREPARE_STORAGE_DIRECTORIES: {
    stepKey: 'prepare-storage',
    stepLabel: 'Preparar diretórios de dados',
    queuedMessage: 'Aguardando o agente preparar os diretórios permitidos.',
    successMessage: 'Diretórios de dados preparados pelo agente.',
  },
  ROLLBACK_STORAGE_DIRECTORIES: {
    stepKey: 'rollback-storage',
    stepLabel: 'Reverter diretórios preparados',
    queuedMessage: 'Aguardando o agente remover apenas diretórios vazios criados por ele.',
    successMessage: 'Diretórios vazios criados pelo agente foram revertidos.',
  },
  VALIDATE_STORAGE_WRITE_ACCESS: {
    stepKey: 'validate-storage-write',
    stepLabel: 'Validar escrita nos diretórios',
    queuedMessage: 'Aguardando o agente executar probes temporários de escrita.',
    successMessage: 'Escrita validada nos diretórios de dados.',
  },
  INSTALL_RELEASE: {
    stepKey: 'install-release',
    stepLabel: 'Baixar e promover release',
    queuedMessage: 'Aguardando o agente baixar, validar e promover o pacote offline.',
    successMessage: 'Release validada e promovida pelo agente.',
  },
  APPLY_SHARED_SECRETS: {
    stepKey: 'apply-shared-secrets',
    stepLabel: 'Aplicar segredos compartilhados',
    queuedMessage: 'Aguardando o agente consumir e aplicar o envelope cifrado.',
    successMessage: 'Segredos compartilhados aplicados pelo agente.',
  },
  ROLLBACK_SHARED_SECRETS: {
    stepKey: 'rollback-shared-secrets',
    stepLabel: 'Restaurar configuração anterior',
    queuedMessage: 'Aguardando o agente restaurar o backup local da configuração.',
    successMessage: 'Configuração anterior restaurada pelo agente.',
  },
  ARM_PROMOTION: {
    stepKey: 'arm-promotion',
    stepLabel: 'Armar promoção no standby',
    queuedMessage: 'Aguardando o standby persistir a promoção local.',
    successMessage: 'Promoção persistida localmente no standby.',
  },
  QUIESCE_PRIMARY: {
    stepKey: 'quiesce-primary',
    stepLabel: 'Congelar o primário e liberar a VIP',
    queuedMessage: 'Aguardando o agente do primário executar a barreira de escrita.',
    successMessage: 'Primário congelado e sem a VIP.',
  },
  PROMOTE_STANDBY: {
    stepKey: 'promote-standby',
    stepLabel: 'Promover o standby',
    queuedMessage: 'Aguardando o agente do standby validar witness e promover o estado.',
    successMessage: 'Standby promovido e validado.',
  },
}

const SHARED_SECRET_KEYS = [
  'JWT_SECRET',
  'PEM_ENCRYPTION_KEY',
  'MYSQL_ROOT_PASSWORD',
  'MYSQL_PASSWORD',
  'MYSQL_REPLICATION_PASSWORD',
  'REDIS_PASSWORD',
] as const

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback
  if (typeof value !== 'string') return value as T
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function tokenMatches(actualHash: string, token: string): boolean {
  const provided = Buffer.from(hashToken(token), 'hex')
  const actual = Buffer.from(actualHash, 'hex')
  return actual.length === provided.length && timingSafeEqual(actual, provided)
}

function parseBool(value: boolean | number | bigint): boolean {
  return value === true || value === 1 || value === BigInt(1)
}

export class HaService {
  private readonly licenses: LicenseEntitlementService

  constructor(private readonly db: PrismaClient) {
    this.licenses = new LicenseEntitlementService(db)
  }

  async requireLicensed(tenantId: number): Promise<void> {
    await this.licenses.requireFeature(
      tenantId,
      'ha',
      'Alta disponibilidade não está habilitada na licença deste ambiente',
    )
  }

  async setEntitlement(tenantId: number, enabled: boolean) {
    if (!enabled) {
      const nodes = await this.db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count FROM ha_nodes WHERE tenant_id = ${tenantId}
      `
      if (Number(nodes[0]?.count ?? 0) > 0) {
        throw new ConflictError('Remova os nós HA antes de desabilitar o recurso')
      }
    }

    const rows = await this.db.$queryRaw<Array<{ featureEntitlementsJson: unknown }>>`
      SELECT feature_entitlements_json AS featureEntitlementsJson
      FROM licenses
      WHERE tenant_id = ${tenantId}
      LIMIT 1
    `
    if (!rows[0]) throw new NotFoundError('Licença')

    const entitlements = parseJson<Record<string, boolean>>(rows[0].featureEntitlementsJson, {})
    entitlements.ha = enabled
    await this.db.$executeRaw`
      UPDATE licenses
      SET feature_entitlements_json = ${JSON.stringify(entitlements)}
      WHERE tenant_id = ${tenantId}
    `
    return { enabled }
  }

  async list(tenantId: number) {
    await this.requireLicensed(tenantId)
    const rows = await this.db.$queryRaw<HaNodeRow[]>`
      SELECT
        id,
        tenant_id AS tenantId,
        name,
        endpoint,
        desired_role AS desiredRole,
        observed_role AS observedRole,
        owns_vip AS ownsVip,
        virtual_ip AS virtualIp,
        status,
        promotion_ready AS promotionReady,
        blockers_json AS blockersJson,
        components_json AS componentsJson,
        inventory_json AS inventoryJson,
        agent_public_key AS agentPublicKey,
        enrollment_hash AS enrollmentHash,
        enrollment_expires AS enrollmentExpires,
        enrolled_at AS enrolledAt,
        last_seen_at AS lastSeenAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM ha_nodes
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at ASC
    `
    return rows.map((row) => this.toPublic(row))
  }

  async reconcileObservedRoles(
    tenantId: number,
    initiatedById: number,
    confirmation: string,
  ) {
    await this.requireLicensed(tenantId)
    if (confirmation !== 'RECONCILE_OBSERVED_ROLES') {
      throw new ForbiddenError('Confirmação inválida para reconciliar os papéis HA')
    }

    const runningRows = await this.db.$queryRaw<Array<{ runningCount: bigint }>>`
      SELECT COUNT(*) AS runningCount
      FROM ha_operations
      WHERE tenant_id = ${tenantId} AND status = 'RUNNING'
    `
    if (Number(runningRows[0]?.runningCount ?? 0) > 0) {
      throw new ConflictError('Aguarde a operação HA em andamento antes de reconciliar os papéis')
    }

    const rows = await this.db.$queryRaw<HaRoleReconciliationRow[]>`
      SELECT
        id,
        name,
        observed_role AS observedRole,
        owns_vip AS ownsVip,
        virtual_ip AS virtualIp,
        last_seen_at AS lastSeenAt
      FROM ha_nodes
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at ASC
    `
    if (rows.length !== 2) {
      throw new ConflictError('A reconciliação desta versão exige exatamente dois nós HA')
    }
    if (rows.some((row) =>
      !row.lastSeenAt || Date.now() - row.lastSeenAt.getTime() > HEARTBEAT_STALE_MS
    )) {
      throw new ConflictError('Os dois agentes precisam ter heartbeat atual para reconciliar os papéis')
    }

    const primary = rows.find((row) => row.observedRole === 'PRIMARY')
    const standby = rows.find((row) => row.observedRole === 'STANDBY')
    const vipOwners = rows.filter((row) => parseBool(row.ownsVip))
    if (!primary || !standby || vipOwners.length !== 1 || vipOwners[0]?.id !== primary.id) {
      throw new ConflictError(
        'Topologia insegura: confirme um PRIMARY com a VIP e um STANDBY sem a VIP',
      )
    }
    if (!primary.virtualIp || primary.virtualIp !== standby.virtualIp) {
      throw new ConflictError('Os dois nós precisam reportar a mesma VIP antes da reconciliação')
    }

    const operationId = randomUUID()
    const steps = [
      {
        key: 'fresh-heartbeats',
        label: 'Heartbeats atuais nos dois nós',
        status: 'ok',
      },
      {
        key: 'single-primary-vip',
        label: 'Um único PRIMARY confirmado com a VIP',
        status: 'ok',
        message: `${primary.name} assumiu ${primary.virtualIp}.`,
      },
      {
        key: 'standby-without-vip',
        label: 'STANDBY confirmado sem a VIP',
        status: 'ok',
        message: `${standby.name} permanece como candidato.`,
      },
      {
        key: 'persist-desired-roles',
        label: 'Papéis configurados alinhados à topologia observada',
        status: 'ok',
      },
    ]

    await this.db.$transaction([
      this.db.$executeRaw`
        UPDATE ha_nodes
        SET
          desired_role = observed_role,
          updated_at = NOW(3)
        WHERE tenant_id = ${tenantId}
          AND observed_role IN ('PRIMARY', 'STANDBY')
      `,
      this.db.$executeRaw`
        INSERT INTO ha_operations (
          id, tenant_id, node_id, type, status, current_stage, steps_json,
          error_layer, error_message, initiated_by_id, started_at, finished_at,
          created_at, updated_at
        ) VALUES (
          ${operationId}, ${tenantId}, ${primary.id}, 'ROLE_RECONCILIATION', 'COMPLETED',
          'ROLES_RECONCILED', ${JSON.stringify(steps)}, null, null, ${initiatedById},
          NOW(3), NOW(3), NOW(3), NOW(3)
        )
      `,
    ])

    return {
      id: operationId,
      nodeId: primary.id,
      nodeName: primary.name,
      type: 'ROLE_RECONCILIATION',
      status: 'COMPLETED',
      currentStage: 'ROLES_RECONCILED',
      steps,
      errorLayer: null,
      errorMessage: null,
      initiatedById,
      startedAt: new Date(),
      finishedAt: new Date(),
    }
  }

  async createEnrollment(
    tenantId: number,
    input: { name: string; endpoint?: string; desiredRole?: 'PRIMARY' | 'STANDBY' },
  ) {
    await this.requireLicensed(tenantId)
    const id = randomUUID()
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS)
    const name = input.name.trim()
    if (!name) throw new ForbiddenError('Informe um nome para o nó HA')

    await this.db.$executeRaw`
      INSERT INTO ha_nodes (
        id, tenant_id, name, endpoint, desired_role, status,
        promotion_ready, enrollment_hash, enrollment_expires, created_at, updated_at
      ) VALUES (
        ${id}, ${tenantId}, ${name}, ${input.endpoint?.trim() || null}, ${input.desiredRole ?? 'STANDBY'}, 'PENDING',
        false, ${hashToken(token)}, ${expiresAt}, NOW(3), NOW(3)
      )
    `

    return { id, token, expiresAt }
  }

  async report(nodeId: string, token: string, report: HaAgentReport) {
    const row = await this.findById(nodeId)
    if (!row || !tokenMatches(row.enrollmentHash, token)) {
      throw new ForbiddenError('Credencial do agente HA inválida')
    }
    if (!row.enrolledAt && row.enrollmentExpires.getTime() < Date.now()) {
      throw new ForbiddenError('Token de matrícula HA expirado')
    }

    const transition = report.components.orchestration?.status === 'degraded'
    const operationalNotices: string[] = []
    const healthBlockers = REQUIRED_COMPONENTS.flatMap((name) => {
      const component = report.components[name]
      if (!component) return [`Sem informação do componente ${name}`]
      if (component.status !== 'ok') return [component.message || `${name} está ${component.status}`]
      return []
    })
    if (report.observedRole !== row.desiredRole) {
      const message = `Papel observado ${report.observedRole} difere do papel configurado ${row.desiredRole}`
      if (transition) operationalNotices.push(message)
      else healthBlockers.push(message)
    }
    if (report.observedRole === 'PRIMARY' && !report.ownsVip) {
      const message = 'Nó PRIMARY não possui a VIP configurada'
      if (transition) operationalNotices.push(`${message}; transferência em andamento`)
      else healthBlockers.push(message)
    }
    if (report.observedRole === 'STANDBY' && report.ownsVip) {
      const message = 'Nó STANDBY possui a VIP; risco de split-brain'
      if (transition) operationalNotices.push('VIP recebida durante a troca; aguardando promoção do estado')
      else healthBlockers.push(message)
    }
    const orchestrationMessage = report.components.orchestration?.message?.trim()
    if (transition && orchestrationMessage) operationalNotices.unshift(orchestrationMessage)

    const healthy = healthBlockers.length === 0
    const ready = healthy && report.observedRole === 'STANDBY' && !report.ownsVip
    await this.db.$executeRaw`
      UPDATE ha_nodes
      SET
        observed_role = ${report.observedRole},
        owns_vip = ${report.ownsVip},
        virtual_ip = ${report.virtualIp?.trim() || null},
        status = ${healthy ? 'HEALTHY' : 'DEGRADED'},
        promotion_ready = ${ready},
        blockers_json = ${JSON.stringify(healthBlockers)},
        components_json = ${JSON.stringify(report.components)},
        inventory_json = ${report.inventory ? JSON.stringify(report.inventory) : row.inventoryJson},
        agent_public_key = ${report.encryptionPublicKeyBase64?.trim() || row.agentPublicKey},
        enrolled_at = COALESCE(enrolled_at, NOW(3)),
        last_seen_at = NOW(3),
        updated_at = NOW(3)
      WHERE id = ${nodeId}
    `
    if (report.observedRole === 'PRIMARY' && report.ownsVip) {
      const completedSteps = [
        { key: 'preflight', label: 'Preflight recente aprovado', status: 'ok' },
        { key: 'arm-promotion', label: 'Armar promoção no standby', status: 'ok' },
        { key: 'quiesce-primary', label: 'Congelar o primário e liberar a VIP', status: 'ok' },
        { key: 'promote-standby', label: 'Validar witness e promover o standby', status: 'ok' },
        {
          key: 'reconcile-roles',
          label: 'Confirmar topologia e reconciliar papéis',
          status: 'required',
          message: 'Promoção observada; confirme os dois heartbeats antes de persistir os papéis.',
        },
      ]
      await this.db.$executeRaw`
        UPDATE ha_operations
        SET
          status = 'COMPLETED',
          current_stage = 'AWAITING_ROLE_RECONCILIATION',
          steps_json = ${JSON.stringify(completedSteps)},
          error_layer = NULL,
          error_message = NULL,
          finished_at = NOW(3),
          updated_at = NOW(3)
        WHERE tenant_id = ${row.tenantId}
          AND node_id = ${nodeId}
          AND type = 'PROMOTION'
          AND status = 'RUNNING'
          AND current_stage = 'AWAITING_LOCAL_PROMOTION'
      `
    }
    return {
      accepted: true,
      promotionReady: ready,
      blockers: healthBlockers,
      notices: operationalNotices,
    }
  }

  async remove(tenantId: number, nodeId: string): Promise<void> {
    await this.requireLicensed(tenantId)
    const changed = await this.db.$executeRaw`
      DELETE FROM ha_nodes WHERE id = ${nodeId} AND tenant_id = ${tenantId}
    `
    if (changed === 0) throw new NotFoundError('Nó HA')
  }

  async listOperations(tenantId: number) {
    await this.requireLicensed(tenantId)
    const rows = await this.db.$queryRaw<HaOperationRow[]>`
      SELECT
        operation.id,
        operation.node_id AS nodeId,
        node.name AS nodeName,
        operation.type,
        operation.status,
        operation.current_stage AS currentStage,
        operation.steps_json AS stepsJson,
        operation.error_layer AS errorLayer,
        operation.error_message AS errorMessage,
        operation.initiated_by_id AS initiatedById,
        operation.started_at AS startedAt,
        operation.finished_at AS finishedAt
      FROM ha_operations operation
      INNER JOIN ha_nodes node ON node.id = operation.node_id
      WHERE operation.tenant_id = ${tenantId}
      ORDER BY operation.created_at DESC
      LIMIT 50
    `
    return rows.map(({ stepsJson, ...row }) => ({
      ...row,
      steps: parseJson(stepsJson, []),
    }))
  }

  async runPreflight(tenantId: number, nodeId: string, initiatedById: number) {
    await this.requireLicensed(tenantId)
    const row = await this.findById(nodeId)
    if (!row || row.tenantId !== tenantId) throw new NotFoundError('Nó HA')

    const node = this.toPublic(row)
    const topologyRows = await this.db.$queryRaw<HaTopologyGuardRow[]>`
      SELECT
        SUM(observed_role = 'PRIMARY') AS primaryCount,
        SUM(owns_vip = true) AS vipOwnerCount,
        SUM(observed_role = 'PRIMARY' AND owns_vip = true) AS primaryVipOwnerCount
      FROM ha_nodes
      WHERE tenant_id = ${tenantId}
    `
    const topology = topologyRows[0]
    const steps = [
      {
        key: 'agent-heartbeat',
        label: 'Heartbeat do agente',
        status: node.lastSeenAt && node.status !== 'OFFLINE' ? 'ok' : 'failed',
      },
      {
        key: 'standby-role',
        label: 'Papel standby',
        status: node.observedRole === 'STANDBY' ? 'ok' : 'failed',
      },
      {
        key: 'single-primary',
        label: 'Um único nó PRIMARY',
        status: Number(topology?.primaryCount ?? 0) === 1 ? 'ok' : 'failed',
      },
      {
        key: 'single-vip-owner',
        label: 'Um único dono da VIP',
        status: Number(topology?.vipOwnerCount ?? 0) === 1 ? 'ok' : 'failed',
      },
      {
        key: 'primary-owns-vip',
        label: 'PRIMARY confirmado como dono da VIP',
        status: Number(topology?.primaryVipOwnerCount ?? 0) === 1 ? 'ok' : 'failed',
      },
      {
        key: 'standby-without-vip',
        label: 'Candidato sem posse da VIP',
        status: !node.ownsVip ? 'ok' : 'failed',
      },
      ...REQUIRED_COMPONENTS.map((name) => ({
        key: `component-${name}`,
        label: `Componente ${name}`,
        status: node.components[name]?.status === 'ok' ? 'ok' : 'failed',
        message: node.components[name]?.message,
      })),
      {
        key: 'fencing',
        label: 'Fencing ou witness',
        status: 'required',
        message: 'Obrigatório antes da promoção; não é aplicado no preflight somente leitura.',
      },
    ]
    const failed = steps.filter((step) => step.status === 'failed')
    const status = failed.length === 0 ? 'READY' : 'BLOCKED'
    const operationId = randomUUID()
    const errorMessage = failed.length > 0
      ? `${failed.length} verificação(ões) impediram a promoção`
      : null

    await this.db.$executeRaw`
      INSERT INTO ha_operations (
        id, tenant_id, node_id, type, status, current_stage, steps_json,
        error_layer, error_message, initiated_by_id, started_at, finished_at,
        created_at, updated_at
      ) VALUES (
        ${operationId}, ${tenantId}, ${nodeId}, 'PREFLIGHT', ${status}, 'PREFLIGHT_COMPLETE',
        ${JSON.stringify(steps)}, ${failed.length > 0 ? 'readiness' : null}, ${errorMessage},
        ${initiatedById}, NOW(3), NOW(3), NOW(3), NOW(3)
      )
    `

    return {
      id: operationId,
      nodeId,
      nodeName: node.name,
      type: 'PREFLIGHT',
      status,
      currentStage: 'PREFLIGHT_COMPLETE',
      steps,
      errorLayer: failed.length > 0 ? 'readiness' : null,
      errorMessage,
      initiatedById,
      startedAt: new Date(),
      finishedAt: new Date(),
    }
  }

  async startPlannedSwitchover(
    tenantId: number,
    standbyNodeId: string,
    initiatedById: number,
    input: {
      confirmation: string
      witnessEvidenceFile: string
      witnessSignatureFile: string
    },
  ) {
    await this.requireLicensed(tenantId)
    if (input.confirmation !== 'START_PLANNED_SWITCHOVER') {
      throw new ForbiddenError('Confirmação inválida para iniciar a troca planejada')
    }
    for (const filename of [input.witnessEvidenceFile, input.witnessSignatureFile]) {
      if (!/^[A-Za-z0-9._-]{1,160}$/.test(filename) || filename.includes('..')) {
        throw new ForbiddenError('Use apenas o nome do arquivo witness, sem diretórios')
      }
    }

    const standbyRow = await this.findById(standbyNodeId)
    if (!standbyRow || standbyRow.tenantId !== tenantId) throw new NotFoundError('Nó HA')
    const standby = this.toPublic(standbyRow)
    if (
      standby.observedRole !== 'STANDBY'
      || standby.ownsVip
      || !standby.promotionReady
      || !standby.endpoint
      || standby.heartbeatState !== 'CURRENT'
    ) {
      throw new ConflictError('O candidato precisa estar STANDBY, atual, sem VIP e pronto para promoção')
    }

    const primaryRows = await this.db.$queryRaw<HaNodeRow[]>`
      SELECT
        id, tenant_id AS tenantId, name, endpoint,
        desired_role AS desiredRole, observed_role AS observedRole,
        owns_vip AS ownsVip, virtual_ip AS virtualIp, status,
        promotion_ready AS promotionReady, blockers_json AS blockersJson,
        components_json AS componentsJson, inventory_json AS inventoryJson,
        agent_public_key AS agentPublicKey, enrollment_hash AS enrollmentHash,
        enrollment_expires AS enrollmentExpires, enrolled_at AS enrolledAt,
        last_seen_at AS lastSeenAt, created_at AS createdAt, updated_at AS updatedAt
      FROM ha_nodes
      WHERE tenant_id = ${tenantId}
        AND observed_role = 'PRIMARY'
        AND owns_vip = true
      LIMIT 2
    `
    if (primaryRows.length !== 1) {
      throw new ConflictError('A troca exige exatamente um PRIMARY como único dono da VIP')
    }
    const primary = this.toPublic(primaryRows[0]!)
    if (
      !primary.endpoint
      || primary.heartbeatState !== 'CURRENT'
      || !primary.virtualIp
      || primary.virtualIp !== standby.virtualIp
    ) {
      throw new ConflictError('PRIMARY e STANDBY precisam estar atuais e reportar a mesma VIP')
    }

    const readyPreflights = await this.db.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM ha_operations
      WHERE tenant_id = ${tenantId}
        AND node_id = ${standbyNodeId}
        AND type = 'PREFLIGHT'
        AND status = 'READY'
        AND created_at >= DATE_SUB(NOW(3), INTERVAL 15 MINUTE)
      ORDER BY created_at DESC
      LIMIT 1
    `
    if (!readyPreflights[0]) {
      throw new ConflictError('Execute um preflight READY nos últimos 15 minutos antes da troca')
    }

    const activeRows = await this.db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count
      FROM ha_agent_jobs
      WHERE tenant_id = ${tenantId}
        AND status IN ('PENDING', 'LEASED')
    `
    if (Number(activeRows[0]?.count ?? 0) > 0) {
      throw new ConflictError('Já existe uma ação governada pendente na topologia HA')
    }

    const operationId = randomUUID()
    const jobId = randomUUID()
    const witnessRoot = '/opt/nodeaccess/shared/ha/witness'
    const params = {
      operationId,
      virtualIp: primary.virtualIp,
      primaryNodeId: primary.id,
      standbyNodeId: standby.id,
      primaryNodeIp: primary.endpoint,
      standbyNodeIp: standby.endpoint,
      witnessEvidenceFile: `${witnessRoot}/${input.witnessEvidenceFile}`,
      witnessSignatureFile: `${witnessRoot}/${input.witnessSignatureFile}`,
      witnessPublicKey: '/opt/nodeaccess/shared/ha/witness-public.pem',
    }
    const steps = [
      { key: 'preflight', label: 'Preflight recente aprovado', status: 'ok' },
      {
        key: 'arm-promotion',
        label: 'Armar promoção no standby',
        status: 'required',
        message: `Aguardando ${standby.name}.`,
      },
      {
        key: 'quiesce-primary',
        label: 'Congelar o primário e liberar a VIP',
        status: 'required',
        message: `Bloqueado até ${standby.name} persistir a promoção local.`,
      },
      {
        key: 'promote-standby',
        label: 'Validar witness e promover o standby',
        status: 'required',
        message: `Bloqueado até ${primary.name} confirmar o quiesce.`,
      },
      {
        key: 'reconcile-roles',
        label: 'Confirmar topologia e reconciliar papéis',
        status: 'required',
      },
    ]
    await this.db.$transaction([
      this.db.$executeRaw`
        INSERT INTO ha_operations (
          id, tenant_id, node_id, type, status, current_stage, steps_json,
          error_layer, error_message, initiated_by_id, started_at, finished_at,
          created_at, updated_at
        ) VALUES (
          ${operationId}, ${tenantId}, ${standbyNodeId}, 'PROMOTION', 'RUNNING',
          'PROMOTION_ARM_QUEUED', ${JSON.stringify(steps)}, NULL, NULL, ${initiatedById},
          NOW(3), NULL, NOW(3), NOW(3)
        )
      `,
      this.db.$executeRaw`
        INSERT INTO ha_agent_jobs (
          id, tenant_id, node_id, operation_id, action, status, attempts, params_json,
          created_at, updated_at
        ) VALUES (
          ${jobId}, ${tenantId}, ${standby.id}, ${operationId}, 'ARM_PROMOTION',
          'PENDING', 0, ${JSON.stringify(params)}, NOW(3), NOW(3)
        )
      `,
    ])
    return {
      id: operationId,
      nodeId: standby.id,
      nodeName: standby.name,
      type: 'PROMOTION',
      status: 'RUNNING',
      currentStage: 'PROMOTION_ARM_QUEUED',
      steps,
      errorLayer: null,
      errorMessage: null,
      initiatedById,
      startedAt: new Date(),
      finishedAt: null,
    }
  }

  async runRejoinPreflight(tenantId: number, nodeId: string, initiatedById: number) {
    await this.requireLicensed(tenantId)
    const row = await this.findById(nodeId)
    if (!row || row.tenantId !== tenantId) throw new NotFoundError('Nó HA')

    const node = this.toPublic(row)
    const mysql = node.components.mysql
    const steps = [
      {
        key: 'agent-heartbeat',
        label: 'Heartbeat do agente',
        status: node.lastSeenAt && node.status !== 'OFFLINE' ? 'ok' : 'failed',
      },
      {
        key: 'standby-role',
        label: 'Papel standby',
        status: node.observedRole === 'STANDBY' ? 'ok' : 'failed',
      },
      {
        key: 'mysql-replication',
        label: 'MySQL replicando',
        status: mysql?.status === 'ok' ? 'ok' : 'failed',
        message: mysql?.message,
      },
      {
        key: 'mysql-zero-lag',
        label: 'Lag MySQL zerado',
        status: mysql?.status === 'ok' && mysql.lagSeconds === 0 ? 'ok' : 'failed',
        message: Number.isFinite(mysql?.lagSeconds)
          ? `Lag observado: ${mysql?.lagSeconds}s`
          : 'O agente não informou o lag da réplica.',
      },
      {
        key: 'redis-replication',
        label: 'Redis replicando',
        status: node.components.redis?.status === 'ok' ? 'ok' : 'failed',
        message: node.components.redis?.message,
      },
      {
        key: 'file-replication',
        label: 'Arquivos sincronizados',
        status: node.components.files?.status === 'ok' ? 'ok' : 'failed',
        message: node.components.files?.message,
      },
      {
        key: 'final-write-freeze',
        label: 'Congelamento final de escrita',
        status: 'required',
        message: 'Obrigatório imediatamente antes de promover este nó novamente.',
      },
      {
        key: 'fencing',
        label: 'Fencing ou witness',
        status: 'required',
        message: 'Obrigatório antes da promoção; não é aplicado nesta validação somente leitura.',
      },
    ]
    const failed = steps.filter((step) => step.status === 'failed')
    const status = failed.length === 0 ? 'READY' : 'BLOCKED'
    const operationId = randomUUID()
    const errorMessage = failed.length > 0
      ? `${failed.length} verificação(ões) impediram o retorno`
      : null

    await this.db.$executeRaw`
      INSERT INTO ha_operations (
        id, tenant_id, node_id, type, status, current_stage, steps_json,
        error_layer, error_message, initiated_by_id, started_at, finished_at,
        created_at, updated_at
      ) VALUES (
        ${operationId}, ${tenantId}, ${nodeId}, 'FAILBACK', ${status}, 'REJOIN_PREFLIGHT_COMPLETE',
        ${JSON.stringify(steps)}, ${failed.length > 0 ? 'rejoin-readiness' : null}, ${errorMessage},
        ${initiatedById}, NOW(3), NOW(3), NOW(3), NOW(3)
      )
    `

    return {
      id: operationId,
      nodeId,
      nodeName: node.name,
      type: 'FAILBACK',
      status,
      currentStage: 'REJOIN_PREFLIGHT_COMPLETE',
      steps,
      errorLayer: failed.length > 0 ? 'rejoin-readiness' : null,
      errorMessage,
      initiatedById,
      startedAt: new Date(),
      finishedAt: new Date(),
    }
  }

  async createProvisioningPlan(tenantId: number, nodeId: string, initiatedById: number) {
    await this.requireLicensed(tenantId)
    const row = await this.findById(nodeId)
    if (!row || row.tenantId !== tenantId) throw new NotFoundError('Nó HA')

    const node = this.toPublic(row)
    const inventory = node.inventory
    const steps = [
      {
        key: 'inventory',
        label: 'Inventário recebido do agente',
        status: inventory ? 'ok' : 'failed',
        message: inventory ? `Host ${inventory.hostname}` : 'Aguarde o primeiro relatório do agente.',
      },
      {
        key: 'operating-system',
        label: 'Sistema operacional Linux',
        status: inventory?.operatingSystem.toLowerCase().includes('linux') ? 'ok' : 'failed',
        message: inventory?.operatingSystem,
      },
      {
        key: 'architecture',
        label: 'Arquitetura suportada',
        status: inventory && ['x86_64', 'amd64', 'aarch64', 'arm64'].includes(inventory.architecture.toLowerCase())
          ? 'ok'
          : 'failed',
        message: inventory?.architecture,
      },
      {
        key: 'docker',
        label: 'Docker Engine',
        status: inventory?.dockerInstalled ? 'ok' : 'required',
        message: inventory?.dockerInstalled
          ? inventory.dockerVersion
          : 'Será necessário instalar Docker antes dos containers NodeAccess.',
      },
      {
        key: 'docker-compose',
        label: 'Docker Compose',
        status: inventory?.composeInstalled ? 'ok' : 'required',
        message: inventory?.composeInstalled
          ? 'Plugin disponível.'
          : 'Será necessário instalar o plugin Docker Compose.',
      },
      {
        key: 'capacity',
        label: 'Capacidade recomendada',
        status: inventory && inventory.cpuCores >= 2 && inventory.memoryTotalMb >= 4096 && inventory.diskFreeMb >= 10240
          ? 'ok'
          : 'required',
        message: inventory
          ? `${inventory.cpuCores} CPU · ${inventory.memoryTotalMb} MB RAM · ${inventory.diskFreeMb} MB livres`
          : 'Capacidade ainda não informada.',
      },
      {
        key: 'nodeaccess-stack',
        label: 'Stack NodeAccess',
        status: ['api', 'frontend', 'sshGateway', 'guacd'].every(
          (component) => node.components[component]?.status === 'ok',
        ) ? 'ok' : 'required',
        message: ['api', 'frontend', 'sshGateway', 'guacd'].every(
          (component) => node.components[component]?.status === 'ok',
        )
          ? 'API, frontend, gateway SSH e guacd em execução.'
          : 'O agente não instala a release nem os containers; publique a mesma release do primário neste nó.',
      },
      {
        key: 'state-replication',
        label: 'MySQL, Redis e arquivos replicados',
        status: ['mysql', 'redis', 'files'].every(
          (component) => node.components[component]?.status === 'ok',
        ) ? 'ok' : 'required',
        message: ['mysql', 'redis', 'files'].every(
          (component) => node.components[component]?.status === 'ok',
        )
          ? 'Estado local reportado como íntegro.'
          : 'Configure e valide as réplicas antes de executar qualquer promoção.',
      },
      {
        key: 'traffic',
        label: 'Keepalived, interface e VIP',
        status: 'required',
        message: node.virtualIp
          ? `Configure o Keepalived na interface correta com a VIP ${node.virtualIp}; a posse só deve ser liberada após os gates de promoção.`
          : 'Informe e reserve a VIP antes de configurar o Keepalived.',
      },
      {
        key: 'approval',
        label: 'Aprovação para executar o provisionamento',
        status: 'required',
        message: 'Este plano é somente leitura. Nenhuma alteração foi executada no nó.',
      },
    ]
    const failed = steps.filter((step) => step.status === 'failed')
    const status = failed.length === 0 ? 'READY' : 'BLOCKED'
    const operationId = randomUUID()
    const errorMessage = failed.length > 0
      ? `${failed.length} pré-requisito(s) impediram o plano`
      : null

    await this.db.$executeRaw`
      INSERT INTO ha_operations (
        id, tenant_id, node_id, type, status, current_stage, steps_json,
        error_layer, error_message, initiated_by_id, started_at, finished_at,
        created_at, updated_at
      ) VALUES (
        ${operationId}, ${tenantId}, ${nodeId}, 'PROVISION_PLAN', ${status}, 'PLAN_COMPLETE',
        ${JSON.stringify(steps)}, ${failed.length > 0 ? 'inventory' : null}, ${errorMessage},
        ${initiatedById}, NOW(3), NOW(3), NOW(3), NOW(3)
      )
    `

    return {
      id: operationId,
      nodeId,
      nodeName: node.name,
      type: 'PROVISION_PLAN',
      status,
      currentStage: 'PLAN_COMPLETE',
      steps,
      errorLayer: failed.length > 0 ? 'inventory' : null,
      errorMessage,
      initiatedById,
      startedAt: new Date(),
      finishedAt: new Date(),
    }
  }

  async queueInventoryRefresh(
    tenantId: number,
    nodeId: string,
    initiatedById: number,
    confirmation: string,
  ) {
    return this.queueGovernedAction(
      tenantId,
      nodeId,
      initiatedById,
      confirmation,
      'REFRESH_INVENTORY',
    )
  }

  async queueStoragePreparation(
    tenantId: number,
    nodeId: string,
    initiatedById: number,
    confirmation: string,
  ) {
    return this.queueGovernedAction(
      tenantId,
      nodeId,
      initiatedById,
      confirmation,
      'PREPARE_STORAGE_DIRECTORIES',
    )
  }

  async queueStorageRollback(
    tenantId: number,
    nodeId: string,
    initiatedById: number,
    confirmation: string,
  ) {
    return this.queueGovernedAction(
      tenantId,
      nodeId,
      initiatedById,
      confirmation,
      'ROLLBACK_STORAGE_DIRECTORIES',
    )
  }

  async queueStorageWriteValidation(
    tenantId: number,
    nodeId: string,
    initiatedById: number,
    confirmation: string,
  ) {
    return this.queueGovernedAction(
      tenantId,
      nodeId,
      initiatedById,
      confirmation,
      'VALIDATE_STORAGE_WRITE_ACCESS',
    )
  }

  async queueReleaseInstallation(
    tenantId: number,
    nodeId: string,
    initiatedById: number,
    confirmation: string,
    input: { releaseUrl: string; sha256: string },
  ) {
    const releaseUrl = input.releaseUrl.trim()
    const sha256 = input.sha256.trim().toLowerCase()
    let parsedReleaseUrl: URL
    try {
      parsedReleaseUrl = new URL(releaseUrl)
    } catch {
      throw new ForbiddenError('Informe uma URL HTTP(S) válida para o pacote da release')
    }
    if (!['http:', 'https:'].includes(parsedReleaseUrl.protocol)
      || parsedReleaseUrl.username
      || parsedReleaseUrl.password
      || releaseUrl.length > 1000) {
      throw new ForbiddenError('Informe uma URL HTTP(S) válida para o pacote da release')
    }
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      throw new ForbiddenError('SHA-256 inválido para o pacote da release')
    }
    return this.queueGovernedAction(
      tenantId,
      nodeId,
      initiatedById,
      confirmation,
      'INSTALL_RELEASE',
      { releaseUrl, sha256 },
    )
  }

  async queueSharedSecrets(
    tenantId: number,
    nodeId: string,
    initiatedById: number,
    confirmation: string,
    secrets: Record<string, string>,
  ) {
    const row = await this.findById(nodeId)
    if (!row?.agentPublicKey) {
      throw new ConflictError('O agente ainda não publicou sua chave pública de provisionamento')
    }
    let publicKey
    try {
      publicKey = createPublicKey(Buffer.from(row.agentPublicKey, 'base64').toString('utf8'))
      if (publicKey.asymmetricKeyType !== 'rsa') throw new Error('not-rsa')
    } catch {
      throw new ConflictError('A chave pública de provisionamento do agente é inválida')
    }
    const encryptedSecrets: Record<string, string> = {}
    for (const key of SHARED_SECRET_KEYS) {
      const value = secrets[key]?.trim()
      if (!value || value.length > 240 || !/^[A-Za-z0-9_./+=:@%-]+$/.test(value)) {
        throw new ForbiddenError(`${key} ausente ou contém caracteres não permitidos`)
      }
      encryptedSecrets[key] = publicEncrypt({
        key: publicKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      }, Buffer.from(value)).toString('base64')
    }
    return this.queueGovernedAction(
      tenantId,
      nodeId,
      initiatedById,
      confirmation,
      'APPLY_SHARED_SECRETS',
      encryptedSecrets,
    )
  }

  async queueSharedSecretsRollback(
    tenantId: number,
    nodeId: string,
    initiatedById: number,
    confirmation: string,
  ) {
    return this.queueGovernedAction(
      tenantId,
      nodeId,
      initiatedById,
      confirmation,
      'ROLLBACK_SHARED_SECRETS',
    )
  }

  private async queueGovernedAction(
    tenantId: number,
    nodeId: string,
    initiatedById: number,
    confirmation: string,
    action: HaAgentAction,
    params: Record<string, string> | null = null,
  ) {
    await this.requireLicensed(tenantId)
    if (confirmation !== action) {
      throw new ForbiddenError('Confirmação inválida para a ação governada do agente')
    }
    const row = await this.findById(nodeId)
    if (!row || row.tenantId !== tenantId) throw new NotFoundError('Nó HA')
    if (action !== 'REFRESH_INVENTORY' && (row.observedRole !== 'STANDBY' || parseBool(row.ownsVip))) {
      throw new ConflictError('A ação só pode ser executada em um nó STANDBY que não possui a VIP')
    }
    const plans = await this.db.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM ha_operations
      WHERE tenant_id = ${tenantId}
        AND node_id = ${nodeId}
        AND type = 'PROVISION_PLAN'
        AND status = 'READY'
      ORDER BY created_at DESC
      LIMIT 1
    `
    if (!plans[0]) {
      throw new ConflictError('Gere e revise um plano de provisionamento READY antes de executar esta ação')
    }
    const activeJobs = await this.db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count
      FROM ha_agent_jobs
      WHERE node_id = ${nodeId}
        AND status IN ('PENDING', 'LEASED')
    `
    if (Number(activeJobs[0]?.count ?? 0) > 0) {
      throw new ConflictError('Já existe uma ação governada pendente para este nó')
    }

    const operationId = randomUUID()
    const jobId = randomUUID()
    const actionDefinition = AGENT_ACTIONS[action]
    const steps = [
      {
        key: 'approval',
        label: 'Aprovação explícita',
        status: 'ok',
        message: `Ação limitada ao catálogo ${action}.`,
      },
      {
        key: actionDefinition.stepKey,
        label: actionDefinition.stepLabel,
        status: 'required',
        message: actionDefinition.queuedMessage,
      },
    ]
    await this.db.$transaction([
      this.db.$executeRaw`
        INSERT INTO ha_operations (
          id, tenant_id, node_id, type, status, current_stage, steps_json,
          error_layer, error_message, initiated_by_id, started_at, finished_at,
          created_at, updated_at
        ) VALUES (
          ${operationId}, ${tenantId}, ${nodeId}, 'PROVISIONING', 'RUNNING', 'QUEUED',
          ${JSON.stringify(steps)}, NULL, NULL, ${initiatedById}, NOW(3), NULL, NOW(3), NOW(3)
        )
      `,
      this.db.$executeRaw`
        INSERT INTO ha_agent_jobs (
          id, tenant_id, node_id, operation_id, action, status, attempts, params_json,
          created_at, updated_at
        ) VALUES (
          ${jobId}, ${tenantId}, ${nodeId}, ${operationId}, ${action},
          'PENDING', 0, ${params ? JSON.stringify(params) : null}, NOW(3), NOW(3)
        )
      `,
    ])
    return {
      id: operationId,
      nodeId,
      nodeName: row.name,
      type: 'PROVISIONING',
      status: 'RUNNING',
      currentStage: 'QUEUED',
      steps,
      errorLayer: null,
      errorMessage: null,
      initiatedById,
      startedAt: new Date(),
      finishedAt: null,
    }
  }

  async claimAgentJob(nodeId: string, token: string) {
    const node = await this.findById(nodeId)
    if (!node || !tokenMatches(node.enrollmentHash, token)) {
      throw new ForbiddenError('Credencial do agente HA inválida')
    }
    const jobs = await this.db.$queryRaw<HaAgentJobRow[]>`
      SELECT
        id,
        operation_id AS operationId,
        action,
        status,
        lease_hash AS leaseHash,
        params_json AS paramsJson
      FROM ha_agent_jobs
      WHERE node_id = ${nodeId}
        AND (
          status = 'PENDING'
          OR (status = 'LEASED' AND lease_expires_at < NOW(3))
        )
      ORDER BY created_at ASC
      LIMIT 1
    `
    const job = jobs[0]
    if (!job) return null

    const leaseToken = randomBytes(32).toString('base64url')
    const changed = await this.db.$executeRaw`
      UPDATE ha_agent_jobs
      SET
        status = 'LEASED',
        lease_hash = ${hashToken(leaseToken)},
        lease_expires_at = CASE
          WHEN action IN ('INSTALL_RELEASE', 'PROMOTE_STANDBY')
            THEN DATE_ADD(NOW(3), INTERVAL 30 MINUTE)
          ELSE DATE_ADD(NOW(3), INTERVAL 90 SECOND)
        END,
        attempts = attempts + 1,
        updated_at = NOW(3)
      WHERE id = ${job.id}
        AND (
          status = 'PENDING'
          OR (status = 'LEASED' AND lease_expires_at < NOW(3))
        )
    `
    if (changed === 0) return null
    await this.db.$executeRaw`
      UPDATE ha_operations
      SET current_stage = 'LEASED', updated_at = NOW(3)
      WHERE id = ${job.operationId}
    `
    const peerRows = await this.db.$queryRaw<Array<{ endpoint: string | null }>>`
      SELECT endpoint
      FROM ha_nodes
      WHERE tenant_id = ${node.tenantId}
        AND id <> ${nodeId}
        AND endpoint IS NOT NULL
        AND last_seen_at >= DATE_SUB(NOW(3), INTERVAL 90 SECOND)
      ORDER BY last_seen_at DESC
      LIMIT 1
    `
    const peerEndpoint = peerRows?.[0]?.endpoint?.trim() ?? ''
    const completionBaseUrl = /^[A-Za-z0-9.-]+$/.test(peerEndpoint)
      ? `https://${peerEndpoint}/api/v1`
      : null
    return {
      id: job.id,
      operationId: job.operationId,
      action: job.action,
      leaseToken,
      params: parseJson<Record<string, string>>(job.paramsJson, {}),
      completionBaseUrl,
    }
  }

  async completeAgentJob(
    nodeId: string,
    jobId: string,
    token: string,
    input: { leaseToken: string; success: boolean; message?: string },
  ) {
    const node = await this.findById(nodeId)
    if (!node || !tokenMatches(node.enrollmentHash, token)) {
      throw new ForbiddenError('Credencial do agente HA inválida')
    }
    const jobs = await this.db.$queryRaw<HaAgentJobRow[]>`
      SELECT
        id,
        operation_id AS operationId,
        action,
        status,
        lease_hash AS leaseHash,
        params_json AS paramsJson
      FROM ha_agent_jobs
      WHERE id = ${jobId} AND node_id = ${nodeId}
      LIMIT 1
    `
    const job = jobs[0]
    if (!job) throw new NotFoundError('Ação do agente HA')
    if (job.status !== 'LEASED' || !job.leaseHash || !tokenMatches(job.leaseHash, input.leaseToken)) {
      throw new ConflictError('Lease inválido ou expirado para esta ação')
    }

    const action = job.action as HaAgentAction
    const actionDefinition = AGENT_ACTIONS[action]
    if (!actionDefinition) throw new ConflictError('Ação fora do catálogo permitido do agente')
    const message = input.message?.trim().slice(0, 500)
      || (input.success ? actionDefinition.successMessage : 'O agente não concluiu a ação.')
    if (action === 'ARM_PROMOTION') {
      const params = parseJson<Record<string, string>>(job.paramsJson, {})
      const primaryNodeId = params.primaryNodeId
      if (!primaryNodeId || !/^[A-Za-z0-9-]{8,64}$/.test(primaryNodeId)) {
        throw new ConflictError('Job de promoção não contém um primário válido')
      }
      const quiesceJobId = randomUUID()
      const armedSteps = [
        { key: 'preflight', label: 'Preflight recente aprovado', status: 'ok' },
        { key: 'arm-promotion', label: 'Armar promoção no standby', status: input.success ? 'ok' : 'failed', message },
        {
          key: 'quiesce-primary',
          label: 'Congelar o primário e liberar a VIP',
          status: input.success ? 'required' : 'failed',
          message: input.success ? 'Promoção persistida; aguardando o agente do primário.' : 'O primário não será congelado.',
        },
        { key: 'promote-standby', label: 'Validar witness e promover o standby', status: input.success ? 'required' : 'failed' },
        { key: 'reconcile-roles', label: 'Confirmar topologia e reconciliar papéis', status: 'required' },
      ]
      const statements = [
        this.db.$executeRaw`
          UPDATE ha_agent_jobs
          SET status = ${input.success ? 'COMPLETED' : 'FAILED'},
              result_json = ${JSON.stringify({ success: input.success, message })},
              completed_at = NOW(3), lease_hash = NULL, lease_expires_at = NULL, updated_at = NOW(3)
          WHERE id = ${jobId}
        `,
        this.db.$executeRaw`
          UPDATE ha_operations
          SET status = ${input.success ? 'RUNNING' : 'FAILED'},
              current_stage = ${input.success ? 'QUIESCE_QUEUED' : 'PROMOTION_ARM_FAILED'},
              steps_json = ${JSON.stringify(armedSteps)},
              error_layer = ${input.success ? null : 'arm-promotion'},
              error_message = ${input.success ? null : message},
              finished_at = ${input.success ? null : new Date()},
              updated_at = NOW(3)
          WHERE id = ${job.operationId}
        `,
      ]
      if (input.success) {
        statements.splice(1, 0, this.db.$executeRaw`
          INSERT INTO ha_agent_jobs (
            id, tenant_id, node_id, operation_id, action, status, attempts, params_json,
            created_at, updated_at
          )
          SELECT ${quiesceJobId}, tenant_id, ${primaryNodeId}, operation_id,
            'QUIESCE_PRIMARY', 'PENDING', 0, params_json, NOW(3), NOW(3)
          FROM ha_agent_jobs WHERE id = ${jobId}
        `)
      }
      await this.db.$transaction(statements)
      return { accepted: true }
    }
    if (action === 'QUIESCE_PRIMARY' && input.success) {
      const switchoverSteps = [
        { key: 'preflight', label: 'Preflight recente aprovado', status: 'ok' },
        { key: 'arm-promotion', label: 'Armar promoção no standby', status: 'ok' },
        {
          key: 'quiesce-primary',
          label: 'Congelar o primário e liberar a VIP',
          status: 'required',
          message,
        },
        {
          key: 'promote-standby',
          label: 'Validar witness e promover o standby',
          status: 'required',
          message: 'Promoção local armada; aguardando a origem ficar somente leitura e sem VIP.',
        },
        {
          key: 'reconcile-roles',
          label: 'Confirmar topologia e reconciliar papéis',
          status: 'required',
        },
      ]
      await this.db.$transaction([
        this.db.$executeRaw`
          UPDATE ha_agent_jobs
          SET
            status = 'COMPLETED',
            result_json = ${JSON.stringify({ success: true, message })},
            completed_at = NOW(3),
            lease_hash = NULL,
            lease_expires_at = NULL,
            updated_at = NOW(3)
          WHERE id = ${jobId}
        `,
        this.db.$executeRaw`
          UPDATE ha_operations
          SET
            current_stage = 'AWAITING_LOCAL_PROMOTION',
            steps_json = ${JSON.stringify(switchoverSteps)},
            updated_at = NOW(3)
          WHERE id = ${job.operationId}
        `,
      ])
      return { accepted: true }
    }
    if (action === 'PROMOTE_STANDBY') {
      const switchoverSteps = [
        { key: 'preflight', label: 'Preflight recente aprovado', status: 'ok' },
        {
          key: 'quiesce-primary',
          label: 'Congelar o primário e liberar a VIP',
          status: 'ok',
        },
        {
          key: 'promote-standby',
          label: 'Validar witness e promover o standby',
          status: input.success ? 'ok' : 'failed',
          message,
        },
        {
          key: 'reconcile-roles',
          label: 'Confirmar topologia e reconciliar papéis',
          status: input.success ? 'required' : 'failed',
          message: input.success
            ? 'Aguarde os dois heartbeats e confirme os papéis observados no painel.'
            : 'Não reconcilie papéis até diagnosticar a promoção.',
        },
      ]
      await this.db.$transaction([
        this.db.$executeRaw`
          UPDATE ha_agent_jobs
          SET
            status = ${input.success ? 'COMPLETED' : 'FAILED'},
            result_json = ${JSON.stringify({ success: input.success, message })},
            completed_at = NOW(3),
            lease_hash = NULL,
            lease_expires_at = NULL,
            updated_at = NOW(3)
          WHERE id = ${jobId}
        `,
        this.db.$executeRaw`
          UPDATE ha_operations
          SET
            status = ${input.success ? 'COMPLETED' : 'FAILED'},
            current_stage = ${input.success ? 'AWAITING_ROLE_RECONCILIATION' : 'PROMOTION_FAILED'},
            steps_json = ${JSON.stringify(switchoverSteps)},
            error_layer = ${input.success ? null : 'promote-standby'},
            error_message = ${input.success ? null : message},
            finished_at = NOW(3),
            updated_at = NOW(3)
          WHERE id = ${job.operationId}
        `,
      ])
      return { accepted: true }
    }
    const steps = [
      {
        key: 'approval',
        label: 'Aprovação explícita',
        status: 'ok',
        message: `Ação limitada ao catálogo ${action}.`,
      },
      {
        key: actionDefinition.stepKey,
        label: actionDefinition.stepLabel,
        status: input.success ? 'ok' : 'failed',
        message,
      },
    ]
    await this.db.$transaction([
      this.db.$executeRaw`
        UPDATE ha_agent_jobs
        SET
          status = ${input.success ? 'COMPLETED' : 'FAILED'},
          result_json = ${JSON.stringify({ success: input.success, message })},
          params_json = CASE WHEN action = 'APPLY_SHARED_SECRETS' THEN NULL ELSE params_json END,
          completed_at = NOW(3),
          lease_hash = NULL,
          lease_expires_at = NULL,
          updated_at = NOW(3)
        WHERE id = ${jobId}
      `,
      this.db.$executeRaw`
        UPDATE ha_operations
        SET
          status = ${input.success ? 'COMPLETED' : 'FAILED'},
          current_stage = ${input.success ? 'COMPLETED' : 'FAILED'},
          steps_json = ${JSON.stringify(steps)},
          error_layer = ${input.success ? null : actionDefinition.stepKey},
          error_message = ${input.success ? null : message},
          finished_at = NOW(3),
          updated_at = NOW(3)
        WHERE id = ${job.operationId}
      `,
    ])
    return { accepted: true }
  }

  private async findById(id: string): Promise<HaNodeRow | null> {
    const rows = await this.db.$queryRaw<HaNodeRow[]>`
      SELECT
        id,
        tenant_id AS tenantId,
        name,
        endpoint,
        desired_role AS desiredRole,
        observed_role AS observedRole,
        owns_vip AS ownsVip,
        virtual_ip AS virtualIp,
        status,
        promotion_ready AS promotionReady,
        blockers_json AS blockersJson,
        components_json AS componentsJson,
        inventory_json AS inventoryJson,
        agent_public_key AS agentPublicKey,
        enrollment_hash AS enrollmentHash,
        enrollment_expires AS enrollmentExpires,
        enrolled_at AS enrolledAt,
        last_seen_at AS lastSeenAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM ha_nodes WHERE id = ${id} LIMIT 1
    `
    return rows[0] ?? null
  }

  private toPublic(row: HaNodeRow) {
    const heartbeatAgeMs = row.lastSeenAt ? Math.max(0, Date.now() - row.lastSeenAt.getTime()) : null
    const stale = heartbeatAgeMs == null || heartbeatAgeMs > HEARTBEAT_STALE_MS
    const delayed = heartbeatAgeMs != null && heartbeatAgeMs > HEARTBEAT_DELAYED_MS
    const blockers = parseJson<string[]>(row.blockersJson, [])
    const components = parseJson<Record<string, HaComponentReport>>(row.componentsJson, {})
    const notices: string[] = []
    if (components.orchestration?.status === 'degraded' && components.orchestration.message) {
      notices.push(components.orchestration.message)
    }
    if (stale && row.enrolledAt) blockers.unshift('Heartbeat do agente HA está atrasado')
    if (!row.enrolledAt) blockers.unshift('Agente HA ainda não foi matriculado')
    return {
      id: row.id,
      name: row.name,
      endpoint: row.endpoint,
      desiredRole: row.desiredRole,
      observedRole: row.observedRole,
      ownsVip: parseBool(row.ownsVip),
      virtualIp: row.virtualIp,
      status: stale ? (row.enrolledAt ? 'OFFLINE' : 'PENDING') : row.status,
      promotionReady: !stale && parseBool(row.promotionReady),
      blockers,
      notices,
      heartbeatAgeSeconds: heartbeatAgeMs == null ? null : Math.floor(heartbeatAgeMs / 1000),
      heartbeatState: stale ? 'STALE' : delayed ? 'DELAYED' : 'CURRENT',
      components,
      inventory: parseJson<HaNodeInventory | null>(row.inventoryJson, null),
      secureProvisioningReady: Boolean(row.agentPublicKey),
      enrolledAt: row.enrolledAt,
      lastSeenAt: row.lastSeenAt,
      createdAt: row.createdAt,
    }
  }
}
