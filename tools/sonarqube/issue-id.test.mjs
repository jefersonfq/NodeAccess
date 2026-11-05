import test from 'node:test'
import assert from 'node:assert/strict'
import { readIssue, publicIssue } from '../shared/sonar-issue-id.cjs'

test('legacy and public metadata preserve identity and payload without mutation', () => {
  for (const row of [{ key: 'sonar-finding', rule: 'example' }, { issueId: 'sonar-finding', rule: 'example' }, { key: 'sonar-finding', issueId: 'sonar-finding', rule: 'example' }]) {
    const before = structuredClone(row)
    assert.deepEqual(readIssue(row), { key: 'sonar-finding', rule: 'example' })
    assert.deepEqual(publicIssue(row), { issueId: 'sonar-finding', rule: 'example' })
    assert.deepEqual(row, before)
  }
})
test('conflicting public and API identifiers fail closed in both directions', () => {
  for (const convert of [readIssue, publicIssue]) assert.throws(() => convert({ key: 'one', issueId: 'another' }), /Conflicting/)
})
