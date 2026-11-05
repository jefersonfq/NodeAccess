import { describe, expect, it } from 'vitest'
import { expandMcpActionModes, isMcpActionModeAllowed } from './mcp-action-mode-policy.js'

describe('MCP action mode hierarchy', () => {
  it.each([
    [['read_only'], ['read_only']],
    [['diagnostic_only'], ['read_only', 'diagnostic_only']],
    [['approval_required'], ['read_only', 'diagnostic_only', 'approval_required']],
    [['full_operational_access'], ['read_only', 'diagnostic_only', 'approval_required', 'full_operational_access']],
  ])('expands %j to its effective lower-risk modes', (configured, expected) => {
    expect(expandMcpActionModes(configured)).toEqual(expected)
  })

  it('keeps an empty allowlist unrestricted for legacy JWT and static-token flows', () => {
    expect(isMcpActionModeAllowed(undefined, 'full_operational_access')).toBe(true)
    expect(isMcpActionModeAllowed([], 'diagnostic_only')).toBe(true)
    // This helper preserves unrestricted legacy callers; typed callers validate modes separately.
    expect(isMcpActionModeAllowed(undefined, 'legacy_future_mode')).toBe(true)
  })

  it('does not allow a mode above the configured privilege', () => {
    expect(isMcpActionModeAllowed(['diagnostic_only'], 'approval_required')).toBe(false)
    expect(isMcpActionModeAllowed(['approval_required'], 'full_operational_access')).toBe(false)
  })
})

describe('MCP action mode input boundaries', () => {
  it('expands omitted and empty restrictions to a fresh full hierarchy', () => {
    const modes = ['read_only', 'diagnostic_only', 'approval_required', 'full_operational_access']
    const result = expandMcpActionModes()
    expect(result).toEqual(modes)
    expect(expandMcpActionModes([])).toEqual(modes)
    result.pop()
    expect(expandMcpActionModes()).toEqual(modes)
  })

  it('ignores invalid configured values without letting them erase valid restrictions', () => {
    expect(expandMcpActionModes(['unknown'])).toEqual([])
    expect(expandMcpActionModes(['unknown', 'diagnostic_only', 'read_only', 'diagnostic_only']))
      .toEqual(['read_only', 'diagnostic_only'])
    expect(isMcpActionModeAllowed(['unknown'], 'read_only')).toBe(false)
    expect(isMcpActionModeAllowed(['diagnostic_only'], 'unknown')).toBe(false)
  })

  it('allows the configured mode and lower privileges without allowing higher ones', () => {
    expect(isMcpActionModeAllowed(['diagnostic_only'], 'read_only')).toBe(true)
    expect(isMcpActionModeAllowed(['diagnostic_only'], 'diagnostic_only')).toBe(true)
    expect(isMcpActionModeAllowed(['read_only'], 'diagnostic_only')).toBe(false)
  })
})
