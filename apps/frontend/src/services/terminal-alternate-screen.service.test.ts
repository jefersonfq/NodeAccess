import { describe, expect, it } from 'vitest'
import { TerminalAlternateScreenTracker } from './terminal-alternate-screen.service'

describe('TerminalAlternateScreenTracker', () => {
  it.each(['\u001b[?47h', '\u001b[?1047h', '\u001b[?1049h'])('detects alternate-screen entry %j', sequence => {
    expect(new TerminalAlternateScreenTracker().consume(`before${sequence}after`)).toBe(true)
  })

  it('detects a control sequence split across websocket chunks', () => {
    const tracker = new TerminalAlternateScreenTracker()
    expect(tracker.consume('\u001b[?10')).toBe(false)
    expect(tracker.consume('49h')).toBe(true)
  })

  it('does not treat alternate-screen exit or ordinary output as entry', () => {
    const tracker = new TerminalAlternateScreenTracker()
    expect(tracker.consume('htop output\u001b[?1049l')).toBe(false)
    tracker.reset()
    expect(tracker.consume('vim /var/log/messages')).toBe(false)
  })

  it('keeps the hot path inert for continuous ordinary terminal output', () => {
    const tracker = new TerminalAlternateScreenTracker()
    for (let index = 0; index < 10_000; index += 1) {
      expect(tracker.consume(`log line ${index}\r\n`)).toBe(false)
    }
  })
})
