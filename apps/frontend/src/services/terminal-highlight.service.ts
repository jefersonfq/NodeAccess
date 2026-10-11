import type { SaveTerminalHighlightPreferenceDto, SaveTerminalHighlightTemplateDto, TerminalHighlightRule, TerminalHighlightTelemetryDto } from '@nodeaccess/shared'
import api from './api'
import { createTimedPromiseCache } from './service-cache'

export type EffectiveTerminalHighlights = {
  enabled: boolean
  rules: Array<TerminalHighlightRule & { source: 'personal' | 'template'; assignment: 'direct' | 'group' | 'personal'; templateId: number | null; templateName: string | null }>
  templates: Array<{ id: number; name: string; version: number; assignment: 'direct' | 'group' }>
  omittedRules: number
  version: string
  limits: { maxRules: number; budgetMs: number; maxMatchesPerPass: number }
}
export type TerminalHighlightTemplate = { id: number; name: string; description: string | null; active: boolean; version: number; rules: TerminalHighlightRule[]; userIds: number[]; groupIds: number[]; updatedAt: string }
export type TerminalHighlightHealth = { templateId: number | null; samples: number; averageMs: number; maximumMs: number; budgetExceededCount: number; health: 'healthy' | 'attention' | 'review'; recommendation: string; hotRuleIds: Array<{ ruleId: string; hits: number }> }
export type TerminalHighlightAdoption = { configuredUsers: number; disabledUsers: number; templates: number; userAssignments: number; groupAssignments: number; activeUsers30d: number }
export type TerminalHighlightTemplateVersion = { id: string; version: number; name: string; description: string | null; active: boolean; rules: TerminalHighlightRule[]; userIds: number[]; groupIds: number[]; createdAt: string }

const effectiveCache = createTimedPromiseCache<{ data: EffectiveTerminalHighlights }>(30_000, { name: 'terminal-highlights:effective' })
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('nodeaccess-terminal-highlights-v1') : null

function invalidate(reason: string, broadcast = true, notify = true): void {
  effectiveCache.clear(reason)
  if (broadcast) channel?.postMessage({ type: 'invalidate' })
  if (notify) window.dispatchEvent(new CustomEvent('nodeaccess:terminal-highlights-invalidated'))
}
channel?.addEventListener('message', () => invalidate('broadcast', false))

export const terminalHighlightService = {
  effective(options: { fresh?: boolean } = {}): Promise<{ data: EffectiveTerminalHighlights; }> {
    if (options.fresh) effectiveCache.clear('fresh')
    return effectiveCache.get(() => api.get<EffectiveTerminalHighlights>('/terminal-highlights/effective'))
  },
  effectiveForUser: (userId: number): ReturnType<typeof api.get<EffectiveTerminalHighlights>> => api.get<EffectiveTerminalHighlights>(`/terminal-highlights/admin/users/${userId}/effective`),
  getPreference: (): ReturnType<typeof api.get<{ enabled: boolean; rules: TerminalHighlightRule[]; version: number }>> => api.get<{ enabled: boolean; rules: TerminalHighlightRule[]; version: number }>('/terminal-highlights/preference'),
  savePreference: (dto: SaveTerminalHighlightPreferenceDto): ReturnType<typeof api.put> => api.put('/terminal-highlights/preference', dto).then((response) => { invalidate('preference-save'); return response }),
  listTemplates: (): ReturnType<typeof api.get<TerminalHighlightTemplate[]>> => api.get<TerminalHighlightTemplate[]>('/terminal-highlights/admin/templates'),
  createTemplate: (dto: SaveTerminalHighlightTemplateDto): ReturnType<typeof api.post> => api.post('/terminal-highlights/admin/templates', dto).then((response) => { invalidate('template-create'); return response }),
  updateTemplate: (id: number, dto: SaveTerminalHighlightTemplateDto): ReturnType<typeof api.put> => api.put(`/terminal-highlights/admin/templates/${id}`, dto).then((response) => { invalidate('template-update'); return response }),
  removeTemplate: (id: number): ReturnType<typeof api.delete> => api.delete(`/terminal-highlights/admin/templates/${id}`).then((response) => { invalidate('template-remove'); return response }),
  duplicateTemplate: (id: number): ReturnType<typeof api.post> => api.post(`/terminal-highlights/admin/templates/${id}/duplicate`).then((response) => { invalidate('template-duplicate'); return response }),
  templateVersions: (id: number): ReturnType<typeof api.get<TerminalHighlightTemplateVersion[]>> => api.get<TerminalHighlightTemplateVersion[]>(`/terminal-highlights/admin/templates/${id}/versions`),
  restoreTemplateVersion: (id: number, version: number): ReturnType<typeof api.post> => api.post(`/terminal-highlights/admin/templates/${id}/versions/${version}/restore`).then((response) => { invalidate('template-restore'); return response }),
  telemetry: (dto: TerminalHighlightTelemetryDto): ReturnType<typeof api.post> => api.post('/terminal-highlights/telemetry', dto),
  telemetrySummary: (): ReturnType<typeof api.get<TerminalHighlightHealth[]>> => api.get<TerminalHighlightHealth[]>('/terminal-highlights/admin/telemetry'),
  adoptionSummary: (): ReturnType<typeof api.get<TerminalHighlightAdoption>> => api.get<TerminalHighlightAdoption>('/terminal-highlights/admin/adoption'),
  cacheStatus: (): ReturnType<typeof api.get<{ ttlMs: number; entries: number; oldestExpiresAt: string | null }>> => api.get<{ ttlMs: number; entries: number; oldestExpiresAt: string | null }>('/terminal-highlights/admin/cache'),
  clearCache: (): ReturnType<typeof api.delete> => api.delete('/terminal-highlights/admin/cache').then((response) => { invalidate('admin-clear'); return response }),
  invalidate,
}
