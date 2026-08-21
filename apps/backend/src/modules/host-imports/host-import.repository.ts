import { Prisma, type PrismaClient } from '@prisma/client'

export interface HostImportJobRow {
  id: number
  tenantId: number
  actorId: number
  actorName: string
  previewId: string
  source: string
  status: 'PREVIEWED' | 'COMMITTED' | 'REVERTED' | 'PARTIALLY_REVERTED'
  detectedHosts: number
  readyHosts: number
  blockedHosts: number
  createdHosts: number
  updatedHosts: number
  createdFolders: number
  impactJson: string | null
  snapshotJson: string | null
  createdAt: Date
  completedAt: Date | null
  revertedAt: Date | null
}

export class HostImportRepository {
  constructor(private readonly db: PrismaClient) {}

  async createPreview(input: {
    tenantId: number; actorId: number; previewId: string; source: string
    detectedHosts: number; readyHosts: number; blockedHosts: number; impact: unknown
  }): Promise<number> {
    await this.db.$executeRaw`
      INSERT INTO host_import_jobs (tenant_id, actor_id, preview_id, source, status, detected_hosts, ready_hosts, blocked_hosts, impact_json, updated_at)
      VALUES (${input.tenantId}, ${input.actorId}, ${input.previewId}, ${input.source}, 'PREVIEWED', ${input.detectedHosts}, ${input.readyHosts}, ${input.blockedHosts}, ${JSON.stringify(input.impact)}, NOW(3))
    `
    const rows = await this.db.$queryRaw<Array<{ id: number }>>`SELECT id FROM host_import_jobs WHERE preview_id = ${input.previewId} LIMIT 1`
    return Number(rows[0]?.id)
  }

  async markCommitted(previewId: string, input: { createdHosts: number; updatedHosts: number; createdFolders: number; snapshot: unknown }): Promise<number | null> {
    await this.db.$executeRaw`
      UPDATE host_import_jobs SET status = 'COMMITTED', created_hosts = ${input.createdHosts}, updated_hosts = ${input.updatedHosts},
        created_folders = ${input.createdFolders}, snapshot_json = ${JSON.stringify(input.snapshot)}, completed_at = NOW(3), updated_at = NOW(3)
      WHERE preview_id = ${previewId}
    `
    const rows = await this.db.$queryRaw<Array<{ id: number }>>`SELECT id FROM host_import_jobs WHERE preview_id = ${previewId} LIMIT 1`
    return rows[0] ? Number(rows[0].id) : null
  }

  async list(tenantId: number): Promise<HostImportJobRow[]> {
    return this.db.$queryRaw<HostImportJobRow[]>(Prisma.sql`
      SELECT j.id, j.tenant_id AS tenantId, j.actor_id AS actorId, u.name AS actorName, j.preview_id AS previewId,
        j.source, j.status, j.detected_hosts AS detectedHosts, j.ready_hosts AS readyHosts, j.blocked_hosts AS blockedHosts,
        j.created_hosts AS createdHosts, j.updated_hosts AS updatedHosts, j.created_folders AS createdFolders,
        j.impact_json AS impactJson, j.snapshot_json AS snapshotJson, j.created_at AS createdAt,
        j.completed_at AS completedAt, j.reverted_at AS revertedAt
      FROM host_import_jobs j JOIN users u ON u.id = j.actor_id
      WHERE j.tenant_id = ${tenantId} AND j.status <> 'PREVIEWED'
      ORDER BY j.created_at DESC LIMIT 100
    `)
  }

  async findById(tenantId: number, id: number): Promise<HostImportJobRow | null> {
    const rows = await this.db.$queryRaw<HostImportJobRow[]>(Prisma.sql`
      SELECT j.id, j.tenant_id AS tenantId, j.actor_id AS actorId, u.name AS actorName, j.preview_id AS previewId,
        j.source, j.status, j.detected_hosts AS detectedHosts, j.ready_hosts AS readyHosts, j.blocked_hosts AS blockedHosts,
        j.created_hosts AS createdHosts, j.updated_hosts AS updatedHosts, j.created_folders AS createdFolders,
        j.impact_json AS impactJson, j.snapshot_json AS snapshotJson, j.created_at AS createdAt,
        j.completed_at AS completedAt, j.reverted_at AS revertedAt
      FROM host_import_jobs j JOIN users u ON u.id = j.actor_id
      WHERE j.tenant_id = ${tenantId} AND j.id = ${id} LIMIT 1
    `)
    return rows[0] ?? null
  }

  async markReverted(id: number, partial: boolean): Promise<void> {
    await this.db.$executeRaw`
      UPDATE host_import_jobs SET status = ${partial ? 'PARTIALLY_REVERTED' : 'REVERTED'}, reverted_at = NOW(3), updated_at = NOW(3)
      WHERE id = ${id}
    `
  }
}
