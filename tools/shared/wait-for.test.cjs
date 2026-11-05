const test = require('node:test')
const assert = require('node:assert/strict')
const { waitFor } = require('./wait-for.cjs')

test('waits for callback readiness and returns the callback without running it', async () => {
  let ready, calls = 0
  const timer = setTimeout(() => { ready = () => calls++ }, 5)
  try {
    const result = await waitFor(() => ready, { timeoutMs: 1000, intervalMs: 2 })
    assert.equal(calls, 0); result(); assert.equal(calls, 1)
  } finally { clearTimeout(timer) }
})
test('missing callback fails with bounded diagnostic instead of hanging', async () => {
  await assert.rejects(waitFor(() => undefined, { timeoutMs: 15, intervalMs: 2, message: 'save request was never observed' }), /save request was never observed/)
})
test('predicate failure is propagated and invalid deadlines are rejected', async () => {
  await assert.rejects(waitFor(() => { throw new Error('probe failed') }), /probe failed/)
  await assert.rejects(waitFor(() => false, { timeoutMs: Infinity }), /Invalid/)
  await assert.rejects(waitFor(() => false, { intervalMs: 0 }), /Invalid/)
})
