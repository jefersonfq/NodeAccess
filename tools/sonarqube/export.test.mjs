import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, mkdir, chmod, readFile, readdir, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportReport, localUrl, client } from './export.mjs'

const token = 'synthetic-sonar-token-do-not-log'
const api = { webServices: [
  { path: 'api/issues', actions: [{ key: 'search', params: ['components', 'resolved', 'p', 'ps'].map(key => ({ key })) }] },
  { path: 'api/hotspots', actions: [{ key: 'search', params: ['project', 'p', 'ps'].map(key => ({ key })) }] },
  { path: 'api/qualitygates', actions: [{ key: 'project_status', params: [{ key: 'projectKey' }] }] },
] }
function json(res, data, status = 200) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }
function page(field, count, url) {
  const p = Number(url.searchParams.get('p'))
  return { paging: { pageIndex: p, pageSize: 100, total: count }, [field]: Array.from({ length: Math.min(100, Math.max(0, count - (p - 1) * 100)) }, (_, i) => ({ key: `${field}-${(p - 1) * 100 + i}`, status: 'TO_REVIEW' })) }
}
async function fixture(t, override = () => false) {
  const dir = await mkdtemp(join(tmpdir(), 'sonar-export-test-'))
  const calls = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    calls.push({ path: url.pathname, query: url.searchParams, authorization: req.headers.authorization })
    if (override(req, res, url, calls)) return
    if (url.pathname === '/api/webservices/list') return json(res, api)
    if (url.pathname === '/api/issues/search') return json(res, page('issues', 205, url))
    if (url.pathname === '/api/hotspots/search') return json(res, page('hotspots', 101, url))
    if (url.pathname === '/api/qualitygates/project_status') return json(res, { projectStatus: { status: 'ERROR', conditions: [] } })
    json(res, {}, 404)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }) })
  return { dir, calls, options: { server: `http://127.0.0.1:${server.address().port}`, token, outputRoot: join(dir, '.sonar-reports'), retryDelayMs: 1, timeoutMs: 1000 } }
}

test('exports every issue/hotspot page, preserves failed gate, private files and redacts token', async t => {
  const f = await fixture(t, (_req, res, url) => {
    if (url.pathname !== '/api/qualitygates/project_status') return false
    json(res, { projectStatus: { status: 'ERROR', conditions: [], debug: token } }); return true
  })
  const { output, summary } = await exportReport(f.options)
  assert.equal(summary.complete, true)
  assert.deepEqual(summary.counts, { issues: 205, hotspots: 101, hotspotsToReview: 101 })
  assert.equal(summary.qualityGate, 'ERROR')
  assert.equal(f.calls.length, 7)
  assert.ok(f.calls.every(call => call.authorization === `Bearer ${token}`))
  assert.equal(f.calls.find(call => call.path === '/api/issues/search').query.get('resolved'), 'false')
  for (const call of f.calls.filter(call => call.path === '/api/issues/search')) {
    assert.equal(call.query.get('components'), 'nodeaccess')
    assert.equal(call.query.has('componentKeys'), false)
  }
  for (const call of f.calls.filter(call => call.path === '/api/hotspots/search')) {
    assert.equal(call.query.get('project'), 'nodeaccess')
    assert.equal(call.query.has('projectKey'), false)
  }
  assert.equal(f.calls.find(call => call.path === '/api/qualitygates/project_status').query.get('projectKey'), 'nodeaccess')
  assert.equal((await stat(f.options.outputRoot)).mode & 0o777, 0o700)
  assert.equal((await stat(output)).mode & 0o777, 0o700)
  for (const file of await readdir(output)) {
    assert.equal((await stat(join(output, file))).mode & 0o777, 0o600)
    assert.ok(!(await readFile(join(output, file), 'utf8')).includes(token))
  }
})

test('refuses non-loopback, URL credentials/path and invalid project keys', async () => {
  for (const url of ['https://localhost:9000', 'http://example.org', 'http://127.0.0.2', 'http://a:b@localhost', 'http://localhost/path', 'http://localhost/?token=bad']) assert.throws(() => localUrl(url))
  assert.equal(localUrl('http://localhost:9000').hostname, '127.0.0.1')
  assert.equal(localUrl('http://[::1]:9000').hostname, '[::1]')
  await assert.rejects(exportReport({ projectKey: '../secrets', token }), { code: 'INVALID_PROJECT_KEY' })
  assert.throws(() => client({ server: 'http://localhost', token: '' }), { code: 'TOKEN_REQUIRED' })
})

test('refuses redirects without forwarding credential', async t => {
  const f = await fixture(t, (_req, res) => { res.writeHead(302, { Location: 'http://external.invalid' }); res.end(token); return true })
  await assert.rejects(exportReport(f.options), { code: 'REDIRECT_REFUSED' })
  assert.equal(f.calls.length, 1)
})

test('refuses missing advertised API contract before querying findings', async t => {
  const f = await fixture(t, (_req, res) => { json(res, { webServices: [] }); return true })
  await assert.rejects(exportReport(f.options), { code: 'API_SCHEMA_MISMATCH' })
  assert.equal(f.calls.length, 1)
})

test('bounded retries recover transient errors', async t => {
  const f = await fixture(t, (_req, res, _url, calls) => {
    if (calls.length <= 2) { json(res, { message: token }, calls.length === 1 ? 429 : 503); return true }
    return false
  })
  assert.equal((await exportReport(f.options)).summary.complete, true)
  assert.equal(f.calls.length, 9)
})

test('authorization fails once, sanitized failure report is explicitly incomplete', async t => {
  const f = await fixture(t, (_req, res) => { json(res, { message: token }, 403); return true })
  await assert.rejects(exportReport(f.options), { code: 'AUTHORIZATION_FAILED' })
  assert.equal(f.calls.length, 1)
  const run = (await readdir(f.options.outputRoot))[0]
  const report = JSON.parse(await readFile(join(f.options.outputRoot, run, 'summary.json'), 'utf8'))
  assert.equal(report.complete, false); assert.equal(report.error, 'AUTHORIZATION_FAILED')
  assert.deepEqual(await readdir(join(f.options.outputRoot, run)), ['summary.json'])
})

test('fails on >10000 results instead of silently truncating', async t => {
  const f = await fixture(t, (_req, res, url) => {
    if (url.pathname !== '/api/issues/search') return false
    json(res, page('issues', 10001, url)); return true
  })
  await assert.rejects(exportReport(f.options), { code: 'RESULT_LIMIT_EXCEEDED' })
})

test('fails on truncated page, changing total and duplicate results', async t => {
  for (const mode of ['truncated', 'changed', 'duplicate']) {
    const f = await fixture(t, (_req, res, url) => {
      if (url.pathname !== '/api/issues/search') return false
      const data = page('issues', 205, url)
      if (mode === 'truncated') data.issues.pop()
      if (Number(url.searchParams.get('p')) === 2) {
        if (mode === 'changed') data.paging.total++
        if (mode === 'duplicate') data.issues[0].key = 'issues-0'
      }
      json(res, data); return true
    })
    await assert.rejects(exportReport(f.options), { code: { truncated: 'RESULTS_TRUNCATED', changed: 'RESULTS_CHANGED_RETRY_EXPORT', duplicate: 'DUPLICATE_OR_INVALID_RESULT' }[mode] })
  }
})

test('rejects malformed JSON and invalid gate status', async t => {
  for (const mode of ['json', 'gate']) {
    const f = await fixture(t, (_req, res, url) => {
      if (mode === 'json') { res.end(token); return true }
      if (url.pathname !== '/api/qualitygates/project_status') return false
      json(res, { projectStatus: { status: token } }); return true
    })
    await assert.rejects(exportReport(f.options), { code: mode === 'json' ? 'INVALID_JSON' : 'QUALITY_GATE_INVALID' })
  }
})

test('network timeout exhausts exactly three attempts', async t => {
  const f = await fixture(t, () => true)
  await assert.rejects(exportReport({ ...f.options, timeoutMs: 20 }), { code: 'NETWORK_OR_TIMEOUT' })
  assert.equal(f.calls.length, 3)
})

test('rejects symlink or public output directories before HTTP', async t => {
  const f = await fixture(t)
  const target = join(f.dir, 'target'); await mkdir(target, { mode: 0o700 })
  await symlink(target, f.options.outputRoot)
  await assert.rejects(exportReport(f.options), { code: 'PRIVATE_DIRECTORY_REQUIRED' })
  await rm(f.options.outputRoot); await mkdir(f.options.outputRoot, { mode: 0o755 })
  await chmod(f.options.outputRoot, 0o755) // Establish the unsafe fixture even under the validator's umask077.
  await assert.rejects(exportReport(f.options), { code: 'PRIVATE_DIRECTORY_REQUIRED' })
  assert.equal(f.calls.length, 0)
})

test('zero findings remain complete and not equivalent to missing gate', async t => {
  const f = await fixture(t, (_req, res, url) => {
    const field = url.pathname === '/api/issues/search' ? 'issues' : url.pathname === '/api/hotspots/search' ? 'hotspots' : null
    if (!field) return false
    json(res, page(field, 0, url)); return true
  })
  const result = await exportReport(f.options)
  assert.deepEqual(result.summary.counts, { issues: 0, hotspots: 0, hotspotsToReview: 0 })
  assert.equal(result.summary.qualityGate, 'ERROR')
})


test('client rejects absolute off-origin endpoints before sending token', async () => {
  const request = client({ server: 'http://127.0.0.1:9000', token })
  await assert.rejects(request('http://example.invalid/api/issues/search'), { code: 'LOCAL_SERVER_REQUIRED' })
})


test('refuses legacy project filter names instead of querying an unscoped project', async t => {
  const legacy = structuredClone(api)
  legacy.webServices[0].actions[0].params[0].key = 'componentKeys'
  legacy.webServices[1].actions[0].params[0].key = 'projectKey'
  const f = await fixture(t, (_req, res) => { json(res, legacy); return true })
  await assert.rejects(exportReport(f.options), { code: 'API_SCHEMA_MISMATCH' })
  assert.equal(f.calls.length, 1)
})
