/// <reference lib="webworker" />
self.onmessage = (event: MessageEvent<{ pattern: string; text: string; caseSensitive: boolean }>): void => {
  try {
    const { pattern, text, caseSensitive } = event.data
    if (!pattern || pattern.length > 512 || text.length > 8192) throw new Error('limit')
    const regex = new RegExp(pattern, caseSensitive ? '' : 'i')
    if (regex.test('')) throw new Error('empty')
    const match = regex.exec(text)
    if (match && match[0].length === 0) throw new Error('empty')
    self.postMessage({ start: match?.index ?? null, end: match ? match.index + match[0].length : null })
  } catch { self.postMessage({ error: 'invalidRegex' }) }
}
export {}
