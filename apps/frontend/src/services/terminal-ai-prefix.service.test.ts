import { describe, expect, it } from 'vitest'
import { TerminalAiPrefixInterceptor } from './terminal-ai-prefix.service'

describe('TerminalAiPrefixInterceptor', () => {
  it.each(['@ia-ass ', '@ai-ass '])('opens context for %s without SSH bytes', prefix => {
    const parser = new TerminalAiPrefixInterceptor()
    for (const char of prefix.slice(0, -1)) expect(parser.consume(char, true).type).toBe('hold')
    expect(parser.consume(' ', true)).toEqual({type:'trigger',eraseChars:7,mode:'context'})
  })

  it('intercepts only the exact explicit prefix', () => {
    const parser = new TerminalAiPrefixInterceptor()
    expect(parser.consume('@', true)).toEqual({ type: 'hold', display: '@' })
    expect(parser.consume('a', true)).toEqual({ type: 'hold', display: 'a' })
    expect(parser.consume('i', true)).toEqual({ type: 'hold', display: 'i' })
    expect(parser.consume(' ', true)).toEqual({ type: 'trigger', eraseChars: 3, mode: 'command' })
  })

  it('recognizes the Portuguese alias without sending the prefix', () => {
    const parser = new TerminalAiPrefixInterceptor()
    for (const char of '@ia') expect(parser.consume(char, true).type).toBe('hold')
    expect(parser.consume(' ', true)).toEqual({type:'trigger',eraseChars:3,mode:'command'})
  })
  it('preserves ordinary input sharing the prefix', () => {
    const parser = new TerminalAiPrefixInterceptor()
    parser.consume('@', true); parser.consume('i', true)
    expect(parser.consume('d', true)).toEqual({type:'send',data:'@id',eraseChars:2})
  })
  it('releases a different command and its Enter unchanged', () => {
    const parser = new TerminalAiPrefixInterceptor()
    parser.consume('@', true); parser.consume('a', true)
    expect(parser.consume('b', true)).toEqual({ type: 'send', data: '@ab', eraseChars: 2 })
    expect(parser.consume('\r', true)).toEqual({ type: 'send', data: '\r', eraseChars: 0 })
  })

  it('does not inspect paste or input when disabled', () => {
    const parser = new TerminalAiPrefixInterceptor()
    expect(parser.consume('@ai echo test', true)).toEqual({ type: 'send', data: '@ai echo test', eraseChars: 0 })
    expect(parser.consume('@', false)).toEqual({ type: 'send', data: '@', eraseChars: 0 })
  })

  it('preserves pasted chunks after a held prefix and only erases displayed chars', () => {
    const parser = new TerminalAiPrefixInterceptor()
    parser.consume('@', true)
    expect(parser.consume('hello', true)).toEqual({type:'send',data:'@hello',eraseChars:1})
  })
  it('supports backspace while matching the prefix', () => {
    const parser = new TerminalAiPrefixInterceptor()
    parser.consume('@', true); parser.consume('a', true)
    expect(parser.consume('\u007f', true)).toEqual({ type: 'erase', chars: 1 })
    expect(parser.consume('a', true)).toEqual({ type: 'hold', display: 'a' })
  })
})
