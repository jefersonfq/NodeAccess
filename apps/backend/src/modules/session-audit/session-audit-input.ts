/* eslint-disable no-control-regex -- Offline terminal parsing deliberately matches recorded control bytes. */
import { readHistoryReplacement } from './session-audit-history.js'
/** Offline reconstruction only: never sends input or probes to an SSH session. */
export interface ReconstructedInput {
  command: string
  actorUserId: number | null
  preserveWhitespace: boolean
  uncertain: boolean
}

function completedSqlLength(sql: string, delimiter: string): number {
  let quote = '', block = false, comment = false
  let end = 0, pending = false
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!, next = sql[i + 1]
    if (comment) { if (c === '\n') comment = false; continue }
    if (block) { if (c === '*' && next === '/') { block = false; i++ } continue }
    if (quote) {
      if (c === '\\') { i++; continue }
      if (c === quote) { if (next === quote) i++; else quote = '' }
      continue
    }
    if (c === '#' || (c === '-' && next === '-' && /\s/.test(sql[i + 2] ?? ''))) { comment = true; continue }
    if (c === '/' && next === '*') { block = true; i++; continue }
    const terminatorLength = sql.startsWith(delimiter, i) ? delimiter.length : c === '\\' && (next === 'g' || next === 'G') ? 2 : 0
    if (terminatorLength) { end = i + terminatorLength; pending = false; i += terminatorLength - 1; continue }
    if (!/\s/.test(c)) pending = true
    if (c === "'" || c === '"' || c === '`') { quote = c; continue }
  }
  return end ? pending || block ? end : sql.length : 0
}

export class AuditInputReconstructor {
  private line: string[] = []
  private cursor = 0
  private escape = ''
  private paste = false
  private surrogate = ''
  private previousCr = false
  private uncertain = false
  private killed: string[] = []
  private sql = ''
  private mysql = false
  private delimiter = ';'
  private actor: number | null | undefined
  private editorEcho: { text: string; columns: number; promptColumns: number; uncertainBefore: boolean; literalKey?: string } | null = null
  get empty(): boolean { return this.line.length === 0 && this.sql.length === 0 && this.escape.length === 0 && !this.paste }

  setMysql(enabled: boolean): void {
    if (this.mysql === enabled) return
    this.mysql = enabled
    this.reset()
    this.delimiter = ';'
  }
  reset(): void {
    this.line = []; this.cursor = 0; this.escape = ''; this.paste = false
    this.sql = ''; this.uncertain = false; this.actor = undefined; this.surrogate = ''; this.previousCr = false
    this.editorEcho = null
  }
  observeOutput(text: string, columns: number, promptColumns: number): void {
    if (this.editorEcho) {
      this.editorEcho.text += text
      this.editorEcho.columns = columns
      this.editorEcho.promptColumns = promptColumns
    }
  }
  private recoverEditorEcho(): void {
    if (!this.editorEcho) return
    const echo = this.editorEcho
    this.editorEcho = null
    if (/^\x07+$/.test(echo.text)) { this.uncertain = echo.uncertainBefore; return }
    if (echo.literalKey) {
      // Some readline bindings reject a modified arrow and insert its final byte.
      // Accept that only when the server explicitly echoes an insert-character operation.
      const inserted = echo.text.match(/^\x07*\x1b\[(?:1)?@([^\x00-\x1f\x7f])/)?.[1]
      if (inserted === echo.literalKey) {
        this.line.splice(this.cursor++, 0, inserted)
        this.uncertain = echo.uncertainBefore
      }
      return
    }
    const replacement = readHistoryReplacement(echo.text, echo.columns, echo.promptColumns)
    if (replacement === null) return
    this.line = [...replacement]; this.cursor = this.line.length
    this.uncertain = echo.uncertainBefore
  }
  private start(): number { return this.line.slice(0, this.cursor).lastIndexOf('\n') + 1 }
  private end(): number { const i = this.line.indexOf('\n', this.cursor); return i < 0 ? this.line.length : i }
  private wordLeft(): number { let i = this.cursor; while (i && /\s/.test(this.line[i - 1]!)) i--; while (i && !/\s/.test(this.line[i - 1]!)) i--; return i }
  private wordRight(): number { let i = this.cursor; while (i < this.line.length && /\s/.test(this.line[i]!)) i++; while (i < this.line.length && !/\s/.test(this.line[i]!)) i++; return i }
  private kill(start: number, end: number): void { this.killed = this.line.splice(start, end - start); this.cursor = start }

  private control(sequence: string): void {
    if (sequence === '\x1b[200~') { this.paste = true; return }
    if (sequence === '\x1b[201~') { this.paste = false; return }
    const match = sequence.match(/^\x1b(?:\[([0-9;]*)([A-Za-z~])|O([A-Za-z]))$/)
    const key = match?.[2] ?? match?.[3]
    const count = Math.min(100000, Math.max(1, Number(match?.[1]?.split(';')[0] || 1)))
    const word = match?.[1]?.includes(';5') || sequence === '\x1bb' || sequence === '\x1bf'
    const modifier = match?.[1]?.split(';')[1]
    if (key && modifier && modifier !== '1' && modifier !== '5') {
      this.editorEcho = { text: '', columns: 80, promptColumns: 0, uncertainBefore: this.uncertain, literalKey: key }
      this.uncertain = true
      return
    }
    if (key === 'A' || key === 'B') {
      this.editorEcho = { text: '', columns: 80, promptColumns: 0, uncertainBefore: this.uncertain }
      this.uncertain = true
    }
    else if (sequence === '\x1bb' || (key === 'D' && word)) this.cursor = this.wordLeft()
    else if (sequence === '\x1bf' || (key === 'C' && word)) this.cursor = this.wordRight()
    else if (key === 'D') this.cursor = Math.max(0, this.cursor - count)
    else if (key === 'C') this.cursor = Math.min(this.line.length, this.cursor + count)
    else if (key === 'H' || (key === '~' && [1, 7].includes(count))) this.cursor = this.start()
    else if (key === 'F' || (key === '~' && [4, 8].includes(count))) this.cursor = this.end()
    else if (key === '~' && count === 3) this.line.splice(this.cursor, 1)
    else if (sequence === '\x1bd') this.kill(this.cursor, this.wordRight())
    else if (sequence === '\x1b\x7f') this.kill(this.wordLeft(), this.cursor)
    else this.uncertain = true // History/search or an unsupported editor cannot be guessed from keystrokes.
  }

  feed(chunk: string, actorUserId: number | null): ReconstructedInput[] {
    this.recoverEditorEcho()
    if (this.actor !== undefined && this.actor !== actorUserId && !this.empty) this.uncertain = true
    this.actor = actorUserId
    const submitted: ReconstructedInput[] = []
    let raw = this.surrogate + chunk
    this.surrogate = ''
    const last = raw.charCodeAt(raw.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) { this.surrogate = raw.slice(-1); raw = raw.slice(0, -1) }
    for (const char of raw) {
      if (char === '\n' && this.previousCr) { this.previousCr = false; continue }
      this.previousCr = char === '\r'
      if (this.escape) {
        this.escape += char
        if (this.escape.length > 4096) { this.escape = ''; this.uncertain = true; continue }
        if (this.escape === '\x1b[' || this.escape === '\x1bO' || this.escape === '\x1b]') continue
        if (this.escape.startsWith('\x1b]')) {
          if (char === '\x07' || this.escape.endsWith('\x1b\\')) { this.escape = ''; this.uncertain = true }
          else if (this.escape.length > 4096) { this.escape = ''; this.uncertain = true }
          continue
        }
        if (this.escape.startsWith('\x1b[') && !/[@-~]/.test(char)) continue
        this.control(this.escape); this.escape = ''; continue
      }
      if (char === '\x1b') { this.escape = char; continue }
      if (char === '\x03') { this.reset(); continue }
      if ((char === '\r' || char === '\n') && !this.paste) {
        let command = this.line.join('')
        this.line = []; this.cursor = 0
        if (this.mysql) {
          if (command.trim() === '\\c') { this.sql = ''; this.uncertain = false; continue }
          const delimiter = command.trim().match(/^delimiter\s+(\S+)$/i)
          const meta = /^(?:use|source|connect|help|status|exit|quit|tee|notee|pager|nopager|delimiter)(?:\s|;|$)|^\\[qsh?]$/i.test(command.trim())
          if (delimiter && !this.sql) this.delimiter = delimiter[1]!
          if (this.sql || (!meta && command.trim())) {
            this.sql += (this.sql ? '\n' : '') + command
            const completedLength = completedSqlLength(this.sql, this.delimiter)
            if (!completedLength) continue
            command = this.sql.slice(0, completedLength)
            this.sql = this.sql.slice(completedLength).trimStart()
          }
        }
        if (command.trim()) submitted.push({ command: command.trim(), actorUserId, preserveWhitespace: this.mysql || command.includes('\n'), uncertain: this.uncertain })
        this.uncertain = false
        continue
      }
      if (char === '\b' || char === '\x7f') { if (this.cursor) this.line.splice(--this.cursor, 1); continue }
      if (char === '\x01') { this.cursor = this.start(); continue }
      if (char === '\x05') { this.cursor = this.end(); continue }
      if (char === '\x02') { this.cursor = Math.max(0, this.cursor - 1); continue }
      if (char === '\x06') { this.cursor = Math.min(this.line.length, this.cursor + 1); continue }
      if (char === '\x04') { this.line.splice(this.cursor, 1); continue }
      if (char === '\x0b') { this.kill(this.cursor, this.end()); continue }
      if (char === '\x15') { this.kill(this.start(), this.cursor); continue }
      if (char === '\x17') { this.kill(this.wordLeft(), this.cursor); continue }
      if (char === '\x19') { this.line.splice(this.cursor, 0, ...this.killed); this.cursor += this.killed.length; continue }
      if (char === '\0' || char === '\x07') continue
      if (char === '\t' && this.mysql && !this.paste) this.uncertain = true
      if (char >= ' ' || char === '\t' || (this.paste && (char === '\n' || char === '\r'))) {
        this.line.splice(this.cursor++, 0, char === '\r' ? '\n' : char)
      } else this.uncertain = true
    }
    return submitted
  }
}
