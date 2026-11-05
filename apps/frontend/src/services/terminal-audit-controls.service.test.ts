import { describe, expect, it } from 'vitest'
import { countTerminalControlSequences, stripDcsSequences } from './terminal-audit-controls.service'
const oldDcs = (text: string): string => text.replace(/\x1bP[\s\S]*?(?:\x1b\\|\x07)/g, '')
const oldCount = (text: string): number => text.match(/\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|P[\s\S]*?(?:\x1b\\|\x07)|[()*+\-./][0-?]*[ -/]*[@-~]|[@-_][0-?]*[ -/]*[@-~]|[=>78<MNOPQRS])/g)?.length ?? 0

describe('audit DCS linear scanning', () => {
  it('removes complete BEL/ST frames and preserves surrounding Unicode and incomplete evidence', () => {
    expect(stripDcsSequences('α🙂\x1bPpayload\x07ação\x1bP二\x1b\\fim')).toBe('α🙂açãofim')
    expect(stripDcsSequences('antes\x1bPincompleto🙂')).toBe('antes\x1bPincompleto🙂')
    expect(stripDcsSequences('\x1bPouter\x1bPinner\x07tail')).toBe('tail')
    expect(stripDcsSequences('')).toBe('')
  })
  it('retains the previous differential contract across nested, broken and combined control families', () => {
    const tokens = ['', 'ação🙂二\u2028\u2029', '\x1bP', '\x1bPdata\x07', '\x1bPdata\x1b\\', '\x1b]title\x07', '\x1b]broken', '\x1b[31m', '\x1b[?1049h', '\x1b(0', '\x1b7', '\x07', '\x1b\\', '\r\n']
    for (const a of tokens) for (const b of tokens) for (const c of tokens) {
      const input = a + b + c
      expect(stripDcsSequences(input)).toBe(oldDcs(input))
      expect(countTerminalControlSequences(input)).toBe(oldCount(input))
    }
  })
  it('handles a large unterminated adversarial tail without dropping its data', () => {
    const input = '\x1bP'.repeat(250_000) + '🙂incompleto'
    expect(stripDcsSequences(input)).toBe(input)
    // Without a DCS terminator, the legacy short-control alternative counts each ESC P.
    expect(countTerminalControlSequences(input)).toBe(250_000)
  })
  it('counts separate complete DCS, OSC and cursor updates in order', () => {
    expect(countTerminalControlSequences('x\x1bPpayload\x07\x1b]title\x1b\\\x1b[2J\x1b[H')).toBe(4)
    expect(countTerminalControlSequences('\x1bPunterminated')).toBe(oldCount('\x1bPunterminated'))
  })
})
