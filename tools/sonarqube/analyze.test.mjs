import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localUrl, preflight } from './analyze.mjs'

test('local-only destination rejects external hosts, userinfo, paths and query secrets', () => {
  assert.equal(localUrl(), 'http://127.0.0.1:9000')
  assert.equal(localUrl('http://localhost:9000'), 'http://127.0.0.1:9000')
  for (const url of ['https://example.com', 'http://127.0.0.1.evil', 'http://u:secret@localhost:9000', 'http://localhost:9000/x', 'http://localhost:9000?token=secret', 'http://0.0.0.0:9000', 'invalid']) {
    assert.throws(() => localUrl(url))
  }
})

test('preflight requires supported runtime, env token, real LCOV and existing sources', () => {
  const root = mkdtempSync(join(tmpdir(), 'na-sonar-preflight-'))
  try {
    mkdirSync(join(root, 'src')); mkdirSync(join(root, 'coverage'))
    writeFileSync(join(root, 'sonar-project.properties'), 'sonar.sources=src\n')
    const options = { root, env: { SONAR_TOKEN: 'synthetic-test-token' }, version: '24.21.0' }
    assert.throws(() => preflight(options), /coverage/)
    writeFileSync(join(root, 'coverage/lcov.info'), 'SF:src/example.ts\nDA:1,1\nend_of_record\n')
    assert.equal(preflight(options).scannerVersion, '5.0.2')
    for (const name of ['SONAR_SCANNER_JSON_PARAMS', 'SONARQUBE_SCANNER_PARAMS', 'SONAR_SCANNER_OPTS', 'JAVA_TOOL_OPTIONS']) {
      assert.throws(() => preflight({ ...options, env: { ...options.env, [name]: 'unreviewed' } }), /overrides/)
    }
    assert.throws(() => preflight({ ...options, env: {} }), /SONAR_TOKEN/)
    assert.throws(() => preflight({ ...options, version: '20.20.2' }), /Node.js/)
    writeFileSync(join(root, 'sonar-project.properties'), 'sonar.sources=missing\n')
    assert.throws(() => preflight(options), /source path/)
    writeFileSync(join(root, 'sonar-project.properties'), 'sonar.sources=src\nsonar.token=secret\n')
    assert.throws(() => preflight(options), /Credentials/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
