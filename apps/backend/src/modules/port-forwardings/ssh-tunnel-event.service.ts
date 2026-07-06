import { Prisma, type PrismaClient } from '@prisma/client'

export type SshTunnelEventType = 'WEB' | 'TUNNEL'

export interface RecordSshTunnelEventInput {
  tenantId: number
  userId: number
  eventType: SshTunnelEventType
  remoteHost: string
  remotePort: number
  forwardingId?: number
  hostId?: number
  label?: string | null | undefined
  hostName?: string | null | undefined
  localPort?: number
  usedPortFallback?: boolean
  metadata?: Record<string, unknown> | undefined
}

export class SshTunnelEventService {
  constructor(private readonly db: PrismaClient) {}

  async record(input: RecordSshTunnelEventInput): Promise<void> {
    if (!input.remoteHost || !Number.isInteger(input.remotePort)) return
    await this.db.$executeRaw(Prisma.sql`
      INSERT INTO local_access_events (
        tenant_id,
        user_id,
        forwarding_id,
        host_id,
        event_type,
        label_snapshot,
        host_name_snapshot,
        remote_host_snapshot,
        remote_port_snapshot,
        local_port_snapshot,
        used_port_fallback,
        metadata_json
      )
      VALUES (
        ${input.tenantId},
        ${input.userId},
        ${input.forwardingId ?? null},
        ${input.hostId ?? null},
        ${input.eventType},
        ${input.label ?? null},
        ${input.hostName ?? null},
        ${input.remoteHost},
        ${input.remotePort},
        ${input.localPort ?? null},
        ${input.usedPortFallback ?? null},
        ${input.metadata === undefined ? null : JSON.stringify(input.metadata)}
      )
    `)
  }
}
