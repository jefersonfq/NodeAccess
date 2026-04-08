import type { PrismaClient } from '@prisma/client'

const SESSION_HEARTBEAT_STALE_MS = 2 * 60 * 1000

export function getSessionStaleBefore(now = new Date()): Date {
  return new Date(now.getTime() - SESSION_HEARTBEAT_STALE_MS)
}

export async function endStaleActiveSessions(
  db: PrismaClient,
  staleBefore = getSessionStaleBefore(),
): Promise<number> {
  const endedAt = new Date()
  const auditRepairBefore = new Date(endedAt.getTime() - 30_000)
  const endedCount = await db.$executeRaw`
    UPDATE sessions
    SET active = false, ended_at = ${endedAt}
    WHERE active = true AND last_seen_at < ${staleBefore}
  `

  await db.$executeRaw`
    UPDATE session_audits sa
    INNER JOIN sessions s ON s.id = sa.session_id
    SET
      sa.ended_at = COALESCE(sa.ended_at, s.ended_at, ${endedAt}),
      sa.status = ${'FAILED'},
      sa.updated_at = NOW()
    WHERE sa.status = ${'RUNNING'}
      AND s.active = false
      AND (
        s.last_seen_at < ${staleBefore}
        OR s.ended_at < ${auditRepairBefore}
      )
  `

  return Number(endedCount)
}
