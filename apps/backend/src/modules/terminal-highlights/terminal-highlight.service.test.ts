import { createHighlightPreset, highlightPresets } from '../../../../frontend/src/services/terminal-highlight-presets.js'
import { describe, expect, it, vi } from 'vitest'
import type { TerminalHighlightRule } from '@nodeaccess/shared'
import { compileHighlightRules, matchTerminalLine } from '../../../../../apps/frontend/src/terminal/terminal-highlighter.js'
import { TerminalHighlightService } from './terminal-highlight.service.js'

let sequence = 0
function rule(patch: Partial<TerminalHighlightRule> = {}): TerminalHighlightRule {
  sequence += 1
  return { id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`, name: 'Avisos', pattern: 'WARNING', mode: 'literal', caseSensitive: false, wholeWord: true, foreground: 'amber', background: null, bold: true, enabled: true, priority: 50, ...patch }
}

type HighlightTestEvent = { type: 'terminal_highlights_changed'; tenantId: number; userIds: number[] } | { type: 'user_acl_membership_changed'; tenantId: number; userId: number }

function fixture() {
  let listener: ((event: HighlightTestEvent) => void) | undefined
  const events = {
    onEvent: vi.fn((callback: (event: HighlightTestEvent) => void) => { listener = callback }),
    publish: vi.fn().mockResolvedValue(undefined),
  }
  const db = {
    terminalHighlightPreference: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
    terminalHighlightAssignment: { findMany: vi.fn().mockResolvedValue([]) },
    terminalHighlightTemplate: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), delete: vi.fn(), count: vi.fn() },
    terminalHighlightTemplateVersion: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    terminalHighlightGroupAssignment: { count: vi.fn() },
    terminalHighlightTelemetry: { createMany: vi.fn().mockResolvedValue({ count: 1 }), findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn(), findFirst: vi.fn() }, group: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
  }
  return { db, events, service: new TerminalHighlightService(db as never, events as never), emit: (event: HighlightTestEvent) => listener?.(event) }
}

describe('TerminalHighlightService', () => {
  it('returns an enabled zero-cost default and caches repeated effective reads', async () => {
    const { db, service } = fixture()
    const first = await service.effective(9101, 9201)
    const second = await service.effective(9101, 9201)
    expect(first).toMatchObject({ enabled: true, rules: [], templates: [], limits: { maxRules: 40, budgetMs: 8, maxMatchesPerPass: 120 } })
    expect(second).toBe(first)
    expect(db.terminalHighlightPreference.findUnique).toHaveBeenCalledTimes(1)
    expect(db.terminalHighlightAssignment.findMany).toHaveBeenCalledTimes(1)
  })

  it('merges personal and assigned rules by priority while isolating tenant assignments', async () => {
    const { db, service } = fixture()
    db.terminalHighlightPreference.findUnique.mockResolvedValue({ tenantId: 9102, enabled: true, version: 3, rulesJson: [rule({ pattern: 'WARN', priority: 20 }), rule({ enabled: false, priority: 100 })] })
    db.terminalHighlightAssignment.findMany.mockResolvedValue([{ template: { id: 81, name: 'Operação', version: 4, rulesJson: [rule({ pattern: 'ERROR', priority: 90 })] } }])
    const result = await service.effective(9102, 9202)
    expect(result.rules.map((item) => [item.pattern, item.source])).toEqual([['ERROR', 'template'], ['WARN', 'personal']])
    expect(result.version).toBe('v2:3:81.4.direct')
    expect(db.terminalHighlightAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 9202, template: { tenantId: 9102, active: true } } }))
  })

  it('invalidates only affected cache entries when an application event arrives', async () => {
    const { db, service, emit } = fixture()
    await service.effective(9103, 9203)
    await service.effective(9103, 9204)
    emit({ type: 'terminal_highlights_changed', tenantId: 9103, userIds: [9203] })
    await service.effective(9103, 9203)
    await service.effective(9103, 9204)
    expect(db.terminalHighlightPreference.findUnique).toHaveBeenCalledTimes(3)
  })

  it('invalidates group-derived rules when user membership changes', async () => {
    const { db, service, emit } = fixture()
    await service.effective(9111, 9211)
    emit({ type: 'user_acl_membership_changed', tenantId: 9111, userId: 9211 })
    await service.effective(9111, 9211)
    expect(db.terminalHighlightPreference.findUnique).toHaveBeenCalledTimes(2)
  })

  it.each([
    { pattern: '(', expected: 'Regex inválido' },
    { pattern: '(a+)+', expected: 'Regex potencialmente custoso' },
  ])('rejects unsafe regex before persisting: $pattern', async ({ pattern, expected }) => {
    const { db, service } = fixture()
    await expect(service.savePreference(9104, 9205, { enabled: true, rules: [rule({ mode: 'regex', pattern })] })).rejects.toThrow(expected)
    expect(db.terminalHighlightPreference.upsert).not.toHaveBeenCalled()
  })

  it('persists a preference and notifies only that user', async () => {
    const { db, events, service } = fixture()
    db.terminalHighlightPreference.upsert.mockResolvedValue({ enabled: false, version: 2 })
    await service.savePreference(9105, 9206, { enabled: false, rules: [rule()] })
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'terminal_highlights_changed', tenantId: 9105, userIds: [9206], actorId: 9206 }))
  })

  it('rejects a template assignment when any user belongs outside the tenant', async () => {
    const { db, events, service } = fixture()
    db.user.findMany.mockResolvedValue([{ id: 2 }])
    await expect(service.saveTemplate(9106, 1, null, { name: 'Padrão', description: null, active: true, rules: [rule()], userIds: [2, 3], groupIds: [] })).rejects.toThrow('não pertencem ao tenant')
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(events.publish).not.toHaveBeenCalled()
  })

  it('drops cheap telemetry, stores degraded samples and aggregates the adoption health window', async () => {
    const { db, service } = fixture()
    const base = { templateIds: [81, 82], bytesProcessed: 4096, matchCount: 3, ruleCount: 8, matchedRuleIds: [] }
    await service.recordTelemetry(9107, 9207, { ...base, durationMs: 2, budgetExceeded: false })
    expect(db.terminalHighlightTelemetry.createMany).not.toHaveBeenCalled()
    await service.recordTelemetry(9107, 9207, { ...base, durationMs: 9, budgetExceeded: true })
    expect(db.terminalHighlightTelemetry.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ templateId: 81, durationMs: 9 }), expect.objectContaining({ templateId: 82, durationMs: 9 })] })
    db.terminalHighlightTelemetry.findMany.mockResolvedValue([
      { templateId: 81, durationMs: 6, budgetExceeded: false },
      { templateId: 81, durationMs: 10, budgetExceeded: true },
      { templateId: null, durationMs: 4, budgetExceeded: false },
    ])
    expect(await service.telemetrySummary(9107)).toEqual(expect.arrayContaining([
      expect.objectContaining({ templateId: 81, samples: 2, maximumMs: 10, budgetExceededCount: 1, averageMs: 8, health: 'attention' }),
      expect.objectContaining({ templateId: null, samples: 1, maximumMs: 4, budgetExceededCount: 0, averageMs: 4 }),
    ]))
  })

  it('resolves group assignments dynamically and deduplicates direct assignment', async () => {
    const { db, service } = fixture()
    const template = { id: 82, name: 'NOC', version: 1, rulesJson: [rule({ pattern: 'CRITICAL' })] }
    db.terminalHighlightAssignment.findMany.mockResolvedValue([{ template }])
    db.terminalHighlightTemplate.findMany.mockResolvedValue([{ ...template, groupAssignments: [{ groupId: 7 }] }])
    const effective = await service.effective(9108, 9208)
    expect(effective.templates).toEqual([{ id: 82, name: 'NOC', version: 1, assignment: 'direct' }])
    expect(effective.rules).toHaveLength(1)
    expect(db.terminalHighlightTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 9108, groupAssignments: expect.any(Object) as unknown }) as unknown }))
  })

  it('classifies repeated budget overruns as review', async () => {
    const { db, service } = fixture()
    db.terminalHighlightTelemetry.findMany.mockResolvedValue(Array.from({ length: 5 }, () => ({ templateId: 90, durationMs: 12, budgetExceeded: true })))
    expect(await service.telemetrySummary(9109)).toEqual([expect.objectContaining({ templateId: 90, health: 'review', recommendation: expect.stringContaining('regex') as unknown })])
  })

  it('persists group assignments, a restorable version and notifies group members', async () => {
    const { db, events, service } = fixture()
    db.user.findMany.mockResolvedValue([{ id: 2 }])
    db.group.findMany.mockResolvedValue([{ id: 7, users: [{ userId: 3 }, { userId: 4 }] }])
    const tx = {
      terminalHighlightTemplate: { create: vi.fn().mockResolvedValue({ id: 91, version: 1, name: 'NOC', description: null, active: true }) },
      terminalHighlightAssignment: { deleteMany: vi.fn(), createMany: vi.fn() },
      terminalHighlightGroupAssignment: { deleteMany: vi.fn(), createMany: vi.fn() },
      terminalHighlightTemplateVersion: { create: vi.fn() },
    }
    db.$transaction.mockImplementation((callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx))
    await service.saveTemplate(9110, 1, null, { name: 'NOC', description: null, active: true, rules: [rule()], userIds: [2], groupIds: [7] })
    expect(tx.terminalHighlightGroupAssignment.createMany).toHaveBeenCalledWith({ data: [{ templateId: 91, groupId: 7 }] })
    expect(tx.terminalHighlightTemplateVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({ templateId: 91, version: 1, userIdsJson: [2], groupIdsJson: [7] }) as unknown })
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({ userIds: expect.arrayContaining([2, 3, 4]) as unknown }))
  })
})


describe('highlight assignment precedence and administration', () => {
  it('applies direct > group > personal even against numeric priority and preserves unrelated matches', async () => {
    const { db, service } = fixture()
    db.terminalHighlightPreference.findUnique.mockResolvedValue({ tenantId: 9301, enabled: true, version: 1, rulesJson: [rule({ pattern: 'ERROR', priority: 100, foreground: 'amber' }), rule({ pattern: 'OK', foreground: 'green' })] })
    db.terminalHighlightAssignment.findMany.mockResolvedValue([{ template: { id: 1, name: 'Direto', version: 1, rulesJson: [rule({ pattern: 'ERROR', priority: 0, foreground: 'red' })] } }])
    db.terminalHighlightTemplate.findMany.mockResolvedValue([{ id: 2, name: 'Grupo', version: 1, rulesJson: [rule({ pattern: 'ERROR', priority: 100, foreground: 'blue' })] }])
    const result = await service.effective(9301, 1)
    expect(result.rules.map(r => r.assignment)).toEqual(['direct', 'group', 'personal', 'personal'])
    const ranges = matchTerminalLine('ERROR OK', compileHighlightRules(result.rules))
    expect(ranges.map(r => [r.x, r.foreground])).toEqual([[0, '#f87171'], [6, '#4ade80']])
    expect(db.terminalHighlightPreference.upsert).not.toHaveBeenCalled()
  })

  it('uses priority within a tier and stable template IDs and rule order for ties', async () => {
    const { db, service } = fixture()
    db.terminalHighlightAssignment.findMany.mockResolvedValue([
      { template: { id: 9, name: 'A', version: 1, rulesJson: [rule({ name: 'Newest', priority: 50 }), rule({ name: 'Highest', priority: 100 })] } },
      { template: { id: 2, name: 'Z', version: 1, rulesJson: [rule({ name: 'First', priority: 50 }), rule({ name: 'Second', priority: 50 })] } },
    ])
    expect((await service.effective(9302, 1)).rules.map(r => r.name)).toEqual(['Highest', 'First', 'Second', 'Newest'])
  })

  it('retains opt-out and reports rules omitted by the combined limit', async () => {
    const { db, service } = fixture()
    db.terminalHighlightPreference.findUnique.mockResolvedValue({ tenantId: 9303, enabled: false, version: 1, rulesJson: [rule({ priority: 100 })] })
    db.terminalHighlightAssignment.findMany.mockResolvedValue([{ template: { id: 1, name: 'Direto', version: 1, rulesJson: Array.from({ length: 40 }, () => rule({ priority: 0 })) } }])
    const result = await service.effective(9303, 1)
    expect(result.enabled).toBe(false)
    expect(result.rules).toHaveLength(40)
    expect(result.rules.every(r => r.assignment === 'direct')).toBe(true)
    expect(result.omittedRules).toBe(1)
  })

  it('checks tenant membership before any admin preview, including cached data', async () => {
    const { db, service } = fixture()
    db.user.findFirst.mockResolvedValue({ id: 4 })
    await service.effectiveForUser(9304, 4)
    expect(db.user.findFirst).toHaveBeenCalledWith({ where: { id: 4, tenantId: 9304, deletedAt: null }, select: { id: true } })
    db.user.findFirst.mockResolvedValue(null)
    await expect(service.effectiveForUser(9304, 4)).rejects.toThrow('Usuário não encontrado')
    expect(db.terminalHighlightPreference.findUnique).toHaveBeenCalledTimes(1)
  })

  it('rejects preference data belonging to another tenant', async () => {
    const { db, service } = fixture()
    db.terminalHighlightPreference.findUnique.mockResolvedValue({ tenantId: 999, rulesJson: [] })
    await expect(service.effective(9305, 1)).rejects.toThrow('Preferência não encontrada')
  })

  it('notifies both direct and group members on deletion and restores personal precedence', async () => {
    const { db, events, service } = fixture()
    db.terminalHighlightTemplate.findFirst.mockResolvedValue({ id: 1, assignments: [{ userId: 1 }], groupAssignments: [{ group: { users: [{ userId: 2 }, { userId: 1 }] } }] })
    await service.effective(9306, 2)
    await service.removeTemplate(9306, 10, 1)
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({ userIds: [1, 2] }))
    db.terminalHighlightPreference.findUnique.mockResolvedValue({ tenantId: 9306, enabled: true, rulesJson: [rule({ foreground: 'amber' })] })
    const result = await service.effective(9306, 2)
    expect(result.rules[0]!.assignment).toBe('personal')
    expect(db.terminalHighlightPreference.findUnique).toHaveBeenCalledTimes(2)
  })

  it('does not publish changes after a transaction failure', async () => {
    const { db, events, service } = fixture()
    db.user.findMany.mockResolvedValue([{ id: 1 }])
    db.$transaction.mockRejectedValue(new Error('database unavailable'))
    await expect(service.saveTemplate(9307, 1, null, { name: 'Test', active: true, rules: [], userIds: [1], groupIds: [] })).rejects.toThrow('database unavailable')
    expect(events.publish).not.toHaveBeenCalled()
  })

  it('rejects group assignments outside the tenant', async () => {
    const { db, service } = fixture()
    db.user.findMany.mockResolvedValue([])
    await expect(service.saveTemplate(9308, 1, null, { name: 'Test', active: true, rules: [], userIds: [], groupIds: [50] })).rejects.toThrow('grupos não pertencem ao tenant')
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})


it('falls back from direct to group to personal as assignments are removed without changing personal data', async () => {
  const { db, service, emit } = fixture()
  const direct = { id: 1, name: 'Direto', version: 1, rulesJson: [rule({ foreground: 'red' })] }
  const group = { id: 2, name: 'Grupo', version: 1, rulesJson: [rule({ foreground: 'blue' })] }
  db.terminalHighlightPreference.findUnique.mockResolvedValue({ tenantId: 9310, enabled: true, version: 1, rulesJson: [rule({ foreground: 'amber' })] })
  db.terminalHighlightAssignment.findMany.mockResolvedValue([{ template: direct }])
  db.terminalHighlightTemplate.findMany.mockResolvedValue([group])
  const color = async () => matchTerminalLine('WARNING', compileHighlightRules((await service.effective(9310, 1)).rules))[0]!.foreground
  expect(await color()).toBe('#f87171')
  db.terminalHighlightAssignment.findMany.mockResolvedValue([])
  emit({ type: 'terminal_highlights_changed', tenantId: 9310, userIds: [1] })
  expect(await color()).toBe('#60a5fa')
  db.terminalHighlightTemplate.findMany.mockResolvedValue([])
  emit({ type: 'user_acl_membership_changed', tenantId: 9310, userId: 1 })
  expect(await color()).toBe('#fbbf24')
  expect(db.terminalHighlightPreference.upsert).not.toHaveBeenCalled()
})


describe('highlight cache and assignment failure simulations', () => {
  it('does not cache failed reads and recovers on the next request', async () => {
    const { db, service } = fixture()
    db.terminalHighlightPreference.findUnique.mockRejectedValueOnce(new Error('database timeout'))
    await expect(service.effective(9501, 1)).rejects.toThrow('database timeout')
    expect((await service.effective(9501, 1)).rules).toEqual([])
    expect(db.terminalHighlightPreference.findUnique).toHaveBeenCalledTimes(2)
  })

  it('keeps the prior effective configuration when a preference write fails', async () => {
    const { db, events, service } = fixture()
    const before = await service.effective(9502, 1)
    db.terminalHighlightPreference.upsert.mockRejectedValue(new Error('write failed'))
    await expect(service.savePreference(9502, 1, { enabled: false, rules: [] })).rejects.toThrow('write failed')
    expect(await service.effective(9502, 1)).toBe(before)
    expect(events.publish).not.toHaveBeenCalled()
  })

  it('invalidates one tenant without flushing another tenant with the same user ID', async () => {
    const { db, service, emit } = fixture()
    const first = await service.effective(9503, 1)
    const second = await service.effective(9504, 1)
    emit({ type: 'terminal_highlights_changed', tenantId: 9503, userIds: [] })
    expect(await service.effective(9503, 1)).not.toBe(first)
    expect(await service.effective(9504, 1)).toBe(second)
    expect(db.terminalHighlightPreference.findUnique).toHaveBeenCalledTimes(3)
  })

  it('refreshes only after TTL on the next read, without background work', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    try {
      const { db, service } = fixture()
      const first = await service.effective(9505, 1)
      clock.mockReturnValue(1_029_999)
      expect(await service.effective(9505, 1)).toBe(first)
      clock.mockReturnValue(1_030_001)
      expect(db.terminalHighlightPreference.findUnique).toHaveBeenCalledTimes(1)
      expect(await service.effective(9505, 1)).not.toBe(first)
      expect(db.terminalHighlightPreference.findUnique).toHaveBeenCalledTimes(2)
    } finally { clock.mockRestore() }
  })

  it('removes disabled rules before the combined limit and never rewrites saved preferences', async () => {
    const { db, service } = fixture()
    db.terminalHighlightPreference.findUnique.mockResolvedValue({ tenantId: 9506, rulesJson: [rule({ name: 'Personal enabled' })] })
    db.terminalHighlightAssignment.findMany.mockResolvedValue([{ template: { id: 1, name: 'Disabled rules', version: 1, rulesJson: Array.from({ length: 40 }, () => rule({ enabled: false })) } }])
    const effective = await service.effective(9506, 1)
    expect(effective.rules.map(r => r.name)).toEqual(['Personal enabled'])
    expect(effective.omittedRules).toBe(0)
    expect(db.terminalHighlightPreference.upsert).not.toHaveBeenCalled()
  })

  it('notifies previous and new direct/group recipients when assignments change', async () => {
    const { db, events, service } = fixture()
    db.user.findMany.mockResolvedValue([{ id: 3 }])
    db.group.findMany.mockResolvedValue([{ id: 8, users: [{ userId: 4 }] }])
    db.terminalHighlightTemplate.findFirst.mockResolvedValue({ id: 1, assignments: [{ userId: 1 }], groupAssignments: [{ group: { users: [{ userId: 2 }] } }] })
    const tx = {
      terminalHighlightTemplate: { update: vi.fn().mockResolvedValue({ id: 1, version: 2, name: 'Moved', active: true }) },
      terminalHighlightAssignment: { deleteMany: vi.fn(), createMany: vi.fn() },
      terminalHighlightGroupAssignment: { deleteMany: vi.fn(), createMany: vi.fn() },
      terminalHighlightTemplateVersion: { create: vi.fn() },
    }
    db.$transaction.mockImplementation((callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx))
    await service.saveTemplate(9507, 10, 1, { name: 'Moved', active: true, rules: [], userIds: [3], groupIds: [8] })
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({ userIds: expect.arrayContaining([1, 2, 3, 4]) as unknown }))
    expect(tx.terminalHighlightTemplateVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({ version: 2, userIdsJson: [3], groupIdsJson: [8] }) as unknown })
  })

  it('does not delete or notify when the database refuses deletion', async () => {
    const { db, events, service } = fixture()
    db.terminalHighlightTemplate.findFirst.mockResolvedValue({ id: 1, assignments: [], groupAssignments: [] })
    db.terminalHighlightTemplate.delete.mockRejectedValue(new Error('database unavailable'))
    await expect(service.removeTemplate(9508, 1, 1)).rejects.toThrow('database unavailable')
    expect(events.publish).not.toHaveBeenCalled()
  })

  it('does not restore a version containing recipients that no longer belong to the tenant', async () => {
    const { db, service } = fixture()
    db.terminalHighlightTemplateVersion.findFirst.mockResolvedValue({ name: 'Old', active: true, rulesJson: [], userIdsJson: [99], groupIdsJson: [] })
    db.user.findMany.mockResolvedValue([])
    await expect(service.restoreTemplateVersion(9509, 1, 1, 2)).rejects.toThrow('usuários não pertencem ao tenant')
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})

for (const preset of highlightPresets) {
  it(`saves built-in ${preset.id} through existing validation, history and assignment events`, async () => {
    const { db, events, service } = fixture()
    db.user.findMany.mockResolvedValue([{ id: 2 }])
    db.group.findMany.mockResolvedValue([{ id: 7, users: [{ userId: 3 }] }])
    const tx = {
      terminalHighlightTemplate: { create: vi.fn().mockResolvedValue({ id: 91, version: 1, name: preset.name, active: true }) },
      terminalHighlightAssignment: { deleteMany: vi.fn(), createMany: vi.fn() },
      terminalHighlightGroupAssignment: { deleteMany: vi.fn(), createMany: vi.fn() },
      terminalHighlightTemplateVersion: { create: vi.fn() },
    }
    db.$transaction.mockImplementation((callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx))
    const draft = createHighlightPreset(preset.id, () => rule().id as `${string}-${string}-${string}-${string}-${string}`)
    const saved = await service.saveTemplate(9400, 1, null, { ...draft, active: true, userIds: [2], groupIds: [7] })
    expect(saved.rules).toEqual(draft.rules)
    expect(tx.terminalHighlightTemplateVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({ rulesJson: draft.rules, userIdsJson: [2], groupIdsJson: [7] }) as unknown })
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 9400, userIds: [2, 3] }))
  })
}
