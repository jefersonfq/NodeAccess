const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
// Execute the pure function from the real harness without starting its servers/browser.
function functionFrom(file, name, next) {
  const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8')
  const start = source.indexOf(`function ${name}(`)
  const end = source.indexOf(next, start)
  assert.ok(start >= 0 && end > start)
  return vm.runInNewContext(`(${source.slice(start, end).trim()})`)
}
test('screenshot labels retain names and trim long hostile labels in linear passes', () => {
  const sanitize = functionFrom('tools/frontend/sidebar-cdp-ux.cjs', 'sanitizeFilePart', 'async function captureScreenshot')
  assert.equal(sanitize('---desktop / mobile---'), 'desktop-mobile')
  assert.equal(sanitize('-'.repeat(100000)), 'shot')
  assert.equal(sanitize('a'.repeat(100000) + '-'.repeat(100000)), 'a'.repeat(80))
})
test('Prometheus decimal parser aggregates labels and rejects long malformed numbers', () => {
  const parse = functionFrom('tools/load-tests/scripts/run-gateway-with-metrics.js', 'parsePrometheusMetrics', 'function parseMetricsTargets')
  const result = parse('metric{kind="a"} 1.5\nmetric{kind="b"} -2e+1\nsmall .5\ninteger 2\ntrailing 2.\ninvalid 0x10\n# comment')
  assert.equal(result.metric, -18.5)
  assert.equal(result.small, 0.5)
  assert.equal(result.integer, 2)
  assert.equal(result.trailing, 2)
  assert.equal(result.invalid, undefined)
  assert.equal(Object.keys(parse('metric ' + '1'.repeat(100000) + '!')).length, 0)
})
