export class TerminalOscDirectoryTracker {
  private tail = ''
  consume(chunk: string): string | null {
    this.tail = `${this.tail}${chunk}`.slice(-2048)
    const matches = [...this.tail.matchAll(/\u001b\]7;file:\/\/[^/\u0007\u001b]*(\/[^\u0007\u001b]*)(?:\u0007|\u001b\\)/g)]
    const encoded = matches.at(-1)?.[1]
    if (!encoded) return null
    try { const value = decodeURIComponent(encoded); return value.startsWith('/') ? value : null } catch { return encoded.startsWith('/') ? encoded : null }
  }
  reset() { this.tail = '' }
}
