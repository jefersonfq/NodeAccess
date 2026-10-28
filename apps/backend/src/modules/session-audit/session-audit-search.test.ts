import { describe, expect, it } from 'vitest'
import { AuditInputReconstructor } from './session-audit-input.js'
import type { SessionAuditPreviewEvent } from '@nodeaccess/shared'
import { buildCommandTimeline } from './session-audit-normalizer.js'
import { readSearchDisplay } from './session-audit-search.js'

const initial = '\r\x1b[9@(reverse-i-search)`\':\x1b[C'
const match = "\b\b\bN': echo NA_AUDIT_HISTORY_OK" + '\b'.repeat(20)
function search(): AuditInputReconstructor {
  const input = new AuditInputReconstructor()
  input.feed('\x12', 1)
  input.observeOutput(initial, 80, 13)
  input.feed('N', 1)
  input.observeOutput(match, 80, 13)
  return input
}

describe('offline reverse history search', () => {
  it('propagates the observed candidate with low confidence and warning into the audit timeline', () => {
    const raw: Array<[SessionAuditPreviewEvent['type'], string]> = [
      ['stdin', '\x12'], ['stdout', initial], ['stdin', 'N'], ['stdout', match],
      ['stdin', '\r'], ['stdout', '\r\x1b[10Paudit-proof$\r\nNA_AUDIT_HISTORY_OK\r\naudit-proof$ '],
    ]
    const events = raw.map(([type, text], i): SessionAuditPreviewEvent => ({
      type, text, seq: i + 1, timestamp: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      bytes: text.length, actorUserId: type === 'stdin' ? 1 : null, cols: 80, rows: 24,
    }))
    const commands = buildCommandTimeline(events)
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({ command: 'echo NA_AUDIT_HISTORY_OK', confidence: 'low' })
    expect(commands[0]?.reconstructionWarnings).toHaveLength(1)
  })

  it('uses the selected command from real local Bash PTY output, not the search letter', () => {
    expect(search().feed('\r', 1)).toEqual([{ command: 'echo NA_AUDIT_HISTORY_OK', actorUserId: 1, preserveWhitespace: false, uncertain: true }])
  })
  it('supports every stdout fragment boundary including control sequences', () => {
    for (let split = 0; split <= match.length; split++) {
      const input = new AuditInputReconstructor()
      input.feed('\x12', 1); input.observeOutput(initial, 80, 13); input.feed('N', 1)
      input.observeOutput(match.slice(0, split), 80, 13)
      input.observeOutput(match.slice(split), 80, 13)
      expect(input.feed('\r', 1)[0], `split ${split}`).toMatchObject({ command: 'echo NA_AUDIT_HISTORY_OK', uncertain: true })
    }
  })
  it('supports repeated searches only when the new selection was observed', () => {
    const input = search()
    input.feed('\x12', 1)
    input.observeOutput("\r(reverse-i-search)`N': echo NEXT\x1b[K", 80, 13)
    expect(input.feed('\r', 1)[0]).toMatchObject({ command: 'echo NEXT', uncertain: true })
    const unknown = search()
    unknown.feed('\x12\r', 1).forEach(command => expect(command.uncertain).toBe(true))
  })
  it('restores the original line on Ctrl+G and cancels entirely on Ctrl+C', () => {
    const input = new AuditInputReconstructor()
    input.feed('echo original\x12', 1)
    input.observeOutput("\r(reverse-i-search)`o': echo other", 80, 13)
    expect(input.feed('\x07\r', 1)[0]).toMatchObject({ command: 'echo original', uncertain: false })
    expect(search().feed('\x03echo next\r', 1)[0]).toMatchObject({ command: 'echo next', uncertain: false })
  })
  it('accepts a selected match then applies cursor editing without writing to the server', () => {
    const input = search()
    expect(input.feed('\x05!\r', 1)[0]).toMatchObject({ command: 'echo NA_AUDIT_HISTORY_OK!', uncertain: true })
  })
  it('does not turn an unobserved search, failed search or unsupported screen into a verified command', () => {
    for (const output of ['', "\r(failed reverse-i-search)`N': echo wrong", "\r(reverse-i-search)`N': echo wrong\x1b[2J", "\r(reverse-i-search)`N': echo wrong\r\noutput"]) {
      const input = new AuditInputReconstructor()
      input.feed('echo prior\x12N', 1)
      if (output) input.observeOutput(output, 80, 13)
      expect(input.feed('\r', 1)[0]?.uncertain).toBe(true)
    }
  })
  it('accepts Escape followed by Enter or a fragmented arrow edit', () => {
    const input = search()
    input.feed('\x1b', 1)
    expect(input.feed('\r', 1)[0]).toMatchObject({ command: 'echo NA_AUDIT_HISTORY_OK', uncertain: true })
    const edited = search()
    edited.feed('\x1b', 1); edited.feed('[F', 1)
    expect(edited.feed('!\r', 1)[0]).toMatchObject({ command: 'echo NA_AUDIT_HISTORY_OK!', uncertain: true })
  })
  it('never certifies the previous display when Enter races a partial redraw', () => {
    const input = search()
    input.feed('A', 1)
    input.observeOutput('\x07', 80, 13)
    expect(input.feed('\r', 1)[0]).toMatchObject({ command: 'echo NA_AUDIT_HISTORY_OK', uncertain: true })
  })
  it('retains uncertainty when the actor changes during search', () => {
    expect(search().feed('\r', 2)[0]).toMatchObject({ actorUserId: 2, uncertain: true })
  })
  it('supports precomposed Latin characters and rejects ambiguous wide/combining or wrapped grids', () => {
    expect(readSearchDisplay("\r(reverse-i-search)`a': echo ação", 80)?.command).toBe('echo ação')
    expect(readSearchDisplay("\r(reverse-i-search)`a': echo 😀", 80)).toBeNull()
    expect(readSearchDisplay("\r(reverse-i-search)`a': echo ação", 80)).toBeNull()
    expect(readSearchDisplay("\r(reverse-i-search)`a': echo long", 20)).toBeNull()
    expect(readSearchDisplay('x'.repeat(65537), 80)).toBeNull()
  })
  it('does not change MySQL unsupported-control handling', () => {
    const input = new AuditInputReconstructor(); input.setMysql(true)
    expect(input.feed('\x12SELECT 1;\r', 1)[0]).toMatchObject({ command: 'SELECT 1;', uncertain: true })
  })
})
