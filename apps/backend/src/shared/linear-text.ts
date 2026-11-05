/** Linear scans for delimiters in externally supplied text. */
export function trimTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end -= 1
  return value.slice(0, end)
}

export function jsonFenceBody(value: string, whole = false): string | undefined {
  const start = whole ? (value.startsWith('```') ? 0 : -1) : value.indexOf('```')
  if (start < 0) return undefined
  let bodyStart = start + 3
  if (value.slice(bodyStart, bodyStart + 4).toLowerCase() === 'json') bodyStart += 4
  const end = whole ? (value.endsWith('```') ? value.length - 3 : -1) : value.indexOf('```', bodyStart)
  if (end < bodyStart) return undefined
  return value.slice(bodyStart, end).trim()
}
