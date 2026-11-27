// NA-0203: shared fixture kit for the real-browser sites/adoption harnesses.
// Same behavior as the former per-harness copies: real MV3 worker/popup, synthetic HTTPS API.
// No manifest rewriting, host-permission expansion, worker patching or sender spoofing.
import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:https'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { CompactEncrypt, calculateJwkThumbprint, importJWK } from 'jose'
import { VaultSiteListSchema, VaultSiteListReplySchema } from '../../packages/shared/src/schemas/vault-sites.schema.ts'
import { VaultSiteFillAuthorizeSchema, VaultSiteFillConsumeSchema, VaultSiteFillReleaseSchema } from '../../packages/shared/src/schemas/vault-site-fill.schema.ts'
import { resolveExecutable } from '../shared/trusted-executable.cjs'

export const PORTAL = 'https://vault.example.test', SITE = 'https://login.example.test'
export const BUILD = 'cccccccccccc', ACCESS = 'A'.repeat(43), CODE = 'C'.repeat(43), OTHER_ACCESS = 'B'.repeat(43)

export function harnessTools(result) {
  const check = (name, ok) => { result.checks[name] = ok ? 'PASS' : 'FAIL'; if (!ok) throw new Error(name) }
  const delay = ms => new Promise(done => setTimeout(done, ms))
  async function until(test, message, timeout = 10000) {
    const end = Date.now() + timeout
    while (Date.now() < end) { if (await test()) return; await delay(50) }
    throw new Error(message)
  }
  return { check, delay, until }
}
export function syntheticState() {
  const seen = { paths: [], creates: 0, updates: 0, authorizes: 0, consumes: 0, passwordReleases: 0, usernameReleases: 0, submissions: 0, nonce: false, id: '', pending: null, hold: false, consumeAttempts: 0, revoked: false, dropAfterConsume: false, dropBeforeHeaders: false, holdConsume: false, pendingConsume: null }
  const items = [{ id: 1, version: 1, kind: 'login', label: 'Synthetic suggested login', scope: 'PERSONAL', groupId: null,
    username: 'synthetic-user', origins: [SITE], url: null, host: { id: 10, name: 'Synthetic host' }, canManage: true, allowFill: true },
  { id: 2, version: 1, kind: 'login', label: 'Unrelated origin login', scope: 'PERSONAL', groupId: null,
    username: 'other-user', origins: ['https://other.example.test'], url: null, host: null, canManage: true, allowFill: true }]
  return { seen, items, operations: new Map() }
}
export const loginHtml = `<!doctype html><html><head><title>E7 synthetic login</title></head><body>
<form id="login"><label>Username<input id="username" autocomplete="username"></label>
<label>Password<input id="password" type="password" autocomplete="current-password"></label>
<input id="hidden-password" type="password" hidden><button type="submit">Sign in</button></form>
<iframe srcdoc="<input type='password' id='frame-password'>"></iframe>
<script>window.submissions=0;document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();window.submissions++;fetch('/submitted',{method:'POST'})})</script>
</body></html>`

/** Reads a bounded JSON request and returns { url, body, send }. */
export async function readRequest(req, res) {
  const chunks = []; for await (const chunk of req) { chunks.push(chunk); if (Buffer.concat(chunks).length > 32768) throw new Error('body too large') }
  const url = new URL(req.url, PORTAL), body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
  const send = (status, value, type = 'application/json', extra = {}) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'DPoP-Nonce': `fixture.${'n'.repeat(32)}`, ...extra })
    res.end(type === 'application/json' ? JSON.stringify(value) : value)
  }
  return { url, body, send }
}
export const isSiteHost = req => req.headers.host?.startsWith('login.example.test') || req.headers.host?.startsWith('other.example.test')

/** Portal pages, consent and DPoP/token admission. Returns the API path, or null when already answered. */
export function admitPortal({ req, url, body, send, seen, check }) {
  if (url.pathname === '/vaultnaccess-build.json') { send(200, { buildId: BUILD }); return null }
  if (url.pathname === '/vault/extension/connect') {
    check('consent-extension-binding', url.searchParams.get('extensionId') === seen.id && url.searchParams.get('redirectUri') === `https://${seen.id}.chromiumapp.org/`)
    send(302, '', 'text/plain', { Location: `${url.searchParams.get('redirectUri')}?code=${CODE}&state=${url.searchParams.get('state')}&lang=en` }); return null
  }
  if (url.pathname === '/hosts') { send(200, '<title>Synthetic terminal landing</title><p data-testid="synthetic-terminal">Synthetic host route only; no SSH connection.</p>', 'text/html'); return null }
  if (!url.pathname.startsWith('/api/')) { send(200, '<title>Synthetic portal</title>', 'text/html'); return null }
  seen.paths.push(url.pathname)
  if ((req.method === 'POST' || req.headers.origin !== undefined) && req.headers.origin !== `chrome-extension://${seen.id}`) { send(403, {}); return null }
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(req.headers.dpop ?? '')) { send(401, {}); return null }
  const path = url.pathname.replace('/api/v1/vault-security/extension', '')
  if (path === '/token') {
    if (!seen.nonce) { seen.nonce = true; send(401, {}, 'application/json', { 'WWW-Authenticate': 'DPoP error="use_dpop_nonce"' }); return null }
    check('consent-code', body.code === CODE)
    send(200, { accessToken: ACCESS, tokenType: 'DPoP', expiresAt: 1800000, serverNow: 0 }); return null
  }
  if (![ACCESS, OTHER_ACCESS].some(token => req.headers.authorization === `DPoP ${token}`)) { send(401, {}); return null }
  return path
}
/** Read-only site metadata endpoints. Returns true when answered. */
export function siteMetadata({ path, body, send, seen, items, check }) {
  if (path === '/items') { send(200, { items: [], nextCursor: null }); return true }
  if (path === '/sites/current-hosts') {
    check('current-hosts-exact-origin', body.origin === SITE)
    send(200, { hosts: [{ id: 10, name: 'Synthetic host' }] }); return true
  }
  if (path === '/sites/hosts') { send(200, { hosts: [{ id: 10, name: 'Synthetic host' }] }); return true }
  if (path === '/sites/list') {
    const query = VaultSiteListSchema.parse(body)
    const reply = VaultSiteListReplySchema.parse({ items: items.filter(item => !query.origin || item.origins.includes(query.origin)), next: null })
    seen.lastList = reply; seen.lastOrigin = query.origin
    send(200, reply); return true
  }
  return false
}
/** Fill authorize/consume with real JWE envelopes. `gate` answers 423 while a proof is missing. */
export async function siteFill({ req, res, path, body, send, seen, items, operations, check, delay, plaintext, gate = () => true }) {
  if (path === '/sites/fill/authorize') {
    const value = VaultSiteFillAuthorizeSchema.parse(body), item = items.find(item => item.id === value.siteId)
    if (!item || item.version !== value.siteVersion || !item.origins.includes(value.binding.origin)) { send(403, {}); return true }
    check('fill-top-document-binding', value.binding.frameId === 0 && !!value.binding.documentId)
    if (!gate()) { send(423, {}); return true }
    const operation = randomBytes(32).toString('base64url'); operations.set(operation, { ...value, principal: req.headers.authorization }); seen.authorizes++
    if (seen.hold) await new Promise(done => { seen.pending = done })
    send(200, { operation, expiresAt: 30000, serverNow: 0 }); return true
  }
  if (path !== '/sites/fill/consume') return false
  seen.consumeAttempts++
  const value = VaultSiteFillConsumeSchema.parse(body), operation = operations.get(value.operation)
  if (seen.revoked || (operation && operation.principal !== req.headers.authorization)) { send(403, { code: 'EXTENSION_ITEM_DENIED' }); return true }
  if (!operation || JSON.stringify(operation.binding) !== JSON.stringify(value.binding)) { send(409, { code: 'OPERATION_UNAVAILABLE' }); return true }
  operations.delete(value.operation); seen.consumes++
  if (seen.dropBeforeHeaders) { req.socket.destroy(); return true }
  if (seen.dropAfterConsume) {
    // Commit occurred, then the reply is truncated AFTER response headers. No fixture-induced 403/logout.
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '999999', 'Cache-Control': 'no-store' })
    res.write('{"envelope":'); await delay(20); req.socket.destroy(); return true
  }
  const item = items.find(item => item.id === operation.siteId)
  if (value.binding.mode === 'username') {
    seen.usernameReleases++
    send(200, VaultSiteFillReleaseSchema.parse({ mode: 'username', username: item.username, operation: value.operation, binding: value.binding, expiresAt: 30000, serverNow: 0 })); return true
  }
  seen.passwordReleases++
  const binding = { version: 1, operationId: value.operation, tenantId: 7, userId: 41, clientId: 'c'.repeat(64), action: 'fill', itemRef: `site:${item.id}:${value.binding.mode}`,
    recipientThumbprint: await calculateJwkThumbprint(operation.recipient, 'sha256'), policyVersion: 1, secretVersion: String(item.version), expiresAt: 30000, origin: value.binding.origin }
  const envelope = await new CompactEncrypt(new TextEncoder().encode(plaintext(item, value.binding.mode)))
    .setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM', typ: 'vaultnaccess+jwe', vault: binding }).encrypt(await importJWK(operation.recipient, 'RSA-OAEP-256'))
  if (seen.holdConsume) await new Promise(done => { seen.pendingConsume = done })
  send(200, VaultSiteFillReleaseSchema.parse({ mode: value.binding.mode, envelope, context: binding, username: value.binding.mode === 'both' ? item.username : '', serverNow: 0 }))
  return true
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
async function attachPopup(info, root, until, maskPasswords) {
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
  const capture = async path => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path, Buffer.from(data, 'base64')) }
  return { ...locator([]), isClosed: () => closed,
    async close() { closed = true; await root.send('Target.closeTarget', { targetId: info.targetId }).catch(() => {}); await root.detach() },
    async screenshot({ path }) {
      if (!maskPasswords) return capture(path)
      await evaluate(`(() => { const style=document.createElement('style'); style.id='fixture-password-mask'; style.textContent='input[type=password]{color:transparent!important;text-shadow:none!important;background:#64748b!important}'; document.head.append(style) })()`)
      try { await capture(path) } finally { await evaluate(`document.getElementById('fixture-password-mask')?.remove()`) }
    },
  }
}
/** Opens the real toolbar popup: browser shortcut, then OS XTest, then an explicitly reported CDP gesture. */
export async function realPopup({ target, context, worker, popupURL, result, until, maskPasswords = false }) {
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
  return attachPopup(info, root, until, maskPasswords)
}
/**
 * Builds the production extension, serves the synthetic HTTPS fixture and launches headed Chromium on Xvfb.
 * `state.server`/`state.display`/`state.context` are set as soon as each exists, so callers can always clean up.
 */
export async function launchFixture({ root, run, dist, result, check, route, state }) {
  execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'apps/extension/vite.config.ts', '--outDir', dist, '--logLevel', 'error'],
    { cwd: root, env: { ...process.env, VAULTNACCESS_PORTAL_ORIGIN: PORTAL, VAULTNACCESS_BUILD_ID: BUILD }, stdio: 'inherit' })
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json')))
  result.manifestSha256 = createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
  check('production-manifest-no-extra-access', JSON.stringify(manifest.permissions) === '["identity","storage","activeTab","scripting"]'
    && JSON.stringify(manifest.host_permissions) === JSON.stringify([`${PORTAL}/*`]) && !manifest.content_scripts && !manifest.optional_host_permissions
    && !manifest.externally_connectable && !manifest.web_accessible_resources)
  check('production-action-shortcut', manifest.commands?._execute_action?.suggested_key?.default === 'Alt+Shift+V')
  execFileSync(resolveExecutable('openssl'), ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-days', '1', '-subj', '/CN=vault.example.test',
    '-addext', 'subjectAltName=DNS:vault.example.test,DNS:login.example.test,DNS:other.example.test', '-keyout', join(run, 'key.pem'), '-out', join(run, 'cert.pem')], { stdio: 'ignore' })
  state.server = createServer({ key: readFileSync(join(run, 'key.pem')), cert: readFileSync(join(run, 'cert.pem')) }, (req, res) => {
    void route(req, res).catch(error => { result.fixtureError = String(error.message).slice(0, 200); if (!res.headersSent) res.writeHead(500); res.end() })
  })
  await new Promise(done => state.server.listen(0, '127.0.0.1', done))
  const display = state.display = spawn(resolveExecutable('Xvfb'), ['-displayfd', '3', '-screen', '0', '1280x900x24', '-nolisten', 'tcp', '-nolisten', 'unix'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] })
  display.stderr.on('data', data => { result.displayError = ((result.displayError ?? '') + data.toString()).slice(0, 500) })
  const number = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Xvfb startup timeout')), 5000)
    display.once('exit', code => { clearTimeout(timer); reject(new Error(`Xvfb exit ${code}`)) })
    display.once('error', reject); display.stdio[3].once('data', data => { clearTimeout(timer); done(data.toString().trim()) })
  })
  result.display = `:${number}`
  const port = state.server.address().port
  state.context = await chromium.launchPersistentContext(join(run, 'profile'), { channel: 'chromium', headless: false, env: { ...process.env, DISPLAY: result.display },
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, `--host-resolver-rules=MAP vault.example.test:443 127.0.0.1:${port},MAP login.example.test:443 127.0.0.1:${port},MAP other.example.test:443 127.0.0.1:${port}`, '--ignore-certificate-errors', '--no-proxy-server'] })
  const worker = state.context.serviceWorkers()[0] ?? await state.context.waitForEvent('serviceworker')
  const id = new URL(worker.url()).host
  return { worker, id, popupURL: `chrome-extension://${id}/popup.html` }
}
