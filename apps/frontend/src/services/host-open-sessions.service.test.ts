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


it('can switch tenant repeatedly without deleting connections hidden by the current projection', () => {
 const sessions = Object.freeze([
  Object.freeze({ id: 'local-a', hostId: 10, tenantId: 7 }),
  Object.freeze({ id: 'popup-b', hostId: 11, tenantId: 8 }),
  Object.freeze({ id: 'legacy', hostId: 12, tenantId: null }),
 ])
 for (const tenantId of [7, 8, 7, 8, 7]) {
  const visible = filterHostSessionsForTenant([...sessions], tenantId, new Set())
  expect(visible.map(item => item.id)).toEqual(tenantId === 7 ? ['local-a'] : ['popup-b'])
  expect(visible[0]).toBe(sessions[tenantId === 7 ? 0 : 1])
 }
 expect(sessions).toHaveLength(3)
 expect(filterHostSessionsForTenant([...sessions], 7, new Set([12])).map(item => item.id)).toEqual(['local-a', 'legacy'])
})

it('does not expose a known foreign session merely because its host appears in an old host cache', () => {
 expect(filterHostSessionsForTenant([{ id: 'foreign', hostId: 10, tenantId: 8 }], 7, new Set([10]))).toEqual([])
})
