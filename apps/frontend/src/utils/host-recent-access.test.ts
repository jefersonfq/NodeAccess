import { describe, expect, it } from 'vitest'
import { exactRecentAccess, formatRecentAccess } from './host-recent-access'

const now = new Date('2026-09-23T15:00:00.000Z').getTime()
describe('host recent access formatting', () => {
  it.each([
    ['2026-09-23T14:59:40.000Z', 'Último acesso agora'],
    ['2026-09-23T14:42:00.000Z', 'Último acesso há 18 min'],
    ['2026-09-23T12:00:00.000Z', 'Último acesso há 3 h'],
    ['2026-09-22T14:00:00.000Z', 'Último acesso ontem'],
  ])('formats %s relatively', (value, expected) => expect(formatRecentAccess(value, false, now, 'pt-BR')).toBe(expected))
  it('prioritizes active state and handles missing history', () => {
    expect(formatRecentAccess(null, true, now)).toBe('Sessão ativa')
    expect(formatRecentAccess(null, false, now)).toBe('Sem sessão registrada')
  })
  it('provides an exact localized timestamp for tooltips', () => expect(exactRecentAccess('2026-09-23T12:00:00.000Z')).toContain('2026'))
})
