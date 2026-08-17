export class TerminalInputModel {
  private value = ''
  private escapeSequence = false

  consume(data: string): string {
    for (const char of data) {
      if (this.escapeSequence) {
        if (char === '[' || char === 'O') continue
        if (char >= '@' && char <= '~') this.escapeSequence = false
        continue
      }
      if (char === '\r' || char === '\n' || char === '\u0003') this.value = ''
      else if (char === '\u0015') this.value = ''
      else if (char === '\u0017') this.value = this.value.replace(/\s*\S+\s*$/, '')
      else if (char === '\u007f' || char === '\b') this.value = this.value.slice(0, -1)
      else if (char === '\u001b') this.escapeSequence = true
      else if (char === '\t') continue
      else if (char >= ' ') this.value += char
    }
    return this.value
  }

  append(text: string) { this.value += text; return this.value }
  reset() { this.value = '' }
  current() { return this.value }
}
