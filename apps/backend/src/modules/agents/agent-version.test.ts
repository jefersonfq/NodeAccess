import { describe, expect, it } from 'vitest'
import { agentVersionStatus, MIN_SUPPORTED_AGENT_VERSION } from './agent.service.js'

describe('agent version compatibility', () => {
  it('classifies missing, older, current and newer versions', () => {
    expect(MIN_SUPPORTED_AGENT_VERSION).toBe('1.0.0')
    expect(agentVersionStatus(null)).toBe('unknown')
    expect(agentVersionStatus('0.9.9')).toBe('outdated')
    expect(agentVersionStatus('1.0.0')).toBe('current')
    expect(agentVersionStatus('1.2.0')).toBe('current')
  })
})
