const { setTimeout: delay } = require('node:timers/promises')
const { performance } = require('node:perf_hooks')

async function waitFor(predicate, { timeoutMs = 15000, intervalMs = 10, message = 'Harness condition did not become ready' } = {}) {
  if (typeof predicate !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0
      || !Number.isFinite(intervalMs) || intervalMs <= 0) throw new TypeError('Invalid harness wait options')
  const deadline = performance.now() + timeoutMs
  for (;;) {
    const result = predicate()
    if (result) return result
    const remaining = deadline - performance.now()
    if (remaining <= 0) throw new Error(message)
    await delay(Math.min(intervalMs, remaining))
  }
}
module.exports = { waitFor }
