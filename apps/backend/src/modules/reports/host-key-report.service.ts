import type { HostKeyEventRow, HostKeyReportFilters, HostKeyReportRepository } from './host-key-report.repository.js'

function toNumber(value: number | bigint | null | undefined) {
  return Number(value ?? 0)
}

function parseDetails(details: string | null) {
  if (!details) return { previousFingerprint: null, nextFingerprint: null }
  try {
    const parsed = JSON.parse(details) as Record<string, unknown>
    return {
      previousFingerprint: typeof parsed.previousFingerprint === 'string' ? parsed.previousFingerprint : null,
      nextFingerprint: typeof parsed.nextFingerprint === 'string' ? parsed.nextFingerprint : null,
    }
  } catch {
    return { previousFingerprint: null, nextFingerprint: null }
  }
}

function mapEvent(row: HostKeyEventRow) {
  const details = parseDetails(row.details)
  return {
    id: row.id,
    action: row.action,
    timestamp: row.timestamp.toISOString(),
    userId: row.userId,
    userName: row.userName,
    userEmail: row.userEmail,
    hostId: row.hostId,
    hostName: row.hostName,
    hostIp: row.hostIp,
    hostPort: row.hostPort,
    hostScope: row.hostScope,
    hostDeleted: row.hostDeletedAt !== null,
    previousFingerprint: details.previousFingerprint,
    nextFingerprint: details.nextFingerprint,
    currentFingerprint: row.currentFingerprint,
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
  }
}

export class HostKeyReportService {
  constructor(private readonly repo: HostKeyReportRepository) {}

  async getHostKeyReport(tenantId: number, filters: HostKeyReportFilters) {
    const result = await this.repo.getReport(tenantId, filters)
    const summary = result.summary

    return {
      summary: {
        totalHosts: toNumber(summary?.totalHosts),
        trustedHosts: toNumber(summary?.trustedHosts),
        missingHosts: toNumber(summary?.missingHosts),
        trustedEvents: toNumber(summary?.trustedEvents),
        updatedEvents: toNumber(summary?.updatedEvents),
        uniqueHostsWithEvents: toNumber(summary?.uniqueHostsWithEvents),
      },
      missingHosts: result.missingHosts.map((row) => ({
        hostId: row.hostId,
        hostName: row.hostName,
        hostIp: row.hostIp,
        hostPort: row.hostPort,
        hostScope: row.hostScope,
      })),
      events: {
        data: result.events.map(mapEvent),
        total: result.total,
        page: result.page,
        limit: result.limit,
      },
    }
  }
}
