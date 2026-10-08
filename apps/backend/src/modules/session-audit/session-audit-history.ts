/* eslint-disable no-control-regex -- Offline terminal parsing deliberately matches recorded control bytes. */
/** Accept only an observed readline replacement, not a guess from local history. */
export function readHistoryReplacement(raw: string, columns: number, promptColumns: number): string | null {
  const text = raw.replace(/\x1b\[\?2004[hl]/g, '').replace(/\x07/g, '')
  if (!text) return null
  let result = '', column = promptColumns
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (char === '\x1b') {
      const match = text.slice(i).match(/^\x1b\[(\d*)([GK])/)
      if (!match) return null
      if (match[2] === 'G') {
        // Readline returns to the start of the editable part before replacement.
        if (result || Number(match[1] || 1) !== promptColumns + 1) return null
        column = promptColumns
      } else if (match[1] && match[1] !== '0') return null
      i += match[0].length - 1
      continue
    }
    if (char === '\r') {
      // Readline's soft wrap emits an extra space beyond the last column, then CR.
      if (column !== columns + 1 || !result.endsWith(' ')) return null
      result = result.slice(0, -1); column = 0
      continue
    }
    if (char < ' ') return null
    result += char; column++
  }
  return result
}
