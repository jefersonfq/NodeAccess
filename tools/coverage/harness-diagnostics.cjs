const { openSync, closeSync, fstatSync, readSync, constants } = require('node:fs')
const { basename } = require('node:path')
const scripts = new Set(['sonar-frontend-review.cjs', 'table-review.cjs', 'terminal-experience-playwright.cjs', 'platform-settings-playwright.cjs', 'sonar-flow-coverage.cjs'])
const categories = new Set(['ASSERTION', 'TIMEOUT', 'OTHER'])
function sanitizeHarnessDiagnostic(value) {
  if (!value || !categories.has(value.category)) return undefined
  if (!Number.isSafeInteger(value.line) || value.line < 1 || value.line > 1000000) return undefined
  if (!Number.isSafeInteger(value.column) || value.column < 1 || value.column > 100000) return undefined
  return { category: value.category, line: value.line, column: value.column }
}
function parseHarnessDiagnostic(text, script) {
  const name = basename(script)
  if (!scripts.has(name) || typeof text !== 'string') return undefined
  const pattern = new RegExp(`^ {4}at [^\\n]*[\\\\/]${name.replaceAll('.', '\\.')}:(\\d{1,7}):(\\d{1,6})\\)?$`, 'm')
  const frame = pattern.exec(text)
  if (!frame) return undefined
  let category = 'OTHER'
  if (/^AssertionError(?: \[ERR_ASSERTION\])?:/m.test(text)) category = 'ASSERTION'
  else if (/^(?:TimeoutError:|[^\n]+: Timeout \d+ms exceeded\.)/m.test(text)) category = 'TIMEOUT'
  return sanitizeHarnessDiagnostic({ category, line: Number(frame[1]), column: Number(frame[2]) })
}
function readHarnessDiagnostic(file, script) {
  let fd
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > 65536) return undefined
    const buffer = Buffer.alloc(65537)
    const size = readSync(fd, buffer, 0, buffer.length, 0)
    if (size > 65536) return undefined
    return parseHarnessDiagnostic(buffer.toString('utf8', 0, size), script)
  } catch { return undefined }
  finally { if (fd !== undefined) closeSync(fd) }
}
module.exports = { sanitizeHarnessDiagnostic, parseHarnessDiagnostic, readHarnessDiagnostic }
