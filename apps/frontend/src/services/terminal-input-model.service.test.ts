import { describe, expect, it } from 'vitest'
import { TerminalInputModel } from './terminal-input-model.service'

describe('TerminalInputModel', () => {
  it('tracks printable input, backspace and shell clear shortcuts', () => {
    const model = new TerminalInputModel()
    expect(model.consume('cd /tm')).toBe('cd /tm')
    expect(model.consume('\u007f')).toBe('cd /t')
    expect(model.consume('\u0015')).toBe('')
  })

  it('resets on command submission without interpreting escape sequences', () => {
    const model = new TerminalInputModel()
    model.consume('uptime')
    expect(model.consume('\u001b[A')).toBe('uptime')
    expect(model.consume('\r')).toBe('')
  })
})
