const { test } = require('node:test')
const assert = require('node:assert/strict')
const { waitForResponsiveLayout } = require('./sonar-responsive-layout.cjs')

test('layout wait retains the exact overflow condition and inherits the page timeout', async () => {
  const oldDocument = globalThis.document, oldWidth = globalThis.innerWidth
  try {
    globalThis.document = { documentElement: { scrollWidth: 391 } }
    globalThis.innerWidth = 390
    let calls = 0
    await waitForResponsiveLayout({ waitForFunction: async (...args) => {
      calls++
      assert.equal(args.length, 1, 'no timeout extension or polling override')
      const [condition] = args
      assert.equal(condition(), false)
      document.documentElement.scrollWidth = 390
      assert.equal(condition(), true)
      document.documentElement.scrollWidth = 389
      assert.equal(condition(), true)
    } })
    assert.equal(calls, 1)
  } finally {
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument
    if (oldWidth === undefined) delete globalThis.innerWidth; else globalThis.innerWidth = oldWidth
  }
})

test('timeout or browser failure propagates without retries or ignored errors', async () => {
  for (const name of ['TimeoutError', 'TargetClosedError']) {
    const failure = Object.assign(new Error(name), { name })
    let calls = 0
    await assert.rejects(waitForResponsiveLayout({ waitForFunction: async () => { calls++; throw failure } }), error => error === failure)
    assert.equal(calls, 1)
  }
})
