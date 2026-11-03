import { describe, expect, it } from 'vitest'
import { hasEmailShape, trimBoundaryCharacters, trimTrailingCharacters } from './text-boundaries'
import { hasProcessMetricColumns, hasRecursiveForceRemoval, isLikelyShellPrompt, isOnlyShellMarkers, isOnlyTerminalResponses } from './audit-text-patterns'

function strings(alphabet: string, maxLength: number): string[] {
  const result = ['']; let layer = ['']
  for (let size = 1; size <= maxLength; size++) { layer = layer.flatMap(prefix => [...alphabet].map(char => prefix + char)); result.push(...layer) }
  return result
}

describe('linear text scans preserve accepted text', () => {
  it('preserves exact boundary characters, including trailing spaces after a newline', () => {
    for (const text of strings('a\n \t-', 5)) {
      expect(trimTrailingCharacters(text, '\n')).toBe(text.replace(/\n+$/g, ''))
      expect(trimTrailingCharacters(text, ' \t')).toBe(text.replace(/[ \t]+$/g, ''))
      expect(trimBoundaryCharacters(text, '-')).toBe(text.replace(/^-+|-+$/g, ''))
    }
  })
  it('preserves existing UI email validation without nested greedy partitions', () => {
    for (const text of strings('a.@ ', 6)) expect(hasEmailShape(text)).toBe(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim()))
    expect(hasEmailShape('a@' + 'a'.repeat(200_000))).toBe(false)
  })
  it('recognizes shell markers and prompts including trailing newlines', () => {
    for (const text of strings('$ \t', 6)) expect(isOnlyShellMarkers(text)).toBe(/^(?:\$\s*)+$/.test(text))
    for (const text of ['[root@host /]$ ', '[a@b c]$\n', 'output\n$', '#\n ', '[a@b]$', '[a@b  ]$', '[a@@b c]$', '[a@b \nc]$', '[a@b \n[c]$', 'plain']) {
      expect(isLikelyShellPrompt(text)).toBe(/(?:^|\n)\[[^\]\n]+@[^\]\n]+\s+[^\]\n]+\]\$\s*$/.test(text) || /(?:^|\n)[#$]\s*$/.test(text))
    }
  })
  it('preserves process metric recognition and avoids backtracking on long output', () => {
    const old = /(?:\d+(?:\.\d+)?[MGK]\b.*){2,}|\b\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+(?:\d{1,2}:|\d+h\d{1,2}:)/
    const samples = ['java 12M 14K', 'java 12.4M abc 11G', 'java 12M only', '123 4.5 00:09', '1 2 1h12:', 'a123.45 1 2:', '12.3.4M xx 5G', '12M\n14K', '12MB 14GB', '12.0 3.0 100:', 'a12 3 1:']
    for (const text of samples) expect(hasProcessMetricColumns(text), text).toBe(old.test(text))
    const start = performance.now()
    expect(hasProcessMetricColumns('1M '.repeat(50_000))).toBe(true)
    expect(hasProcessMetricColumns('1'.repeat(500_000) + '!')).toBe(false)
    expect(isOnlyShellMarkers('$ '.repeat(100_000) + '!')).toBe(false)
    expect(isLikelyShellPrompt('[' + 'a@'.repeat(100_000) + ']$')).toBe(false)
    expect(performance.now() - start).toBeLessThan(1500)
  })
  it('preserves recursive-force risk recognition without greedy repartitioning', () => {
    const old = /\b(rm\s+-[^;&|]*r[^;&|]*f)\b/
    for (const text of ['rm -rf /', 'rm -r --force', 'rm -fr /', 'rm -rxxf!', 'rm -rfoo', 'rm -r; echo f', 'xrm -rf', 'rm -x rm -f', 'rm -' + 'r'.repeat(30) + 'x']) expect(hasRecursiveForceRemoval(text), text).toBe(old.test(text))
    const start = performance.now(); expect(hasRecursiveForceRemoval('rm -' + 'r'.repeat(500_000) + 'x')).toBe(false); expect(performance.now() - start).toBeLessThan(1500)
  })
})

it('recognizes adjacent terminal responses using bounded state, including ambiguous hex/digit boundaries', () => {
  const old = /^(?:OB|OA|OC|OD|P\+q[0-9a-f]+|[0-9]+;[0-9]+R)+$/i
  const tokens = ['OA', 'OB', 'P+qabc', 'P+q1', '1;2R', 'p+q12;3R', 'P+q12', '!', 'P+q']
  for (const a of tokens) for (const b of tokens) for (const c of tokens) {
    const text = a + b + c
    expect(isOnlyTerminalResponses(text), text).toBe(old.test(text))
  }
  const start = performance.now()
  expect(isOnlyTerminalResponses('P+q' + '1'.repeat(300_000) + '!')).toBe(false)
  expect(performance.now() - start).toBeLessThan(1500)
})

it('matches legacy prompt/metric classifiers across deterministic mixed output', () => {
  let seed = 817
  const random = (max: number) => { seed = (seed * 16807) % 2147483647; return seed % max }
  const pieces = ['a', '[', ']', '@', '$', '#', '\n', '\r', '\t', ' ', '1', '12', '.', 'M', 'G', 'K', ':', 'h']
  const oldMetrics = /(?:\d+(?:\.\d+)?[MGK]\b.*){2,}|\b\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+(?:\d{1,2}:|\d+h\d{1,2}:)/
  for (let i = 0; i < 20_000; i++) {
    const text = Array.from({length: random(20)}, () => pieces[random(pieces.length)]).join('')
    expect(hasProcessMetricColumns(text), JSON.stringify(text)).toBe(oldMetrics.test(text))
    expect(isLikelyShellPrompt(text), JSON.stringify(text)).toBe(/(?:^|\n)\[[^\]\n]+@[^\]\n]+\s+[^\]\n]+\]\$\s*$/.test(text) || /(?:^|\n)[#$]\s*$/.test(text))
  }
})
