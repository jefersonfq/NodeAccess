import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assertConfiguration, materializeBaseConfiguration, readConfiguration, verifyScannerContext } from './ci-config.mjs'
const source = 'sonar.projectKey=nodeaccess\nsonar.sources=src\nsonar.tests=tests\nsonar.test.inclusions=**/*.test.js\nsonar.exclusions=sentinel/**\nsonar.sourceEncoding=UTF-8\nsonar.javascript.lcov.reportPaths=coverage/lcov.info\nsonar.python.coverage.reportPaths=coverage/python.xml,coverage/zap-python.xml\n'
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ci-config-test-')), root = join(directory, 'head'), baseRoot = join(directory, 'base')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  mkdirSync(root); mkdirSync(baseRoot)
  const settings = join(root, 'sonar-project.properties'), baseSettings = join(baseRoot, 'sonar-project.properties')
  writeFileSync(settings, source)
  return { directory, root, baseRoot, settings, baseSettings }
}
for (const existing of [false, true]) test(`base receives the candidate bytes when prior config ${existing ? 'differs' : 'is absent'}`, t => {
  const f = fixture(t)
  if (existing) writeFileSync(f.baseSettings, 'sonar.projectKey=wrong\nsonar.sources=.\n')
  const result = materializeBaseConfiguration(f.root, f.baseRoot)
  assert.equal(readFileSync(result.baseSettings, 'utf8'), source)
  assert.deepEqual(readConfiguration(result.baseSettings).properties, result.properties)
  assert.equal(assertConfiguration(f.root, f.settings, result.sha256).sha256, result.sha256)
  assert.equal(readFileSync(f.settings, 'utf8'), source)
})
test('base symlink cannot redirect config writes outside the disposable base', t => {
  const f = fixture(t), outside = join(f.directory, 'outside')
  writeFileSync(outside, 'preserve'); symlinkSync(outside, f.baseSettings)
  materializeBaseConfiguration(f.root, f.baseRoot)
  assert.equal(readFileSync(outside, 'utf8'), 'preserve'); assert.equal(readFileSync(f.baseSettings, 'utf8'), source)
})
test('settings location, mutation, unsupported syntax and duplicate keys fail closed', t => {
  const f = fixture(t), config = readConfiguration(f.settings)
  assert.throws(() => assertConfiguration(f.root, join(f.root, 'alternative.properties')), /CI_SETTINGS_LOCATION_MISMATCH/)
  assert.throws(() => materializeBaseConfiguration(f.root, f.root), /CI_DISTINCT_BASE_REQUIRED/)
  for (const text of ['sonar.sources=src', source + 'sonar.sources=other\n', source + 'sonar.token=private\n', source.replace('src', '${env.SOURCE}'), source.replace('src', 'sr\\c')]) {
    writeFileSync(f.settings, text); assert.throws(() => readConfiguration(f.settings), /CI_(UNSUPPORTED_SETTINGS|REQUIRED_SETTINGS_MISSING)/)
  }
  writeFileSync(f.settings, source + '# changed\n'); assert.throws(() => assertConfiguration(f.root, f.settings, config.sha256), /CI_SETTINGS_CHANGED/)
  rmSync(f.settings); symlinkSync(f.baseRoot, f.settings); assert.throws(() => readConfiguration(f.settings), /CI_SETTINGS_REGULAR_FILE_REQUIRED/)
})
test('effective context proves configured scope and discards every non-allowlisted field', t => {
  const f = fixture(t), config = readConfiguration(f.settings), runtime = { root: f.root, revision: 'a'.repeat(40) }
  const context = ['Project scanner properties:', ...Object.entries(config.properties).map(([key,value]) => `  - ${key}=${value}`),
    `sonar.projectBaseDir=${f.root}`, `sonar.projectVersion=${runtime.revision}`, 'sonar.scm.disabled=true', `sonar.scm.revision=${runtime.revision}`, 'sonar.qualitygate.wait=false', 'sonar.token=private', 'ENV_SECRET=private'].join('\n')
  const result = verifyScannerContext(context, config, runtime)
  assert.equal(result.contextVerified, true); assert.deepEqual(result.effectiveProperties, config.properties)
  assert.ok(!JSON.stringify(result).includes('private'))
  assert.throws(() => verifyScannerContext(context.replace('sonar.python.coverage.reportPaths=coverage/python.xml', 'sonar.python.coverage.reportPaths=other.xml'), config, runtime), /CI_SCANNER_CONTEXT_MISMATCH/)
  assert.throws(() => verifyScannerContext(context.replace('sonar.python.coverage.reportPaths=coverage/python.xml', ''), config, runtime), /CI_SCANNER_CONTEXT_MISMATCH/)
  assert.throws(() => verifyScannerContext(undefined, config, runtime), /CI_SCANNER_CONTEXT_MISSING/)
  assert.throws(() => verifyScannerContext('', config, runtime), /CI_SCANNER_CONTEXT_MISSING/)
  assert.throws(() => verifyScannerContext(context.replace('sonar.tests=tests', 'sonar.tests=default'), config, runtime), /CI_SCANNER_CONTEXT_MISMATCH/)
  assert.throws(() => verifyScannerContext(context.replace(`sonar.scm.revision=${runtime.revision}`, 'sonar.scm.revision=wrong'), config, runtime), /CI_SCANNER_CONTEXT_MISMATCH/)
  for (const key of ['sonar.inclusions', 'sonar.test.exclusions', 'sonar.coverage.exclusions', 'sonar.cpd.exclusions', 'sonar.global.exclusions', 'sonar.global.test.exclusions']) {
    assert.throws(() => verifyScannerContext(context + `\n${key}=**/private/**`, config, runtime), /CI_SCANNER_SCOPE_OVERRIDE/)
    assert.equal(verifyScannerContext(context + `\n${key}=`, config, runtime).contextVerified, true)
  }
  assert.throws(() => verifyScannerContext(context + '\nsonar.sources=wrong', config, runtime), /CI_SCANNER_CONTEXT_AMBIGUOUS/)
})

test('current repository scanner settings satisfy the strict CI contract', () => {
  const config = readConfiguration(new URL('../../sonar-project.properties', import.meta.url))
  assert.equal(config.properties['sonar.python.coverage.reportPaths'], 'coverage/python.xml,coverage/zap-python.xml')
})
