#!/usr/bin/env node
// NA-0203: real MV3 popup/worker/injection, synthetic HTTPS backend and login page.
// No manifest rewriting, host-permission expansion, worker patching or sender spoofing.
// Run with Node24 through bin/dev. Result is failed/blocked unless every mandatory check passes.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:https'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { CompactEncrypt, calculateJwkThumbprint, importJWK } from 'jose'
import { VaultSiteCreateSchema, VaultSiteUpdateSchema, VaultSiteListSchema, VaultSiteListReplySchema, VaultSiteVersionSchema } from '../../packages/shared/src/schemas/vault-sites.schema.ts'
import { VaultSiteFillAuthorizeSchema, VaultSiteFillConsumeSchema, VaultSiteFillReleaseSchema } from '../../packages/shared/src/schemas/vault-site-fill.schema.ts'
import { resolveExecutable } from '../shared/trusted-executable.cjs'

const ROOT = resolve(import.meta.dirname, '../..')
const OUT = join(ROOT, '.tmp/NA-0203/adoption-browser')
mkdirSync(OUT, { recursive: true })
const run = mkdtempSync(join(OUT, 'run-')), dist = join(run, 'extension')
const PORTAL = 'https://vault.example.test', SITE = 'https://login.example.test'
const SECRET = randomBytes(18).toString('hex'), CREATED = randomBytes(18).toString('hex')
const BUILD = 'cccccccccccc', ACCESS = 'A'.repeat(43), CODE = 'C'.repeat(43)
const result = { startedAt: new Date().toISOString(), status: 'failed', sections: { assistance: 'pending', capture: 'pending', preferences: 'pending', generator: 'pending', hello: 'pending' }, checks: {}, matrix: [], gaps: [], activeTab: { verified: false, method: null },
  boundaries: ['Synthetic HTTPS API, not real backend authorization/DB', 'Hello approval is an explicit fixture state change, not physical Windows Hello; pending references, worker, popup and injection are real', 'Server revocation cannot retract an envelope after transaction commit; local context checks stop pending injection, not an already dispatched script'], runDirectory: run }
const sources = ['apps/extension/src/background.ts', 'apps/extension/src/popup/App.vue', 'apps/extension/src/popup/SitePanel.vue',
  'apps/extension/src/popup/main.ts', 'apps/extension/src/adapters/site-fill.ts', 'apps/extension/src/core/site-fill.ts',
  'apps/extension/src/adapters/site-preferences.ts',
  'apps/extension/src/core/sites-client.ts', 'apps/extension/src/core/client.ts', 'apps/extension/manifest.ts',
  'packages/shared/src/schemas/vault-sites.schema.ts', 'packages/shared/src/schemas/vault-site-fill.schema.ts', 'tools/vault-extension/adoption-smoke.mjs', 'apps/extension/src/adapters/site-assistance.ts', 'apps/extension/src/adapters/site-interactions.ts', 'apps/extension/src/core/site-interactions.ts', 'apps/extension/src/core/portal-fill-intent.ts', 'apps/extension/src/core/site-preferences.ts', 'apps/extension/src/core/password.ts']
const fingerprint = () => createHash('sha256').update(sources.map(file => `${file}\0${readFileSync(join(ROOT, file))}`).join('\0')).digest('hex')
result.sourceFingerprint = fingerprint()
result.sourceFiles = sources
writeFileSync(join(run, 'sources-before.json'), JSON.stringify(Object.fromEntries(sources.map(file => [file, createHash('sha256').update(readFileSync(join(ROOT, file))).digest('hex')])), null, 2))
const check = (name, ok) => { result.checks[name] = ok ? 'PASS' : 'FAIL'; if (!ok) throw new Error(name) }
const delay = ms => new Promise(done => setTimeout(done, ms))
async function until(test, message, timeout = 10000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await test()) return; await delay(50) }
  throw new Error(message)
}
const seen = { paths: [], creates: 0, updates: 0, authorizes: 0, consumes: 0, passwordReleases: 0, usernameReleases: 0, submissions: 0, nonce: false, id: '', pending: null, hold: false, consumeAttempts: 0, revoked: false, dropAfterConsume: false, dropBeforeHeaders: false, holdConsume: false, pendingConsume: null }
const items = [{ id: 1, version: 1, kind: 'login', label: 'Synthetic suggested login', scope: 'PERSONAL', groupId: null,
  username: 'synthetic-user', origins: [SITE], url: null, host: { id: 10, name: 'Synthetic host' }, canManage: true, allowFill: true },
{ id: 2, version: 1, kind: 'login', label: 'Unrelated origin login', scope: 'PERSONAL', groupId: null,
  username: 'other-user', origins: ['https://other.example.test'], url: null, host: null, canManage: true, allowFill: true }]
const OTHER_ACCESS = 'B'.repeat(43)
const PROOF = randomBytes(32).toString('base64url'); let proofReady = true, proofRequested = false
const passwords = new Map([[1, SECRET]]), operations = new Map()
let expectedUpdate = { id: 1, username: 'synthetic-user' }
const pendingPages = []
let context, server, display, target, worker, popup, popupURL
const loginHtml = `<!doctype html><html><head><title>E7 synthetic login</title></head><body>
<form id="login"><label>Username<input id="username" autocomplete="username"></label>
<label>Password<input id="password" type="password" autocomplete="current-password"></label>
<input id="hidden-password" type="password" hidden><button type="submit">Sign in</button></form>
<iframe srcdoc="<input type='password' id='frame-password'>"></iframe>
<script>window.submissions=0;document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();window.submissions++;fetch('/submitted',{method:'POST'})})</script>
</body></html>`
async function route(req, res) {
  const chunks = []; for await (const chunk of req) { chunks.push(chunk); if (Buffer.concat(chunks).length > 32768) throw new Error('body too large') }
  const url = new URL(req.url, PORTAL), body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
  const send = (status, value, type = 'application/json', extra = {}) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'DPoP-Nonce': `fixture.${'n'.repeat(32)}`, ...extra })
    res.end(type === 'application/json' ? JSON.stringify(value) : value)
  }
  if (req.headers.host?.startsWith('login.example.test') || req.headers.host?.startsWith('other.example.test')) {
    if (url.pathname === '/change') return send(200, loginHtml.replace('<label>Username<input id="username" autocomplete="username"></label>', '').replace('autocomplete="current-password"', 'autocomplete="new-password"').replace('<button type="submit">', '<input id="confirm" type="password" autocomplete="new-password"><input id="old" type="password" autocomplete="current-password"><button type="submit">'), 'text/html')
    if (url.pathname === '/redirect') return send(302, '', 'text/plain', { Location: 'https://other.example.test/redirected' })
    if (url.pathname === '/submitted') { seen.submissions++; return send(200, {}) }
    return send(200, loginHtml, 'text/html')
  }
  if (url.pathname === '/vaultnaccess-build.json') return send(200, { buildId: BUILD })
  if (url.pathname === '/vault/extension/connect') {
    check('consent-extension-binding', url.searchParams.get('extensionId') === seen.id && url.searchParams.get('redirectUri') === `https://${seen.id}.chromiumapp.org/`)
    return send(302, '', 'text/plain', { Location: `${url.searchParams.get('redirectUri')}?code=${CODE}&state=${url.searchParams.get('state')}&lang=en` })
  }
  if (url.pathname === '/hosts') return send(200, '<title>Synthetic terminal landing</title><p data-testid="synthetic-terminal">Synthetic host route only; no SSH connection.</p>', 'text/html')
  if (!url.pathname.startsWith('/api/')) return send(200, '<title>Synthetic portal</title>', 'text/html')
  seen.paths.push(url.pathname)
  if ((req.method === 'POST' || req.headers.origin !== undefined) && req.headers.origin !== `chrome-extension://${seen.id}`) return send(403, {})
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(req.headers.dpop ?? '')) return send(401, {})
  const path = url.pathname.replace('/api/v1/vault-security/extension', '')
  if (path === '/token') {
    if (!seen.nonce) { seen.nonce = true; return send(401, {}, 'application/json', { 'WWW-Authenticate': 'DPoP error="use_dpop_nonce"' }) }
    check('consent-code', body.code === CODE)
    return send(200, { accessToken: ACCESS, tokenType: 'DPoP', expiresAt: 1800000, serverNow: 0 })
  }
  if (![ACCESS, OTHER_ACCESS].some(token => req.headers.authorization === `DPoP ${token}`)) return send(401, {})
  if (path === '/capabilities') return send(200, { apiVersion: 1, minExtensionVersion: '0.1.0', kinds: ['secret', 'pem'],
    features: { reveal: false, copy: false, create: true, sites: true, fill: true }, writeAccess: { groups: [], tenant: false }, portalOrigin: PORTAL,
    preferenceScope: 'f'.repeat(64), proofUntil: proofReady ? 60000 : 0, expiresAt: 1800000, serverNow: 0 })
  if (path === '/proof-request') { proofRequested = true; return send(200, { request: PROOF, url: `${PORTAL}/vault/extension/confirm?request=${PROOF}` }) }
  if (path === '/proof-claim') return send(200, proofReady ? { state: 'APPROVED', proofUntil: 60000, serverNow: 0 } : { state: 'PENDING' })
  if (path === '/items') return send(200, { items: [], nextCursor: null })
  if (path === '/sites/current-hosts') {
    check('current-hosts-exact-origin', body.origin === SITE)
    return send(200, { hosts: [{ id: 10, name: 'Synthetic host' }] })
  }
  if (path === '/sites/hosts') return send(200, { hosts: [{ id: 10, name: 'Synthetic host' }] })
  if (path === '/sites/list') {
    const query = VaultSiteListSchema.parse(body)
    const reply = VaultSiteListReplySchema.parse({ items: items.filter(item => !query.origin || item.origins.includes(query.origin)), next: null })
    seen.lastList = reply; seen.lastOrigin = query.origin
    return send(200, reply)
  }
  if (path === '/sites/create') {
    if (!proofReady) return send(423, {})
    const value = VaultSiteCreateSchema.parse(body), id = items.length + 1
    check('create-login-reviewed', value.kind === 'login' && !!value.password)
    passwords.set(id, value.password)
    items.push({ id, version: 1, kind: value.kind, label: value.label, scope: value.scope, groupId: null, username: value.username,
      origins: value.origins, url: null, host: value.hostId === 10 ? { id: 10, name: 'Synthetic host' } : null, canManage: true, allowFill: value.allowFill })
    seen.creates++; return send(200, VaultSiteVersionSchema.parse({ id, version: 1 }))
  }
  if (path === '/sites/update') {
    const value = VaultSiteUpdateSchema.parse(body), item = items.find(item => item.id === value.id)
    if (!item || item.version !== value.version) return send(409, {})
    if (value.password) {
      check('reviewed-update-matches-target-and-username', value.id === expectedUpdate.id && value.username === expectedUpdate.username)
      if (seen.updates === 0) check('password-change-preserves-existing-username-in-api', value.username === item.username)
      passwords.set(value.id, value.password)
    }
    Object.assign(item, { label: value.label ?? item.label, username: value.username ?? item.username, version: item.version + 1 })
    seen.updates++; return send(200, VaultSiteVersionSchema.parse({ id: item.id, version: item.version }))
  }
  if (path === '/sites/fill/authorize') {
    const value = VaultSiteFillAuthorizeSchema.parse(body), item = items.find(item => item.id === value.siteId)
    if (!item || item.version !== value.siteVersion || !item.origins.includes(value.binding.origin)) return send(403, {})
    check('fill-top-document-binding', value.binding.frameId === 0 && !!value.binding.documentId)
    if (!proofReady) return send(423, {})
    const operation = randomBytes(32).toString('base64url'); operations.set(operation, { ...value, principal: req.headers.authorization }); seen.authorizes++
    if (seen.hold) await new Promise(done => { seen.pending = done })
    return send(200, { operation, expiresAt: 30000, serverNow: 0 })
  }
  if (path === '/sites/fill/consume') {
    seen.consumeAttempts++
    const value = VaultSiteFillConsumeSchema.parse(body), operation = operations.get(value.operation)
    if (seen.revoked || (operation && operation.principal !== req.headers.authorization)) return send(403, { code: 'EXTENSION_ITEM_DENIED' })
    if (!operation || JSON.stringify(operation.binding) !== JSON.stringify(value.binding)) return send(409, { code: 'OPERATION_UNAVAILABLE' })
    operations.delete(value.operation); seen.consumes++
    if (seen.dropBeforeHeaders) { req.socket.destroy(); return }
    if (seen.dropAfterConsume) {
      // Commit occurred, then the reply is truncated AFTER response headers. No fixture-induced 403/logout.
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '999999', 'Cache-Control': 'no-store' })
      res.write('{"envelope":'); await delay(20); req.socket.destroy(); return
    }
    const item = items.find(item => item.id === operation.siteId)
    if (value.binding.mode === 'username') return send(200, {mode:'username', username:item.username, operation:value.operation,binding:value.binding,expiresAt:30000,serverNow:0})
    if (value.binding.mode === 'username') {
      seen.usernameReleases++
      return send(200, VaultSiteFillReleaseSchema.parse({ mode: 'username', username: item.username, operation: value.operation, binding: value.binding, expiresAt: 30000, serverNow: 0 }))
    }
    seen.passwordReleases++
    const binding = { version: 1, operationId: value.operation, tenantId: 7, userId: 41, clientId: 'c'.repeat(64), action: 'fill', itemRef: `site:${item.id}:${value.binding.mode}`,
      recipientThumbprint: await calculateJwkThumbprint(operation.recipient, 'sha256'), policyVersion: 1, secretVersion: String(item.version), expiresAt: 30000, origin: value.binding.origin }
    const envelope = await new CompactEncrypt(new TextEncoder().encode(value.binding.mode === 'username' ? item.username : passwords.get(item.id)))
      .setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM', typ: 'vaultnaccess+jwe', vault: binding }).encrypt(await importJWK(operation.recipient, 'RSA-OAEP-256'))
    if (seen.holdConsume) await new Promise(done => { seen.pendingConsume = done })
    return send(200, VaultSiteFillReleaseSchema.parse({ mode: value.binding.mode, envelope, context: binding, username: value.binding.mode === 'both' ? item.username : '', serverNow: 0 }))
  }
  return send(404, {})
}

// XTest sends an OS keyboard gesture to the headed Chromium window. It does not modify extension APIs.
const xkeys = String.raw`
import ctypes, os
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
X.XFlush(d)
`
// Toolbar popups are real CDP page targets, but are not always exposed by Playwright pages().
// This driver attaches to that exact browser-created target. Input is dispatched to its real UI.
async function attachPopup(info, root) {
  const { sessionId } = await root.send('Target.attachToTarget', { targetId: info.targetId, flatten: false })
  let serial = 0, closed = false
  const pending = new Map()
  root.on('Target.receivedMessageFromTarget', event => {
    if (event.sessionId !== sessionId) return
    const reply = JSON.parse(event.message), job = pending.get(reply.id)
    if (!job) return
    pending.delete(reply.id); clearTimeout(job.timer)
    if (reply.error) job.reject(new Error(reply.error.message)); else job.resolve(reply.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Popup CDP timeout: ${method}`)) }, 10000)
    pending.set(id, { resolve, reject, timer })
    void root.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject)
  })
  const evaluate = async expression => {
    const value = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (value.exceptionDetails) throw new Error('Popup DOM evaluation failed: ' + (value.exceptionDetails.exception?.description ?? value.exceptionDetails.text).split('\n')[0])
    return value.result.value
  }
  function nodes(chain) {
    let list = [document]
    for (const step of chain) {
      if (step.kind === 'css') list = list.flatMap(base => [...base.querySelectorAll(step.value)])
      if (step.kind === 'filter') list = list.filter(node => node.textContent.includes(step.value))
      if (step.kind === 'text') list = list.flatMap(base => [...base.querySelectorAll('*')]).filter(node => step.exact ? node.textContent.trim() === step.value : node.textContent.includes(step.value))
      if (step.kind === 'role') list = list.flatMap(base => [...base.querySelectorAll(step.role === 'button' ? 'button' : `[role="${step.role}"]`)]).filter(node => step.exact ? node.textContent.trim() === step.value : node.textContent.includes(step.value))
      if (step.kind === 'label') list = list.flatMap(base => [...base.querySelectorAll('label')]).filter(node => {
        const label = [...node.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim()
        return step.exact ? label === step.value : label.includes(step.value)
      }).map(label => label.control ?? label.querySelector('input,textarea,select')).filter(Boolean)
    }
    return [...new Set(list)]
  }
  const read = (chain, fn, value) => evaluate(`(${fn.toString()})((${nodes.toString()})(${JSON.stringify(chain)}),${JSON.stringify(value)})`)
  const locator = chain => ({
    locator: value => locator([...chain, { kind: 'css', value }]),
    filter: ({ hasText }) => locator([...chain, { kind: 'filter', value: hasText }]),
    getByText: (value, { exact = false } = {}) => locator([...chain, { kind: 'text', value, exact }]),
    getByRole: (role, { name, exact = false }) => locator([...chain, { kind: 'role', role, value: name, exact }]),
    getByLabel: (value, { exact = false } = {}) => locator([...chain, { kind: 'label', value, exact }]),
    count: () => read(chain, list => list.length),
    waitFor: () => until(() => read(chain, list => list.some(node => !!node.getClientRects().length)), 'Popup element missing'),
    getAttribute: name => read(chain, (list, name) => list[0]?.getAttribute(name), name),
    inputValue: () => read(chain, list => list[0]?.value),
    textContent: () => read(chain, list => list[0]?.textContent ?? ''),
    async click() {
      await until(() => read(chain, list => list.length === 1 && !list[0].disabled), 'Popup button missing/ambiguous/disabled')
      const point = await read(chain, list => { list[0].scrollIntoView({ block: 'center' }); const r = list[0].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
    },
    async fill(value) {
      await until(() => read(chain, list => list.length === 1), 'Popup field missing: ' + chain.at(-1).value)
      await read(chain, (list, value) => {
        if (list.length !== 1) throw new Error('Ambiguous field')
        const input = list[0]; input.focus()
        const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }))
      }, value)
    },
    async check() { if (!await read(chain, list => list[0]?.checked)) await locator(chain).click() },
  })
  return { ...locator([]), isClosed: () => closed,
    async close() { closed = true; await root.send('Target.closeTarget', { targetId: info.targetId }).catch(() => {}); await root.detach() },
    async screenshot({ path }) {
      await evaluate(`(() => { const style=document.createElement('style'); style.id='fixture-password-mask'; style.textContent='input[type=password]{color:transparent!important;text-shadow:none!important;background:#64748b!important}'; document.head.append(style) })()`)
      try { const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path, Buffer.from(data, 'base64')) }
      finally { await evaluate(`document.getElementById('fixture-password-mask')?.remove()`) }
    },
  }
}
async function realPopup() {
  await target.bringToFront()
  const root = await context.newCDPSession(target)
  const find = async () => (await root.send('Target.getTargets')).targetInfos.find(info => info.url === popupURL)
  await target.keyboard.press('Alt+Shift+V')
  try { await until(find, 'browser keyboard did not open action', 1500); result.activeTab.method = 'Playwright keyboard Alt+Shift+V' }
  catch {
    execFileSync(resolveExecutable('python3'), ['-c', xkeys], { env: { ...process.env, DISPLAY: result.display }, stdio: 'pipe' })
    try { await until(find, 'OS keyboard did not open action', 3000); result.activeTab.method = 'XTest OS keyboard Alt+Shift+V' }
    catch {
      // Explicit automation fallback: never claim a physical user gesture.
      const info = (await root.send('Target.getTargets')).targetInfos.find(info => info.type === 'service_worker' && info.url === worker.url())
      const { sessionId } = await root.send('Target.attachToTarget', { targetId: info.targetId, flatten: false })
      await root.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'chrome.action.openPopup()', awaitPromise: true, userGesture: true } }) })
      try { await until(find, 'action.openPopup did not open action', 3000); result.activeTab.method = 'CDP userGesture:true chrome.action.openPopup' }
      catch { await root.detach(); return null }
    }
  }
  const info = await find()
  result.popupTargetType = info.type
  return attachPopup(info, root)
}


try {
  execFileSync(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'apps/extension/vite.config.ts', '--outDir', dist, '--logLevel', 'error'],
    { cwd: ROOT, env: { ...process.env, VAULTNACCESS_PORTAL_ORIGIN: PORTAL, VAULTNACCESS_BUILD_ID: BUILD }, stdio: 'inherit' })
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json')))
  result.manifestSha256 = createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
  check('production-manifest-no-extra-access', JSON.stringify(manifest.permissions) === '["identity","storage","activeTab","scripting"]'
    && JSON.stringify(manifest.host_permissions) === JSON.stringify([`${PORTAL}/*`]) && !manifest.content_scripts && !manifest.optional_host_permissions
    && !manifest.externally_connectable && !manifest.web_accessible_resources)
  check('production-action-shortcut', manifest.commands?._execute_action?.suggested_key?.default === 'Alt+Shift+V')
  execFileSync(resolveExecutable('openssl'), ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-days', '1', '-subj', '/CN=vault.example.test',
    '-addext', 'subjectAltName=DNS:vault.example.test,DNS:login.example.test,DNS:other.example.test', '-keyout', join(run, 'key.pem'), '-out', join(run, 'cert.pem')], { stdio: 'ignore' })
  server = createServer({ key: readFileSync(join(run, 'key.pem')), cert: readFileSync(join(run, 'cert.pem')) }, (req, res) => {
    void route(req, res).catch(error => { result.fixtureError = String(error.message).slice(0, 200); if (!res.headersSent) res.writeHead(500); res.end() })
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  display = spawn(resolveExecutable('Xvfb'), ['-displayfd', '3', '-screen', '0', '1280x900x24', '-nolisten', 'tcp', '-nolisten', 'unix'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] })
  display.stderr.on('data', data => { result.displayError = ((result.displayError ?? '') + data.toString()).slice(0, 500) })
  const number = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Xvfb startup timeout')), 5000)
    display.once('exit', code => { clearTimeout(timer); reject(new Error(`Xvfb exit ${code}`)) })
    display.once('error', reject); display.stdio[3].once('data', data => { clearTimeout(timer); done(data.toString().trim()) })
  })
  result.display = `:${number}`
  const port = server.address().port
  context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: false, env: { ...process.env, DISPLAY: result.display },
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, `--host-resolver-rules=MAP vault.example.test:443 127.0.0.1:${port},MAP login.example.test:443 127.0.0.1:${port},MAP other.example.test:443 127.0.0.1:${port}`, '--ignore-certificate-errors', '--no-proxy-server'] })
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
  seen.id = new URL(worker.url()).host; popupURL = `chrome-extension://${seen.id}/popup.html`
  target = await context.newPage(); await target.goto(`${SITE}/login`); await target.bringToFront()
  const denied = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => location.origin }); return false } catch { return true }
  })
  check('foreign-origin-denied-before-gesture', denied)
  popup = await realPopup(); if (!popup) throw Error('Real action required for connect')
  await popup.locator('[data-testid=\"vaultnaccess-connect\"]').click().catch(error => { if (!seen.nonce) throw error })
  await until(async () => seen.nonce && !!(await worker.evaluate(async () => (await chrome.storage.session.get('authorization')).authorization)), 'Real toolbar consent did not complete', 20000)
  await popup.close(); check('real-worker-consent', seen.nonce)
  async function enable(capture = false) {
    popup = await realPopup()
    assertPopup()
    await popup.getByRole('button', { name: 'Sites', exact: true }).click()
    await popup.getByRole('button', { name: 'Enable suggestions on this site', exact: true }).waitFor()
    if (capture) await popup.getByLabel('Also offer to save the login from this form', { exact: true }).check()
    await popup.getByRole('button', { name: 'Enable suggestions on this site', exact: true }).click()
    await popup.getByText('Assistance enabled on this site. Choose a login; the extension will ask for confirmation.', { exact: true }).waitFor()
    await popup.close(); await target.bringToFront()
  }
  function assertPopup() { if (!popup) throw Error('Real toolbar popup unavailable') }
  async function reviewFrom(action) {
    const next = context.waitForEvent('page', { timeout: 15000 }); next.catch(() => {}); pendingPages.push(next)
    await action()
    const review = await next; await review.waitForURL(popupURL)
    return review
  }
  async function chooseInline() {
    return reviewFrom(async () => { await target.locator('#username').click(); await target.screenshot({ path: join(run, 'inline-suggestions.png'), mask: [target.locator('input[type=password]')] }); await target.keyboard.press('ArrowDown'); await target.keyboard.press('Enter') })
  }
  await enable()
  const beforeFill = seen.consumes
  let review = await chooseInline()
  await review.getByRole('button', { name: 'Confirm filling', exact: true }).waitFor()
  await review.screenshot({ path: join(run, 'privileged-fill-confirmation.png'), mask: [review.locator('input[type=password]')] })
  check('inline-selection-awaits-privileged-confirmation', seen.consumes === beforeFill && await target.locator('#password').inputValue() === '')
  await review.getByRole('button', { name: 'Confirm filling', exact: true }).click()
  await until(async () => await target.locator('#password').inputValue() === SECRET, 'Confirmed inline login did not fill')
  check('confirmed-fill-real-worker-jwe', seen.consumes === beforeFill + 1 && await target.locator('#username').inputValue() === 'synthetic-user')
  result.activeTab.verified = true // Real bound injection completed after the pre-gesture permission denial.
  check('fill-never-submits', seen.submissions === 0)
  await review.close(); result.sections.assistance = 'passed'

  async function captureLogin(value, change = false) {
    await target.goto(`${SITE}/${change ? 'change' : 'login'}`); await enable(true)
    if (!change) await target.locator('#username').fill('synthetic-user')
    await target.locator('#password').fill(value)
    if (change) { await target.locator('#old').fill(SECRET); await target.locator('#confirm').fill(value) }
    await target.keyboard.press('Escape')
    const before = seen.creates + seen.updates
    const capture = await reviewFrom(() => target.getByRole('button', { name: 'Sign in', exact: true }).click())
    await capture.getByText('Captured login. Review the details before saving.', { exact: false }).waitFor()
    check('capture-only-proposes-before-save', seen.creates + seen.updates === before)
    const storage = await worker.evaluate(async () => JSON.stringify([await chrome.storage.local.get(null), await chrome.storage.session.get(null)]))
    check('capture-not-in-extension-storage', !storage.includes(value))
    return capture
  }
  review = await captureLogin(CREATED)
  await review.getByLabel('Name', { exact: true }).fill('Reviewed captured login')
  await review.screenshot({ path: join(run, 'review-create.png'), mask: [review.locator('input[type=password]')] })
  await review.getByRole('button', { name: 'Save', exact: true }).click()
  await until(() => seen.creates === 1, 'Reviewed create was not sent')
  check('capture-create-requires-confirm', passwords.get(3) === CREATED)
  await review.close()
  items.push({ ...items[1], id: 4, label: 'Second same-origin login', username: 'second-user', origins: [SITE] })
  const changed = randomBytes(18).toString('hex')
  review = await captureLogin(changed, true)
  const captureUser = review.getByLabel('Username', { exact: true })
  check('password-change-original-username-empty', await captureUser.inputValue() === '')
  await review.getByLabel('Save as').selectOption('1')
  check('password-change-target-a-username', await captureUser.inputValue() === 'synthetic-user')
  await review.getByLabel('Save as').selectOption('4')
  check('password-change-target-b-replaces-autofilled-username', await captureUser.inputValue() === 'second-user')
  await review.getByLabel('Save as').selectOption({ label: 'New personal login' })
  check('password-change-new-login-restores-original-empty-username', await captureUser.inputValue() === '')
  await review.getByLabel('Save as').selectOption('1')
  await review.screenshot({ path: join(run, 'review-password-change-update.png'), mask: [review.locator('input[type=password]')] })
  await review.getByRole('button', { name: 'Save', exact: true }).click()
  await until(() => seen.updates === 1, 'Reviewed update was not sent')
  check('capture-update-selected-item-version', passwords.get(1) === changed && items[0].version === 2)
  await review.close()
  const userEditedPassword = randomBytes(18).toString('hex')
  review = await captureLogin(userEditedPassword, true)
  await review.getByLabel('Save as').selectOption('1')
  await review.getByLabel('Username', { exact: true }).fill('explicitly-reviewed-user')
  await review.getByLabel('Save as').selectOption('4')
  check('explicit-user-edit-survives-target-change', await review.getByLabel('Username', { exact: true }).inputValue() === 'explicitly-reviewed-user')
  await review.getByLabel('Save as').selectOption({ label: 'New personal login' })
  check('explicit-user-edit-survives-new-login-choice', await review.getByLabel('Username', { exact: true }).inputValue() === 'explicitly-reviewed-user')
  await review.getByLabel('Save as').selectOption('4')
  expectedUpdate = { id: 4, username: 'explicitly-reviewed-user' }
  await review.screenshot({ path: join(run, 'review-target-b-explicit-username.png'), mask: [review.locator('input[type=password]')] })
  await review.getByRole('button', { name: 'Save', exact: true }).click()
  await until(() => seen.updates === 2, 'Explicitly edited target B update was not sent')
  check('explicit-user-edit-written-only-to-selected-target', passwords.get(4) === userEditedPassword && items.find(item => item.id === 4).username === 'explicitly-reviewed-user' && items[0].username === 'synthetic-user')
  await review.close(); result.sections.capture = 'passed'

  await target.goto(`${SITE}/login`); popup = await realPopup(); assertPopup()
  await popup.getByRole('button', { name: 'Sites', exact: true }).click()
  const favorite = popup.locator('button[aria-label="Favorite: Synthetic suggested login"]')
  await favorite.click(); await until(async () => await favorite.getAttribute('aria-pressed') === 'true', 'Favorite did not persist')
  check('favorite-toggle-real-ui', await favorite.getAttribute('aria-pressed') === 'true')
  await popup.close(); popup = await realPopup(); assertPopup()
  await popup.getByRole('button', { name: 'Sites', exact: true }).click()
  await until(async () => await popup.locator('button[aria-label="Favorite: Synthetic suggested login"]').getAttribute('aria-pressed') === 'true', 'Favorite was not restored')
  check('favorite-restored-after-popup-reopen', await popup.locator('button[aria-label="Favorite: Synthetic suggested login"]').getAttribute('aria-pressed') === 'true')
  const stored = await worker.evaluate(() => chrome.storage.local.get(null))
  const references = Object.entries(stored).filter(([key]) => key.startsWith('vault-preferences:'))
  check('preferences-only-resource-references', references.length > 0 && references.every(([, value]) => {
    assert.deepEqual(Object.keys(value).sort((a, b) => a.localeCompare(b)), ['favorites', 'recents']); return value.favorites.every(Number.isSafeInteger) && value.recents.every(entry => Object.keys(entry).sort((a, b) => a.localeCompare(b)).join(',') === 'at,id')
  }))
  check('no-captured-password-in-local-storage', !JSON.stringify(stored).includes(CREATED) && !JSON.stringify(stored).includes(changed))
  result.sections.preferences = 'passed'

  await popup.getByRole('button', { name: 'New item', exact: true }).click()
  await popup.locator('summary').click(); await popup.getByLabel('Length', { exact: true }).fill('32')
  await popup.getByRole('button', { name: 'Generate password', exact: true }).click()
  const generated = await popup.getByLabel('Password', { exact: true }).inputValue()
  check('configured-generator-preserves-form', generated.length === 32 && /[A-Z]/.test(generated) && /[a-z]/.test(generated) && /\d/.test(generated) && /[^A-Za-z0-9]/.test(generated))
  await popup.screenshot({ path: join(run, 'generator-options.png') })
  await popup.getByLabel('Name', { exact: true }).fill('Preserved editor')
  await popup.getByLabel('Username', { exact: true }).fill('synthetic-editor')
  await popup.getByLabel('Websites for this login (one per line)', { exact: true }).fill(SITE)
  proofReady = false
  const editorPortalWait = context.waitForEvent('page', { timeout: 15000 }); editorPortalWait.catch(() => {}); pendingPages.push(editorPortalWait)
  await popup.getByRole('button', { name: 'Save', exact: true }).click()
  const editorPortal = await editorPortalWait; await editorPortal.waitForURL('**/vault/extension/confirm?request=*')
  const stagedStorage = await worker.evaluate(async () => JSON.stringify([await chrome.storage.local.get(null), await chrome.storage.session.get(null)]))
  check('staged-generated-password-not-in-extension-storage', !stagedStorage.includes(generated))
  await popup.close(); proofReady = true; await editorPortal.close()
  popup = await realPopup(); assertPopup()
  await popup.getByLabel('Name', { exact: true }).waitFor()
  check('editor-restored-after-hello-with-generated-password', await popup.getByLabel('Name', { exact: true }).inputValue() === 'Preserved editor' && await popup.getByLabel('Password', { exact: true }).inputValue() === generated)
  await popup.screenshot({ path: join(run, 'editor-restored-after-hello.png') })
  check('generator-does-not-save-automatically', seen.creates === 1)
  await popup.getByRole('button', { name: 'Save', exact: true }).click()
  await until(() => seen.creates === 2, 'Restored editor save did not complete')
  check('generated-password-written-only-on-confirmation', passwords.get(items.find(item => item.label === 'Preserved editor')?.id) === generated)
  await popup.close(); result.sections.generator = 'passed'

  proofReady = false; await target.goto(`${SITE}/login`); await enable()
  const helloBefore = seen.consumes
  review = await chooseInline()
  await review.getByRole('button', { name: 'Confirm identity in the portal', exact: true }).waitFor()
  const portalWait = context.waitForEvent('page', { timeout: 10000 }); portalWait.catch(() => {}); pendingPages.push(portalWait)
  await review.getByRole('button', { name: 'Confirm identity in the portal', exact: true }).click()
  const portal = await portalWait; await portal.waitForURL('**/vault/extension/confirm?request=*')
  check('hello-reference-no-password-delivery', proofRequested && seen.consumes === helloBefore && await target.locator('#password').inputValue() === '')
  await review.close()
  proofReady = true // Declared synthetic approval: physical WebAuthn is outside this harness.
  await portal.close(); popup = await realPopup(); assertPopup()
  await popup.getByRole('button', { name: 'Confirm filling', exact: true }).waitFor()
  await popup.screenshot({ path: join(run, 'hello-final-confirmation.png') })
  check('hello-reopen-keeps-reference-requires-confirm', seen.consumes === helloBefore)
  await popup.getByRole('button', { name: 'Confirm filling', exact: true }).click()
  await until(async () => await target.locator('#password').inputValue() === changed, 'Hello resume did not fill current item')
  check('hello-final-confirm-consumes-once', seen.consumes === helloBefore + 1)
  await popup.close(); result.sections.hello = 'passed'
  await Promise.allSettled(pendingPages)
  check('fixture-valid', !result.fixtureError)
  check('reviewed-sources-stable', fingerprint() === result.sourceFingerprint)
  result.status = 'passed'
} catch (error) {
  result.error = String(error.stack ?? error).replaceAll(SECRET, '[synthetic]').replaceAll(CREATED, '[synthetic]').slice(0, 2000)
  if (context) result.targets = context.pages().map(page => page.url().split('?')[0])
  result.apiPaths = seen.paths
  result.counts = { creates: seen.creates, updates: seen.updates, authorizes: seen.authorizes, consumes: seen.consumes }
  if (worker) result.undefinedArgumentProbe = await worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith('https://login.example.test'))
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', func: () => true, args: [undefined] }); return 'accepted' }
    catch (error) { return String(error.message) }
  }).catch(() => 'worker unavailable')
  if (worker) result.targetDiagnostics = await worker.evaluate(async () => {
    const active = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith('https://login.example.test'))
    let document
    try { document = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', func: () => ({ origin: location.origin, visibility: document.visibilityState, top: window.top === window }) }) }
    catch (error) { document = String(error.message) }
    return { active: active.map(tab => ({ id: tab.id, windowId: tab.windowId, origin: new URL(tab.url).origin })), siteTabId: tab?.id, document }
  }).catch(() => 'worker unavailable')
  if (context) result.visibleFailure = await Promise.all(context.pages().map(async (page, index) => {
    try { const body = await page.locator('body').innerText({ timeout: 2000 }); await page.screenshot({ path: join(run, `failure-${index}.png`), timeout: 2000 }); return { url: page.url().split('?')[0], body: body.slice(0, 12000) } }
    catch { return { url: page.url().split('?')[0], unavailable: true } }
  }))
} finally {
  try { await context?.close() } catch { result.cleanupFailed = true }
  await Promise.allSettled(pendingPages)
  server?.closeAllConnections(); await new Promise(done => server ? server.close(done) : done()); display?.kill()
  try { rmSync(join(run, 'profile'), { recursive: true, force: true }); rmSync(join(run, 'key.pem'), { force: true }); rmSync(join(run, 'cert.pem'), { force: true }) } catch { result.cleanupFailed = true }
  result.cleanup = !result.cleanupFailed
  result.sourceFingerprintAfter = fingerprint(); result.sourceChanged = result.sourceFingerprintAfter !== result.sourceFingerprint
  writeFileSync(join(run, 'sources-after.json'), JSON.stringify(Object.fromEntries(sources.map(file => [file, createHash('sha256').update(readFileSync(join(ROOT, file))).digest('hex')])), null, 2))
  if (!result.cleanup || result.sourceChanged) result.status = 'failed'
  result.finishedAt = new Date().toISOString()
  writeFileSync(join(run, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2))
  if (result.status !== 'passed') process.exitCode = 1
}
