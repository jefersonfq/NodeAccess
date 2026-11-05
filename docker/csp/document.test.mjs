import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import documentHandler from './document.js'

function run(t, template = '<meta nonce="__NODEACCESS_CSP_NONCE__">') {
  const read = t.mock.method(fs, 'readFileSync', (file, encoding) => {
    assert.equal(file, '/usr/share/nginx/html/index.html')
    assert.equal(encoding, 'utf8')
    return template
  })
  const response = { variables: {}, headersOut: {}, error: () => {}, return(status, body) { this.status = status; this.body = body } }
  try {
    documentHandler.document(response)
    return response
  } finally { read.mock.restore() }
}
test('document nonce is fresh, 256-bit, and identical to the header variable', t => {
  const first = run(t), second = run(t)
  assert.equal(first.status, 200)
  assert.equal(Buffer.from(first.variables.nodeaccess_nonce, 'base64').length, 32)
  assert.notEqual(first.variables.nodeaccess_nonce, second.variables.nodeaccess_nonce)
  assert.ok(first.body.includes(first.variables.nodeaccess_nonce))
  assert.equal(first.headersOut['Cache-Control'], 'no-store')
})
test('entropy failure returns 503 without app or predictable nonce', t => {
  t.mock.method(globalThis.crypto, 'getRandomValues', () => { throw Error('unavailable') })
  const result = run(t)
  assert.equal(result.status, 503)
  assert.equal(result.variables.nodeaccess_nonce, undefined)
  assert.ok(!result.body.includes('<'))
})
test('missing template placeholder fails closed', t => {
  assert.equal(run(t, '<html>invalid build</html>').status, 503)
})
