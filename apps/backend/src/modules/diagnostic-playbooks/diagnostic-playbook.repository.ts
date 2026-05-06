import { Prisma, type PrismaClient } from '@prisma/client'
import type {
  CreateDiagnosticPlaybookDto,
  DiagnosticPlaybookPublic,
  UpdateDiagnosticPlaybookDto,
} from '@nodeaccess/shared'
import { ConflictError, NotFoundError } from '../../shared/errors.js'

const DEFAULT_CATALOG: CreateDiagnosticPlaybookDto[] = [
  {
    slug: 'linux-network-baseline',
    name: 'Rede basica Linux',
    description: 'Coleta conectividade, rotas, DNS e conexoes abertas para um diagnostico inicial de rede.',
    category: 'network',
    riskLevel: 'low',
    targetOs: 'linux',
    requiresApproval: true,
    enabled: true,
    commands: [
      { id: 'hostname', label: 'Host', command: 'hostnamectl', timeoutSeconds: 10 },
      { id: 'ip-address', label: 'Interfaces', command: 'ip addr', timeoutSeconds: 10 },
      { id: 'routes', label: 'Rotas', command: 'ip route', timeoutSeconds: 10 },
      { id: 'dns', label: 'DNS', command: 'resolvectl status || cat /etc/resolv.conf', timeoutSeconds: 10 },
      { id: 'connections', label: 'Conexoes', command: 'ss -tunap', timeoutSeconds: 15 },
    ],
  },
  {
    slug: 'linux-cpu-memory-baseline',
    name: 'CPU, memoria e processos',
    description: 'Resume carga, memoria, swap e processos dominantes para investigar lentidao geral.',
    category: 'compute',
    riskLevel: 'low',
    targetOs: 'linux',
    requiresApproval: true,
    enabled: true,
    commands: [
      { id: 'uptime', label: 'Carga', command: 'uptime', timeoutSeconds: 10 },
      { id: 'memory', label: 'Memoria', command: 'free -m', timeoutSeconds: 10 },
      { id: 'vmstat', label: 'VMStat', command: 'vmstat 1 5', timeoutSeconds: 15 },
      { id: 'top', label: 'Top processos', command: 'ps -eo pid,ppid,comm,%cpu,%mem --sort=-%cpu | head -20', timeoutSeconds: 10 },
    ],
  },
  {
    slug: 'linux-disk-baseline',
    name: 'Disco e filesystem',
    description: 'Verifica uso de disco, inodes, mounts e consumo dos principais volumes.',
    category: 'storage',
    riskLevel: 'low',
    targetOs: 'linux',
    requiresApproval: true,
    enabled: true,
    commands: [
      { id: 'df', label: 'Uso de disco', command: 'df -h', timeoutSeconds: 10 },
      { id: 'inodes', label: 'Inodes', command: 'df -i', timeoutSeconds: 10 },
      { id: 'mounts', label: 'Mounts', command: 'mount | head -50', timeoutSeconds: 10 },
      { id: 'largest', label: 'Maiores diretorios', command: 'du -xh / --max-depth=1 2>/dev/null | sort -h | tail -20', timeoutSeconds: 20 },
    ],
  },
  {
    slug: 'linux-mysql-baseline',
    name: 'MySQL basico',
    description: 'Coleta estado inicial do servico MySQL, conexoes e sinais simples de sobrecarga.',
    category: 'mysql',
    riskLevel: 'low',
    targetOs: 'linux',
    requiresApproval: true,
    enabled: true,
    commands: [
      { id: 'service-status', label: 'Servico', command: 'systemctl status mysql --no-pager || systemctl status mysqld --no-pager', timeoutSeconds: 15 },
      { id: 'version', label: 'Versao', command: 'mysql --version', timeoutSeconds: 10 },
      { id: 'processlist', label: 'Processlist', command: 'mysql -e "show processlist;"', timeoutSeconds: 15 },
      { id: 'threads', label: 'Threads conectadas', command: `mysql -e "show global status like 'Threads_connected';"`, timeoutSeconds: 15 },
    ],
  },
]

type DiagnosticPlaybookRow = {
  id: number
  slug: string
  name: string
  description: string
  category: string
  riskLevel: string
  targetOs: string
  requiresApproval: boolean
  enabled: boolean
  version: number
  createdAt: Date
  updatedAt: Date
  definitionJson: string
}

function mapFallbackCatalog(): DiagnosticPlaybookPublic[] {
  return DEFAULT_CATALOG.map((item, index): DiagnosticPlaybookPublic => ({
    id: index + 1,
    slug: item.slug,
    name: item.name,
    description: item.description,
    category: item.category,
    riskLevel: item.riskLevel,
    targetOs: item.targetOs,
    requiresApproval: item.requiresApproval,
    enabled: item.enabled,
    version: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    commands: item.commands,
  }))
}

function mapRow(row: DiagnosticPlaybookRow): DiagnosticPlaybookPublic {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: String(row.category).toLowerCase() as DiagnosticPlaybookPublic['category'],
    riskLevel: String(row.riskLevel).toLowerCase() as DiagnosticPlaybookPublic['riskLevel'],
    targetOs: row.targetOs as DiagnosticPlaybookPublic['targetOs'],
    requiresApproval: row.requiresApproval,
    enabled: row.enabled,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    commands: parseDefinition(row.definitionJson),
  }
}

function parseDefinition(value: string): DiagnosticPlaybookPublic['commands'] {
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed as DiagnosticPlaybookPublic['commands']
    }
  } catch {
    return []
  }
  return []
}

function toDbCategory(value: DiagnosticPlaybookPublic['category']) {
  return value.toUpperCase() as never
}

function toDbRiskLevel(value: DiagnosticPlaybookPublic['riskLevel']) {
  return value.toUpperCase() as never
}

export class DiagnosticPlaybookRepository {
  constructor(private readonly db: PrismaClient) {}

  async listCatalog(
    tenantId: number,
    options: {
      includeDisabled?: boolean
    } = {},
  ): Promise<DiagnosticPlaybookPublic[]> {
    try {
      await this.ensureTenantDefaults(tenantId)
      const rows = await this.db.diagnosticPlaybook.findMany({
        where: {
          tenantId,
          ...(options.includeDisabled ? {} : { enabled: true }),
        },
        orderBy: [
          { enabled: 'desc' },
          { name: 'asc' },
        ],
      })
      return rows.map((row) => mapRow({
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        category: row.category,
        riskLevel: row.riskLevel,
        targetOs: row.targetOs,
        requiresApproval: row.requiresApproval,
        enabled: row.enabled,
        version: row.version,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        definitionJson: row.definitionJson,
      }))
    } catch (error) {
      if (this.isMissingTableError(error)) {
        const fallback = mapFallbackCatalog()
        return options.includeDisabled ? fallback : fallback.filter((item) => item.enabled)
      }
      throw error
    }
  }

  async findById(
    tenantId: number,
    id: number,
    options: {
      includeDisabled?: boolean
    } = {},
  ): Promise<DiagnosticPlaybookPublic | null> {
    try {
      await this.ensureTenantDefaults(tenantId)
      const row = await this.db.diagnosticPlaybook.findFirst({
        where: {
          id,
          tenantId,
          ...(options.includeDisabled ? {} : { enabled: true }),
        },
      })
      if (!row) return null
      return mapRow({
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        category: row.category,
        riskLevel: row.riskLevel,
        targetOs: row.targetOs,
        requiresApproval: row.requiresApproval,
        enabled: row.enabled,
        version: row.version,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        definitionJson: row.definitionJson,
      })
    } catch (error) {
      if (this.isMissingTableError(error)) {
        const fallback = mapFallbackCatalog()
        return fallback.find((item) => item.id === id && (options.includeDisabled || item.enabled)) ?? null
      }
      throw error
    }
  }

  async create(tenantId: number, dto: CreateDiagnosticPlaybookDto): Promise<DiagnosticPlaybookPublic> {
    try {
      const row = await this.db.diagnosticPlaybook.create({
        data: {
          tenantId,
          slug: dto.slug,
          name: dto.name,
          description: dto.description,
          category: toDbCategory(dto.category),
          riskLevel: toDbRiskLevel(dto.riskLevel),
          targetOs: dto.targetOs,
          requiresApproval: dto.requiresApproval,
          enabled: dto.enabled,
          version: 1,
          definitionJson: JSON.stringify(dto.commands),
        },
      })
      return mapRow({
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        category: row.category,
        riskLevel: row.riskLevel,
        targetOs: row.targetOs,
        requiresApproval: row.requiresApproval,
        enabled: row.enabled,
        version: row.version,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        definitionJson: row.definitionJson,
      })
    } catch (error) {
      if (this.isMissingTableError(error)) {
        throw new ConflictError('A tabela de playbooks de diagnostico ainda nao esta disponivel. Aplique a migration antes de gerenciar o catalogo.')
      }
      if (this.isUniqueError(error)) {
        throw new ConflictError('Ja existe um playbook com esse slug neste tenant')
      }
      throw error
    }
  }

  async update(tenantId: number, id: number, dto: UpdateDiagnosticPlaybookDto): Promise<DiagnosticPlaybookPublic> {
    const current = await this.getDbRowOrThrow(tenantId, id)
    try {
      const row = await this.db.diagnosticPlaybook.update({
        where: { id: current.id },
        data: {
          ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.category !== undefined ? { category: toDbCategory(dto.category) } : {}),
          ...(dto.riskLevel !== undefined ? { riskLevel: toDbRiskLevel(dto.riskLevel) } : {}),
          ...(dto.targetOs !== undefined ? { targetOs: dto.targetOs } : {}),
          ...(dto.requiresApproval !== undefined ? { requiresApproval: dto.requiresApproval } : {}),
          ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
          ...(dto.commands !== undefined ? { definitionJson: JSON.stringify(dto.commands) } : {}),
        },
      })
      return mapRow({
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        category: row.category,
        riskLevel: row.riskLevel,
        targetOs: row.targetOs,
        requiresApproval: row.requiresApproval,
        enabled: row.enabled,
        version: row.version,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        definitionJson: row.definitionJson,
      })
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictError('Ja existe um playbook com esse slug neste tenant')
      }
      throw error
    }
  }

  async delete(tenantId: number, id: number): Promise<void> {
    const current = await this.getDbRowOrThrow(tenantId, id)
    await this.db.diagnosticPlaybook.delete({ where: { id: current.id } })
  }

  private async getDbRowOrThrow(tenantId: number, id: number) {
    try {
      const row = await this.db.diagnosticPlaybook.findFirst({
        where: { id, tenantId },
      })
      if (!row) throw new NotFoundError('Playbook de diagnostico')
      return row
    } catch (error) {
      if (this.isMissingTableError(error)) {
        throw new ConflictError('A tabela de playbooks de diagnostico ainda nao esta disponivel. Aplique a migration antes de gerenciar o catalogo.')
      }
      throw error
    }
  }

  private async ensureTenantDefaults(tenantId: number): Promise<void> {
    const existingCount = await this.db.diagnosticPlaybook.count({ where: { tenantId } })
    if (existingCount > 0) return
    await this.db.diagnosticPlaybook.createMany({
      data: DEFAULT_CATALOG.map((item) => ({
        tenantId,
        slug: item.slug,
        name: item.name,
        description: item.description,
        category: toDbCategory(item.category),
        riskLevel: toDbRiskLevel(item.riskLevel),
        targetOs: item.targetOs,
        requiresApproval: item.requiresApproval,
        enabled: item.enabled,
        version: 1,
        definitionJson: JSON.stringify(item.commands),
      })),
      skipDuplicates: true,
    })
  }

  private isMissingTableError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021'
  }

  private isUniqueError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  }
}
