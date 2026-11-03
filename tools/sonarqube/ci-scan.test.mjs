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
  const cli = join(directory, 'fixture-cli.mjs')
  writeFileSync(cli, `import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
assert.ok(process.argv.includes('--package=@sonar/scan@5.0.2'));
assert.ok(process.argv.includes('-Dsonar.scm.disabled=true'));
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
  const input = { root: directory, settings: join(directory, 'settings'), revision: 'a'.repeat(40),
    instance: { server: `http://127.0.0.1:${server.address().port}` }, tokens: { scan: 'private-token' }, output: directory }
  assert.equal(await scan({ ...input, stage: 'success' }), 'analysis-fixture')
  taskStatus = 'FAILED'
  await assert.rejects(scan({ ...input, stage: 'failed' }), /CI_ANALYSIS_FAILED/)
  taskStatus = 'SUCCESS'; id = 'foreign-task'
  await assert.rejects(scan({ ...input, stage: 'foreign' }), /CI_TASK_IDENTITY_MISMATCH/)
  writeFileSync(cli, 'process.exitCode = 1;')
  await assert.rejects(scan({ ...input, stage: 'scanner-failed' }), /CI_SCANNER_FAILED/)
  writeFileSync(cli, `import { writeFileSync } from 'node:fs'; const file = process.argv.find(arg => arg.startsWith('-Dsonar.scanner.metadataFilePath=')).split('=').slice(1).join('='); writeFileSync(file, 'ceTaskId=task\\nprojectKey=foreign\\nserverUrl=http://127.0.0.1:9000\\n');`)
  await assert.rejects(scan({ ...input, stage: 'metadata-failed' }), /CI_TASK_METADATA_MISMATCH/)
})
