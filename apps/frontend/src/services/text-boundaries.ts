/** Linear scans for untrusted pasted/imported text; preserve internal whitespace. */
export function trimTrailingCharacters(value: string, characters: string): string {
  let end = value.length
  while (end > 0 && characters.includes(value[end - 1])) end -= 1
  return value.slice(0, end)
}

export function trimBoundaryCharacters(value: string, characters: string): string {
  let start = 0, end = value.length
  while (start < end && characters.includes(value[start])) start += 1
  while (end > start && characters.includes(value[end - 1])) end -= 1
  return value.slice(start, end)
}

/** Same permissive UI shape check as before; backend remains authoritative. */
export function hasEmailShape(value: string): boolean {
  const text = value.trim()
  const at = text.indexOf('@'), dot = text.indexOf('.', at + 2)
  return at > 0 && at === text.lastIndexOf('@') && dot > at + 1 && dot < text.length - 1 && !/\s/.test(text)
}
