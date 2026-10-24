export type TerminalAiPrefixAction =
  | { type: 'send'; data: string; eraseChars: number }
  | { type: 'hold'; display: string }
  | { type: 'erase'; chars: number }
  | { type: 'trigger'; eraseChars: number; mode: 'command' | 'context' }

export class TerminalAiPrefixInterceptor {
  private buffer = ''

  consume(data: string, enabled: boolean): TerminalAiPrefixAction {
    if (!enabled) {
      const buffered = this.buffer
      this.buffer = ''
      return { type: 'send', data: `${buffered}${data}`, eraseChars: buffered.length }
    }
    if (!this.buffer && data !== '@') return { type: 'send', data, eraseChars: 0 }
    if (data === '\u007f' && this.buffer) {
      this.buffer = this.buffer.slice(0, -1)
      return { type: 'erase', chars: 1 }
    }
    const displayedChars = this.buffer.length
    let appended = false
    if (data.length === 1 && !/[\r\n]/.test(data)) {
      appended = true
      this.buffer += data
      if (['@ai ', '@ia ', '@ia-ass ', '@ai-ass '].includes(this.buffer)) {
        const mode = this.buffer.includes('-ass') ? 'context' : 'command'
        const eraseChars = displayedChars
        this.buffer = ''
        return { type: 'trigger', eraseChars, mode }
      }
      if (['@ai ', '@ia ', '@ia-ass ', '@ai-ass '].some(prefix => prefix.startsWith(this.buffer))) return { type: 'hold', display: data }
    }
    const buffered = this.buffer
    this.buffer = ''
    return { type: 'send', data: appended ? buffered : `${buffered}${data}`, eraseChars: displayedChars }
  }

  reset(): void { this.buffer = '' }
}
