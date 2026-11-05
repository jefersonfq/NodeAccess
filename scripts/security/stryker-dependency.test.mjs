import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { getUrl } = require('typed-rest-client/Util.js')

test('Stryker HTTP dependency preserves repeated query values and escaping', () => {
  const result = new URL(getUrl('/reports', 'https://example.invalid/api/', {
    params: { tag: ['alpha beta', 'a&b'], limit: 2 },
  }))
  assert.deepEqual(result.searchParams.getAll('tag'), ['alpha beta', 'a&b'])
  assert.equal(result.searchParams.get('limit'), '2')
})

test('Stryker HTTP dependency handles hostile comma-array values without crashing', () => {
  for (const value of [null, undefined, { toString: 'not-callable' }]) {
    const result = getUrl('/reports', 'https://example.invalid/', {
      params: { value: [value, 'safe'] }, options: { arrayFormat: 'comma' },
    })
    assert.equal(new URL(result).hostname, 'example.invalid')
    assert.ok(result.includes('safe'))
  }
})
