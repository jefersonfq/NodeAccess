import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { isAbsolute, join, relative, resolve } from 'node:path'

const MAX_BYTES = 8 * 1024 * 1024
const MAX_FAILURES = 50
const MAX_ASSERTIONS = 50000

// Never read free-form process output. Refuse links, including the coverage directory.
function readReport(root) {
  let fd
  try {
    if (!lstatSync(join(root, 'coverage')).isDirectory()) return { reportRead: 'not_regular' }
    fd = openSync(join(root, 'coverage/vitest-tests.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = fstatSync(fd)
    if (!stat.isFile()) return { reportRead: 'not_regular' }
    if (stat.size > MAX_BYTES) return { reportRead: 'too_large' }
    const bytes = Buffer.alloc(MAX_BYTES + 1)
    let size = 0, count
    do {
      count = readSync(fd, bytes, size, bytes.length - size, null)
      size += count
    } while (count && size < bytes.length)
    if (size > MAX_BYTES) return { reportRead: 'too_large' }
    const report = JSON.parse(bytes.subarray(0, size).toString('utf8'))
    if (!report || !Array.isArray(report.testResults)) return { reportRead: 'invalid' }
    return { reportRead: 'parsed', report }
  } catch (error) {
    if (error.code === 'ENOENT') return { reportRead: 'missing' }
    if (error.code === 'ELOOP') return { reportRead: 'not_regular' }
    return { reportRead: 'invalid' }
  } finally { if (fd !== undefined) closeSync(fd) }
}

function trackedTests(root) {
  try {
    const files = execFileSync('/usr/bin/git', ['-C', root, 'ls-files', '-z', '--cached'], {
      encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\0')
    return new Set(files.filter(file => /^(apps|packages|tools)\/[A-Za-z0-9_./-]+\.(test|spec)\.[cm]?[jt]sx?$/.test(file)))
  } catch { return new Set() }
}

function sourcePath(root, name, tracked) {
  if (typeof name !== 'string' || name.length > 4096) return undefined
  const file = isAbsolute(name) ? relative(resolve(root), name) : name
  // No report-supplied path is published unless it exactly matches repository metadata.
  return tracked.has(file) ? file : undefined
}

function category(assertion) {
  const message = assertion.failureMessages?.[0]
  if (typeof message !== 'string') return 'UNCLASSIFIED'
  const name = message.slice(0, 32).split(':')[0]
  return new Map([
    ['AssertionError', 'ASSERTION'], ['TypeError', 'TYPE_ERROR'],
    ['ReferenceError', 'REFERENCE_ERROR'], ['SyntaxError', 'SYNTAX_ERROR'],
  ]).get(name) ?? 'UNCLASSIFIED'
}

function collectSuite(suite, suiteIndex, identity, state) {
  const before = state.failures.length
  for (const [testIndex, assertion] of suite.assertionResults.entries()) {
    if (++state.scanned > MAX_ASSERTIONS) return false
    if (assertion?.status !== 'failed') continue
    if (state.failures.length === MAX_FAILURES) return false
    state.failures.push({ ...identity, suiteIndex, testIndex: testIndex + 1, errorCategory: category(assertion) })
  }
  if (suite.status === 'failed' && before === state.failures.length) {
    if (state.failures.length === MAX_FAILURES) return false
    state.failures.push({ ...identity, suiteIndex, errorCategory: 'SUITE_FAILED' })
  }
  return true
}

function failures(root, report, tracked) {
  const state = { failures: [], scanned: 0 }
  for (const [suiteIndex, suite] of report.testResults.entries()) {
    if (suiteIndex >= 10000) return { failures: state.failures, truncated: true }
    if (!Array.isArray(suite?.assertionResults)) continue
    const source = sourcePath(root, suite.name, tracked)
    const identity = { ...(source ? { source } : {}), sourceVerified: Boolean(source) }
    if (!collectSuite(suite, suiteIndex + 1, identity, state)) return { failures: state.failures, truncated: true }
  }
  return { failures: state.failures, truncated: false }
}

// Indices refer to the private JSON report (1-based). Dynamic titles are never copied,
// even when they look innocuous: credentials can be arbitrary strings.
export function vitestDiagnostics(root) {
  const { reportRead, report } = readReport(root)
  if (!report) return { reportRead }
  return { reportRead, ...failures(root, report, trackedTests(root)) }
}
