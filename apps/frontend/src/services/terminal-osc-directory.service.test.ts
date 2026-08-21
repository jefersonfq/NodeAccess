import { describe, expect, it } from 'vitest'
import { TerminalOscDirectoryTracker } from './terminal-osc-directory.service'
describe('TerminalOscDirectoryTracker', () => {
  it('extracts OSC 7 directories with BEL or ST terminators', () => {
    const tracker = new TerminalOscDirectoryTracker()
    expect(tracker.consume('\u001b]7;file://host/var/log\u0007prompt')).toBe('/var/log')
    expect(tracker.consume('\u001b]7;file://host/opt/node%20access\u001b\\')).toBe('/opt/node access')
  })
  it('handles sequences split across websocket chunks and ignores invalid values', () => {
    const tracker = new TerminalOscDirectoryTracker()
    expect(tracker.consume('\u001b]7;file://host/var/')).toBeNull()
    expect(tracker.consume('lib\u0007')).toBe('/var/lib')
    tracker.reset()
    expect(tracker.consume('ordinary output')).toBeNull()
  })
})
