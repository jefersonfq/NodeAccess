const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
test('live HA fails before launch when target is omitted', () => {
  const env = { ...process.env, FRONTEND_BASE: 'http://127.0.0.1:5174', HA_TEST_ACCESS_TOKEN: 'synthetic-test-only' }
  delete env.HA_TEST_NODE_NAME
  delete env.HA_TEST_NODE_ENDPOINT
  delete env.HA_TEST_VIRTUAL_IP
  const result = spawnSync(process.execPath, ['tools/frontend/ha-live-enrollment-harness.cjs'], { cwd: path.resolve(__dirname, '../..'), env, encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /HA_TEST_NODE_NAME é obrigatório/)
  assert.doesNotMatch(result.stderr, /browserType.launch/)
})
test('live HA rejects remote cleartext before handling token or launching', () => {
  const result = spawnSync(process.execPath, ['tools/frontend/ha-live-enrollment-harness.cjs'], { cwd: path.resolve(__dirname, '../..'), env: { ...process.env, FRONTEND_BASE: 'http://example.test' }, encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /HTTPS/)
})
