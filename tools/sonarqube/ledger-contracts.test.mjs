import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { signature, compareFindings, catalog, csv, html, discoverFindings } from './ledger.mjs'
const issue = { key: 'fixture-1', rule: 'javascript:S1', component: 'nodeaccess:apps/backend/fixture.ts', hash: 'fixture-content', line: 7, severity: 'MAJOR', type: 'BUG', message: 'RAW_MESSAGE_MUST_NOT_EXPORT' }
const valid = () => ({ schemaVersion: 1, findings: [{ signature: signature(issue), count: 1, reason: 'Reviewed individual context', evidence: ['fixture-test'], status: 'context_reviewed' }] })
const cli = fileURLToPath(new URL('./ledger.mjs', import.meta.url))
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'nodeaccess-ledger-contract-'))
  mkdirSync(join(root, 'docs/changes/2026/11'), { recursive: true })
  const json = (name, data) => { const path = join(root, name); writeFileSync(path, JSON.stringify(data)); return path }
  const baseline = json('baseline.json', { issues: [issue] })
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', env: process.env })
  return { root, json, baseline, run, close: () => rmSync(root, { recursive: true, force: true }) }
}

test('signature accepts sanitized file fallback and requires rule, path and hash', () => {
  assert.equal(signature({ rule: issue.rule, file: 'apps/backend/fixture.ts', hash: issue.hash }), signature(issue))
  for (const field of ['rule', 'component', 'hash']) assert.throws(() => signature({ ...issue, [field]: null }), /cannot compare safely/)
})
for (const [name, change] of [
  ['schema', baseline => { baseline.schemaVersion = 2 }], ['rows', baseline => { baseline.findings = null }],
  ['reason', baseline => { baseline.findings[0].reason = '   ' }], ['evidence', baseline => { baseline.findings[0].evidence = [] }],
  ['status', baseline => { baseline.findings[0].status = 'fixed' }], ['signature', baseline => { baseline.findings[0].signature = 'wrong' }],
  ['zero count', baseline => { baseline.findings[0].count = 0 }], ['fractional count', baseline => { baseline.findings[0].count = 1.5 }],
  ['duplicate signature', baseline => { baseline.findings.push({ ...baseline.findings[0] }) }],
]) test(`baseline rejects ${name} instead of approving unverified findings`, () => {
  const baseline = valid(); change(baseline)
  assert.throws(() => compareFindings([issue], baseline), /Invalid reviewed baseline|Baseline requires/)
})

test('catalog orders same-path line/key ties, classifies domains and preserves missing line', () => {
  const inputs = [
    { ...issue, key: 'z', component: 'nodeaccess:apps/frontend/Fixture.vue', line: null },
    { ...issue, key: 'b', component: 'nodeaccess:scripts/fixture.mjs', line: 8 },
    { ...issue, key: 'a', component: 'nodeaccess:scripts/fixture.mjs', line: 8 },
    { ...issue, key: 'c', component: 'nodeaccess:scripts/fixture.mjs', line: 2 },
    issue,
  ]
  const rows = catalog(inputs)
  assert.deepEqual(rows.map(row => row.key), ['fixture-1', 'z', 'c', 'a', 'b'])
  assert.deepEqual([...new Set(rows.map(row => row.domain))], ['Backend / shared / agent', 'Frontend', 'Ferramentas'])
  assert.equal(rows[1].baselineLine, null); assert.equal(rows[1].observed, 'not_reanalyzed')
  assert.deepEqual(discoverFindings([], [inputs[1], inputs[2], inputs[3]]).map(row => row.key), ['c', 'a', 'b'])
  assert.deepEqual(discoverFindings([issue]), [])
})

test('CSV neutralizes every formula prefix, quotes multiline cells and preserves empty values', () => {
  for (const value of ['=SUM(1)', '+1', '-1', '@function', '  =formula']) {
    const output = csv([{ rationale: value, evidence: ['a', 'b'], risk: null }])
    assert.ok(output.includes(`"'${value}"`)); assert.ok(output.includes('"a | b"'))
  }
  assert.ok(csv([{ rationale: 'line1\n"line2"' }]).includes('"line1\n""line2"""'))
  assert.ok(csv([]).startsWith('\uFEFF'))
})

test('HTML escapes unknown states and evidence instead of creating executable attributes', () => {
  const rows = catalog([issue], [{ key: issue.key, status: 'new-state', rationale: '<img onerror="bad">', evidence: 'quoted & evidence', branch: 'fixture', risk: null }])
  rows[0].observed = 'custom-observation'; rows[0].url = 'https://example.invalid/?a="&b=\''
  const page = html(rows)
  assert.ok(page.includes('new-state')); assert.ok(page.includes('custom-observation'))
  assert.ok(page.includes('&lt;img onerror=&quot;bad&quot;&gt;'))
  assert.ok(page.includes('quoted &amp; evidence')); assert.ok(page.includes('&amp;b=&#39;'))
  assert.ok(!page.includes('<img')); assert.ok(html([]).includes('Nenhum achado corresponde aos filtros'))
})

test('real CLI builds sanitized files and loads array/object dispositions with branch fallback', () => {
  const f = fixture()
  try {
    const path = join(f.root, 'docs/changes/2026/11')
    mkdirSync(join(path, 'one')); mkdirSync(join(path, 'two')); mkdirSync(join(path, 'empty'))
    writeFileSync(join(path, 'not-a-directory'), 'ignored')
    writeFileSync(join(path, 'one/plan.md'), 'branch: test/fixture-reviewed\n')
    writeFileSync(join(path, 'one/dispositions.json'), JSON.stringify([{ key: issue.key, status: 'fixed', rationale: 'Fixture correction', evidence: ['unit'] }]))
    writeFileSync(join(path, 'two/plan.md'), 'no branch field\n')
    writeFileSync(join(path, 'two/dispositions.json'), JSON.stringify({ dispositions: [{ issueId: 'fixture-new', status: 'context_reviewed', branch: 'explicit-branch', rationale: 'Fixture context', evidence: ['review'] }] }))
    const current = f.json('current.json', { issues: [issue, { ...issue, key: 'fixture-new', hash: 'new-content' }] })
    const result = f.run(f.baseline, 'out', current)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), { rows: 2, reviewed: 2 })
    const rows = JSON.parse(readFileSync(join(f.root, 'out/findings.json'), 'utf8')).findings
    assert.equal(rows[0].branch, 'test/fixture-reviewed'); assert.equal(rows[1].branch, 'explicit-branch')
    for (const name of ['findings.json', 'findings.csv', 'findings.html', 'discovered-findings.json']) assert.ok(!readFileSync(join(f.root, 'out', name), 'utf8').includes(issue.message))
    assert.equal(rows[0].observed, 'present')
    const empty = f.json('empty.json', { issues: [] })
    assert.equal(f.run(f.baseline, 'out', empty).status, 0)
    const later = JSON.parse(readFileSync(join(f.root, 'out/findings.json'), 'utf8')).findings
    assert.deepEqual(later.map(row => [row.id, row.issueId, row.observed]), [['SQ-0001', issue.key, 'absent'], ['SQ-0002', 'fixture-new', 'absent']])
  } finally { f.close() }
})

test('real CLI default output represents unreanalyzed baseline without inventing observations', () => {
  const f = fixture()
  try {
    const result = f.run(f.baseline)
    assert.equal(result.status, 0, result.stderr)
    const data = JSON.parse(readFileSync(join(f.root, 'docs/sonarqube/findings.json'), 'utf8'))
    assert.equal(data.baselineCount, 1); assert.equal(data.findings[0].observed, 'not_reanalyzed')
    assert.deepEqual(JSON.parse(result.stdout), { rows: 1, reviewed: 0 })
  } finally { f.close() }
})

test('real CLI rejects absent input and conflicting decisions without generated catalogue', () => {
  const f = fixture()
  try {
    const missing = f.run(); assert.notEqual(missing.status, 0); assert.match(missing.stderr, /Provide private baseline issues JSON path/)
    const dir = join(f.root, 'docs/changes/2026/11/duplicate'); mkdirSync(dir)
    writeFileSync(join(dir, 'plan.md'), 'branch: fixture\n')
    writeFileSync(join(dir, 'dispositions.json'), JSON.stringify([{ key: issue.key }, { key: issue.key }]))
    const result = f.run(f.baseline, 'out')
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Duplicate disposition/)
  } finally { f.close() }
})
