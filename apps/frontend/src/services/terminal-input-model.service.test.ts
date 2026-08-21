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
    expect(model.consume('\u001b[A')).toBe('')
    expect(model.snapshot().reliable).toBe(false)
    expect(model.consume('\r')).toBe('')
  })

  it('edits in the middle of a line with arrows, home, end and delete', () => {
    const model = new TerminalInputModel()
    model.consume('cd /var/log')
    model.consume('\u001b[D\u001b[D\u001b[D')
    model.consume('r')
    expect(model.snapshot()).toEqual({ value: 'cd /var/rlog', cursor: 9, reliable: true })
    model.consume('\u001b[H\u001b[3~')
    expect(model.snapshot()).toMatchObject({ value: 'd /var/rlog', cursor: 0 })
    model.consume('\u001b[F!')
    expect(model.current()).toBe('d /var/rlog!')
  })

  it('models readline control keys without losing the suffix', () => {
    const model = new TerminalInputModel()
    model.consume('prefix suffix\u001b[D\u001b[D\u001b[D\u001b[D\u001b[D\u001b[D')
    model.consume('\u0015')
    expect(model.snapshot()).toEqual({ value: 'suffix', cursor: 0, reliable: true })
    model.consume('\u0005\u000b')
    expect(model.current()).toBe('suffix')
  })
})
