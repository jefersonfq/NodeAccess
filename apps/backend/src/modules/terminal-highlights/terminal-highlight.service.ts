import type { PrismaClient, Prisma, TerminalHighlightTemplate, TerminalHighlightTemplateVersion } from '@prisma/client'
import { TerminalHighlightRulesSchema, type SaveTerminalHighlightPreferenceDto, type SaveTerminalHighlightTemplateDto, type TerminalHighlightRule, type TerminalHighlightTelemetryDto } from '@nodeaccess/shared'
import type { AppEventBus } from '../app-events/app-event.bus.js'
import { BadRequestError, NotFoundError } from '../../shared/errors.js'

const CACHE_TTL_MS = 30_000
const cache = new Map<string, { expiresAt: number; value: EffectiveHighlights }>()

type AssignmentSource = 'direct' | 'group' | 'personal'

type EffectiveHighlights = {
  enabled: boolean
  rules: Array<TerminalHighlightRule & { source: 'personal' | 'template'; assignment: AssignmentSource; templateId: number | null; templateName: string | null }>
  templates: Array<{ id: number; name: string; version: number; assignment: 'direct' | 'group' }>
  omittedRules: number
  version: string
  limits: { maxRules: number; budgetMs: number; maxMatchesPerPass: number }
}

function validateRules(input: unknown): TerminalHighlightRule[] {
  const rules = TerminalHighlightRulesSchema.parse(input)
  for (const rule of rules) {
    if (rule.mode !== 'regex') continue
    if (/\([^)]*[+*][^)]*\)[+*{]/.test(rule.pattern) || /([+*])\1/.test(rule.pattern)) {
      throw new BadRequestError(`Regex potencialmente custoso na regra "${rule.name}"`)
    }
    try { new RegExp(rule.pattern, rule.caseSensitive ? 'g' : 'gi') } catch {
      throw new BadRequestError(`Regex inválido na regra "${rule.name}"`)
    }
  }
  return rules
}

function cacheKey(tenantId: number, userId: number): string { return `${tenantId}:${userId}` }

export class TerminalHighlightService {
  constructor(private readonly db: PrismaClient, private readonly events: AppEventBus) {
    this.events.onEvent((event) => {
      if (event.type === 'user_acl_membership_changed') {
        cache.delete(cacheKey(event.tenantId, event.userId))
        return
      }
      if (event.type !== 'terminal_highlights_changed') return
      if (event.userIds.length === 0) {
        for (const key of cache.keys()) if (key.startsWith(`${event.tenantId}:`)) cache.delete(key)
      } else {
        event.userIds.forEach((userId) => cache.delete(cacheKey(event.tenantId, userId)))
      }
    })
  }

  async effective(tenantId: number, userId: number): Promise<EffectiveHighlights> {
    const key = cacheKey(tenantId, userId)
    const hit = cache.get(key)
    if (hit && hit.expiresAt > Date.now()) return hit.value
    const [preference, assignments, groupTemplates] = await Promise.all([
      this.db.terminalHighlightPreference.findUnique({ where: { userId } }),
      this.db.terminalHighlightAssignment.findMany({
        where: { userId, template: { tenantId, active: true } },
        include: { template: true },
        orderBy: { template: { name: 'asc' } },
      }),
      this.db.terminalHighlightTemplate.findMany({
        where: { tenantId, active: true, groupAssignments: { some: { group: { users: { some: { userId } } } } } },
        include: { groupAssignments: true }, orderBy: { name: 'asc' },
      }),
    ])
    if (preference && preference.tenantId !== tenantId) throw new NotFoundError('Preferência não encontrada')
    const personal = validateRules(preference?.rulesJson ?? [])
    const directIds = new Set(assignments.map(({ template }) => template.id))
    const assignedTemplates = [...new Map([...assignments.map(({ template }) => template), ...groupTemplates].map((template) => [template.id, template])).values()]
      .sort((a, b) => a.id - b.id)
    const assignmentFor = (id: number): 'direct' | 'group' => directIds.has(id) ? 'direct' : 'group'
    const templateRules = assignedTemplates.flatMap((template) => validateRules(template.rulesJson).map((rule) => ({
      ...rule, source: 'template' as const, assignment: assignmentFor(template.id), templateId: template.id, templateName: template.name,
    })))
    const personalRules = personal.map((rule) => ({ ...rule, source: 'personal' as const, assignment: 'personal' as const, templateId: null, templateName: null }))
    const rank: Record<AssignmentSource, number> = { direct: 0, group: 1, personal: 2 }
    // Stable ordering preserves rule order within a template on equal priority.
    const orderedRules = [...templateRules, ...personalRules]
      .filter((rule) => rule.enabled)
      .sort((a, b) => rank[a.assignment] - rank[b.assignment] || b.priority - a.priority)
    const rules = orderedRules.slice(0, 40)
    const templates = assignedTemplates.map((template) => ({ id: template.id, name: template.name, version: template.version, assignment: assignmentFor(template.id) }))
    const value: EffectiveHighlights = {
      enabled: preference?.enabled ?? true,
      rules,
      templates,
      omittedRules: Math.max(0, orderedRules.length - rules.length),
      version: `v2:${preference?.version ?? 0}:${templates.map((item) => `${item.id}.${item.version}.${item.assignment}`).join(',')}`,
      limits: { maxRules: 40, budgetMs: 8, maxMatchesPerPass: 120 },
    }
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value })
    return value
  }

  async effectiveForUser(tenantId: number, userId: number): Promise<EffectiveHighlights> {
    const user = await this.db.user.findFirst({ where: { id: userId, tenantId, deletedAt: null }, select: { id: true } })
    if (!user) throw new NotFoundError('Usuário')
    return this.effective(tenantId, user.id)
  }

  cacheStatus(tenantId: number): { ttlMs: number; entries: number; oldestExpiresAt: string | null; } {
    const entries = [...cache.entries()].filter(([key]) => key.startsWith(`${tenantId}:`))
    return { ttlMs: CACHE_TTL_MS, entries: entries.length, oldestExpiresAt: entries.length ? new Date(Math.min(...entries.map(([, item]) => item.expiresAt))).toISOString() : null }
  }

  async clearTenantCache(tenantId: number, actorId: number): Promise<void> {
    for (const key of cache.keys()) if (key.startsWith(`${tenantId}:`)) cache.delete(key)
    await this.events.publish({ type: 'terminal_highlights_changed', tenantId, userIds: [], actorId, changedAt: new Date().toISOString() })
  }

  async getPreference(tenantId: number, userId: number): GetPreferenceResult {
    const row = await this.db.terminalHighlightPreference.findUnique({ where: { userId } })
    if (row && row.tenantId !== tenantId) throw new NotFoundError('Preferência não encontrada')
    return { enabled: row?.enabled ?? true, rules: validateRules(row?.rulesJson ?? []), version: row?.version ?? 0 }
  }

  async savePreference(tenantId: number, userId: number, dto: SaveTerminalHighlightPreferenceDto): SavePreferenceResult {
    const rules = validateRules(dto.rules)
    const row = await this.db.terminalHighlightPreference.upsert({
      where: { userId },
      create: { userId, tenantId, enabled: dto.enabled, rulesJson: rules },
      update: { enabled: dto.enabled, rulesJson: rules, version: { increment: 1 } },
    })
    cache.delete(cacheKey(tenantId, userId))
    await this.events.publish({ type: 'terminal_highlights_changed', tenantId, userIds: [userId], actorId: userId, changedAt: new Date().toISOString() })
    return { enabled: row.enabled, rules, version: row.version }
  }

  async listTemplates(tenantId: number): ListTemplatesResult {
    const rows = await this.db.terminalHighlightTemplate.findMany({
      where: { tenantId }, include: { assignments: { select: { userId: true } }, groupAssignments: { select: { groupId: true } } }, orderBy: { name: 'asc' },
    })
    return rows.map((row) => ({ ...row, rules: validateRules(row.rulesJson), rulesJson: undefined, userIds: row.assignments.map((item) => item.userId), groupIds: row.groupAssignments.map((item) => item.groupId), assignments: undefined, groupAssignments: undefined }))
  }

  async saveTemplate(tenantId: number, actorId: number, id: number | null, dto: SaveTerminalHighlightTemplateDto): SaveTemplateResult {
    const rules = validateRules(dto.rules)
    const validUsers = await this.db.user.findMany({ where: { tenantId, id: { in: dto.userIds }, deletedAt: null }, select: { id: true } })
    if (validUsers.length !== dto.userIds.length) throw new BadRequestError('Um ou mais usuários não pertencem ao tenant')
    const requestedGroupIds = dto.groupIds ?? []
    const validGroups = await this.db.group.findMany({ where: { tenantId, id: { in: requestedGroupIds } }, select: { id: true, users: { select: { userId: true } } } })
    if (validGroups.length !== requestedGroupIds.length) throw new BadRequestError('Um ou mais grupos não pertencem ao tenant')
    const previous = id ? await this.db.terminalHighlightTemplate.findFirst({ where: { id, tenantId }, include: { assignments: true, groupAssignments: { include: { group: { include: { users: true } } } } } }) : null
    if (id && !previous) throw new NotFoundError('Template não encontrado')
    const userIds = validUsers.map((item) => item.id)
    const groupIds = validGroups.map((item) => item.id)
    const template = await this.db.$transaction(async (tx) => {
      const saved = id
        ? await tx.terminalHighlightTemplate.update({ where: { id }, data: { name: dto.name, description: dto.description ?? null, active: dto.active, rulesJson: rules, version: { increment: 1 } } })
        : await tx.terminalHighlightTemplate.create({ data: { tenantId, createdByUserId: actorId, name: dto.name, description: dto.description ?? null, active: dto.active, rulesJson: rules } })
      await tx.terminalHighlightAssignment.deleteMany({ where: { templateId: saved.id } })
      if (userIds.length) await tx.terminalHighlightAssignment.createMany({ data: userIds.map((userId) => ({ templateId: saved.id, userId })) })
      await tx.terminalHighlightGroupAssignment.deleteMany({ where: { templateId: saved.id } })
      if (groupIds.length) await tx.terminalHighlightGroupAssignment.createMany({ data: groupIds.map((groupId) => ({ templateId: saved.id, groupId })) })
      await tx.terminalHighlightTemplateVersion.create({ data: { templateId: saved.id, tenantId, version: saved.version, name: saved.name, description: saved.description, active: saved.active, rulesJson: rules, userIdsJson: userIds, groupIdsJson: groupIds, actorId } })
      return saved
    })
    const previousGroupUsers = previous?.groupAssignments.flatMap((item) => item.group.users.map((member) => member.userId)) ?? []
    const groupUsers = validGroups.flatMap((group) => group.users.map((member) => member.userId))
    const affected = [...new Set([...(previous?.assignments.map((item) => item.userId) ?? []), ...previousGroupUsers, ...userIds, ...groupUsers])]
    affected.forEach((userId) => cache.delete(cacheKey(tenantId, userId)))
    await this.events.publish({ type: 'terminal_highlights_changed', tenantId, userIds: affected, actorId, changedAt: new Date().toISOString() })
    return { ...template, rules, userIds, groupIds }
  }

  async duplicateTemplate(tenantId: number, actorId: number, id: number): DuplicateTemplateResult {
    const source = await this.db.terminalHighlightTemplate.findFirst({ where: { id, tenantId }, include: { assignments: true, groupAssignments: true } })
    if (!source) throw new NotFoundError('Template não encontrado')
    let name = `${source.name} — cópia`
    const exists = await this.db.terminalHighlightTemplate.findFirst({ where: { tenantId, name } })
    if (exists) name = `${name} ${Date.now()}`
    return this.saveTemplate(tenantId, actorId, null, { name, description: source.description, active: false, rules: validateRules(source.rulesJson), userIds: [], groupIds: [] })
  }

  async listTemplateVersions(tenantId: number, id: number): ListTemplateVersionsResult {
    const template = await this.db.terminalHighlightTemplate.findFirst({ where: { id, tenantId }, select: { id: true } })
    if (!template) throw new NotFoundError('Template não encontrado')
    const rows = await this.db.terminalHighlightTemplateVersion.findMany({ where: { templateId: id, tenantId }, orderBy: { version: 'desc' }, take: 20 })
    return rows.map((row) => ({ ...row, id: row.id.toString(), rules: validateRules(row.rulesJson), rulesJson: undefined, userIds: row.userIdsJson, groupIds: row.groupIdsJson }))
  }

  async restoreTemplateVersion(tenantId: number, actorId: number, id: number, version: number): RestoreTemplateVersionResult {
    const row = await this.db.terminalHighlightTemplateVersion.findFirst({ where: { templateId: id, tenantId, version } })
    if (!row) throw new NotFoundError('Versão não encontrada')
    return this.saveTemplate(tenantId, actorId, id, { name: row.name, description: row.description, active: row.active, rules: validateRules(row.rulesJson), userIds: row.userIdsJson as number[], groupIds: row.groupIdsJson as number[] })
  }

  async removeTemplate(tenantId: number, actorId: number, id: number): Promise<void> {
    const template = await this.db.terminalHighlightTemplate.findFirst({ where: { id, tenantId }, include: { assignments: true, groupAssignments: { include: { group: { include: { users: true } } } } } })
    if (!template) throw new NotFoundError('Template não encontrado')
    await this.db.terminalHighlightTemplate.delete({ where: { id } })
    const userIds = [...new Set([...template.assignments.map((item) => item.userId), ...template.groupAssignments.flatMap((item) => item.group.users.map((user) => user.userId))])]
    userIds.forEach((userId) => cache.delete(cacheKey(tenantId, userId)))
    await this.events.publish({ type: 'terminal_highlights_changed', tenantId, userIds, actorId, changedAt: new Date().toISOString() })
  }

  async recordTelemetry(tenantId: number, userId: number, dto: TerminalHighlightTelemetryDto): Promise<void> {
    if (dto.durationMs < 4 && !dto.budgetExceeded) return
    await this.db.terminalHighlightTelemetry.createMany({ data: (dto.templateIds.length ? dto.templateIds : [null]).map((templateId) => ({ tenantId, userId, templateId, durationMs: dto.durationMs, bytesProcessed: dto.bytesProcessed, matchCount: dto.matchCount, ruleCount: dto.ruleCount, matchedRuleIds: dto.matchedRuleIds, budgetExceeded: dto.budgetExceeded })) })
  }

  async telemetrySummary(tenantId: number): Promise<{ averageMs: number; health: string; hotRuleIds: { ruleId: string; hits: number; }[]; recommendation: string; templateId: number | null; samples: number; maximumMs: number; budgetExceededCount: number; }[]> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60_000)
    const rows = await this.db.terminalHighlightTelemetry.findMany({
      where: { tenantId, createdAt: { gte: since } },
      select: { templateId: true, durationMs: true, budgetExceeded: true, matchedRuleIds: true },
      orderBy: { createdAt: 'desc' }, take: 5_000,
    })
    const grouped = new Map<number | null, { templateId: number | null; samples: number; totalMs: number; maximumMs: number; budgetExceededCount: number; ruleHits: Map<string, number> }>()
    for (const row of rows) {
      const current = grouped.get(row.templateId) ?? { templateId: row.templateId, samples: 0, totalMs: 0, maximumMs: 0, budgetExceededCount: 0, ruleHits: new Map<string, number>() }
      current.samples += 1
      current.totalMs += row.durationMs
      current.maximumMs = Math.max(current.maximumMs, row.durationMs)
      if (row.budgetExceeded) current.budgetExceededCount += 1
      for (const ruleId of Array.isArray(row.matchedRuleIds) ? row.matchedRuleIds.filter((item): item is string => typeof item === 'string') : []) current.ruleHits.set(ruleId, (current.ruleHits.get(ruleId) ?? 0) + 1)
      grouped.set(row.templateId, current)
    }
    return [...grouped.values()].map(({ totalMs, ruleHits, ...row }) => {
      const averageMs = totalMs / row.samples
      const health = row.budgetExceededCount > Math.max(2, row.samples * 0.1) ? 'review' : averageMs >= 4 ? 'attention' : 'healthy'
      const hotRuleIds = [...ruleHits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([ruleId, hits]) => ({ ruleId, hits }))
      return { ...row, averageMs, health, hotRuleIds, recommendation: health === 'review' ? 'Revise as regras mais acionadas, regex amplas ou divida o template.' : health === 'attention' ? 'Acompanhe o custo antes de ampliar a atribuição.' : 'Custo dentro do orçamento.' }
    })
  }

  async adoptionSummary(tenantId: number): Promise<{ configuredUsers: number; disabledUsers: number; templates: number; userAssignments: number; groupAssignments: number; activeUsers30d: number; }> {
    const [configuredUsers, disabledUsers, templates, userAssignments, groupAssignments, activeUsers] = await Promise.all([
      this.db.terminalHighlightPreference.count({ where: { tenantId, rulesJson: { not: [] } } }),
      this.db.terminalHighlightPreference.count({ where: { tenantId, enabled: false } }),
      this.db.terminalHighlightTemplate.count({ where: { tenantId } }),
      this.db.terminalHighlightAssignment.count({ where: { template: { tenantId } } }),
      this.db.terminalHighlightGroupAssignment.count({ where: { template: { tenantId } } }),
      this.db.terminalHighlightTelemetry.groupBy({ by: ['userId'], where: { tenantId, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60_000) } } }),
    ])
    return { configuredUsers, disabledUsers, templates, userAssignments, groupAssignments, activeUsers30d: activeUsers.length }
  }
}


type GetPreferenceResult = Promise<{ enabled: boolean; rules: TerminalHighlightRule[]; version: number }>
type SavePreferenceResult = GetPreferenceResult
type TemplateRules = { rules: TerminalHighlightRule[]; userIds: number[]; groupIds: number[] }
type ListTemplatesResult = Promise<Array<Omit<TerminalHighlightTemplate, 'rulesJson'> & TemplateRules & { rulesJson: undefined; assignments: undefined; groupAssignments: undefined }>>
type SaveTemplateResult = Promise<TerminalHighlightTemplate & TemplateRules>
type DuplicateTemplateResult = SaveTemplateResult
type RestoreTemplateVersionResult = SaveTemplateResult
type ListTemplateVersionsResult = Promise<Array<Omit<TerminalHighlightTemplateVersion, 'id' | 'rulesJson'> & { id: string; rules: TerminalHighlightRule[]; rulesJson: undefined; userIds: Prisma.JsonValue; groupIds: Prisma.JsonValue }>>
