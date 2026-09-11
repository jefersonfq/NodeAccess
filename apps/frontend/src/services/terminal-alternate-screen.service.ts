const ALTERNATE_SCREEN_ENTER = /\u001b\[\?(?:47|1047|1049)h/

export class TerminalAlternateScreenTracker {
  private tail = ''

  consume(chunk: string): boolean {
    if (!this.tail && !chunk.includes('\u001b')) return false
    const candidate = `${this.tail}${chunk}`
    const entered = ALTERNATE_SCREEN_ENTER.test(candidate)
    const lastEscape = candidate.lastIndexOf('\u001b')
    const possiblePartial = lastEscape >= 0 ? candidate.slice(lastEscape) : ''
    this.tail = !entered && possiblePartial.length < 12 && !/[hl]$/.test(possiblePartial)
      ? possiblePartial
      : ''
    return entered
  }

  reset(): void {
    this.tail = ''
  }
}
