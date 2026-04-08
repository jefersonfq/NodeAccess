import type { PrismaClient, Prisma } from '@prisma/client'
import { endStaleActiveSessions } from './session-liveness.js'

export interface SessionFilters {
  search?: string
  active?: boolean
  page?:   number
  limit?:  number
}

const sessionInclude = {
  user: { select: { id: true, name: true, email: true } },
  host: { select: { id: true, name: true, ip: true } },
} as const

export type SessionRow = Prisma.SessionGetPayload<{ include: typeof sessionInclude }>

export class SessionsRepository {
  constructor(private readonly db: PrismaClient) {}

  async findAll(
    tenantId: number,
    filters: SessionFilters,
  ): Promise<{ sessions: SessionRow[]; total: number }> {
    const { search, active, page = 1, limit = 20 } = filters
    const skip = (page - 1) * limit

    const where: Prisma.SessionWhereInput = {
      user: { tenantId },
      ...(active !== undefined && { active }),
      ...(search && {
        OR: [
          { user: { name:  { contains: search } } },
          { host: { name:  { contains: search } } },
          { host: { ip:    { contains: search } } },
        ],
      }),
    }

    const [sessions, total] = await this.db.$transaction([
      this.db.session.findMany({
        where,
        include: sessionInclude,
        orderBy: { startedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.db.session.count({ where }),
    ])

    return { sessions, total }
  }

  async endStaleActive(staleBefore: Date): Promise<number> {
    return endStaleActiveSessions(this.db, staleBefore)
  }

  /** Encerra TODAS as sessões ativas globalmente (usado no startup do gateway). */
  async endAllActive(): Promise<number> {
    const result = await this.db.session.updateMany({
      where: { active: true },
      data:  { active: false, endedAt: new Date() },
    })
    return result.count
  }

  /** Encerra todas as sessões ativas de um tenant (cleanup manual pelo admin). */
  async endActiveSessions(tenantId: number): Promise<number> {
    const result = await this.db.session.updateMany({
      where: { active: true, user: { tenantId } },
      data:  { active: false, endedAt: new Date() },
    })
    return result.count
  }
}
