export interface TerminalInputSnapshot { value: string; cursor: number; reliable: boolean }

export class TerminalInputModel {
  private value = ''
  private cursor = 0
  private escape = ''
  private reliable = true

  consume(data: string): string {
    for (const char of data) {
      if (this.escape) { this.consumeEscape(char); continue }
      if (char === '\u001b') { this.escape = char; continue }
      if (char === '\r' || char === '\n' || char === '\u0003') this.reset()
      else if (char === '\u0001') this.cursor = 0
      else if (char === '\u0005') this.cursor = this.value.length
      else if (char === '\u000b') this.value = this.value.slice(0, this.cursor)
      else if (char === '\u0015') { this.value = this.value.slice(this.cursor); this.cursor = 0; this.reliable = true }
      else if (char === '\u0017') this.deletePreviousWord()
      else if (char === '\u007f' || char === '\b') this.backspace()
      else if (char === '\t') continue
      else if (char >= ' ') this.insert(char)
    }
    return this.reliable ? this.value : ''
  }

  snapshot(): TerminalInputSnapshot { return { value: this.value, cursor: this.cursor, reliable: this.reliable } }
  append(text: string) { for (const char of text) this.insert(char); return this.value }
  reset() { this.value = ''; this.cursor = 0; this.escape = ''; this.reliable = true }
  current() { return this.reliable ? this.value : '' }

  private insert(char: string) { this.value = `${this.value.slice(0, this.cursor)}${char}${this.value.slice(this.cursor)}`; this.cursor += char.length }
  private backspace() { if (this.cursor > 0) { this.value = `${this.value.slice(0, this.cursor - 1)}${this.value.slice(this.cursor)}`; this.cursor -= 1 } }
  private deletePreviousWord() {
    const left = this.value.slice(0, this.cursor)
    const nextLeft = left.replace(/\s*\S+\s*$/, '')
    this.value = `${nextLeft}${this.value.slice(this.cursor)}`; this.cursor = nextLeft.length
  }
  private consumeEscape(char: string) {
    this.escape += char
    if (this.escape === '\u001b[' || this.escape === '\u001bO') return
    if (!/[@-~]$/.test(char)) return
    const sequence = this.escape; this.escape = ''
    if (/\[(?:1;\d+)?D$/.test(sequence)) this.cursor = Math.max(0, this.cursor - 1)
    else if (/\[(?:1;\d+)?C$/.test(sequence)) this.cursor = Math.min(this.value.length, this.cursor + 1)
    else if (/\[(?:H|1~)$/.test(sequence) || sequence === '\u001bOH') this.cursor = 0
    else if (/\[(?:F|4~)$/.test(sequence) || sequence === '\u001bOF') this.cursor = this.value.length
    else if (/\[3~$/.test(sequence) && this.cursor < this.value.length) this.value = `${this.value.slice(0, this.cursor)}${this.value.slice(this.cursor + 1)}`
    else if (/\[(?:A|B)$/.test(sequence)) this.reliable = false
  }
}
