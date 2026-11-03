const isDigit = (character: string | undefined): boolean => character !== undefined && character >= '0' && character <= '9'
const isWord = (character: string | undefined): boolean => character !== undefined && /\w/.test(character)
const isWhitespace = (character: string | undefined): boolean => character !== undefined && /\s/.test(character)

function numberEnd(text: string, start: number): number {
  let end = start
  while (isDigit(text[end])) end += 1
  if (text[end] === '.' && isDigit(text[end + 1])) {
    end += 1
    while (isDigit(text[end])) end += 1
  }
  return end
}
function whitespaceEnd(text: string, start: number): number {
  let end = start
  while (isWhitespace(text[end])) end += 1
  return end
}
function hasTimePrefix(text: string, start: number): boolean {
  let end = start
  while (isDigit(text[end])) end += 1
  if (end === start) return false
  if (text[end] === ':' && end - start <= 2) return true
  if (text[end] !== 'h') return false
  const minutes = ++end
  while (isDigit(text[end]) && end - minutes < 2) end += 1
  return end > minutes && text[end] === ':'
}

/** Detect the previous process-monitor column shapes without repeated greedy wildcards. */
export function hasProcessMetricColumns(text: string): boolean {
  let unitCount = 0
  for (let index = 0; index < text.length;) {
    if (!isDigit(text[index])) {
      if (text[index] === '\n' || text[index] === '\r' || text[index] === '\u2028' || text[index] === '\u2029') unitCount = 0
      index += 1; continue
    }
    const end = numberEnd(text, index)
    if ('MGK'.includes(text[end] ?? '') && end < text.length && !isWord(text[end + 1])) {
      unitCount += 1
      if (unitCount >= 2) return true
    }
    // A fractional suffix can start at a word boundary even after a letter-prefixed number.
    if (!isWord(text[index - 1]) || text.slice(index, end).includes('.')) {
      const second = whitespaceEnd(text, end)
      if (second > end && isDigit(text[second])) {
        const secondEnd = numberEnd(text, second), time = whitespaceEnd(text, secondEnd)
        if (time > secondEnd && hasTimePrefix(text, time)) return true
      }
    }
    index = end
  }
  return false
}

export function isOnlyShellMarkers(text: string): boolean {
  return text.startsWith('$') && [...text].every(character => character === '$' || isWhitespace(character))
}

export function isLikelyShellPrompt(text: string): boolean {
  // Keep the legacy multiline/whitespace grammar with a bounded number of states.
  let states = new Set<string>()
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (index === 0 || text[index - 1] === '\n') states.add('lineStart')
    const next = new Set<string>()
    const bodyCharacter = character !== ']' && character !== '\n'
    for (const state of states) {
      if (state === 'lineStart') {
        if (character === '[') next.add('firstUser')
        else if (character === '#' || character === '$') next.add('done')
      } else if (state === 'firstUser' && bodyCharacter) next.add('user')
      else if (state === 'user') {
        if (bodyCharacter) next.add('user')
        if (character === '@') next.add('firstHost')
      } else if (state === 'firstHost' && bodyCharacter) next.add('host')
      else if (state === 'host') {
        if (bodyCharacter) next.add('host')
        if (isWhitespace(character)) next.add('space')
      } else if (state === 'space') {
        if (isWhitespace(character)) next.add('space')
        if (bodyCharacter) next.add('path')
      } else if (state === 'path') {
        if (bodyCharacter) next.add('path')
        if (character === ']') next.add('close')
      } else if (state === 'close' && character === '$') next.add('done')
      else if (state === 'done' && isWhitespace(character)) next.add('done')
    }
    states = next
  }
  return states.has('done')
}

export function hasRecursiveForceRemoval(command: string): boolean {
  for (const segment of command.split(/[;&|]/)) {
    const marker = /\brm\s+-/.exec(segment)
    if (!marker) continue
    const tail = segment.slice(marker.index + marker[0].length), recursive = tail.indexOf('r')
    if (recursive < 0) continue
    for (let index = recursive + 1; index < tail.length; index += 1) {
      if (tail[index] === 'f' && !isWord(tail[index + 1])) return true
    }
  }
  return false
}

/** Small finite-state recognizer for stripped cursor/capability response tokens. */
export function isOnlyTerminalResponses(text: string): boolean {
  if (!text) return false
  let states = new Set(['boundary'])
  for (const character of text.toLowerCase()) {
    if (states.has('hex')) states.add('boundary')
    const next = new Set<string>()
    for (const state of states) {
      if (state === 'boundary') {
        if (character === 'o') next.add('cursor')
        if (character === 'p') next.add('plus')
        if (isDigit(character)) next.add('row')
      } else if (state === 'cursor' && 'abcd'.includes(character)) next.add('boundary')
      else if (state === 'plus' && character === '+') next.add('query')
      else if (state === 'query' && character === 'q') next.add('firstHex')
      else if ((state === 'firstHex' || state === 'hex') && /[0-9a-f]/.test(character)) next.add('hex')
      else if (state === 'row') {
        if (isDigit(character)) next.add('row')
        else if (character === ';') next.add('firstColumn')
      } else if (state === 'firstColumn' && isDigit(character)) next.add('column')
      else if (state === 'column') {
        if (isDigit(character)) next.add('column')
        else if (character === 'r') next.add('boundary')
      }
    }
    if (!next.size) return false
    states = next
  }
  return states.has('boundary') || states.has('hex')
}
