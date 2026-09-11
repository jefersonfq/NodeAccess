import type { PrismaClient } from '@prisma/client'
import type { Redis } from 'ioredis'
import type { JwtPayload } from '../../shared/guards.js'
import type { SshRepository } from '../ssh/ssh.repository.js'
import { ForbiddenError } from '../../shared/errors.js'

export class SessionSupervisionService {
  constructor(readonly db: PrismaClient, readonly redis: Redis, readonly ssh: SshRepository) {}
  async permission(userId: number, tenantId: number): Promise<boolean> {
    const rows = await this.db.$queryRaw<Array<{ enabled: number | boolean }>>`SELECT can_supervise_sessions AS enabled FROM users WHERE id = ${userId} AND tenant_id = ${tenantId} AND active = true AND deleted_at IS NULL`
    return rows[0]?.enabled === true || rows[0]?.enabled === 1
  }
  async assertUser(user: JwtPayload) {
    const current = await this.db.user.findFirst({ where: { id: Number(user.sub), tenantId: user.tenantId, active: true, deletedAt: null }, select: { sessionVersion: true, role: true, tenant: { select: { active: true } } } })
    if (!current?.tenant.active || current.sessionVersion !== (user.sessionVersion ?? 0) || !await this.permission(Number(user.sub), user.tenantId)) throw new ForbiddenError('Sem permissão para supervisionar sessões')
    return current.role
  }
  async authorize(user: JwtPayload, sessionId: number) {
    const role = await this.assertUser(user)
    const session = await this.db.session.findFirst({ where: { id: sessionId, active: true, endedAt: null, host: { tenantId: user.tenantId, deletedAt: null, accessProtocol: 'SSH' }, connectionMethod: { not: 'native_ssh_gateway' } }, select: { hostId: true } })
    if (!session || !await this.ssh.hasEffectiveHostPermission(session.hostId, user.tenantId, Number(user.sub), 'connect', role)) throw new ForbiddenError('Sessão encerrada ou fora do seu escopo')
    return session
  }
  async list(user: JwtPayload) {
    const role = await this.assertUser(user)
    const sessions = await this.db.session.findMany({ where: { active: true, endedAt: null, host: { tenantId: user.tenantId, deletedAt: null, accessProtocol: 'SSH' }, connectionMethod: { not: 'native_ssh_gateway' } }, select: { id: true, hostId: true, startedAt: true, host: { select: { name: true } }, user: { select: { name: true } } }, orderBy: { startedAt: 'desc' }, take: 200 })
    const allowed = await this.ssh.findHostIdsWithEffectivePermission(sessions.map(s => s.hostId), user.tenantId, Number(user.sub), 'connect', role)
    return sessions.filter(s => allowed.has(s.hostId))
  }
  async setPermission(admin: JwtPayload, userId: number, enabled: boolean) {
    const current = await this.db.user.findFirst({ where: { id: Number(admin.sub), tenantId: admin.tenantId, active: true, deletedAt: null }, select: { role: true, sessionVersion: true } })
    if (current?.role !== 'ADMIN' || current.sessionVersion !== (admin.sessionVersion ?? 0)) throw new ForbiddenError('Administração não autorizada')
    await this.db.$transaction(async tx => {
      const target = await tx.user.findFirst({ where: { id: userId, tenantId: admin.tenantId, deletedAt: null }, select: { id: true } })
      if (!target) throw new ForbiddenError('Usuário não encontrado neste tenant')
      await tx.$executeRaw`UPDATE users SET can_supervise_sessions = ${enabled} WHERE id = ${userId} AND tenant_id = ${admin.tenantId} AND deleted_at IS NULL`
      await tx.adminLog.create({ data: { adminId: Number(admin.sub), action: 'SESSION_SUPERVISION_PERMISSION_CHANGED', targetType: 'User', targetId: userId, details: JSON.stringify({ enabled, tenantId: admin.tenantId }) } })
    })
    // Distributed observers close immediately on permission changes.
    await this.redis.publish(`supervision:user:${admin.tenantId}:${userId}`, 'revoked')
  }
  async audit(user: JwtPayload, sessionId: number, action: string, reason: string, observationId: string) {
    await this.db.adminLog.create({ data: { adminId: Number(user.sub), action, targetType: 'Session', targetId: sessionId, details: JSON.stringify({ tenantId: user.tenantId, reason, observationId }) } })
  }
  publish(sessionId: number, data: Buffer | { cols: number; rows: number } | null) {
    if (data && !Buffer.isBuffer(data)) {
      if (!Number.isInteger(data.cols) || !Number.isInteger(data.rows) || data.cols < 1 || data.rows < 1 || data.cols > 1000 || data.rows > 1000) return
      void this.redis.set(`supervision:dimensions:${sessionId}`, JSON.stringify(data), 'EX', 86400).catch(() => {})
      void this.redis.publish(`supervision:session:${sessionId}`, JSON.stringify({ resize: data })).catch(() => {})
      return
    }
    if (data === null) void this.redis.del(`supervision:dimensions:${sessionId}`).catch(() => {})
    // Output already redacted by SSH gateway. No input path and no stored copy here.
    void this.redis.publish(`supervision:session:${sessionId}`, data === null ? JSON.stringify({ ended: true }) : JSON.stringify({ data: data.toString('base64') })).catch(() => {})
  }
}
