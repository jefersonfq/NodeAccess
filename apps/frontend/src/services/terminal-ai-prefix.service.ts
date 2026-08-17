export type TerminalAiPrefixAction =
  | { type: 'send'; data: string; eraseChars: number }
  | { type: 'hold'; display: string }
  | { type: 'erase'; chars: number }
  | { type: 'trigger'; eraseChars: number }

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
    if (data.length === 1 && !/[\r\n]/.test(data)) {
      this.buffer += data
      if (this.buffer === '@ai ') {
        const eraseChars = this.buffer.length
        this.buffer = ''
        return { type: 'trigger', eraseChars }
      }
      if ('@ai '.startsWith(this.buffer)) return { type: 'hold', display: data }
    }
    const buffered = this.buffer
    this.buffer = ''
    return { type: 'send', data: /[\r\n]/.test(data) ? `${buffered}${data}` : buffered, eraseChars: buffered.length }
  }

  reset() { this.buffer = '' }
}
