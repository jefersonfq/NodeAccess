import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { reconcile, ruleFingerprint } from './reconcile.mjs'

const sha = value => createHash('sha256').update(value).digest('hex')
function fixture(t, withManifest = true) {
  const root = mkdtempSync(join(tmpdir(), 'sonar-review-contract-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'docs/sonarqube'), { recursive: true })
  mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src/control.js'), 'module.exports = 1\n')
  writeFileSync(join(root, 'docs/proof.md'), 'Independent exact occurrence review')
  const rule = { key: 'javascript:S3403', name: 'Strict equality', htmlDesc: '<p>Different types</p>', type: 'BUG', repo: 'javascript', params: [] }
  const range = { startLine: 1, endLine: 1, startOffset: 0, endOffset: 6 }
  const item = { id: 'NA0157-FP-1', rule: rule.key, file: 'src/control.js', hash: 'a'.repeat(32), range,
    sourceSha256: sha(readFileSync(join(root, 'src/control.js'))), ruleSha256: ruleFingerprint(rule),
    rationale: 'Independent review demonstrates that this precise comparison can be true and false.', evidence: ['docs/proof.md'] }
  const manifest = { schemaVersion: 1, project: 'nodeaccess', serverVersion: '26.10', findings: [item] }
  const issue = { key: 'fixture-issue', project: 'nodeaccess', component: 'nodeaccess:src/control.js', rule: rule.key,
    hash: item.hash, textRange: { ...range }, issueStatus: 'OPEN', transitions: ['falsepositive'], comments: [] }
  const calls = [], events = [], state = { issues: [issue], analysis: 'analysis-1', revision: 'b'.repeat(40), rule, version: '26.10' }
  const save = () => writeFileSync(join(root, 'docs/sonarqube/reviewed-false-positives.json'), JSON.stringify(manifest))
  if (withManifest) save()
  const git = args => execFileSync('/usr/bin/git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q']); git(['add', '.'])
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'review fixture'])
  state.revision = git(['rev-parse', 'HEAD'])
  const request = async (path, params = {}, method = 'POST') => {
    calls.push({ path, params, method })
    if (path === '/api/project_analyses/search') return { analyses: [{ key: state.analysis, revision: state.revision }] }
    if (path === '/api/system/status') return { version: state.version }
    if (path === '/api/rules/show') return { rule: state.rule }
    if (path === '/api/issues/search') {
      const rows = params.issues ? state.issues.filter(i => i.key === params.issues) : state.issues
      return { paging: { total: rows.length, pageIndex: params.p ?? 1, pageSize: params.ps }, issues: rows.slice(((params.p ?? 1) - 1) * params.ps, (params.p ?? 1) * params.ps) }
    }
    if (path === '/api/issues/add_comment') { issue.comments.push({ markdown: params.text }); return {} }
    if (path === '/api/issues/do_transition') {
      assert.equal(params.transition, 'falsepositive'); issue.issueStatus = 'FALSE_POSITIVE'; return { issue }
    }
    throw new Error('Unexpected test API')
  }
  return { root, manifest, item, issue, state, calls, events, save, request, git,
    args: { root, analysisId: state.analysis, revision: state.revision, request, record: event => events.push(event) } }
}
const writes = f => f.calls.filter(c => c.method === 'POST')
test('dry run discovers exact decisions without writes; application is idempotent', async t => {
  const f = fixture(t)
  assert.equal((await reconcile(f.args)).proposed, 1); assert.deepEqual(writes(f), [])
  const applied = await reconcile({ ...f.args, dryRun: false })
  assert.equal(applied.changed, 1); assert.equal(writes(f).length, 2)
  assert.equal((await reconcile({ ...f.args, dryRun: false })).unchanged, 1)
  assert.equal(writes(f).length, 2); assert.equal(f.events[0].previousState, 'OPEN')
})
test('complete paginated inventory confirms absence without resolving another issue', async t => {
  const f = fixture(t)
  f.state.issues = Array.from({ length: 101 }, (_, i) => ({ ...f.issue, key: `unrelated-${i}`, hash: 'c'.repeat(32) }))
  const result = await reconcile({ ...f.args, dryRun: false })
  assert.equal(result.absent, 1); assert.deepEqual(writes(f), [])
  assert.ok(f.calls.some(c => c.params.p === 2))
})
for (const [name, change, expected] of [
  ['source drift', f => writeFileSync(join(f.root, 'src/control.js'), 'changed'), 'SOURCE_CHANGED'],
  ['rule drift', f => { f.state.rule = { ...f.state.rule, htmlDesc: 'Changed semantics' } }, 'RULE_CHANGED'],
  ['server drift', f => { f.state.version = '27' }, 'SERVER_CHANGED'],
  ['analysis drift', f => { f.state.analysis = 'other' }, 'ANALYSIS_CHANGED'],
  ['revision drift', f => { f.state.revision = 'c'.repeat(40) }, 'ANALYSIS_CHANGED'],
  ['foreign project', f => { f.issue.project = 'other' }, 'ISSUE_INVALID'],
  ['ambiguous occurrence', f => { f.state.issues.push({ ...f.issue, key: 'second' }) }, 'MATCH_AMBIGUOUS'],
  ['range changed', f => { f.issue.textRange.startOffset = 1 }, 'UNREVIEWED_OCCURRENCE'],
  ['extra occurrence outside reviewed range', f => { f.state.issues.push({ ...f.issue, key: 'extra', textRange: { ...f.issue.textRange, startLine: 2, endLine: 2 } }) }, 'UNREVIEWED_OCCURRENCE'],
  ['duplicate key in inventory', f => { f.state.issues.push({ ...f.issue }) }, 'ISSUE_INVALID'],
  ['human accepted risk', f => { f.issue.issueStatus = 'ACCEPTED' }, 'DECISION_CONFLICT'],
  ['human confirmed issue', f => { f.issue.issueStatus = 'CONFIRMED' }, 'DECISION_CONFLICT'],
  ['missing capability', f => { f.issue.transitions = ['confirm'] }, 'DECISION_CONFLICT'],
  ['duplicate manifest', f => { f.manifest.findings.push({ ...f.item }); f.save() }, 'ENTRY_INVALID'],
  ['unsafe evidence path', f => { f.item.evidence = ['../outside']; f.save() }, 'PATH_INVALID'],
  ['invalid range', f => { f.item.range.startLine = 0; f.save() }, 'RANGE_INVALID'],
  ['manifest project', f => { f.manifest.project = 'other'; f.save() }, 'MANIFEST_INVALID'],
]) test(`${name} refuses all mutations`, async t => {
  const f = fixture(t); change(f)
  await assert.rejects(reconcile({ ...f.args, dryRun: false }), new RegExp(`REVIEW_${expected}`))
  assert.deepEqual(writes(f), [])
})
test('symbolic source is rejected even when its contents match', async t => {
  const f = fixture(t); const p = join(f.root, 'src/control.js')
  writeFileSync(join(f.root, 'src/other.js'), readFileSync(p)); rmSync(p); symlinkSync('other.js', p)
  await assert.rejects(reconcile(f.args), /REVIEW_SOURCE_UNSAFE/)
})
test('valid manifest cannot authorize an uncommitted source snapshot', async t => {
  const f = fixture(t); writeFileSync(join(f.root, 'src/control.js'), 'module.exports = 2\n')
  f.item.sourceSha256 = sha(readFileSync(join(f.root, 'src/control.js'))); f.save()
  await assert.rejects(reconcile({ ...f.args, dryRun: false }), /REVIEW_CHECKOUT_CHANGED/)
  assert.deepEqual(writes(f), [])
})
test('untracked source cannot impersonate a file from the analyzed commit', async t => {
  const f = fixture(t); f.item.file = 'src/untracked.js'; writeFileSync(join(f.root, f.item.file), 'module.exports = 1\n')
  f.save(); f.git(['add', 'docs']); f.git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'manifest change'])
  f.state.revision = f.git(['rev-parse', 'HEAD']); f.args.revision = f.state.revision
  await assert.rejects(reconcile({ ...f.args, dryRun: false }), /REVIEW_CHECKOUT_UNVERIFIED/)
  assert.deepEqual(writes(f), [])
})
test('Git assume-unchanged flags cannot hide a different reviewed source', async t => {
  const f = fixture(t)
  f.git(['update-index', '--assume-unchanged', 'src/control.js', 'docs/sonarqube/reviewed-false-positives.json'])
  writeFileSync(join(f.root, 'src/control.js'), 'module.exports = 2\n')
  f.item.sourceSha256 = sha(readFileSync(join(f.root, 'src/control.js'))); f.save()
  assert.equal(f.git(['status', '--porcelain', '--untracked-files=no']), '')
  await assert.rejects(reconcile({ ...f.args, dryRun: false }), /REVIEW_GIT_SOURCE_CHANGED/)
  assert.deepEqual(writes(f), [])
})
test('changing an untracked review document during a batch blocks the next mutation', async t => {
  const f = fixture(t, false); f.save()
  const request = async (...args) => {
    const result = await f.request(...args)
    if (args[0] === '/api/issues/add_comment') {
      const p = join(f.root, 'docs/sonarqube/reviewed-false-positives.json')
      writeFileSync(p, readFileSync(p, 'utf8') + '\n')
    }
    return result
  }
  await assert.rejects(reconcile({ ...f.args, request, dryRun: false }), /REVIEW_MANIFEST_CHANGED/)
  assert.equal(f.issue.issueStatus, 'OPEN'); assert.equal(writes(f).length, 1)
})
test('incomplete pagination and duplicate results never establish absence', async t => {
  const f = fixture(t)
  const request = async (...args) => {
    const data = await f.request(...args)
    if (args[0] === '/api/issues/search') data.paging.total = 2
    return data
  }
  await assert.rejects(reconcile({ ...f.args, request, dryRun: false }), /REVIEW_PAGINATION_INVALID/)
  assert.deepEqual(writes(f), [])
})
test('partial failure records completed comment; retry does not repeat it', async t => {
  const f = fixture(t)
  const request = async (...args) => {
    if (args[0] === '/api/issues/do_transition') throw new Error('Sensitive remote response')
    return f.request(...args)
  }
  await assert.rejects(reconcile({ ...f.args, request, dryRun: false }), /^Error: REVIEW_EXECUTION_FAILED$/)
  assert.equal(f.issue.comments.length, 1); assert.equal(f.events.at(-1).action, 'failed')
  assert.equal((await reconcile({ ...f.args, dryRun: false })).changed, 1)
  assert.equal(f.issue.comments.length, 1)
})
test('analysis change after comment prevents transition', async t => {
  const f = fixture(t)
  const request = async (...args) => {
    const result = await f.request(...args)
    if (args[0] === '/api/issues/add_comment') f.state.analysis = 'replacement'
    return result
  }
  await assert.rejects(reconcile({ ...f.args, request, dryRun: false }), /REVIEW_ANALYSIS_CHANGED/)
  assert.equal(f.issue.issueStatus, 'OPEN'); assert.equal(writes(f).length, 1)
})
test('human decision after comment is checked again before transition', async t => {
  const f = fixture(t)
  const request = async (...args) => {
    const result = await f.request(...args)
    if (args[0] === '/api/issues/add_comment') f.issue.issueStatus = 'CONFIRMED'
    return result
  }
  await assert.rejects(reconcile({ ...f.args, request, dryRun: false }), /REVIEW_ISSUE_CHANGED/)
  assert.equal(f.issue.issueStatus, 'CONFIRMED'); assert.equal(writes(f).length, 1)
})
test('lost transition response leaves a durable intent and uncertain failure', async t => {
  const f = fixture(t)
  const request = async (...args) => {
    const result = await f.request(...args)
    if (args[0] === '/api/issues/do_transition') throw new Error('Lost response')
    return result
  }
  await assert.rejects(reconcile({ ...f.args, request, dryRun: false }), /REVIEW_EXECUTION_FAILED/)
  assert.equal(f.issue.issueStatus, 'FALSE_POSITIVE')
  assert.ok(f.events.some(event => event.action === 'transition_intent'))
  assert.equal((await reconcile({ ...f.args, dryRun: false })).unchanged, 1)
})
test('changed issue state between inventory and mutation is not overwritten', async t => {
  const f = fixture(t)
  const request = async (path, params, method) => {
    if (params?.issues) f.issue.issueStatus = 'ACCEPTED'
    return f.request(path, params, method)
  }
  await assert.rejects(reconcile({ ...f.args, request, dryRun: false }), /REVIEW_ISSUE_CHANGED/)
  assert.deepEqual(writes(f), [])
})
test('false-positive response must identify exact key and final state', async t => {
  const f = fixture(t)
  const request = async (...args) => args[0] === '/api/issues/do_transition'
    ? { issue: { key: f.issue.key, issueStatus: 'ACCEPTED' } } : f.request(...args)
  await assert.rejects(reconcile({ ...f.args, request, dryRun: false }), /REVIEW_TRANSITION_NOT_VERIFIED/)
})
test('canonical rule hash ignores response timestamps and parameter ordering', () => {
  const rule = { key: 'javascript:S1', name: 'Rule', htmlDesc: 'Meaning', type: 'BUG', repo: 'javascript',
    params: [{ key: 'b', defaultValue: '2' }, { key: 'a', defaultValue: '1' }] }
  assert.equal(ruleFingerprint(rule), ruleFingerprint({ ...rule, createdAt: 'later', params: [...rule.params].reverse() }))
  assert.notEqual(ruleFingerprint(rule), ruleFingerprint({ ...rule, htmlDesc: 'New meaning' }))
})
test('installed description sections are hashed when htmlDesc is null', () => {
  const rule = { key: 'javascript:S1', name: 'Rule', htmlDesc: null, type: 'BUG', repo: 'javascript',
    descriptionSections: [{ key: 'root_cause', content: 'Original meaning' }] }
  assert.notEqual(ruleFingerprint(rule), ruleFingerprint({ ...rule, descriptionSections: [{ key: 'root_cause', content: 'Changed meaning' }] }))
  assert.throws(() => ruleFingerprint({ ...rule, descriptionSections: [] }), /REVIEW_RULE_INVALID/)
})
test('legacy checkout without review manifest performs no API calls', async t => {
  const f = fixture(t, false)
  assert.equal((await reconcile(f.args)).status, 'no_reviews'); assert.deepEqual(f.calls, [])
})
test('deleting a tracked manifest cannot bypass review verification', async t => {
  const f = fixture(t); rmSync(join(f.root, 'docs/sonarqube/reviewed-false-positives.json'))
  await assert.rejects(reconcile({ ...f.args, dryRun: false }), /REVIEW_CHECKOUT_CHANGED/)
  assert.deepEqual(f.calls, [])
})
