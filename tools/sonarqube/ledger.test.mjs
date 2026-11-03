import test from 'node:test'
import assert from 'node:assert/strict'
import { signature, compareFindings, catalog, csv, html, discoverFindings } from './ledger.mjs'
const issue = { key: 'id-1', rule: 'javascript:S1', component: 'nodeaccess:tools/example.mjs', hash: 'content-hash', line: 5, severity: 'MAJOR', type: 'BUG', message: 'do-not-export-secret' }
test('baseline tracks content across line moves, but not new duplicates or changes', () => {
 const accepted = { schemaVersion: 1, findings: [{ signature: signature(issue), count: 1, reason: 'Reviewed isolated fixture', evidence: ['test'], status: 'context_reviewed' }] }
 assert.equal(compareFindings([{ ...issue, line: 99, key: 'other-server-id' }], accepted).passed, true)
 assert.equal(compareFindings([issue, { ...issue, key: 'second' }], accepted).unexpected.length, 1)
 assert.equal(compareFindings([{ ...issue, hash: 'changed' }], accepted).passed, false)
 assert.equal(compareFindings([], accepted).absentReviewedOccurrences, 1)
 assert.throws(() => compareFindings([issue], { ...accepted, findings: [{ ...accepted.findings[0], reason: '' }] }))
 assert.throws(() => signature({ ...issue, hash: null }))
})
test('catalog preserves all findings and separates disposition from observation; does not export messages', () => {
 const rows = catalog([issue], [{ key: issue.key, status: 'fixed', rationale: 'Correction', evidence: ['test'] }], [issue])
 assert.equal(rows[0].status, 'fixed'); assert.equal(rows[0].observed, 'present')
 assert.equal(JSON.stringify(rows).includes('do-not-export-secret'), false)
 assert.throws(() => catalog([issue], [{ key: issue.key }, { key: issue.key }]))
})
test('HTML escapes decisions and CSV neutralizes formulas', () => {
 const rows = catalog([issue], [{ key: issue.key, rationale: '<img src=x onerror=alert(1)>', evidence: [] }])
 assert.ok(html(rows).includes('&lt;img'))
 assert.equal(html(rows).includes('<img src=x'), false)
 rows[0].rationale = '=HYPERLINK("unsafe")'
 assert.ok(csv(rows).includes("'=HYPERLINK"))
})

test('new findings are appended without renumbering original consultation IDs', () => {
 const added = { ...issue, key: 'new', component: 'nodeaccess:aaa.ts', hash: 'new' }
 const original = catalog([issue]); const current = catalog([issue], [], [issue, added])
 assert.equal(current[0].id, original[0].id); assert.equal(current[0].key, issue.key)
 assert.equal(current[1].id, 'SQ-0002'); assert.equal(current[1].status, 'pending')
})

test('discovered findings retain IDs after correction and after later discoveries', () => {
 const known = {...issue, key:'known', component:'nodeaccess:zzz.ts', hash:'known'}
 const later = {...issue, key:'later', component:'nodeaccess:aaa.ts', hash:'later'}
 const rows = catalog([issue], [], [later], [known])
 assert.equal(rows[1].key, 'known'); assert.equal(rows[1].id, 'SQ-0002'); assert.equal(rows[1].observed, 'absent')
 assert.equal(rows[2].key, 'later'); assert.equal(rows[2].id, 'SQ-0003')
})

test('discovery persists sanitized additions and retains earlier absent findings in order', () => {
 const old = {...issue, key:'old', component:'nodeaccess:zzz.ts', hash:'old'}
 const fresh = {...issue, key:'fresh', component:'nodeaccess:aaa.ts', hash:'fresh'}
 const first = discoverFindings([issue], [old])
 const next = discoverFindings([issue], [fresh, issue], first)
 assert.deepEqual(next.map(i=>i.key), ['old','fresh'])
 assert.equal(JSON.stringify(next).includes('do-not-export-secret'), false)
 assert.deepEqual(discoverFindings([issue], [], next), next)
})
