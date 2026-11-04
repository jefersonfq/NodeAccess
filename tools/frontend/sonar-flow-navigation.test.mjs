import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const { navigationFixture } = createRequire(import.meta.url)('./sonar-flow-fixtures.cjs')
test('navigation fixtures support actual destination consumer operations instead of generic arrays', () => {
  const sidebar = navigationFixture('/api/v1/hosts/sidebar-bootstrap')
  assert.deepEqual(sidebar.groups.map(group => ({ label: group.name, value: group.id })), [])
  assert.equal(sidebar.summary.all, 0)
  assert.deepEqual(sidebar.folders, [])
  assert.deepEqual(sidebar.tags, [])
  assert.deepEqual(navigationFixture('/api/v1/sessions/filter-options').users.map(user => ({ label: user.name, value: user.id })), [])
  for (const destination of ['users', 'hosts', 'sessions']) {
    const page = navigationFixture(`/api/v1/${destination}`)
    assert.equal(page.data.length, page.total)
    assert.equal(page.totalPages, 0)
    assert.equal(page.page, 1)
  }
  assert.deepEqual(navigationFixture('/api/v1/groups'), [])
  assert.deepEqual(navigationFixture('/api/v1/hosts/quick-access'), [])
  assert.throws(() => [].groups.map(group => group.id), TypeError)
  assert.throws(() => [].users.map(user => user.id), TypeError)
})
