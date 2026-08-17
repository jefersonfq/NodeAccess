import { describe, expect, it } from 'vitest'
import { buildMcpCommandAuditEvidence, sanitizeMcpAuditText, sha256McpAuditValue } from './mcp-audit-evidence.js'

describe('MCP audit evidence', () => {
  it('redacts common secrets without losing the operational instruction', () => {
    const sanitized = sanitizeMcpAuditText('import CSV token=abc123 password:supersecret\ninto database')
    expect(sanitized).toBe('import CSV token=[redacted] password:[redacted] into database')
    expect(sanitized).not.toContain('abc123')
    expect(sanitized).not.toContain('supersecret')
  })

  it('stores deterministic command evidence without duplicating the raw command', () => {
    const command = 'df -hT'
    const evidence = buildMcpCommandAuditEvidence([
      { id: 'disk', label: 'Uso de disco', command, timeoutSeconds: 30 },
    ])
    expect(evidence).toEqual([{
      stepId: 'disk', label: 'Uso de disco', commandSha256: sha256McpAuditValue(command),
      commandLength: command.length, timeoutSeconds: 30,
    }])
    expect(JSON.stringify(evidence)).not.toContain(command)
  })
})
