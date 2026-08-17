import { describe, expect, it } from 'vitest'
import { TerminalAiPrefixInterceptor } from './terminal-ai-prefix.service'

describe('TerminalAiPrefixInterceptor', () => {
  it('intercepts only the exact explicit prefix', () => {
    const parser = new TerminalAiPrefixInterceptor()
    expect(parser.consume('@', true)).toEqual({ type: 'hold', display: '@' })
    expect(parser.consume('a', true)).toEqual({ type: 'hold', display: 'a' })
    expect(parser.consume('i', true)).toEqual({ type: 'hold', display: 'i' })
    expect(parser.consume(' ', true)).toEqual({ type: 'trigger', eraseChars: 4 })
  })

  it('releases a different command and its Enter unchanged', () => {
    const parser = new TerminalAiPrefixInterceptor()
    parser.consume('@', true); parser.consume('a', true)
    expect(parser.consume('b', true)).toEqual({ type: 'send', data: '@ab', eraseChars: 3 })
    expect(parser.consume('\r', true)).toEqual({ type: 'send', data: '\r', eraseChars: 0 })
  })

  it('does not inspect paste or input when disabled', () => {
    const parser = new TerminalAiPrefixInterceptor()
    expect(parser.consume('@ai echo test', true)).toEqual({ type: 'send', data: '@ai echo test', eraseChars: 0 })
    expect(parser.consume('@', false)).toEqual({ type: 'send', data: '@', eraseChars: 0 })
  })

  it('supports backspace while matching the prefix', () => {
    const parser = new TerminalAiPrefixInterceptor()
    parser.consume('@', true); parser.consume('a', true)
    expect(parser.consume('\u007f', true)).toEqual({ type: 'erase', chars: 1 })
    expect(parser.consume('a', true)).toEqual({ type: 'hold', display: 'a' })
  })
})
