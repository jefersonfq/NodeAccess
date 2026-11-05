import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scan } from './ci-run.mjs'

test('scanner launches pinned CLI with env-only token and verifies the matching compute task', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'ci-scan-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const settings = join(directory, 'sonar-project.properties')
  writeFileSync(settings, 'sonar.projectKey=nodeaccess\nsonar.sources=src\nsonar.tests=test\nsonar.test.inclusions=**/*.test.js\nsonar.exclusions=sentinel/**\n')
  const cli = join(directory, 'fixture-cli.mjs')
  writeFileSync(cli, `import { writeFileSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
assert.ok(process.argv.includes('--package=@sonar/scan@5.0.2'));
assert.ok(process.argv.includes('-Dsonar.scm.disabled=true'));
assert.ok(process.argv.includes('-Dsonar.scm.revision='+'a'.repeat(40)));
assert.ok(!process.argv.some(arg => arg.startsWith('-Dproject.settings=')));
assert.match(readFileSync('sonar-project.properties','utf8'), /sonar.tests=test/);
assert.ok(!process.argv.some(arg => arg.includes('private-token')));
assert.equal(process.env.SONAR_TOKEN, 'private-token');
assert.equal(process.env.GITHUB_TOKEN, undefined);
const file = process.argv.find(arg => arg.startsWith('-Dsonar.scanner.metadataFilePath=')).split('=').slice(1).join('=');
writeFileSync(file, 'ceTaskId=task-fixture\\nprojectKey=nodeaccess\\nserverUrl=' + process.env.SONAR_HOST_URL + '\\n');
`)
  const old = process.env.npm_execpath
  process.env.npm_execpath = cli
  t.after(() => { if (old === undefined) delete process.env.npm_execpath; else process.env.npm_execpath = old })
  let taskStatus = 'SUCCESS', id = 'task-fixture'
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer private-token')
    assert.equal(req.url, '/api/ce/task?id=task-fixture')
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ task: { id, componentKey: 'nodeaccess', status: taskStatus, analysisId: 'analysis-fixture' } }))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  let scannerContext = ['sonar.projectKey=nodeaccess', 'sonar.sources=src', 'sonar.tests=test', 'sonar.test.inclusions=**/*.test.js', 'sonar.exclusions=sentinel/**',
    `sonar.projectBaseDir=${directory}`, `sonar.projectVersion=${'a'.repeat(40)}`, 'sonar.scm.disabled=true', `sonar.scm.revision=${'a'.repeat(40)}`, 'sonar.qualitygate.wait=false', 'sonar.token=must-not-export'].map(line => `  - ${line}`).join('\n')
  const verified = []
  const input = { root: directory, settings, revision: 'a'.repeat(40), onConfiguration: data => verified.push(data),
    instance: { server: `http://127.0.0.1:${server.address().port}`, admin: async (path, params, method) => {
      assert.equal(path, '/api/ce/task'); assert.equal(params.additionalFields, 'scannerContext'); assert.equal(method, 'GET')
      return { task: { status: 'SUCCESS', id: 'task-fixture', componentKey: 'nodeaccess', analysisId: 'analysis-fixture', scannerContext } }
    } }, tokens: { scan: 'private-token' }, output: directory }
  assert.equal(await scan({ ...input, stage: 'success' }), 'analysis-fixture')
  assert.equal(verified[0].contextVerified, true); assert.ok(!JSON.stringify(verified).includes('must-not-export'))
  const originalContext = scannerContext
  scannerContext = undefined
  await assert.rejects(scan({ ...input, stage: 'context-missing' }), /CI_SCANNER_CONTEXT_MISSING/)
  scannerContext = originalContext.replace('sonar.tests=test', 'sonar.tests=wrong')
  await assert.rejects(scan({ ...input, stage: 'context-wrong' }), /CI_SCANNER_CONTEXT_MISMATCH/)
  scannerContext = originalContext
  taskStatus = 'FAILED'
  await assert.rejects(scan({ ...input, stage: 'failed' }), /CI_ANALYSIS_FAILED/)
  taskStatus = 'SUCCESS'; id = 'foreign-task'
  await assert.rejects(scan({ ...input, stage: 'foreign' }), /CI_TASK_IDENTITY_MISMATCH/)
  writeFileSync(cli, 'process.exitCode = 1;')
  await assert.rejects(scan({ ...input, stage: 'scanner-failed' }), /CI_SCANNER_FAILED/)
  writeFileSync(cli, `import { writeFileSync } from 'node:fs'; const file = process.argv.find(arg => arg.startsWith('-Dsonar.scanner.metadataFilePath=')).split('=').slice(1).join('='); writeFileSync(file, 'ceTaskId=task\\nprojectKey=foreign\\nserverUrl=http://127.0.0.1:9000\\n');`)
  await assert.rejects(scan({ ...input, stage: 'metadata-failed' }), /CI_TASK_METADATA_MISMATCH/)
})
