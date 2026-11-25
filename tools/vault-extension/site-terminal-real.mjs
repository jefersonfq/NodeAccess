#!/usr/bin/env node
/** Explicitly opt-in: production UI/API/gateway -> disposable OpenSSH. No existing .env or hosts. */
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID, createCipheriv } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { chromium } from 'playwright'
import { createServer, build } from 'vite'
import { calculateJwkThumbprint } from 'jose'
import bcrypt from 'bcrypt'
import speakeasy from 'speakeasy'
import jsonwebtoken from 'jsonwebtoken'
import WebSocket from 'ws'
import { resolveExecutable } from '../shared/trusted-executable.cjs'

if (process.env.RUN_SITE_TERMINAL_REAL !== 'true') throw Error('Explicit RUN_SITE_TERMINAL_REAL=true required')
const ROOT = resolve(import.meta.dirname, '../..'), BASE = join(ROOT, '.tmp/NA-0203/site-terminal-real')
mkdirSync(BASE, { recursive: true, mode: 0o700 })
const OUT = mkdtempSync(join(BASE, 'run-')), prefix = `na0203-terminal-${randomBytes(5).toString('hex')}`
const PORTAL = 'https://vault.example.test', SITE = 'https://login.example.test'
const images = { mysql: 'nodeaccess-mysql:8.4.12-1', redis: 'nodeaccess-redis:8.2.10-1', backend: 'nodeaccess-backend:security-local',
  ssh: 'lscr.io/linuxserver/openssh-server@sha256:39ba37d50fdd6be1bf70644c871e5dcb9234ee79ac56424ea03ca08cadf1e7b0' }
const password = randomBytes(24).toString('hex'), jwt = randomBytes(32).toString('hex'), encryptionKey = randomBytes(32).toString('hex')
const sensitive = [password, jwt, encryptionKey], containers = []
const report = { status: 'failed', startedAt: new Date().toISOString(), checks: [], images: {}, boundaries: [
  'Synthetic identity, credentials and site; MySQL, HTTP API, DPoP, portal route, gateway and OpenSSH are real.',
  'Extension enrollment is seeded with a generated non-extractable key; this harness does not certify enrollment/Windows Hello.',
  'Production action popup opened by automated OS shortcut, with reported CDP fallback; not a claimed physical gesture.',
  'Self-signed fixture TLS accepted by Chromium; certificate-chain homologation is outside this test.',
] }
const redact = value => sensitive.reduce((v, secret) => v.replaceAll(secret, '[disposable]'), String(value))
function run(command, args, options = {}) {
  try { return execFileSync(resolveExecutable(command), args, { cwd: ROOT, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...options }).trim() }
  catch (e) { throw Error(redact(`${command}: ${e.stderr || e.message}`)) }
}
const docker = (args, options) => run('docker', args, options)
const delay = ms => new Promise(done => setTimeout(done, ms))
async function until(fn, label, ms = 20000) {
  const end = Date.now() + ms; let last
  while (Date.now() < end) { try { const v = await fn(); if (v) return v } catch (e) { if (e.fatal) throw e; last = e } await delay(100) }
  throw Error(`${label}: ${redact(last?.message ?? 'deadline')}`)
}
function check(name, ok) { assert.ok(ok, name); report.checks.push(name) }
function start(role, image, args = []) {
  const name = `${prefix}-${role}`
  docker(['run', '-d', '--name', name, '--network', prefix, '--network-alias', role, '--label', `nodeaccess.test=${prefix}`, ...args, image])
  containers.push(name); return name
}
const port = (name, internal) => Number(docker(['port', name, `${internal}/tcp`]).split(':').at(-1))
function containerLogs(name) {
  const result = spawnSync(resolveExecutable('docker'), ['logs', '--tail', '100', name], { encoding: 'utf8', timeout: 10000 })
  return redact((result.stdout ?? '') + (result.stderr ?? ''))
}
async function ready(name, base) {
  if (docker(['inspect', '--format', '{{.State.Status}}', name]) === 'exited') {
    const error = Error(`${name} exited: ${containerLogs(name).slice(-4000)}`); error.fatal = true; throw error
  }
  const response = await fetch(`${base}/health/ready`, { signal: AbortSignal.timeout(5000) })
  const body = await response.text()
  if (!response.ok) throw Error(`Readiness ${response.status}: ${redact(body)}`)
  return true
}
function sources(label) {
  const paths = run('git', ['ls-files', '--cached', '--others', '--exclude-standard']).split('\n')
    .filter(p => /^(apps\/(backend|frontend|extension)\/src\/|packages\/shared\/src\/|apps\/backend\/prisma\/|tools\/vault-extension\/site-terminal-real.mjs)/.test(p)
      || ['apps/frontend/vite.config.ts', 'apps/extension/vite.config.ts', 'apps/extension/manifest.ts', 'package-lock.json', 'tsconfig.base.json', 'apps/backend/tsconfig.json', 'packages/shared/tsconfig.json'].includes(p)).sort((a, b) => a.localeCompare(b))
  const manifest = Object.fromEntries(paths.map(p => [p, createHash('sha256').update(readFileSync(join(ROOT, p))).digest('hex')]))
  writeFileSync(join(OUT, `sources-${label}.json`), JSON.stringify(manifest, null, 2))
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
}
function treeHash(directories) {
  const digest = createHash('sha256')
  const visit = directory => { for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) visit(file)
    else if (entry.isFile()) digest.update(file).update(readFileSync(file))
  } }
  for (const directory of directories) visit(directory)
  return digest.digest('hex')
}
function buildBackend() {
  const inputHash = createHash('sha256').update(treeHash([join(ROOT, 'apps/backend/src'), join(ROOT, 'packages/shared/src')]))
  for (const path of ['package-lock.json', 'tsconfig.base.json', 'apps/backend/tsconfig.json', 'packages/shared/tsconfig.json']) inputHash.update(readFileSync(join(ROOT, path)))
  const sourceHash = inputHash.digest('hex'), cacheFile = join(BASE, 'build-cache.json')
  const outputs = [join(ROOT, 'apps/backend/dist'), join(ROOT, 'packages/shared/dist')]
  let cache
  try { cache = JSON.parse(readFileSync(cacheFile, 'utf8')) } catch { /* first build */ }
  if (cache?.sourceHash === sourceHash && outputs.every(existsSync) && cache.outputHash === treeHash(outputs)) {
    report.backendBuild = { ...cache, reused: true }; return
  }
  writeFileSync(join(OUT, 'build-shared.log'), run('npm', ['run', 'build', '-w', 'packages/shared']))
  writeFileSync(join(OUT, 'build-backend.log'), run('npm', ['run', 'build', '-w', 'apps/backend']))
  cache = { sourceHash, outputHash: treeHash(outputs) }
  writeFileSync(cacheFile, JSON.stringify(cache)); report.backendBuild = { ...cache, reused: false }
}
function jsDependencyOverlay() {
  const packages = new Map()
  const lockBytes = readFileSync(join(ROOT, 'package-lock.json')), locked = JSON.parse(lockBytes).packages
  report.dependencyLockHash = createHash('sha256').update(lockBytes).digest('hex')
  function locate(name, from) {
    for (let base = from; ; base = dirname(base)) {
      const candidate = join(base, 'node_modules', name)
      if (existsSync(join(candidate, 'package.json'))) return candidate
      if (base === dirname(base)) throw Error(`Dependency unavailable: ${name}`)
    }
  }
  function visit(name, from = ROOT) {
    const directory = locate(name, from), info = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    if (packages.has(directory)) return
    const installedPath = directory.slice(ROOT.length + 1)
    assert.equal(locked[installedPath]?.version, info.version, `Overlay ${installedPath} must match package-lock`)
    const native = dir => readdirSync(dir, { withFileTypes: true }).some(entry => entry.isDirectory() ? native(join(dir, entry.name)) : entry.name.endsWith('.node'))
    assert.equal(native(directory), false, 'Only JavaScript packages may be overlaid')
    packages.set(directory, { name, version: info.version, directory, fingerprint: treeHash([directory]) })
    for (const dependency of Object.keys(info.dependencies ?? {})) visit(dependency, directory)
  }
  visit('@simplewebauthn/server')
  report.dependencyOverlay = [...packages.values()].map(({ directory, ...entry }) => ({ ...entry, source: directory.slice(ROOT.length + 1) }))
  report.boundaries.push('Runtime image predates WebAuthn: installed JS-only WebAuthn dependencies and transitives mounted read-only; not a packaged-image certification.')
  // Keep nested versions exactly where Node resolves them in the installed dependency tree.
  return [...packages.values()].flatMap(entry => ['-v', `${entry.directory}:/app/${entry.directory.slice(ROOT.length + 1)}:ro`])
}
let db, web, context, display, apiBase, host, user, tokens, worker, target, popupUrl, sockets = []
const pendingPageWaits = []
const terminalStates = new WeakMap()
async function api(path, body, token = tokens?.accessToken) {
  const response = await fetch(`${apiBase}/api/v1${path}`, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(10000),
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const text = await response.text(); let data
  try { data = JSON.parse(text) } catch { data = text }
  assert.ok(response.ok, `${path}: ${response.status} ${redact(text).slice(0, 250)}`)
  return data
}
async function actionPopup() {
  await target.bringToFront()
  const root = await context.newCDPSession(target)
  const find = async () => (await root.send('Target.getTargets')).targetInfos.find(i => i.url === popupUrl)
  // Same real OS shortcut used by sites-smoke; never grant permissions or patch extension APIs.
  run('python3', ['-c', `import ctypes, os
X=ctypes.CDLL('libX11.so.6'); T=ctypes.CDLL('libXtst.so.6')
X.XOpenDisplay.argtypes=[ctypes.c_char_p]; X.XOpenDisplay.restype=ctypes.c_void_p
d=X.XOpenDisplay(os.environ['DISPLAY'].encode()); assert d
X.XStringToKeysym.argtypes=[ctypes.c_char_p]; X.XStringToKeysym.restype=ctypes.c_ulong
X.XKeysymToKeycode.argtypes=[ctypes.c_void_p,ctypes.c_ulong]; X.XKeysymToKeycode.restype=ctypes.c_uint
T.XTestFakeKeyEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
X.XFlush.argtypes=[ctypes.c_void_p]
keys=[X.XKeysymToKeycode(d,X.XStringToKeysym(k)) for k in [b'Alt_L',b'Shift_L',b'v']]
for k in keys: T.XTestFakeKeyEvent(d,k,1,0)
for k in reversed(keys): T.XTestFakeKeyEvent(d,k,0,0)
X.XFlush(d)`], { env: { ...process.env, DISPLAY: report.display } })
  let info
  try { info = await until(find, 'OS shortcut popup', 3000); report.actionMethod = 'XTest OS Alt+Shift+V' }
  catch {
    const w = (await root.send('Target.getTargets')).targetInfos.find(i => i.type === 'service_worker' && i.url === worker.url())
    const attached = await root.send('Target.attachToTarget', { targetId: w.targetId, flatten: false })
    await root.send('Target.sendMessageToTarget', { sessionId: attached.sessionId, message: JSON.stringify({ id: 1, method: 'Runtime.evaluate',
      params: { expression: 'chrome.action.openPopup()', awaitPromise: true, userGesture: true } }) })
    info = await until(find, 'Action popup'); report.actionMethod = 'CDP userGesture:true action.openPopup'
  }
  const { sessionId } = await root.send('Target.attachToTarget', { targetId: info.targetId, flatten: false })
  let sequence = 10
  const pending = new Map()
  root.on('Target.receivedMessageFromTarget', event => {
    if (event.sessionId !== sessionId) return
    const message = JSON.parse(event.message), entry = pending.get(message.id)
    if (entry) { pending.delete(message.id); message.error ? entry.reject(Error(message.error.message)) : entry.resolve(message.result) }
  })
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence, timeout = setTimeout(() => { pending.delete(id); reject(Error(`Popup CDP timeout: ${method}`)) }, 5000)
    pending.set(id, { resolve: result => { clearTimeout(timeout); resolve(result) }, reject: error => { clearTimeout(timeout); reject(error) } })
    root.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject)
  })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw Error('Action popup evaluation failed')
    return result.result?.value
  }
  async function click(text) {
    const point = await until(() => evaluate(`(() => {
      const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});
      if(!b || b.disabled) return null;
      b.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      const r=b.getBoundingClientRect(), x=r.x+r.width/2, y=r.y+r.height/2;
      return r.width>0 && r.height>0 && x>=0 && x<innerWidth && y>=0 && y<innerHeight && b.contains(document.elementFromPoint(x,y)) ? {x,y} : null;
    })()`), `Action ${text}`)
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, ...point })
  }
  return { click, evaluate, close: async () => { await root.send('Target.closeTarget', { targetId: info.targetId }).catch(() => {}); await root.detach() } }
}
async function sessions() { return db.session.count({ where: { hostId: host.id } }) }
async function openFromSite() {
  const popup = await actionPopup()
  await popup.click('Sites')
  await until(() => popup.evaluate(`document.body.innerText.includes('Hosts for this site') && document.body.innerText.includes('Disposable SSH')`), 'Current site authorized host')
  report.popupBeforeHostAction = await popup.evaluate('document.body.innerText')
  check('current-site-host-suggestion', report.popupBeforeHostAction.includes('Hosts for this site'))
  const next = context.waitForEvent('page', { timeout: 15000 })
  pendingPageWaits.push(next)
  next.catch(() => {}) // Preserve the primary click failure if cleanup closes this pending wait.
  await popup.click('Connect with NodeAccess · Disposable SSH').catch(async error => {
    // The real action may close its popup before CDP acknowledges mouseReleased.
    const opened = await Promise.race([next.then(() => true, () => false), delay(500).then(() => false)])
    if (!opened) throw error
  })
  let page
  try { page = await next }
  catch (error) {
    report.hostActionFailure = await popup.evaluate(`({body:document.body.innerText,viewport:{width:innerWidth,height:innerHeight},buttons:[...document.querySelectorAll('button')].map(b=>({text:b.textContent.trim(),disabled:b.disabled,rect:b.getBoundingClientRect().toJSON()}))})`).catch(() => ({ popupUnavailable: true }))
    throw error
  }
  await page.waitForLoadState('domcontentloaded')
  await popup.close()
  return page
}
try {
  report.sourceSha = run('git', ['rev-parse', 'HEAD']); report.sourceFingerprintBefore = sources('before')
  for (const [name, image] of Object.entries(images)) report.images[name] = docker(['image', 'inspect', '--format', '{{.Id}}', image])
  console.log('Building current backend/shared and extension')
  buildBackend()
  process.env.VAULTNACCESS_PORTAL_ORIGIN = PORTAL
  await build({ configFile: join(ROOT, 'apps/extension/vite.config.ts'), build: { outDir: join(OUT, 'extension'), emptyOutDir: true }, logLevel: 'error' })
  docker(['network', 'create', '--label', `nodeaccess.test=${prefix}`, prefix])
  const mysql = start('mysql', images.mysql, ['-p', '127.0.0.1::3306', '-e', `MYSQL_ROOT_PASSWORD=${password}`, '-e', 'MYSQL_ROOT_HOST=%', '-e', 'MYSQL_DATABASE=site_terminal_test'])
  start('redis', images.redis)
  const ssh = start('ssh', images.ssh, ['-e', 'USER_NAME=stacklab', '-e', 'PASSWORD_ACCESS=true', '-e', `USER_PASSWORD=${password}`, '-e', 'SUDO_ACCESS=false'])
  await until(() => { docker(['exec', ssh, 'sh', '-c', 'nc -z 127.0.0.1 2222']); return true }, 'OpenSSH ready', 90000)
  console.log('OpenSSH running; preparing disposable database')
  const databaseUrl = `mysql://root:${password}@127.0.0.1:${port(mysql, 3306)}/site_terminal_test`
  sensitive.push(databaseUrl)
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await until(async () => { await db.$queryRaw`SELECT 1`; return true }, 'MySQL ready', 90000)
  const schemaBase = 'bf122f141029244b0687f549353d79b4dcbaa506'
  report.schemaBase = schemaBase
  const schema = join(OUT, 'baseline.prisma')
  writeFileSync(schema, run('git', ['show', `${schemaBase}:apps/backend/prisma/schema.prisma`]))
  writeFileSync(join(OUT, 'schema.log'), run('node', ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate', '--schema', schema], { env: { ...process.env, DATABASE_URL: databaseUrl } }))
  const migrations = ['20261116030000_add_vault_security', '20261120150000_vault_extension', '20261123170000_vault_extension_trust', '20261124020000_vault_webauthn', '20261124192900_extend_vault_grants', '20261124193000_add_vault_sites', '20261124233000_vault_fill_generation']
  const historical = run('git', ['ls-tree', '-d', '--name-only', `${schemaBase}:apps/backend/prisma/migrations`]).split('\n').filter(Boolean)
  const expected = readdirSync(join(ROOT, 'apps/backend/prisma/migrations'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort((a, b) => a.localeCompare(b))
  assert.deepEqual([...new Set([...historical, ...migrations])].sort((a, b) => a.localeCompare(b)), expected, 'Every mounted migration must be accounted for')
  await db.$executeRaw`CREATE TABLE _prisma_migrations (
    id VARCHAR(36) PRIMARY KEY NOT NULL, checksum VARCHAR(64) NOT NULL, finished_at DATETIME(3) NULL,
    migration_name VARCHAR(255) NOT NULL, logs TEXT NULL, rolled_back_at DATETIME(3) NULL,
    started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), applied_steps_count INTEGER UNSIGNED NOT NULL DEFAULT 0)`
  async function recordMigration(name, content, note, steps) {
    const checksum = createHash('sha256').update(content).digest('hex')
    await db.$executeRaw`INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,logs,applied_steps_count)
      VALUES(${randomUUID()},${checksum},${new Date()},${name},${note},${steps})`
    return { name, checksum }
  }
  report.baselineHistory = { schemaBase, count: historical.length, mode: 'Imported schema; historical SQL not replayed' }
  report.boundaries.push('Historical schema imported with db push and explicitly baselined migration history; only the seven listed later migrations execute SQL in this run. Production readiness guard remains unchanged.')
  for (const name of historical) {
    const content = execFileSync(resolveExecutable('git'), ['show', `${schemaBase}:apps/backend/prisma/migrations/${name}/migration.sql`], { cwd: ROOT })
    await recordMigration(name, content, `Baseline imported from schema at ${schemaBase}; historical SQL was not executed by this harness.`, 0)
  }
  report.executedMigrations = []
  for (const name of migrations) {
    const content = readFileSync(join(ROOT, 'apps/backend/prisma/migrations', name, 'migration.sql'))
    docker(['exec', '-i', '-e', `MYSQL_PWD=${password}`, mysql, 'mysql', '-uroot', 'site_terminal_test'], { input: content })
    report.executedMigrations.push(await recordMigration(name, content, 'SQL executed by isolated site-terminal harness after imported baseline.', 1))
  }
  console.log('Baseline history recorded; seven real migrations applied')
  const tenant = await db.tenant.create({ data: { name: 'Disposable terminal', slug: prefix } })
  const totp = speakeasy.generateSecret().base32; sensitive.push(totp)
  user = await db.user.create({ data: { tenantId: tenant.id, name: 'Synthetic user', email: `${prefix}@example.test`, role: 'USER', passwordHash: await bcrypt.hash(password, 4), mfaEnabled: true, mfaSecret: totp, forcePasswordChange: false, sessionVersion: 1 } })
  const managers = await Promise.all([1, 2].map(n => db.user.create({ data: { tenantId: tenant.id, name: `Synthetic manager ${n}`, email: `${prefix}-${n}@example.test`, role: 'ADMIN' } })))
  await db.license.create({ data: { tenantId: tenant.id, maxUsers: 10, maxHosts: 10, maxActiveSessionsTenant: 10, multiConnect: true, featureEntitlementsJson: { secrets: true, multiConnect: true } } })
  await db.tenantAuthPolicy.create({ data: { tenantId: tenant.id } })
  await db.$executeRaw`INSERT INTO vault_policies(tenant_id,version,config) VALUES(${tenant.id},1,${JSON.stringify({ unlock: true, reveal: true, copy: true, localReauth: true, origin: PORTAL, tenantQuota: 300 })})`
  await db.$executeRaw`INSERT INTO vault_entitlements(tenant_id,user_id,action,granted_by,approved_by,enabled) VALUES(${tenant.id},${user.id},'extension',${managers[0].id},${managers[1].id},TRUE)`
  const iv = randomBytes(16), cipher = createCipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv)
  const encrypted = Buffer.concat([cipher.update(password), cipher.final(), cipher.getAuthTag()]).toString('base64')
  const secret = await db.secret.create({ data: { tenantId: tenant.id, alias: 'disposable-ssh', scope: 'PERSONAL', ownerUserId: user.id, createdByUserId: user.id, encryptedValue: encrypted, iv: iv.toString('hex') } })
  host = await db.host.create({ data: { tenantId: tenant.id, name: 'Disposable SSH', ip: 'ssh', port: 2222, sshUser: 'stacklab', authType: 'PASSWORD', scope: 'PERSONAL', ownerId: user.id, passwordSecretId: secret.id } })
  await db.hostAssociatedLink.create({ data: { tenantId: tenant.id, hostId: host.id, label: 'Disposable site', urlTemplate: `${SITE}/login` } })
  const inventory = await db.inventoryNode.create({ data: { tenantId: tenant.id, hostId: host.id, type: 'HOST', name: host.name, path: `/${host.id}` } })
  const acl = await db.resourceAclEntry.create({ data: { tenantId: tenant.id, inventoryNodeId: inventory.id, principalType: 'USER', principalId: user.id, canView: true, canConnect: true, canEdit: true, createdById: managers[0].id } })
  await db.$executeRaw`INSERT INTO vault_site_items(tenant_id,kind,label,scope,owner_user_id,created_by_user_id,origins,url,host_id) VALUES(${tenant.id},'url','Disposable site','PERSONAL',${user.id},${user.id},${JSON.stringify([SITE])},${`${SITE}/login`},${host.id})`
  run('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-days', '1', '-subj', '/CN=vault.example.test', '-addext', 'subjectAltName=DNS:vault.example.test,DNS:login.example.test', '-keyout', join(OUT, 'key.pem'), '-out', join(OUT, 'cert.pem')])
  // Browser launches before API so its actual unpacked-extension id can be allowed without a wildcard.
  display = spawn(resolveExecutable('Xvfb'), ['-displayfd', '3', '-screen', '0', '1440x1000x24', '-nolisten', 'tcp', '-nolisten', 'unix'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] })
  const displayNumber = await new Promise((done, reject) => { display.once('error', reject); display.stdio[3].once('data', d => done(d.toString().trim())) })
  report.display = `:${displayNumber}`
  // Reserve the HTTPS origin with Vite; proxy targets are installed after Docker publishes API ports.
  process.env.NODEACCESS_DEV_HTTPS_CERT = join(OUT, 'cert.pem'); process.env.NODEACCESS_DEV_HTTPS_KEY = join(OUT, 'key.pem')
  process.env.VITE_WS_URL = 'wss://vault.example.test'
  web = await createServer({ root: join(ROOT, 'apps/frontend'), envDir: OUT, cacheDir: join(OUT, 'vite-cache'), configFile: join(ROOT, 'apps/frontend/vite.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false, allowedHosts: ['vault.example.test', 'login.example.test'], proxy: {} }, logLevel: 'error' })
  web.middlewares.use((req, res, next) => {
    if (req.headers.host?.startsWith('login.example.test')) { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Disposable site</title><h1>Disposable site</h1>'); return }
    next()
  })
  await web.listen(); const webPort = web.httpServer.address().port
  context = await chromium.launchPersistentContext(join(OUT, 'profile'), { channel: 'chromium', headless: false, ignoreHTTPSErrors: true, env: { ...process.env, DISPLAY: `:${displayNumber}` },
    args: [`--disable-extensions-except=${join(OUT, 'extension')}`, `--load-extension=${join(OUT, 'extension')}`, `--host-resolver-rules=MAP vault.example.test:443 127.0.0.1:${webPort},MAP login.example.test:443 127.0.0.1:${webPort}`, '--ignore-certificate-errors', '--no-proxy-server'] })
  report.browserDiagnostics = []
  context.on('page', page => {
    const terminal = { connected: false, output: '' }
    terminalStates.set(page, terminal)
    page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string') {
        try { if (JSON.parse(payload).type === 'connected') terminal.connected = true } catch { /* control frames only */ }
      } else terminal.output = (terminal.output + payload.toString('utf8')).slice(-16000)
    }))
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) report.browserDiagnostics.push({ type: message.type(), text: redact(message.text()).slice(0, 2000) }) })
    page.on('pageerror', error => report.browserDiagnostics.push({ type: 'pageerror', text: redact(error.message) }))
    page.on('requestfailed', request => report.browserDiagnostics.push({ type: 'requestfailed', url: request.url(), error: request.failure()?.errorText }))
    page.on('response', response => { if (response.status() >= 400) report.browserDiagnostics.push({ type: 'http', url: response.url(), status: response.status() }) })
  })
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
  const extensionId = new URL(worker.url()).host; popupUrl = `chrome-extension://${extensionId}/popup.html`
  const environment = [...jsDependencyOverlay(), '-e', `DATABASE_URL=mysql://root:${password}@mysql:3306/site_terminal_test`, '-e', 'REDIS_URL=redis://redis:6379', '-e', `JWT_SECRET=${jwt}`, '-e', `PEM_ENCRYPTION_KEY=${encryptionKey}`, '-e', `APP_URL=${PORTAL}`, '-e', 'TRUST_PROXY=true', '-e', 'VAULT_EXTENSION_ENABLED=true', '-e', `VAULT_EXTENSION_IDS=${extensionId}`, '-e', 'SESSION_AUDIT_STORAGE_DIR=/tmp/disposable-audit', '-e', 'FEATURE_SESSION_AUDIT=false',
    '-v', `${ROOT}/apps/backend/dist:/app/dist:ro`, '-v', `${ROOT}/packages/shared/dist:/app/packages/shared/dist:ro`,
    '-v', `${ROOT}/apps/backend/prisma/migrations:/app/prisma/migrations:ro`]
  const apiContainer = start('api', images.backend, [...environment, '-e', 'APP_MODE=api', '-p', '127.0.0.1::3000'])
  const gatewayContainer = start('gateway', images.backend, [...environment, '-e', 'APP_MODE=gateway', '-p', '127.0.0.1::3001'])
  apiBase = `http://127.0.0.1:${port(apiContainer, 3000)}`
  const gatewayBase = `http://127.0.0.1:${port(gatewayContainer, 3001)}`
  // Restart Vite with real proxy endpoints; reuse the same reserved port and certificate.
  await web.close()
  const proxy = target => ({ target, changeOrigin: true, headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'vault.example.test' } })
  web = await createServer({ root: join(ROOT, 'apps/frontend'), envDir: OUT, cacheDir: join(OUT, 'vite-cache'), configFile: join(ROOT, 'apps/frontend/vite.config.ts'), server: { host: '127.0.0.1', port: webPort, strictPort: true, allowedHosts: ['vault.example.test', 'login.example.test'],
    proxy: { '/api': proxy(apiBase), '/api/v1/hosts/test-connection': proxy(gatewayBase), '/api/v1/tunnels': proxy(gatewayBase), '/api/v1/web-access': proxy(gatewayBase), '/ws': { ...proxy(gatewayBase), ws: true } } }, logLevel: 'error' })
  web.middlewares.use((req, res, next) => { if (req.headers.host?.startsWith('login.example.test')) { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Disposable site</title><h1>Disposable site</h1>') } else next() })
  await web.listen()
  await until(() => ready(apiContainer, apiBase), 'API ready', 90000)
  await until(() => ready(gatewayContainer, gatewayBase), 'Gateway ready', 90000)
  check('real-api-and-gateway-readiness-with-migration-guard', true)
  console.log('Authenticating synthetic user and seeding extension device')
  const login = await api('/auth/login', { email: user.email, password, tenantSlug: tenant.slug }, null)
  sensitive.push(login.tempToken)
  tokens = await api('/auth/verify-totp', { setupToken: login.tempToken, token: speakeasy.totp({ secret: totp, encoding: 'base32' }) }, null)
  sensitive.push(tokens.accessToken, tokens.refreshToken)
  check('real-password-and-totp-login', !!tokens.accessToken && !!tokens.refreshToken)
  // Challenge/verify the actual SSH server host key before the UI route exercise.
  const socket = new WebSocket(`${gatewayBase.replace('http:', 'ws:')}/ws/ssh/${host.id}?token=${tokens.accessToken}`, { origin: PORTAL }); sockets.push(socket)
  const challenge = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(Error('SSH host-key challenge timeout')), 15000)
    socket.on('error', reject)
    socket.on('message', (data, binary) => { if (!binary) { const frame = JSON.parse(data.toString());
      if (frame.type === 'host_key_verification_required') { clearTimeout(timer); done(frame) }
      if (frame.type === 'error') { clearTimeout(timer); reject(Error(`SSH challenge ${frame.code ?? frame.message}`)) }
    } })
  })
  const publicKeys = docker(['exec', ssh, 'sh', '-c', 'find /config -name "ssh_host_*.pub" -exec ssh-keygen -lf {} \\;'])
  let fingerprintLength = challenge.presentedFingerprint.length
  while (fingerprintLength > 0 && challenge.presentedFingerprint[fingerprintLength - 1] === '=') fingerprintLength--
  check('real-ssh-fingerprint-independently-verified', publicKeys.includes(challenge.presentedFingerprint.slice(0, fingerprintLength)))
  await api(`/hosts/${host.id}/trust-host-key`, { fingerprint: challenge.presentedFingerprint }); socket.terminate()
  const access = randomBytes(32).toString('base64url'); sensitive.push(access)
  const publicJwk = await worker.evaluate(async () => {
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
    const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey)
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })))
    const jkt = btoa(String.fromCharCode(...new Uint8Array(hash))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
    await new Promise((resolve, reject) => { const r = indexedDB.open('vaultnaccess', 1); r.onupgradeneeded = () => r.result.createObjectStore('device'); r.onerror = reject;
      r.onsuccess = () => { const tx = r.result.transaction('device', 'readwrite'); tx.objectStore('device').put({ privateKey: keys.privateKey, publicJwk: jwk, jkt }, 'current'); tx.oncomplete = () => { r.result.close(); resolve() }; tx.onerror = reject } })
    return jwk
  })
  const jkt = await calculateJwkThumbprint(publicJwk), expiresAt = Date.now() + 600000
  await db.$executeRaw`INSERT INTO vault_extension_devices(tenant_id,user_id,jkt,extension_id,state) VALUES(${tenant.id},${user.id},${jkt},${extensionId},'ACTIVE')`
  await db.$executeRaw`INSERT INTO vault_extension_tokens(token_hash,kind,tenant_id,user_id,jkt,payload,expires_at) VALUES(${createHash('sha256').update(access).digest('hex')},'access',${tenant.id},${user.id},${jkt},${JSON.stringify({ sessionVersion: 1, extensionId, origin: null, method: 'local', policyVersion: 1, expiresAt })},${new Date(expiresAt)})`
  await worker.evaluate(async ({ access, expiresAt, portal }) => { await chrome.storage.session.set({ authorization: { accessToken: access, expiresAt, portalOrigin: portal }, locale: 'en' }) }, { access, expiresAt, portal: PORTAL })
  await context.addInitScript(({ tokens, portal }) => { if (location.origin === portal && !localStorage.getItem('na_fixture_seeded')) {
    localStorage.setItem('na_access_token', tokens.accessToken); localStorage.setItem('na_refresh_token', tokens.refreshToken); localStorage.setItem('nodeaccess_locale', 'en'); localStorage.setItem('na_ui_terminal_display_mode', 'workspace')
    localStorage.setItem('na_fixture_seeded', '1')
  } }, { tokens, portal: PORTAL })
  target = await context.newPage(); await target.goto(`${SITE}/login`)
  console.log('Opening real action popup -> portal route -> SSH terminal')
  const before = await sessions(), page = await openFromSite()
  try { await page.waitForURL('**/terminal**', { timeout: 45000 }) }
  catch (error) {
    report.portalFailure = { url: page.url(), body: redact(await page.locator('body').innerText()).slice(0, 20000) }
    await page.screenshot({ path: join(OUT, 'portal-failure.png') })
    throw error
  }
  await page.locator('.xterm-helper-textarea').waitFor({ state: 'attached', timeout: 30000 })
  await until(async () => (await sessions()) === before + 1, 'Exactly one SSH session', 30000)
  await until(() => {
    const terminal = terminalStates.get(page)
    return terminal?.connected && /[$#]\s*$/.test(terminal.output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ''))
  }, 'Real SSH shell prompt before typing', 15000)
  const marker = randomBytes(12).toString('hex'), a = marker.slice(0, 12), b = marker.slice(12)
  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.type(`printf '%s%s\\n' '${a}' '${b}' | tee "$HOME/nodeaccess-proof"; stty size > "$HOME/nodeaccess-pty"`, { delay: 10 }); await page.keyboard.press('Enter')
  try { await until(() => docker(['exec', ssh, 'cat', '/config/nodeaccess-proof']) === marker, 'Command actually executed by OpenSSH', 15000) }
  catch (error) { report.terminalFailure = redact(terminalStates.get(page)?.output ?? ''); await page.screenshot({ path: join(OUT, 'terminal-failure.png') }); throw error }
  check('site-host-route-opens-real-ssh', true)
  const remotePty = await until(() => docker(['exec', ssh, 'cat', '/config/nodeaccess-pty']), 'Remote PTY size')
  const geometry = await page.locator('[data-terminal-container="true"]').evaluate(node => ({ rows: Number(node.dataset.terminalRows), cols: Number(node.dataset.terminalCols) }))
  report.pty = { remote: remotePty, browser: geometry }
  check('real-pty-matches-visible-terminal', geometry.rows > 0 && geometry.cols > 0 && remotePty === `${geometry.rows} ${geometry.cols}`)
  await page.screenshot({ path: join(OUT, 'real-ssh-terminal.png') })
  await page.goBack(); await page.waitForURL(`**/hosts?hostId=${host.id}`)
  check('connect-action-consumed-in-browser-history', !page.url().includes('connect=1'))
  await page.reload(); await page.waitForTimeout(1200)
  check('refresh-without-action-does-not-duplicate', await sessions() === before + 1)
  await page.close()
  await db.resourceAclEntry.update({ where: { id: acl.id }, data: { canConnect: false } })
  const blocked = await openFromSite(); await blocked.waitForTimeout(1800)
  check('view-only-host-cannot-start-ssh', await sessions() === before + 1 && !blocked.url().includes('/terminal'))
  await blocked.close()
  await db.resourceAclEntry.delete({ where: { id: acl.id } })
  const denied = await context.newPage(); await denied.goto(`${PORTAL}/hosts?hostId=${host.id}&connect=1`); await denied.waitForTimeout(1800)
  check('revoked-host-direct-link-cannot-start-ssh', await sessions() === before + 1 && !denied.url().includes('/terminal'))
  await api('/auth/logout', { refreshToken: tokens.refreshToken })
  const expiredAccess = jsonwebtoken.sign({ ...jsonwebtoken.decode(tokens.accessToken), exp: Math.floor(Date.now() / 1000) - 10 }, jwt)
  sensitive.push(expiredAccess)
  await denied.evaluate(({ access, refresh }) => { localStorage.setItem('na_access_token', access); localStorage.setItem('na_refresh_token', refresh) }, { access: expiredAccess, refresh: tokens.refreshToken })
  await denied.goto(`${PORTAL}/hosts?hostId=${host.id}&connect=1`)
  await until(() => denied.url().includes('/login'), 'Expired JWT and revoked refresh redirect to login', 15000)
  check('expired-session-cannot-start-ssh', await sessions() === before + 1)
  await denied.evaluate(tokens => { localStorage.setItem('na_access_token', tokens.accessToken); localStorage.setItem('na_refresh_token', tokens.refreshToken) }, tokens)
  await denied.close()
  await db.user.update({ where: { id: user.id }, data: { sessionVersion: 2 } })
  const expired = await context.newPage(); await expired.goto(`${PORTAL}/hosts?hostId=${host.id}&connect=1`)
  await until(() => expired.url().includes('/login'), 'Expired/revoked portal session redirects to login', 15000)
  check('invalidated-session-cannot-start-ssh', await sessions() === before + 1)
  report.status = 'passed'
} catch (e) { report.error = redact(e.stack ?? e.message).slice(0, 5000); console.error(report.error); process.exitCode = 1 }
finally {
  report.terminalObservations = context?.pages().map(page => ({ url: page.url(), ...terminalStates.get(page), output: redact(terminalStates.get(page)?.output ?? '') })).filter(item => item.connected || item.output)
  for (const socket of sockets) socket.terminate()
  await context?.close().catch(() => { report.cleanupFailed = true }); await Promise.allSettled(pendingPageWaits)
  await web?.close().catch(() => { report.cleanupFailed = true }); display?.kill()
  await db?.$disconnect().catch(() => { report.cleanupFailed = true })
  for (const name of [...containers].reverse()) {
    try { writeFileSync(join(OUT, `${name.split('-').at(-1)}.log`), containerLogs(name)) } catch { /* log collection is secondary to cleanup */ }
    try { docker(['rm', '-f', '-v', name]) } catch { report.cleanupFailed = true }
  }
  try { docker(['network', 'rm', prefix]) } catch { report.cleanupFailed = true }
  report.sourceFingerprintAfter = sources('after'); report.sourceChanged = report.sourceFingerprintBefore !== report.sourceFingerprintAfter
  report.cleanup = !report.cleanupFailed
  if (report.sourceChanged || report.cleanupFailed) { report.status = 'failed'; process.exitCode = 1 }
  report.finishedAt = new Date().toISOString(); report.artifacts = OUT
  writeFileSync(join(OUT, 'result.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
