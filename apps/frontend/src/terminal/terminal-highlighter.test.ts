import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalHighlightRule, TerminalHighlightTelemetryDto } from '@nodeaccess/shared'
import { compileHighlightRules, matchTerminalLine, TerminalHighlighter } from './terminal-highlighter'

function rule(patch: Partial<TerminalHighlightRule> = {}): TerminalHighlightRule {
  return { id: crypto.randomUUID(), name: 'Avisos', pattern: 'WARNING', mode: 'literal', caseSensitive: false, wholeWord: true, foreground: 'amber', background: null, bold: true, enabled: true, priority: 50, ...patch }
}

describe('terminal highlighter', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('does no work when the user has not configured rules', () => {
    expect(compileHighlightRules([])).toEqual([])
    expect(matchTerminalLine('ERROR must remain untouched', [])).toEqual([])
  })

  it('highlights literal warnings without changing the source line', () => {
    const line = '[2026-09-22] WARNING disk usage at 90%'
    const ranges = matchTerminalLine(line, compileHighlightRules([rule()]))
    expect(ranges).toEqual([{ x: 13, width: 7, foreground: '#fbbf24', background: undefined, bold: true }])
    expect(line).toBe('[2026-09-22] WARNING disk usage at 90%')
  })

  it('supports wildcard and regex while respecting priority on overlaps', () => {
    const compiled = compileHighlightRules([
      rule({ name: 'Falha HTTP', mode: 'regex', pattern: 'HTTP\\s+5\\d{2}', foreground: 'red', priority: 90 }),
      rule({ name: 'HTTP', mode: 'wildcard', pattern: 'HTTP*', foreground: 'blue', priority: 10 }),
    ].sort((a, b) => b.priority - a.priority))
    const ranges = matchTerminalLine('HTTP 503 failed', compiled)
    expect(ranges[0]).toMatchObject({ x: 0, width: 8, foreground: '#f87171' })
    expect(ranges).toHaveLength(1)
  })

  it('ignores invalid regex and disabled rules', () => {
    expect(compileHighlightRules([rule({ mode: 'regex', pattern: '(', enabled: true }), rule({ enabled: false })])).toEqual([])
  })

  it('respects case sensitivity, whole words and unicode input', () => {
    const compiled = compileHighlightRules([
      rule({ pattern: 'ERROR', caseSensitive: true, wholeWord: true }),
      rule({ pattern: 'atenção', caseSensitive: false, wholeWord: false, foreground: 'cyan' }),
    ])
    const ranges = matchTerminalLine('errors error ERROR — ATENÇÃO', compiled)
    expect(ranges).toEqual([
      expect.objectContaining({ x: 13, width: 5 }),
      expect.objectContaining({ x: 21, width: 7, foreground: '#22d3ee' }),
    ])
  })

  it('supports wildcard tokens and safely ignores zero-length regex matches', () => {
    const wildcard = compileHighlightRules([rule({ mode: 'wildcard', pattern: 'WARN*', foreground: 'orange' })])
    expect(matchTerminalLine('WARNING WARNINGS', wildcard)).toEqual([
      expect.objectContaining({ x: 0, width: 7, foreground: '#fb923c' }),
      expect.objectContaining({ x: 8, width: 8, foreground: '#fb923c' }),
    ])
    const zeroLength = compileHighlightRules([rule({ mode: 'regex', pattern: '^|$', wholeWord: false })])
    expect(matchTerminalLine('safe', zeroLength)).toEqual([])
  })

  it('compiles at most 40 enabled rules', () => {
    const compiled = compileHighlightRules(Array.from({ length: 60 }, (_, index) => rule({ pattern: `R${index}` })))
    expect(compiled).toHaveLength(40)
  })

  it('caps matches to protect rendering performance', () => {
    const compiled = compileHighlightRules([rule({ pattern: 'ERR', wholeWord: false })])
    const started = performance.now()
    const ranges = matchTerminalLine('ERR '.repeat(20_000), compiled, 120)
    expect(ranges).toHaveLength(120)
    expect(performance.now() - started).toBeLessThan(50)
  })

  it('reports a pass that exceeds its rendering budget', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
    const samples: Array<{ budgetExceeded: boolean; matchCount: number }> = []
    const adapter = {
      isAlternateBuffer: false, cursorLine: 1, bufferLength: 3,
      getBufferLine: (line: number) => line === 0 ? 'WARNING slow operation' : '',
      setLineHighlights: () => {}, clearHighlights: () => {},
    }
    const highlighter = new TerminalHighlighter(adapter as never, (sample) => samples.push(sample), -1, 120)
    highlighter.setRules([rule()])
    highlighter.schedule(2048)
    frames[0](performance.now())
    expect(samples).toEqual([expect.objectContaining({ budgetExceeded: true, matchCount: 1 })])
    highlighter.dispose()
  })

  it('coalesces output bursts into one render pass and preserves byte accounting', async () => {
    const callbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length }))
    const samples: TerminalHighlightTelemetryDto[] = []
    const setLineHighlights = vi.fn()
    const adapter = {
      isAlternateBuffer: false, cursorLine: 0, bufferLength: 1,
      getBufferLine: () => 'WARNING recovered',
      setLineHighlights, clearHighlights: vi.fn(),
    }
    const highlighter = new TerminalHighlighter(adapter as never, (sample) => samples.push(sample), -1, 120)
    highlighter.setRules([rule({ templateId: 9 } as never)])
    highlighter.schedule(128)
    highlighter.schedule(256)
    highlighter.schedule(512)
    expect(callbacks).toHaveLength(1)
    callbacks[0](performance.now())
    expect(samples).toEqual([expect.objectContaining({ bytesProcessed: 896, matchCount: 1, templateIds: [9], matchedRuleIds: [expect.any(String)] })])
    expect(setLineHighlights).toHaveBeenCalledTimes(1)
    highlighter.dispose()
  })

  it('skips alternate-screen applications and clears decorations on dispose', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn())
    const adapter = { isAlternateBuffer: true, cursorLine: 0, bufferLength: 1, getBufferLine: vi.fn(), setLineHighlights: vi.fn(), clearHighlights: vi.fn() }
    const highlighter = new TerminalHighlighter(adapter as never, vi.fn())
    highlighter.setRules([rule()])
    highlighter.schedule(100)
    expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled()
    expect(adapter.getBufferLine).not.toHaveBeenCalled()
    highlighter.dispose()
    expect(adapter.clearHighlights).toHaveBeenCalledTimes(2)
  })
})


describe('terminal experience invariants during highlight updates', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  function fixture() {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length }))
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const lines = ['WARNING line 0', 'WARNING line 1', 'WARNING line 2', 'WARNING line 3', 'WARNING line 4', 'WARNING line 5', 'WARNING line 6']
    const adapter = {
      isAlternateBuffer: false, cursorLine: 6, bufferLength: 7,
      getBufferLine: vi.fn((index: number) => lines[index] ?? null), setLineHighlights: vi.fn(), clearHighlights: vi.fn(),
      write: vi.fn(), writeln: vi.fn(), clear: vi.fn(), focus: vi.fn(), fit: vi.fn(), resize: vi.fn(),
      scrollToBottom: vi.fn(), getSelection: vi.fn(), setDisableStdin: vi.fn(), dispose: vi.fn(),
    }
    const telemetry = vi.fn()
    const highlighter = new TerminalHighlighter(adapter as never, telemetry)
    return { adapter, highlighter, telemetry, frames, lines, flush: () => frames.shift()?.(0) }
  }

  it('keeps input, output, focus, selection, scrolling, size and source buffer untouched across repeated changes', () => {
    const { adapter, highlighter, lines, flush } = fixture()
    const original = [...lines]
    for (let i = 0; i < 50; i++) {
      highlighter.setRules([rule({ foreground: i % 2 ? 'red' : 'amber' })])
      highlighter.schedule(128)
      flush()
    }
    highlighter.dispose()
    expect(lines).toEqual(original)
    expect(adapter.setLineHighlights).toHaveBeenCalled()
    for (const method of ['write', 'writeln', 'clear', 'focus', 'fit', 'resize', 'scrollToBottom', 'getSelection', 'setDisableStdin', 'dispose'] as const) expect(adapter[method]).not.toHaveBeenCalled()
  })

  it('does not schedule work or telemetry when highlights are unconfigured', () => {
    const { adapter, highlighter, telemetry, frames } = fixture()
    for (let i = 0; i < 100; i++) highlighter.schedule(4096)
    expect(frames).toHaveLength(0)
    expect(adapter.getBufferLine).not.toHaveBeenCalled()
    expect(telemetry).not.toHaveBeenCalled()
  })

  it('uses the latest rules if several changes arrive before the queued frame', () => {
    const { adapter, highlighter, frames, flush } = fixture()
    highlighter.setRules([rule({ foreground: 'amber' })])
    highlighter.schedule(128)
    highlighter.setRules([rule({ foreground: 'red' })])
    highlighter.schedule(256)
    expect(frames).toHaveLength(1)
    flush()
    expect(adapter.setLineHighlights.mock.calls.every(([, ranges]) => ranges[0].foreground === '#f87171')).toBe(true)
  })

  it('clears stale decorations on opt-out and never reapplies queued colors', () => {
    const { adapter, highlighter, telemetry, flush } = fixture()
    highlighter.setRules([rule()]); highlighter.schedule(100)
    highlighter.setRules([]); flush()
    expect(adapter.clearHighlights).toHaveBeenCalledTimes(2)
    expect(adapter.setLineHighlights.mock.calls.every(([, ranges]) => ranges.length === 0)).toBe(true)
    expect(telemetry).not.toHaveBeenCalled()
  })

  it('ignores queued output after disposal and does not dispose the terminal itself', () => {
    const { adapter, highlighter, telemetry, flush } = fixture()
    highlighter.setRules([rule()]); highlighter.schedule(100); highlighter.dispose(); flush(); highlighter.schedule(100)
    expect(adapter.getBufferLine).not.toHaveBeenCalled()
    expect(adapter.setLineHighlights).not.toHaveBeenCalled()
    expect(adapter.dispose).not.toHaveBeenCalled()
    expect(telemetry).not.toHaveBeenCalled()
  })

  it('skips a frame if vim/htop enters the alternate buffer after scheduling, and resumes on normal output', () => {
    const { adapter, highlighter, flush } = fixture()
    highlighter.setRules([rule()]); highlighter.schedule(100)
    adapter.isAlternateBuffer = true; flush()
    expect(adapter.getBufferLine).not.toHaveBeenCalled()
    adapter.isAlternateBuffer = false; highlighter.schedule(100); flush()
    expect(adapter.setLineHighlights).toHaveBeenCalled()
  })

  it('reads only the bounded tail near the cursor, including after scrolling the buffer', () => {
    const { adapter, highlighter, flush } = fixture()
    adapter.cursorLine = 10000; adapter.bufferLength = 10001
    highlighter.setRules([rule()]); highlighter.schedule(100); flush()
    expect(adapter.getBufferLine.mock.calls.map(([index]) => index)).toEqual([9996, 9997, 9998, 9999, 10000])
  })

  it('stops after the rendering budget and reports metadata without source text', () => {
    const { adapter, highlighter, telemetry, flush } = fixture()
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(9)
    highlighter.setRules([rule()]); highlighter.schedule(80); flush()
    expect(adapter.getBufferLine).toHaveBeenCalledTimes(1)
    expect(telemetry).toHaveBeenCalledWith(expect.objectContaining({ budgetExceeded: true, bytesProcessed: 80, matchCount: 1 }))
    expect(JSON.stringify(telemetry.mock.calls)).not.toContain('WARNING line')
  })

  it('caps matches across multiple lines and omits low-cost telemetry', () => {
    const { adapter, highlighter, telemetry, flush } = fixture()
    adapter.getBufferLine.mockReturnValue('WARNING '.repeat(200))
    highlighter.setRules([rule()]); highlighter.schedule(800); flush()
    expect(adapter.setLineHighlights.mock.calls.flatMap(([, ranges]) => ranges)).toHaveLength(120)
    expect(adapter.getBufferLine).toHaveBeenCalledTimes(1)
    expect(telemetry).not.toHaveBeenCalled()
  })

  it('does not bleed regex lastIndex across lines or repeated passes', () => {
    const compiled = compileHighlightRules([rule({ mode: 'regex', pattern: 'WARN(?:ING)?' })])
    for (let i = 0; i < 20; i++) {
      expect(matchTerminalLine('WARNING WARN', compiled).map(range => range.x)).toEqual([0, 8])
      expect(matchTerminalLine('all clear', compiled)).toEqual([])
    }
  })

  it('treats regex metacharacters as literal text in literal mode', () => {
    const compiled = compileHighlightRules([rule({ pattern: '[error].*+$', wholeWord: false })])
    expect(matchTerminalLine('prefix [error].*+$ suffix', compiled)).toEqual([expect.objectContaining({ x: 7, width: 11 })])
    expect(matchTerminalLine('error anything', compiled)).toEqual([])
  })
})
