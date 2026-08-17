import { describe, expect, it } from 'vitest'
import { normalizeTerminalText } from './local-ai-terminal-context.js'

describe('local AI terminal context security', () => {
  it.each([
    ['Bearer abc.def.ghi', 'abc.def.ghi'],
    ['password=super-secret', 'super-secret'],
    ['api_key: sk-test-secret', 'sk-test-secret'],
    ['AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
    ['-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----', 'secret'],
  ])('redacts secrets from untrusted terminal output', (input, leaked) => {
    const normalized = normalizeTerminalText(input, 4_000)
    expect(normalized).not.toContain(leaked)
    expect(normalized).toContain('REDACTED')
  })

  it('strips ANSI controls and keeps the most recent bounded context', () => {
    const normalized = normalizeTerminalText(`old-${'x'.repeat(100)}\u001b[31mrecent\u001b[0m`, 20)
    expect(normalized).toBe('xxxxxxxxxxxxxxrecent')
    expect(normalized).not.toContain('\u001b')
  })
})
