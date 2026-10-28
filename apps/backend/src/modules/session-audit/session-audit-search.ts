/** Read a single-line Readline search display. Unsupported/wrapped output stays uncertain.
 * This is an offline projection of recorded stdout, never a source of SSH input.
 */
export function readSearchDisplay(raw: string, columns: number): { command: string; cursor: number } | null {
  if (raw.length > 65536 || columns < 1 || columns > 10000) return null
  const cells: string[] = []
  let cursor = 0
  const text = raw.replace(/\x1b\[\?2004[hl]/g, '')
  for (let i = 0; i < text.length;) {
    const c = text[i]!
    if (c === '\x1b') {
      const match = text.slice(i).match(/^\x1b\[(\d*)([@PKCDGm])/)
      if (!match) return null
      const count = Number(match[1] || 1)
      if (count > columns) return null
      switch (match[2]) {
        case '@': cells.splice(cursor, 0, ...Array<string>(count).fill(' ')); break
        case 'P': cells.splice(cursor, count); break
        case 'K':
          if (match[1] && match[1] !== '0') return null
          cells.splice(cursor); break
        case 'C': cursor += count; break
        case 'D': cursor = Math.max(0, cursor - count); break
        case 'G': cursor = count - 1; break
        case 'm': if (match[1] && match[1] !== '0') return null; break
      }
      if (cursor >= columns || cells.length > columns) return null
      i += match[0].length; continue
    }
    i++
    if (c === '\r') { cursor = 0; continue }
    if (c === '\b') { cursor = Math.max(0, cursor - 1); continue }
    if (c === '\x07') continue
    if (c < ' ' || c === '\x7f') return null
    const code = text.codePointAt(i - 1)!
    const char = String.fromCodePoint(code)
    if (char.length === 2) i++
    // Wide/combining glyphs need a full terminal grid; do not pretend cell offsets are exact.
    if (/[^\u0020-\u007e\u00a0-\u024f]/u.test(char)) return null
    while (cells.length < cursor) cells.push(' ')
    cells[cursor++] = char
    if (cursor >= columns) return null
  }
  const screen = cells.join('').trimEnd()
  const prefix = screen.match(/^\(reverse-i-search\)`[^']*': /)?.[0]
  if (!prefix) return null
  const command = screen.slice(prefix.length)
  if (!command) return null
  return { command, cursor: Math.max(0, Math.min(command.length, cursor - prefix.length)) }
}
