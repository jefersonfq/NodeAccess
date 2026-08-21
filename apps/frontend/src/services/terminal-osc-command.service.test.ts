import { describe, expect, it } from 'vitest'
import { TerminalOscCommandTracker } from './terminal-osc-command.service'

describe('OSC 133 command completion tracker', () => {
  it('reads successful and failed exit codes split across output chunks', () => {
    const tracker = new TerminalOscCommandTracker()
    expect(tracker.consume('\u001b]133;D;')).toBeNull()
    expect(tracker.consume('0\u0007prompt')).toBe(0)
    tracker.reset()
    expect(tracker.consume('\u001b]133;D;127\u001b\\')).toBe(127)
  })
})
