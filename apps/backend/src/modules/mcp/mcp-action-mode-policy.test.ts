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
  })

  it('does not allow a mode above the configured privilege', () => {
    expect(isMcpActionModeAllowed(['diagnostic_only'], 'approval_required')).toBe(false)
    expect(isMcpActionModeAllowed(['approval_required'], 'full_operational_access')).toBe(false)
  })
})
