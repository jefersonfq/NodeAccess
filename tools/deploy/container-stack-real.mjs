/** Opt-in tests of built images. No .env, existing containers, or production data. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { PrismaClient } from '@prisma/client'
import speakeasy from 'speakeasy'
import bcrypt from 'bcrypt'
import WebSocket from 'ws'

if (process.env.RUN_CONTAINER_STACK_REAL !== 'true') throw Error('Set RUN_CONTAINER_STACK_REAL=true for disposable container tests')
const root = resolve(import.meta.dirname, '../..')
const output = resolve(process.env.CONTAINER_TEST_OUTPUT || '/tmp/nodeaccess-container-stack')
mkdirSync(output, { recursive: true })
const images = { ...JSON.parse(readFileSync(resolve(root, 'docker/stack-images.json'))),
  sshLab: 'lscr.io/linuxserver/openssh-server@sha256:39ba37d50fdd6be1bf70644c871e5dcb9234ee79ac56424ea03ca08cadf1e7b0',
  backend: process.env.STACK_BACKEND_IMAGE || 'nodeaccess-backend:security-local',
  frontend: process.env.STACK_FRONTEND_IMAGE || 'nodeaccess-frontend:security-local',
  kubernetes: process.env.STACK_K8S_IMAGE || 'nodeaccess-frontend-k8s:security-local',
  tls: process.env.STACK_TLS_IMAGE || 'nodeaccess-tls-agent:security-local' }
const prefix = `na-container-test-${randomBytes(6).toString('hex')}`
const password = randomBytes(24).toString('hex'), jwt = randomBytes(32).toString('hex')
const secrets = [password, jwt]
const containers = [], report = { passed: false, images: {}, checks: [] }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const clean = value => secrets.reduce((text, secret) => text.replaceAll(secret, '[disposable]'), String(value))
function run(command, args, options = {}) {
  try { return execFileSync(command, args, { cwd: root, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...options }).trim() }
  catch (error) { throw Error(clean(`${command} failed: ${error.stderr || error.message}`)) }
}
const docker = (args, options) => run('docker', args, options)
const common = ['--network', prefix, '--label', `nodeaccess.container-test=${prefix}`]
function start(role, image, args = [], command = []) {
  const name = `${prefix}-${role}`
  docker(['run', '-d', '--name', name, ...common, '--network-alias', role, ...args, image, ...command])
  containers.push(name); return name
}
const port = (name, internal) => docker(['port', name, `${internal}/tcp`]).split(':').at(-1)
async function until(action, label, attempts = 90) {
  let last
  for (let i = 0; i < attempts; i++) {
    try { return await action() } catch (error) { last = error; await sleep(500) }
  }
  throw Error(`${label} deadline: ${clean(last?.message)}`)
}
let ca, db
function request(base, path, { method = 'GET', body, token } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body)
    const url = new URL(path, base), transport = url.protocol === 'https:' ? https : http
    const req = transport.request(url, { method, ca, timeout: 8000, headers: {
      ...(data && { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }),
      ...(token && { authorization: `Bearer ${token}` }),
    } }, response => {
      let text = ''
      response.setEncoding('utf8').on('data', chunk => { text += chunk }).on('end', () => {
        let json; try { json = JSON.parse(text) } catch { /* static asset */ }
        resolve({ status: response.statusCode, headers: response.headers, text, json })
      })
    })
    req.on('timeout', () => req.destroy(Error('HTTP deadline'))).on('error', reject)
    req.end(data)
  })
}
async function rejectedSocket(base, token, hostId = 1) {
  await new Promise((resolve, reject) => {
    const url = new URL(`/ws/ssh/${hostId}?token=${encodeURIComponent(token)}`, base)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url, { ca, origin: 'https://localhost', handshakeTimeout: 5000 })
    const timer = setTimeout(() => { socket.terminate(); reject(Error('WS rejection deadline')) }, 8000)
    socket.on('error', error => { clearTimeout(timer); reject(error) })
    socket.on('close', code => {
      clearTimeout(timer)
      try { assert.equal(code, 1008, 'Proxy upgrades WS and gateway rejects invalid credentials'); resolve() } catch (error) { reject(error) }
    })
  })
}
async function sshConnection(base, token, hostId) {
  const url = new URL(`/ws/ssh/${hostId}?token=${encodeURIComponent(token)}`, base); url.protocol = 'wss:'
  const socket = new WebSocket(url, { ca, origin: 'https://localhost', handshakeTimeout: 5000 })
  const state = { frames: [], output: '', closed: false, error: null }
  socket.on('message', (data, binary) => {
    if (binary) state.output += data.toString()
    else {
      const frame = JSON.parse(data.toString()); state.frames.push(frame)
      if (frame.type === 'credentials_required') socket.send(JSON.stringify({ type: 'credentials_response', username: 'stacklab', password }))
      if (frame.type === 'error') state.error = Error(`SSH gateway: ${frame.code || frame.message}`)
    }
  })
  socket.on('close', () => { state.closed = true })
  socket.on('error', error => { state.error = error })
  const waitFor = predicate => until(() => {
    if (state.error) throw state.error
    const result = predicate(state)
    if (!result) throw Error(state.closed ? 'SSH socket closed' : `Waiting for SSH output; frames=${state.frames.map(f => f.type).join(',')}; tail=${clean(state.output.slice(-500))}`)
    return result
  }, 'SSH protocol', 40)
  const frame = type => waitFor(s => s.frames.find(frame => frame.type === type))
  return { socket, state, waitFor, frame }
}
try {
  for (const [name, image] of Object.entries(images).filter(([name]) => ['backend', 'frontend', 'kubernetes', 'tls', 'mysql', 'redis'].includes(name))) {
    report.images[name] = { ref: image, id: docker(['image', 'inspect', '--format', '{{.Id}}', image]) }
  }
  // Dedicated bridge; every published port is explicitly bound to host loopback.
  docker(['network', 'create', '--label', `nodeaccess.container-test=${prefix}`, prefix])
  const mysql = start('mysql', images.mysql, ['--memory', '1g', '-p', '127.0.0.1::3306',
    '-e', `MYSQL_ROOT_PASSWORD=${password}`, '-e', 'MYSQL_DATABASE=stack_test', '-e', 'MYSQL_USER=stack_app', '-e', `MYSQL_PASSWORD=${password}`],
    ['--innodb-buffer-pool-size=128M', '--max-connections=80'])
  const redis = start('redis', images.redis)
  const ssh = start('ssh-lab', images.sshLab, ['-e', 'USER_NAME=stacklab', '-e', 'PASSWORD_ACCESS=true', '-e', `USER_PASSWORD=${password}`,
    '-e', 'SUDO_ACCESS=false', '-e', 'PUID=1000', '-e', 'PGID=1000'])
  await until(() => docker(['exec', ssh, 'sh', '-c', 'nc -z 127.0.0.1 2222']), 'OpenSSH readiness')
  db = new PrismaClient({ datasources: { db: { url: `mysql://stack_app:${password}@127.0.0.1:${port(mysql, 3306)}/stack_test` } } })
  await until(() => db.$queryRaw`SELECT 1`, 'MySQL', 180)
  const environment = ['-e', `DATABASE_URL=mysql://stack_app:${password}@mysql:3306/stack_test`, '-e', 'REDIS_URL=redis://redis:6379',
    '-e', `JWT_SECRET=${jwt}`, '-e', `PEM_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`, '-e', 'APP_URL=https://localhost',
    '-e', 'FEATURE_SESSION_AUDIT=true', '-e', 'SESSION_AUDIT_STORAGE_DIR=/tmp/nodeaccess-stack-audit']
  docker(['run', '--rm', '--user', '1000:1000', '--read-only', '--tmpfs', '/tmp', ...common, ...environment, images.backend,
    'node', 'node_modules/prisma/build/index.js', 'migrate', 'deploy'])
  docker(['run', '--rm', ...common, ...environment, images.backend, 'node', 'node_modules/prisma/build/index.js', 'migrate', 'deploy'])
  docker(['run', '--rm', images.backend, 'node', '-e', `for (const name of ['vitest', 'vite', 'playwright', 'eslint']) { try { require.resolve(name); throw Error(name + ' leaked into runtime') } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e } } for (const name of ['npm','npx','yarn']) { if (require('fs').existsSync('/usr/local/bin/' + name)) throw Error(name + ' leaked into runtime') } require('bcrypt'); require('@prisma/client'); require('dotenv/config')`])
  report.checks.push('Runtime: real migrations twice including non-root/read-only, native bcrypt/client load, development tools/package managers removed')
  const tenants = await Promise.all(['a', 'b'].map(slug => db.tenant.create({ data: { name: `Disposable ${slug}`, slug: `${prefix}-${slug}` } })))
  const users = await Promise.all(tenants.map((tenant, i) => db.user.create({ data: {
    tenantId: tenant.id, name: 'Compatibility', email: `user${i}@example.invalid`, passwordHash: bcrypt.hashSync(password, 6), role: 'ADMIN',
  } })))
  const hosts = await Promise.all(users.map(user => db.host.create({ data: {
    tenantId: user.tenantId, ownerId: user.id, name: `Host ${user.id}`, ip: 'ssh-lab', port: 2222, sshUser: 'stacklab', authType: 'PASSWORD', scope: 'PERSONAL',
  } })))
  const api = start('api', images.backend, [...environment, '-e', 'APP_MODE=api', '-p', '127.0.0.1::3000'])
  const gateway = start('ssh-gateway', images.backend, [...environment, '-e', 'APP_MODE=gateway'])
  const direct = `http://127.0.0.1:${port(api, 3000)}`
  await until(async () => assert.equal((await request(direct, '/health/ready')).status, 200), 'API readiness')
  const certDir = resolve(output, 'certs'); mkdirSync(certDir, { recursive: true })
  run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-keyout', resolve(certDir, 'privkey.pem'), '-out', resolve(certDir, 'fullchain.pem')])
  ca = readFileSync(resolve(certDir, 'fullchain.pem'))
  const web = start('web', images.frontend, ['-p', '127.0.0.1::443', '-v', `${certDir}:/etc/nginx/certs:ro`])
  const k8s = start('web-k8s', images.kubernetes, ['-p', '127.0.0.1::8080'])
  const bases = [`https://127.0.0.1:${port(web, 443)}`, `http://127.0.0.1:${port(k8s, 8080)}`]
  for (const base of bases) {
    await until(async () => assert.equal((await request(base, '/health/ready')).status, 200), 'Proxy readiness')
    const page = await request(base, '/login?token=log-leak-probe')
    assert.equal(page.status, 200); assert.match(page.text, /<div id="app">/)
    assert.equal(page.headers['x-content-type-options'], 'nosniff')
    assert.equal(page.headers['x-frame-options'], 'SAMEORIGIN')
    assert.match(page.headers['content-security-policy-report-only'], /object-src 'none'/)
    const asset = page.text.match(/src="(\/assets\/[^\"]+\.js)"/)[1]
    const js = await request(base, asset)
    assert.equal(js.status, 200); assert.match(js.headers['cache-control'], /immutable/)
    assert.equal(js.headers['x-content-type-options'], 'nosniff')
    await rejectedSocket(base, 'invalid-credential')
  }
  assert.equal(docker(['exec', k8s, 'id', '-u']), '101')
  assert.match(docker(['run', '--rm', '--entrypoint', 'node', images.tls, '--version']), /^v24\.21\.0$/)
  report.checks.push('Nginx HTTPS and non-root Kubernetes: trusted TLS, SPA/assets, headers, cache, real WS upgrade/rejection; TLS worker Node 24')
  const base = bases[0]
  const loginBody = { email: users[0].email, password, tenantSlug: tenants[0].slug }
  assert.equal((await request(base, '/api/v1/hosts')).status, 401)
  assert.equal((await request(base, '/api/v1/auth/login', { method: 'POST', body: { ...loginBody, email: 'invalid' } })).status, 400)
  const pending = await request(base, '/api/v1/auth/login', { method: 'POST', body: loginBody })
  assert.equal(pending.status, 200); assert.equal(pending.json.requiresMfaSetup, true)
  secrets.push(pending.json.tempToken)
  assert.equal((await request(base, '/api/v1/hosts', { token: pending.json.tempToken })).status, 401)
  const setup = await request(base, '/api/v1/auth/setup-totp', { method: 'POST', body: { setupToken: pending.json.tempToken } })
  assert.equal(setup.status, 200); assert.match(setup.json.qrCode, /^data:image\/png;base64,/)
  const { mfaSecret } = await db.user.findUniqueOrThrow({ where: { id: users[0].id } })
  secrets.push(mfaSecret)
  const confirmed = await request(base, '/api/v1/auth/confirm-totp', { method: 'POST', body: {
    setupToken: pending.json.tempToken, token: speakeasy.totp({ secret: mfaSecret, encoding: 'base32' }),
  } })
  assert.equal(confirmed.status, 200)
  const tokens = confirmed.json; secrets.push(tokens.accessToken, tokens.refreshToken)
  assert.equal((await request(base, `/api/v1/hosts/${hosts[0].id}`, { token: tokens.accessToken })).status, 200)
  const foreign = await request(base, `/api/v1/hosts/${hosts[1].id}`, { token: tokens.accessToken })
  assert.ok([403, 404].includes(foreign.status), `Foreign tenant host returned ${foreign.status}`)
  const refresh = await request(base, '/api/v1/auth/refresh', { method: 'POST', body: { refreshToken: tokens.refreshToken } })
  assert.equal(refresh.status, 200); secrets.push(refresh.json.accessToken)
  assert.equal((await request(base, '/api/v1/auth/logout', { method: 'POST', body: { refreshToken: tokens.refreshToken } })).status, 204)
  assert.equal((await request(base, '/api/v1/auth/refresh', { method: 'POST', body: { refreshToken: tokens.refreshToken } })).status, 401)
  // Existing MFA login path must continue working, independently of enrollment.
  const second = await request(base, '/api/v1/auth/login', { method: 'POST', body: loginBody })
  assert.equal(second.status, 200); assert.equal(second.json.requiresMfaSetup, false)
  secrets.push(second.json.tempToken)
  const verified = await request(base, '/api/v1/auth/verify-totp', { method: 'POST', body: {
    setupToken: second.json.tempToken, token: speakeasy.totp({ secret: mfaSecret, encoding: 'base32' }),
  } })
  assert.equal(verified.status, 200)
  secrets.push(verified.json.accessToken, verified.json.refreshToken)
  report.checks.push('Real HTTP: schema validation, password login, MFA enrollment/verification, temporary-token denial, tenant isolation, refresh and logout revocation')
  await rejectedSocket(base, verified.json.accessToken, hosts[1].id)
  const firstSsh = await sshConnection(base, verified.json.accessToken, hosts[0].id)
  try {
    const untrusted = await firstSsh.frame('host_key_verification_required')
    assert.match(untrusted.presentedFingerprint, /^SHA256:/)
    const publicKeys = docker(['exec', ssh, 'sh', '-c', 'find /config -name "ssh_host_*.pub" -exec ssh-keygen -lf {} \\;'])
    // OpenSSH prints unpadded base64; NodeAccess stores the full digest encoding.
    assert.ok(publicKeys.split('\n').some(line => line.split(/\s+/)[1] === untrusted.presentedFingerprint.replace(/=+$/, '')),
      'Fingerprint independently verified against the disposable SSH server')
    const trusted = await request(base, `/api/v1/hosts/${hosts[0].id}/trust-host-key`, {
      method: 'POST', token: verified.json.accessToken, body: { fingerprint: untrusted.presentedFingerprint },
    })
    assert.equal(trusted.status, 200)
    await firstSsh.waitFor(s => s.closed)
  } finally { firstSsh.socket.terminate() }
  const connectedSsh = await sshConnection(base, verified.json.accessToken, hosts[0].id)
  try {
    const connected = await connectedSsh.frame('connected')
    connectedSsh.socket.send(JSON.stringify({ type: 'resize', cols: 101, rows: 31 }))
    connectedSsh.socket.send(Buffer.from("stty size; printf 'ação 日本語\\n' > \"$HOME/migration-check.txt\"; printf '%s%s\\n' 'NA_STACK_' 'OK'\r"))
    await connectedSsh.waitFor(s => s.output.includes('NA_STACK_OK') && /[\r\n]31 101[\r\n]/.test(s.output))
    connectedSsh.socket.send(JSON.stringify({ type: 'sftp_home', requestId: 'home' }))
    const home = await connectedSsh.frame('sftp_result'); assert.equal(home.ok, true)
    connectedSsh.socket.send(JSON.stringify({ type: 'sftp_list', requestId: 'listing', path: home.home }))
    const listing = await connectedSsh.waitFor(s => s.frames.find(frame => frame.type === 'sftp_result' && frame.requestId === 'listing'))
    assert.equal(listing.ok, true)
    assert.ok(listing.entries.some(entry => entry.name === 'migration-check.txt'))
    connectedSsh.socket.close()
    await connectedSsh.waitFor(s => s.closed)
    await until(async () => assert.ok((await db.session.findUniqueOrThrow({ where: { id: connected.sessionId } })).endedAt), 'SSH session cleanup')
  } finally { connectedSsh.socket.terminate() }
  report.checks.push('Actual gateway -> disposable OpenSSH: cross-tenant denial, host-key challenge/verified approval, interactive credentials, shell, PTY resize, SFTP home/list and persisted session cleanup')
  docker(['stop', '-t', '10', redis])
  await until(async () => assert.equal((await request(direct, '/health/ready')).status, 503), 'Degraded readiness', 30)
  assert.equal((await request(direct, '/health/live')).status, 200)
  docker(['start', redis])
  await until(async () => assert.equal((await request(direct, '/health/ready')).status, 200), 'Recovered readiness')
  report.checks.push('Redis unavailable: ready=503, live=200, readiness recovers after restart')
  for (const name of [api, gateway]) {
    docker(['stop', '-t', '30', name])
    assert.equal(docker(['inspect', '--format', '{{.State.ExitCode}}', name]), '0', 'Graceful shutdown without forced kill')
  }
  assert.ok(!docker(['logs', web]).includes('log-leak-probe'), 'Access log must omit query strings')
  report.checks.push('API and gateway SIGTERM exit cleanly; Nginx access logs omit query tokens')
  report.passed = true
} catch (error) {
  report.error = clean(error.message)
  for (const name of containers) try { writeFileSync(resolve(output, `${name}.log`), clean(docker(['logs', name])), { mode: 0o600 }) } catch { /* owned resources only */ }
  process.exitCode = 1
} finally {
  await db?.$disconnect()
  for (const name of containers.reverse()) try { docker(['rm', '-f', '-v', name]) } catch { /* own anonymous volumes only */ }
  try { docker(['network', 'rm', prefix]) } catch { /* may not have been created */ }
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify(report, null, 2))
