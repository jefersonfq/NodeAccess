const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { projectCatalog, loadSecurityCenter, securityCenterPlugin, evidenceHash } = require('./build.cjs')
function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'na-security-catalog-'))
  fs.mkdirSync(path.join(root, 'docs/security'), { recursive: true })
  fs.writeFileSync(path.join(root, 'control.js'), 'export const control = true')
  fs.writeFileSync(path.join(root, 'control.test.js'), 'test evidence')
  const catalog = {
    schemaVersion: 1, revision: '1', reviewedAt: '2026-11-06', internalMetadata: 'PRIVATE_TOP_SENTINEL', practices: ['Confira o destino.'],
    controls: [{ id: 'sample', state: 'verified', internalDescription: 'PRIVATE_CONTROL_SENTINEL', owner: 'PRIVATE_OWNER_SENTINEL',
      review: { method: 'source-review', reviewedAt: '2026-11-06', sourceRevision: 'a'.repeat(40), sourceFiles: ['control.js'], sourceHash: evidenceHash(root, ['control.js']), testFiles: ['control.test.js'], testsExecuted: false, scope: 'Source inspection' },
      public: { title: 'Controle', summary: 'Resumo', details: ['Explicação'], conditions: [], privateExtra: 'PRIVATE_PUBLIC_SENTINEL' } }],
  }
  const save = () => fs.writeFileSync(path.join(root, 'docs/security/controls-catalog.json'), JSON.stringify(catalog))
  try { return run({ root, catalog, save }) } finally { fs.rmSync(root, { recursive: true, force: true }) }
}
test('real catalog exports reviewed plain-text content only and makes no runtime status claim', () => {
  const result = loadSecurityCenter()
  assert.deepEqual(result.sections.map(section => section.id), ['identity', 'permissions', 'credentials', 'connections', 'audit', 'quality'])
  assert.equal(result.sections.length, 6)
  assert.ok(result.sections.every(section => section.conditions.length > 0))
  assert.match(result.sections.find(section => section.id === 'audit').conditions[0], /não confirma.*gravada/)
  assert.deepEqual(Object.keys(result), ['revision', 'reviewedAt', 'sections', 'practices'])
  for (const section of result.sections) assert.deepEqual(Object.keys(section), ['id', 'title', 'summary', 'details', 'conditions'])
  const serialized = JSON.stringify(result)
  for (const forbidden of ['sourceRevision', 'sourceFiles', 'sourceHash', 'testsExecuted', 'internalDescription', 'internalClassification', 'apps/backend', 'future-zap-mutation', 'future-adaptive', 'future-ssh-ca', 'runtime-installation']) assert.equal(serialized.includes(forbidden), false)
})
test('projection deeply selects permitted fields and excludes planned/unverified content', () => fixture(({ root, catalog }) => {
  catalog.controls.push({ id: 'future', state: 'planned', public: { title: 'PRIVATE_FUTURE_SENTINEL' } }, { id: 'unknown-runtime', state: 'unverified', public: { title: 'PRIVATE_RUNTIME_SENTINEL' } })
  const result = projectCatalog(catalog, root)
  assert.deepEqual(result, { revision: '1', reviewedAt: '2026-11-06', sections: [{ id: 'sample', title: 'Controle', summary: 'Resumo', details: ['Explicação'], conditions: [] }], practices: ['Confira o destino.'] })
  assert.equal(JSON.stringify(result).includes('PRIVATE_'), false)
  result.sections[0].details[0] = 'Changed projected result'
  assert.equal(catalog.controls[0].public.details[0], 'Explicação')
}))
test('Vite loads only the projected virtual module and watches review inputs', () => fixture(({ root, catalog, save }) => {
  save()
  const plugin = securityCenterPlugin(root), watched = []
  assert.equal(plugin.resolveId('other'), undefined)
  assert.equal(plugin.resolveId('virtual:nodeaccess-security-center'), '\0nodeaccess-security-center')
  assert.equal(plugin.load('other'), undefined)
  const code = plugin.load.call({ addWatchFile: file => watched.push(file) }, '\0nodeaccess-security-center')
  assert.equal(code.startsWith('export default '), true)
  assert.deepEqual(JSON.parse(code.slice('export default '.length)), projectCatalog(catalog, root))
  assert.equal(code.includes('PRIVATE_'), false)
  assert.deepEqual(watched, [path.join(root, 'docs/security/controls-catalog.json'), path.join(root, 'control.js')])
  fs.writeFileSync(path.join(root, 'control.js'), 'changed implementation')
  assert.throws(() => loadSecurityCenter(root), /Review is stale/)
}))
test('partial claims require meaningful conditions and still require reviewed evidence', () => fixture(({ root, catalog }) => {
  catalog.controls[0].state = 'partial'
  assert.throws(() => projectCatalog(catalog, root), /Invalid security text list/)
  catalog.controls[0].public.conditions = ['Depende da configuração.']
  assert.equal(projectCatalog(catalog, root).sections.length, 1)
  delete catalog.controls[0].review
  assert.throws(() => projectCatalog(catalog, root), /Source review required/)
}))
test('unknown states, duplicate IDs and catalogs with no publishable control fail closed', () => fixture(({ root, catalog }) => {
  catalog.controls[0].state = 'enabled'
  assert.throws(() => projectCatalog(catalog, root), /Unknown security control state/)
  catalog.controls[0].state = 'verified'
  catalog.controls.push({ id: 'sample', state: 'planned' })
  assert.throws(() => projectCatalog(catalog, root), /Duplicate security control/)
  catalog.controls.pop(); catalog.controls[0].state = 'planned'
  assert.throws(() => projectCatalog(catalog, root), /No reviewed security content/)
}))
test('unsupported schema and malformed content cannot be silently published', () => fixture(({ root, catalog }) => {
  for (const mutate of [
    c => { c.schemaVersion = 2 }, c => { c.revision = '' }, c => { c.reviewedAt = '2026-02-31' },
    c => { c.controls = [] }, c => { c.controls[0].id = '../private' }, c => { c.controls[0].public = null },
    c => { c.controls[0].public.title = 12 }, c => { c.controls[0].public.details = [] },
    c => { c.controls[0].public.summary = '<script>alert(1)</script>' }, c => { c.practices = null },
    c => { c.practices = [''] }, c => { c.practices = ['x'.repeat(2001)] },
  ]) {
    const copy = structuredClone(catalog); mutate(copy)
    assert.throws(() => projectCatalog(copy, root))
  }
}))
test('provenance must identify a reviewed revision, existing tests and unchanged source', () => fixture(({ root, catalog }) => {
  for (const mutate of [
    r => { r.reviewedAt = '2026-11-07' }, r => { r.sourceRevision = 'unknown' }, r => { r.scope = '' },
    r => { r.testsExecuted = true }, r => { r.testFiles = [] }, r => { r.testFiles = ['missing.test.js'] },
    r => { r.sourceHash = '0'.repeat(64) }, r => { r.sourceFiles = [] }, r => { r.sourceFiles = ['control.js', 'control.js'] },
    r => { r.sourceFiles = ['../outside.js'] }, r => { r.sourceFiles = [path.join(root, 'control.js')] },
    r => { r.sourceFiles = ['docs'] },
  ]) {
    const copy = structuredClone(catalog); mutate(copy.controls[0].review)
    assert.throws(() => projectCatalog(copy, root))
  }
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'na-security-outside-'))
  try {
    fs.writeFileSync(path.join(outside, 'source.js'), 'private')
    fs.symlinkSync(path.join(outside, 'source.js'), path.join(root, 'symlink.js'))
    assert.throws(() => evidenceHash(root, ['symlink.js']), /inside repository/)
  } finally { fs.rmSync(outside, { recursive: true, force: true }) }
}))
