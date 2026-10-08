import { Prisma, type PrismaClient } from '@prisma/client'
import { SessionAuditCommandSchema, SessionAuditReconstructionSchema, type SessionAuditCommand, type SessionAuditReconstruction } from '@nodeaccess/shared'
import type { AuditSnapshot } from './session-audit-reconstruction.js'

export interface AuditReconstructionStore {
  save(tenantId:number,sessionId:number,snapshot:AuditSnapshot):Promise<SessionAuditReconstruction>
  history(tenantId:number,sessionId:number):Promise<SessionAuditReconstruction[]>
  commands(tenantId:number,sessionId:number,id:string):Promise<SessionAuditCommand[] | null>
}
const json=(value:unknown):unknown=>typeof value==='string'?JSON.parse(value):value
export class SessionAuditReconstructionRepository implements AuditReconstructionStore {
  constructor(private readonly db:PrismaClient) {}
  async save(tenantId:number,sessionId:number,snapshot:AuditSnapshot):Promise<SessionAuditReconstruction> {
    const m={...snapshot.metadata,persisted:true}
    return this.db.$transaction(async tx=>{
      const inserted=await tx.$executeRaw(Prisma.sql`INSERT IGNORE INTO session_audit_reconstructions (id,tenant_id,session_id,processor_version,source_fingerprint,metadata)
        SELECT ${m.id}, ${tenantId}, sa.session_id, ${m.processorVersion}, ${m.sourceFingerprint}, ${JSON.stringify(m)} FROM session_audits sa
        WHERE sa.tenant_id=${tenantId} AND sa.session_id=${sessionId} AND sa.status IN ('COMPLETED','FAILED')`)
      if (inserted) {
      let batch: Prisma.Sql[] = [], batchBytes = 0
      const flush = async (): Promise<void> => {
        if (!batch.length) return
        await tx.$executeRaw(Prisma.sql`INSERT INTO session_audit_derived_commands (run_id,tenant_id,command_index,command_text,payload) VALUES ${Prisma.join(batch)}`)
        batch = []; batchBytes = 0
      }
      for (const {command,...payload} of snapshot.commands) {
        const encoded = JSON.stringify(payload)
        const bytes = Buffer.byteLength(command) + Buffer.byteLength(encoded)
        if (batch.length && (batch.length >= 100 || batchBytes + bytes > 1024 * 1024)) await flush()
        batch.push(Prisma.sql`(${m.id},${tenantId},${payload.index},${command},${encoded})`)
        batchBytes += bytes
      }
      await flush()
      }
      const saved=await tx.$queryRaw<Array<{metadata:unknown}>>(Prisma.sql`SELECT metadata FROM session_audit_reconstructions WHERE id=${m.id} AND tenant_id=${tenantId} AND session_id=${sessionId} LIMIT 1`)
      if(!saved[0])throw new Error('Reconstruction was not persisted')
      return SessionAuditReconstructionSchema.parse(json(saved[0].metadata))
    },{timeout:30000})
  }
  async history(tenantId:number,sessionId:number):Promise<SessionAuditReconstruction[]> {
    // MySQL can prefer the source-uniqueness index and filesort all versions.
    // This bounded query has equality on both leading columns of this index.
    const rows=await this.db.$queryRaw<Array<{metadata:unknown}>>(Prisma.sql`SELECT r.metadata FROM session_audit_reconstructions r FORCE INDEX (audit_reconstruction_tenant_session_idx)
      JOIN session_audits a ON a.session_id=r.session_id AND a.tenant_id=r.tenant_id
      WHERE r.tenant_id=${tenantId} AND r.session_id=${sessionId} AND a.status <> 'PURGED'
      ORDER BY r.created_at DESC,r.id DESC LIMIT 20`)
    return rows.map(r=>SessionAuditReconstructionSchema.parse(json(r.metadata)))
  }
  async commands(tenantId:number,sessionId:number,id:string):Promise<SessionAuditCommand[] | null> {
    // One authorized indexed read for nonempty versions. An inner join avoids
    // MySQL materializing and sorting potentially large command payloads.
    const rows=await this.db.$queryRaw<Array<{commandText:string;payload:unknown}>>(Prisma.sql`SELECT c.command_text AS commandText,c.payload
      FROM session_audit_reconstructions r
      JOIN session_audits a ON a.session_id=r.session_id AND a.tenant_id=r.tenant_id
      JOIN session_audit_derived_commands c ON c.run_id=r.id AND c.tenant_id=r.tenant_id
      WHERE r.id=${id} AND r.tenant_id=${tenantId} AND r.session_id=${sessionId} AND a.status <> 'PURGED'
      ORDER BY c.command_index ASC`)
    if(!rows.length) {
      // Only empty/missing versions need a second query. It returns no command
      // data and rechecks retention, distinguishing [] from inaccessible null.
      const runs=await this.db.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT r.id FROM session_audit_reconstructions r
        JOIN session_audits a ON a.session_id=r.session_id AND a.tenant_id=r.tenant_id
        WHERE r.id=${id} AND r.tenant_id=${tenantId} AND r.session_id=${sessionId} AND a.status <> 'PURGED' LIMIT 1`)
      return runs.length?[]:null
    }
    return rows.map(r=>SessionAuditCommandSchema.parse({...json(r.payload) as Record<string,unknown>,command:r.commandText}))
  }
}
