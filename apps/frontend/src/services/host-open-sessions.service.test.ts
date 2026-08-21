import { describe, expect, it } from 'vitest'
import { filterHostSessionsForTenant, resolveOpenSessionsAction } from './host-open-sessions.service'

describe('host open session projection', () => {
  const sessions = [
    { id: 'local', hostId: 10, tenantId: 7 },
    { id: 'detached', hostId: 11, tenantId: 7 },
    { id: 'foreign', hostId: 12, tenantId: 8 },
    { id: 'legacy-visible', hostId: 13, tenantId: null },
    { id: 'legacy-hidden', hostId: 14, tenantId: null },
  ]

  it('combines local and detached sessions without leaking another tenant', () => {
    expect(filterHostSessionsForTenant(sessions, 7, new Set([10, 11, 13])).map((item) => item.id))
      .toEqual(['local', 'detached', 'legacy-visible'])
  })

  it('shows no control at zero and routes users/admins to their expected destination', () => {
    expect(resolveOpenSessionsAction(false, 0)).toBe('none')
    expect(resolveOpenSessionsAction(false, 2)).toBe('terminal')
    expect(resolveOpenSessionsAction(true, 2)).toBe('admin-report')
  })
})
