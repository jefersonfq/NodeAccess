const test = require('node:test')
const assert = require('node:assert/strict')
const { harnessEndpoint } = require('./harness-endpoint.cjs')
test('remote credentials only use HTTPS; local disposable HTTP remains supported', () => {
  assert.equal(harnessEndpoint('https://nodeaccess.example.test/'), 'https://nodeaccess.example.test')
  assert.equal(harnessEndpoint('http://127.0.0.1:5174'), 'http://127.0.0.1:5174')
  assert.equal(harnessEndpoint('http://[::1]:5174'), 'http://[::1]:5174')
  for (const value of ['http://192.0.2.10', 'http://localhost.evil', 'https://user:secret@example.test', 'https://example.test/path', 'https://example.test/?token=x', 'file:///tmp/a']) assert.throws(() => harnessEndpoint(value))
})
