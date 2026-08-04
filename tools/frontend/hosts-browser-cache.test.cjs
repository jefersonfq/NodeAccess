const assert = require('node:assert/strict')
const test = require('node:test')
const { assertLoopbackOrigin, comparePasses, summarizePass } = require('./hosts-browser-cache-lib.cjs')

test('accepts local origins and rejects remote targets', () => {
  assert.equal(assertLoopbackOrigin('http://localhost:5173/hosts'), 'http://localhost:5173')
  assert.equal(assertLoopbackOrigin('http://127.0.0.1:5173'), 'http://127.0.0.1:5173')
  assert.throws(() => assertLoopbackOrigin('https://nodeaccess.example.com'), /localhost/)
})

test('summarizes resources, long tasks and errors without sensitive data', () => {
  const summary = summarizePass({ label: 'first', durationMs: 900, resources: [
    { kind: 'frontend', transferSize: 100 }, { kind: 'api', transferSize: 20 },
  ], longTasks: [{ duration: 51.4 }], errors: [] })
  assert.deepEqual(summary, { label: 'first', durationMs: 900, resourceCount: 2, apiCount: 1, frontendCount: 1, transferBytes: 120, longTaskCount: 1, longTaskTotalMs: 51, errorCount: 0 })
})

test('compares passes without claiming improvement', () => {
  const comparison = comparePasses(
    { label: 'first', durationMs: 1000, resources: [{ kind: 'frontend', transferSize: 100 }] },
    { label: 'second', durationMs: 600, resources: [{ kind: 'frontend', transferSize: 0 }] },
  )
  assert.equal(comparison.durationDeltaMs, -400)
  assert.equal(comparison.durationDeltaPercent, -40)
  assert.equal(comparison.transferDeltaBytes, -100)
})
