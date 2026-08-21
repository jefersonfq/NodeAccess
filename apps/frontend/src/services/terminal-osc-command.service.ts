export class TerminalOscCommandTracker {
  private tail = ''
  consume(chunk: string): number | null {
    this.tail = `${this.tail}${chunk}`.slice(-1024)
    const matches = [...this.tail.matchAll(/\u001b\]133;D;(\d+)(?:\u0007|\u001b\\)/g)]
    const raw = matches.at(-1)?.[1]
    if (raw === undefined) return null
    this.tail = ''
    return Number(raw)
  }
  reset() { this.tail = '' }
}
