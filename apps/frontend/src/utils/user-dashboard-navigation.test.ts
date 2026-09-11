import { describe, expect, it } from 'vitest'
import { buildSessionReportRoute, buildTimelineReportRoute } from './user-dashboard-navigation'

describe('user dashboard contextual navigation', () => {
  it('encaminha um ponto de falha para sessoes do usuario naquele dia', () => {
    expect(buildSessionReportRoute({ userId: 42, date: '2026-08-24', hasError: true })).toEqual({
      name: 'admin-reports-sessions',
      query: {
        userId: '42', hostId: undefined, periodDays: undefined,
        dateFrom: '2026-08-24T00:00:00.000Z', dateTo: '2026-08-25T00:00:00.000Z', hasError: 'true',
        source: 'user-dashboard',
      },
    })
  })

  it('encaminha top host para sessoes do usuario, host e periodo', () => {
    expect(buildSessionReportRoute({ userId: 42, hostId: 7, periodDays: 30 })).toMatchObject({
      name: 'admin-reports-sessions',
      query: { userId: '42', hostId: '7', periodDays: '30' },
    })
  })

  it('abre diretamente a auditoria quando a timeline tem sessao', () => {
    expect(buildTimelineReportRoute({
      id: 'audit-99', type: 'audit', title: 'Auditoria', description: 'Concluida',
      hostDeleted: false, occurredAt: new Date('2026-08-24T10:00:00.000Z'), severity: 'success', sessionId: 99,
    }, 42)).toEqual({
      name: 'admin-session-audit-detail',
      params: { sessionId: '99' },
      query: { source: 'user-dashboard' },
    })
  })

  it('encaminha evento de acesso para logs autenticados do usuario', () => {
    expect(buildTimelineReportRoute({
      id: 'auth-7', type: 'auth', title: 'Login na plataforma', description: 'Acesso autenticado',
      hostDeleted: false, occurredAt: new Date('2026-08-24T10:00:00.000Z'), severity: 'success', sessionId: null,
    }, 42, 'ana@example.test')).toEqual({
      name: 'admin-logs',
      query: { tab: 'auth', search: 'ana@example.test', source: 'user-dashboard' },
    })
  })
})
