const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
for (const [httpCode, expected] of [[401, 'rejected'], [403, 'rejected'], [502, 'http'], [0, 'refused']]) {
  test(`registration exposes safe diagnostic for ${httpCode || 'connection refused'}`, async t => {
    const server = http.createServer((req, res) => { res.writeHead(httpCode); res.end() })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const port = server.address().port
    if (!httpCode) await new Promise(r => server.close(r))
    t.after(() => server.close())
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-diagnostic-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const token = 'diagnostic-private-token'
    const tokenFile = path.join(root, 'token'), statusFile = path.join(root, 'status.json')
    fs.writeFileSync(tokenFile, token)
    const args = process.env.AGENT_TEST_EXECUTABLE ? [] : [path.resolve('apps/agent/src/index.js')]
    args.push('--check', '--server', `ws://127.0.0.1:${port}`, '--token-file', tokenFile, '--status-file', statusFile)
    const child = spawn(process.env.AGENT_TEST_EXECUTABLE || process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    t.after(() => { if (child.exitCode === null) child.kill() })
    let output = ''
    child.stdout.on('data', d => { output += d }); child.stderr.on('data', d => { output += d })
    const [code] = await once(child, 'exit')
    assert.equal(code, 2)
    const status = fs.readFileSync(statusFile, 'utf8')
    assert.equal(JSON.parse(status).diagnostic, expected)
    assert.ok(!status.includes(token)); assert.ok(!output.includes(token))
  })
}
