import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const { assertFreshSftpListing, assertSessionSftpNavigation } = createRequire(import.meta.url)('./terminal-sftp-assertions.cjs')
const before = ['/', '/var', '/var', '/var/log']
test('accepts exactly one fresh target listing even if an unrelated previous lookup finishes late', () => {
  const after = [...before, '/var/log/anaconda', '/var']
  // Reproduces the integrated failure: the old global assertion rejects this valid sequence.
  assert.notEqual(after.length, before.length + 1)
  assert.deepEqual(assertFreshSftpListing(before, after, '/var'), { path: '/var', before: 2, after: 3 })
})
test('rejects a cache that was not invalidated even when an unrelated lookup would satisfy old total+1', () => {
  const after = [...before, '/var/log/anaconda']
  assert.equal(after.length, before.length + 1)
  assert.throws(() => assertFreshSftpListing(before, after, '/var'), /antes=2, depois=2/)
})
test('rejects duplicate target requests instead of relaxing the assertion to at least one', () => {
  assert.throws(() => assertFreshSftpListing(before, [...before, '/var', '/var'], '/var'), /antes=2, depois=4/)
})
test('rejects an unprimed target cache and accepts a single isolated refresh', () => {
  assert.throws(() => assertFreshSftpListing(['/'], ['/', '/var'], '/var'), /não foi aquecido/)
  assert.deepEqual(assertFreshSftpListing(before, [...before, '/var'], '/var'), { path: '/var', before: 2, after: 3 })
})

test('accepts directory navigation with intermediate prefix queries on the session transport', () => {
  assert.doesNotThrow(() => assertSessionSftpNavigation(['/', '/var', '/var/log', '/var/log/anaconda'], []))
  assert.doesNotThrow(() => assertSessionSftpNavigation(['/', '/', '/var', '/var', '/var', '/var/log', '/var/log/anaconda'], []))
})
test('rejects REST fallback even when the expected session navigation is present', () => {
  assert.throws(() => assertSessionSftpNavigation(['/', '/var', '/var/log', '/var/log/anaconda'], ['/']), /transporte REST/)
})
test('rejects missing, reversed or incomplete session navigation', () => {
  for (const paths of [[], ['/var', '/', '/var/log', '/var/log/anaconda'], ['/', '/var/log', '/var', '/var/log/anaconda'], ['/', '/var', '/var/log']]) {
    assert.throws(() => assertSessionSftpNavigation(paths, []), /Navegação SFTP/)
  }
})
