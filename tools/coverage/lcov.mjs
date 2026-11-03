import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { isSource } from './inventory.mjs'

const integer = value => /^(?:0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value))
function sourcePath(root, value) {
  const path = resolve(root, value)
  const within = relative(root, path)
  if (!within || within === '..' || within.startsWith('../') || isAbsolute(within)) throw new Error('Coverage source is outside repository')
  return within.replaceAll('\\', '/')
}
export function parseLcov(text, root = process.cwd()) {
  const files = new Map()
  let current
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('TN:')) continue
    if (line.startsWith('SF:')) {
      if (current) throw new Error('Unterminated LCOV record')
      const file = sourcePath(root, line.slice(3))
      if (files.has(file)) throw new Error('Duplicate LCOV source')
      current = { file, lines: new Map(), branches: new Map(), totals: {} }
      continue
    }
    if (!current) throw new Error('LCOV data without source')
    if (line === 'end_of_record') {
      const actual = { LF: current.lines.size, LH: [...current.lines.values()].filter(hits => hits > 0).length,
        BRF: current.branches.size, BRH: [...current.branches.values()].filter(branch => branch.hits > 0).length }
      for (const [key, value] of Object.entries(actual)) if (current.totals[key] !== value) throw new Error('LCOV totals do not match records')
      files.set(current.file, current); current = undefined; continue
    }
    if (line.startsWith('DA:')) {
      const [number, count] = line.slice(3).split(',')
      if (!integer(number) || Number(number) < 1 || !integer(count) || current.lines.has(Number(number))) throw new Error('Invalid LCOV line')
      current.lines.set(Number(number), Number(count))
    } else if (line.startsWith('BRDA:')) {
      const fields = line.slice(5).split(',')
      if (fields.length !== 4 || !fields.slice(0, 3).every(integer) || Number(fields[0]) < 1 || (fields[3] !== '-' && !integer(fields[3]))) throw new Error('Invalid LCOV branch')
      const key = fields.slice(0, 3).join(':')
      if (current.branches.has(key)) throw new Error('Duplicate LCOV branch')
      current.branches.set(key, { line: Number(fields[0]), hits: fields[3] === '-' ? 0 : Number(fields[3]) })
    } else if (/^(?:LF|LH|BRF|BRH):/.test(line)) {
      const [key, value] = line.split(':')
      if (!integer(value) || current.totals[key] !== undefined) throw new Error('Invalid LCOV totals')
      current.totals[key] = Number(value)
    } else if (!/^(?:FN|FNDA|FNF|FNH):/.test(line)) throw new Error('Unknown LCOV field')
  }
  if (current || !files.size) throw new Error('Incomplete LCOV report')
  return files
}

/** Parse added-line hunks for one explicitly selected file, including paths with spaces. */
export function addedLines(diff) {
  const lines = new Set()
  for (const line of diff.split('\n')) {
    const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (!match) continue
    const start = Number(match[1]), count = Number(match[2] ?? 1)
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count)) throw new Error('Invalid diff hunk')
    for (let offset = 0; offset < count; offset += 1) lines.add(start + offset)
  }
  return lines
}

export function diffCoverage(root, baseSha, headSha, lcov) {
  if (!/^[a-f0-9]{7,40}$/i.test(baseSha ?? '') || (headSha && !/^[a-f0-9]{7,40}$/i.test(headSha))) throw new Error('Coverage base/head must be commit SHAs')
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  const base = git(['rev-parse', '--verify', `${baseSha}^{commit}`]).trim()
  const head = headSha ? git(['rev-parse', '--verify', `${headSha}^{commit}`]).trim() : git(['rev-parse', 'HEAD']).trim()
  const range = headSha ? [base, head] : [base]
  const changed = git(['diff', '--name-only', '--diff-filter=ACMR', '-z', ...range, '--']).split('\0').filter(isSource)
  const untracked = headSha ? [] : git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(isSource)
  const files = [...new Set([...changed, ...untracked])].sort()
  const report = typeof lcov === 'string' ? parseLcov(lcov, root) : lcov
  let lines = 0, coveredLines = 0, conditions = 0, coveredConditions = 0
  const missing = []
  for (const file of files) {
    const changedLines = untracked.includes(file)
      ? new Set(readFileSync(resolve(root, file), 'utf8').split('\n').map((_, index) => index + 1))
      : addedLines(git(['diff', '--no-ext-diff', '--unified=0', '--no-textconv', ...range, '--', file]))
    if (!changedLines.size) continue
    const coverage = report.get(file)
    if (!coverage) { missing.push(file); continue }
    for (const [line, hits] of coverage.lines) if (changedLines.has(line)) { lines += 1; if (hits > 0) coveredLines += 1 }
    for (const branch of coverage.branches.values()) if (changedLines.has(branch.line)) { conditions += 1; if (branch.hits > 0) coveredConditions += 1 }
  }
  const total = lines + conditions, covered = coveredLines + coveredConditions
  const percent = total ? 100 * covered / total : 100
  return { status: missing.length || percent < 80 ? 'failed' : 'passed', base, head, includesWorkingTree: !headSha,
    threshold: 80, percent, lines, coveredLines, conditions, coveredConditions, files, missing }
}
