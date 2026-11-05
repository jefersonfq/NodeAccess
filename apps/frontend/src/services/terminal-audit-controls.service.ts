const ESC = '\u001b'
const BEL = '\u0007'

function dcsEnd(value: string, start: number): number {
  for (let index = start + 2; index < value.length; index++) {
    if (value[index] === BEL) return index + 1
    if (value[index] === ESC && value[index + 1] === '\\') return index + 2
  }
  return -1
}

/** Remove complete DCS only. An unterminated suffix is left for the existing cleanup stages. */
export function stripDcsSequences(value: string): string {
  const parts: string[] = []
  let cursor = 0
  while (cursor < value.length) {
    const start = value.indexOf(`${ESC}P`, cursor)
    if (start < 0) break
    const end = dcsEnd(value, start)
    // No later DCS can terminate either: do not rescan the same suffix for every prefix.
    if (end < 0) break
    parts.push(value.slice(cursor, start))
    cursor = end
  }
  parts.push(value.slice(cursor))
  return parts.join('')
}

/** Same token precedence as the audit redraw heuristic, without rescanning incomplete DCS tails. */
export function countTerminalControlSequences(value: string): number {
  const otherControl = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[()*+\-./][0-?]*[ -/]*[@-~]|[@-_][0-?]*[ -/]*[@-~]|[=>78<MNOPQRS])/y
  let count = 0
  let cursor = 0
  let dcsTerminatorUnavailable = false
  while (cursor < value.length) {
    const start = value.indexOf(ESC, cursor)
    if (start < 0) break
    if (value[start + 1] === 'P' && !dcsTerminatorUnavailable) {
      const end = dcsEnd(value, start)
      if (end >= 0) {
        count++
        cursor = end
        continue
      }
      dcsTerminatorUnavailable = true
    }
    otherControl.lastIndex = start
    if (otherControl.test(value)) {
      count++
      cursor = otherControl.lastIndex
    } else cursor = start + 1
  }
  return count
}
