import { describe, expect, it } from 'vitest'
import { suggestPremiumTerminalCompletions } from './terminal-autocomplete-engine.service'
import { suggestContextualTerminalCompletions } from './terminal-contextual-autocomplete.service'

describe('premium terminal autocomplete engine', () => {
  it.each([
    ['systemctl ', 'systemctl status '],
    ['journalctl ', 'journalctl -u '],
    ['docker ', 'docker logs --tail 200 '],
    ['kubectl ', 'kubectl get pods -A'],
    ['git ', 'git status --short --branch'],
    ['ip ', 'ip -br address'],
  ])('provides contextual operational suggestions for %s', (line, expected) => {
    expect(suggestContextualTerminalCompletions(line).map((item) => item.value)).toContain(expected)
  })

  it('deduplicates providers, caps output and exposes context', () => {
    const items = suggestPremiumTerminalCompletions({ line: 'systemctl ', limit: 3 })
    expect(items).toHaveLength(3)
    expect(new Set(items.map((item) => item.value)).size).toBe(items.length)
    expect(items[0]?.contextLabel).toBe('systemd')
  })

  it('narrows contextual suggestions without duplicating the current command line', () => {
    expect(suggestContextualTerminalCompletions('systemctl sta').map((item) => item.value)).toEqual(['systemctl status '])
  })

  it('uses safe recent values as a ranking signal for deterministic commands', () => {
    const items = suggestPremiumTerminalCompletions({ line: '', recentValues: ['uptime'], limit: 8 })
    expect(items[0]?.value).toBe('uptime')
  })
})
