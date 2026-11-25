#!/usr/bin/env node
// NA-0203: real MV3 popup/worker/injection, synthetic HTTPS backend and login page.
// No manifest rewriting, host-permission expansion, worker patching or sender spoofing.
// Run with Node24 through bin/dev. Result is failed/blocked unless every mandatory check passes.
import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:https'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { CompactEncrypt, calculateJwkThumbprint, importJWK } from 'jose'
import { VaultSiteCreateSchema, VaultSiteUpdateSchema, VaultSiteListSchema, VaultSiteListReplySchema, VaultSiteVersionSchema } from '../../packages/shared/src/schemas/vault-sites.schema.ts'
import { VaultSiteFillAuthorizeSchema, VaultSiteFillConsumeSchema, VaultSiteFillReleaseSchema } from '../../packages/shared/src/schemas/vault-site-fill.schema.ts'
import { resolveExecutable } from '../shared/trusted-executable.cjs'

const ROOT = resolve(import.meta.dirname, '../..')
const OUT = join(ROOT, '.tmp/NA-0203/sites-browser')
mkdirSync(OUT, { recursive: true })
const run = mkdtempSync(join(OUT, 'run-')), dist = join(run, 'extension')
const PORTAL = 'https://vault.example.test', SITE = 'https://login.example.test'
const SECRET = 'Synthetic-E7-never-real-7!', CREATED = 'Synthetic-created-only-8!'
const BUILD = 'cccccccccccc', ACCESS = 'A'.repeat(43), CODE = 'C'.repeat(43)
const result = { startedAt: new Date().toISOString(), status: 'failed', sections: { ui: 'pending', activeTab: 'pending', fill: 'pending', terminal: 'pending' }, checks: {}, matrix: [], gaps: [], activeTab: { verified: false, method: null },
  boundaries: ['Synthetic HTTPS API, not real backend authorization/DB', 'Synthetic host landing page, not an SSH connection', 'Server revocation cannot retract an envelope after transaction commit; local context checks stop pending injection, not an already dispatched script'], runDirectory: run }
// Include every production extension module, including newly extracted worker helpers.
const sourceFiles = directory => readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap(entry => {
  const file = `${directory}/${entry.name}`
  return entry.isDirectory() ? sourceFiles(file) : /\.(ts|vue|css)$/.test(file) && !/\.test\.ts$/.test(file) ? [file] : []
})
const sources = [...sourceFiles('apps/extension/src'), 'apps/extension/manifest.ts',
  'packages/shared/src/schemas/vault-extension.schema.ts', 'packages/shared/src/schemas/vault-sites.schema.ts',
  'packages/shared/src/schemas/vault-site-fill.schema.ts', 'tools/vault-extension/sites-smoke.mjs'].sort((left, right) => {
  if (left === right) return 0
  return left < right ? -1 : 1
})
const fingerprint = () => createHash('sha256').update(sources.map(file => `${file}\0${readFileSync(join(ROOT, file))}`).join('\0')).digest('hex')
result.sourceFingerprint = fingerprint()
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
const frameworks = new Map()
const passwords = new Map([[1, SECRET]]), operations = new Map()
let context, server, display, target, worker, popup, popupURL
const loginHtml = `<!doctype html><html><head><title>E7 synthetic login</title></head><body>
<form id="login"><label>Username<input id="username" autocomplete="username"></label>
<label>Password<input id="password" type="password" autocomplete="current-password"></label>
<input id="hidden-password" type="password" hidden><button type="submit">Sign in</button></form>
<iframe srcdoc="<input type='password' id='frame-password'>"></iframe>
<script>window.submissions=0;document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();window.submissions++;fetch('/submitted',{method:'POST'})})</script>
</body></html>`
// Fixture frameworks are pinned disposable downloads, never project dependencies or extension code.
function prepareFrameworks() {
  const fixtures = join(run, 'frameworks'); mkdirSync(fixtures)
  for (const name of ['react', 'react-dom']) {
    const packed = JSON.parse(execFileSync(resolveExecutable('npm'), ['pack', `${name}@18.3.1`, '--ignore-scripts', '--json', '--pack-destination', fixtures],
      { cwd: ROOT, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }))[0]
    const source = execFileSync(resolveExecutable('tar'), ['-xOf', join(fixtures, packed.filename), `package/umd/${name}.production.min.js`], { encoding: 'utf8' })
    frameworks.set(`/framework/${name}.js`, source)
    ;(result.frameworks ??= {})[name] = { version: packed.version, integrity: packed.integrity }
  }
  frameworks.set('/framework/vue.js', readFileSync(join(ROOT, 'node_modules/vue/dist/vue.global.prod.js'), 'utf8'))
  result.frameworks.vue = { version: JSON.parse(readFileSync(join(ROOT, 'node_modules/vue/package.json'))).version }
}
function matrixHtml(kind) {
  const fields = '<label>User<input id="username" autocomplete="username"></label><label>Password<input id="password" type="password" autocomplete="current-password"></label>'
  const form = `<form id="login">${fields}<button type="submit">Sign in</button></form>`
  const script = `window.submissions=0;document.addEventListener('submit',event=>{event.preventDefault();window.submissions++});`
  let body = form, extra = ''
  if (kind === 'two-step') {
    body = '<form id="login"><input id="username" autocomplete="username"><button id="next" type="button">Next</button></form>'
    extra = `document.querySelector('#next').onclick=()=>{location.href='/matrix/password-step'}`
  }
  if (kind === 'password-step') body = '<form><p>Account selected</p><input id="password" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form>'
  if (kind === 'dynamic') {
    body = '<button id="mount" type="button">Load login</button><div id="container"></div>'
    extra = `document.querySelector('#mount').onclick=()=>{setTimeout(()=>{document.querySelector('#container').innerHTML=${JSON.stringify(form)}},50)}`
  }
  if (kind === 'replacement') extra = `window.replaceForm=()=>{document.querySelector('form').outerHTML=${JSON.stringify(form)}}`
  if (kind === 'multiple-forms') body = form + '<form id="second"><input id="other-user"><input id="other-password" type="password"></form>'
  if (kind === 'ambiguous-usernames') body = '<form><input id="username"><input id="email" type="email"><input id="password" type="password"></form>'
  if (kind === 'marked-with-search') body = '<form><input id="search" type="text"></form>' + form
  if (kind === 'new-password') body = form.replace('current-password', 'new-password')
  if (kind === 'react') {
    body = '<div id="app"></div><script src="/framework/react.js"></script><script src="/framework/react-dom.js"></script>'
    extra = `const h=React.createElement;function Login(){const [user,setUser]=React.useState('');const [password,setPassword]=React.useState('');
      React.useEffect(()=>{window.fixtureState={user,password}},[user,password]);
      return h('form',{},h('input',{id:'username',autoComplete:'username',value:user,onChange:e=>setUser(e.target.value)}),
        h('input',{id:'password',type:'password',autoComplete:'current-password',value:password,onChange:e=>setPassword(e.target.value)}),h('button',{type:'submit'},'Sign in'))}
      ReactDOM.createRoot(document.querySelector('#app')).render(h(Login));`
  }
  if (kind === 'vue') {
    body = '<div id="app"><form><input id="username" autocomplete="username" v-model="user"><input id="password" type="password" autocomplete="current-password" v-model="password"><button type="submit">Sign in</button></form></div><script src="/framework/vue.js"></script>'
    extra = `Vue.createApp({data:()=>({user:'',password:''}),mounted(){window.fixtureState=this},}).mount('#app')`
  }
  return `<!doctype html><html><head><title>E7 matrix ${kind}</title></head><body>${body}<script>${script}${extra}</script></body></html>`
}
async function route(req, res) {
  const chunks = []; for await (const chunk of req) { chunks.push(chunk); if (Buffer.concat(chunks).length > 32768) throw new Error('body too large') }
  const url = new URL(req.url, PORTAL), body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
  const send = (status, value, type = 'application/json', extra = {}) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'DPoP-Nonce': `fixture.${'n'.repeat(32)}`, ...extra })
    res.end(type === 'application/json' ? JSON.stringify(value) : value)
  }
  if (req.headers.host?.startsWith('login.example.test') || req.headers.host?.startsWith('other.example.test')) {
    if (frameworks.has(url.pathname)) return send(200, frameworks.get(url.pathname), 'application/javascript')
    if (url.pathname === '/redirect') return send(302, '', 'text/plain', { Location: 'https://other.example.test/redirected' })
    if (url.pathname.startsWith('/matrix/')) return send(200, matrixHtml(url.pathname.split('/').at(-1)), 'text/html')
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
    proofUntil: 60000, expiresAt: 1800000, serverNow: 0 })
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
    const value = VaultSiteCreateSchema.parse(body), id = items.length + 1
    check('create-synthetic-only', value.kind === 'login' && value.password === CREATED)
    passwords.set(id, value.password)
    items.push({ id, version: 1, kind: value.kind, label: value.label, scope: value.scope, groupId: null, username: value.username,
      origins: value.origins, url: null, host: value.hostId === 10 ? { id: 10, name: 'Synthetic host' } : null, canManage: true, allowFill: value.allowFill })
    seen.creates++; return send(200, VaultSiteVersionSchema.parse({ id, version: 1 }))
  }
  if (path === '/sites/update') {
    const value = VaultSiteUpdateSchema.parse(body), item = items.find(item => item.id === value.id)
    check('update-does-not-send-password', !Object.hasOwn(value, 'password'))
    if (!item || item.version !== value.version) return send(409, {})
    Object.assign(item, { label: value.label ?? item.label, username: value.username ?? item.username, version: item.version + 1 })
    seen.updates++; return send(200, VaultSiteVersionSchema.parse({ id: item.id, version: item.version }))
  }
  if (path === '/sites/fill/authorize') {
    const value = VaultSiteFillAuthorizeSchema.parse(body), item = items.find(item => item.id === value.siteId)
    if (!item || item.version !== value.siteVersion || !item.origins.includes(value.binding.origin)) return send(403, {})
    check('fill-top-document-binding', value.binding.frameId === 0 && !!value.binding.documentId)
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
    if (value.binding.mode === 'username') {
      seen.usernameReleases++
      return send(200, VaultSiteFillReleaseSchema.parse({ mode: 'username', username: item.username, operation: value.operation, binding: value.binding, expiresAt: 30000, serverNow: 0 }))
    }
    seen.passwordReleases++
    const binding = { version: 1, operationId: value.operation, tenantId: 7, userId: 41, clientId: 'c'.repeat(64), action: 'fill', itemRef: `site:${item.id}:${value.binding.mode}`,
      recipientThumbprint: await calculateJwkThumbprint(operation.recipient, 'sha256'), policyVersion: 1, secretVersion: String(item.version), expiresAt: 30000, origin: value.binding.origin }
    const envelope = await new CompactEncrypt(new TextEncoder().encode(passwords.get(item.id)))
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
    async screenshot({ path }) { const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path, Buffer.from(data, 'base64')) },
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


async function runMatrix() {
  const outcome = async success => {
    const text = success ? 'Login filled. Review and sign in.' : 'NodeAccess unavailable. Try again.'
    await popup.getByText(text, { exact: true }).waitFor()
  }
  const blank = async () => target.locator('input').evaluateAll(nodes => nodes.every(input => input.value === ''))
  const counts = () => ({ authorizes: seen.authorizes, consumes: seen.consumes, attempts: seen.consumeAttempts })
  const clickFill = () => popup.locator('.site-panel li').filter({ hasText: 'Synthetic suggested login' }).getByRole('button', { name: 'Fill', exact: true }).click()
  async function open() {
    popup = await realPopup()
    if (!popup) throw new Error('Matrix requires real action popup')
    await popup.locator('.site-panel').getByText('Synthetic suggested login', { exact: true }).waitFor()
  }
  async function begin(kind = 'native') {
    if (popup && !popup.isClosed()) await popup.close()
    await target.goto(`${SITE}/matrix/${kind}`)
    if (kind === 'dynamic') await target.locator('#mount').click()
    if (kind !== 'two-step') await target.locator('#password').waitFor()
    await open()
  }
  async function held() {
    seen.hold = true
    await clickFill()
    await until(() => !!seen.pending, 'Matrix authorize did not reach barrier')
  }
  function release() { seen.hold = false; const done = seen.pending; seen.pending = null; done?.() }
  async function runCase(name, behavior, runCaseBody) {
    const start = counts()
    try {
      await runCaseBody()
      check(`matrix-${name}`, true)
      result.matrix.push({ case: name, outcome: behavior, authorizes: seen.authorizes - start.authorizes,
        consumes: seen.consumes - start.consumes, consumeAttempts: seen.consumeAttempts - start.attempts })
    } catch (error) {
      result.checks[`matrix-${name}`] = 'FAIL'
      result.matrix.push({ case: name, outcome: 'failed', authorizes: seen.authorizes - start.authorizes, consumes: seen.consumes - start.consumes, consumeAttempts: seen.consumeAttempts - start.attempts, error: String(error.message).slice(0, 180) })
    } finally {
      writeFileSync(join(run, 'matrix-progress.json'), JSON.stringify(result.matrix, null, 2) + '\n')
      console.log(JSON.stringify({ matrixCase: name, outcome: result.matrix.at(-1).outcome }))
      release(); seen.revoked = false; seen.dropAfterConsume = false; seen.dropBeforeHeaders = false; seen.holdConsume = false; seen.pendingConsume?.(); seen.pendingConsume = null }
  }
  let firstStepDocument
  await runCase('two-step-username', 'supported: username only, no password release', async () => {
    await begin('two-step'); const before = counts(), passwordsBefore = seen.passwordReleases, usersBefore = seen.usernameReleases
    firstStepDocument = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      return (await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, func: () => location.origin }))[0].documentId
    })
    await clickFill(); await outcome(true)
    check('two-step-username-only-release', seen.authorizes === before.authorizes + 1 && seen.usernameReleases === usersBefore + 1 && seen.passwordReleases === passwordsBefore)
    check('two-step-username-filled', await target.locator('#username').inputValue() === items[0].username)
    check('two-step-no-automatic-next', await target.locator('#next').count() === 1 && await target.locator('#password').count() === 0)
    await target.screenshot({ path: join(run, 'matrix-two-step-username.png') })
  })
  await runCase('two-step-password', 'supported: separate gesture, new document and operation', async () => {
    await popup.close(); await target.bringToFront()
    const before = counts(), passwordsBefore = seen.passwordReleases
    await target.locator('#next').click(); await target.waitForURL(`${SITE}/matrix/password-step`)
    await open()
    const currentDocument = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      return (await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, func: () => location.origin }))[0].documentId
    })
    check('two-step-new-document', !!firstStepDocument && currentDocument !== firstStepDocument)
    check('two-step-no-password-before-gesture', await blank() && seen.passwordReleases === passwordsBefore && seen.authorizes === before.authorizes)
    await clickFill(); await outcome(true)
    check('two-step-new-password-operation', seen.authorizes === before.authorizes + 1 && seen.passwordReleases === passwordsBefore + 1)
    check('two-step-password-filled', await target.locator('#password').inputValue() === SECRET)
    check('two-step-no-submit', await target.evaluate(() => window.submissions) === 0)
    await target.screenshot({ path: join(run, 'matrix-two-step-password.png') })
  })
  for (const kind of ['dynamic', 'react', 'vue', 'marked-with-search']) {
    await runCase(kind, 'supported', async () => {
      await begin(kind); await clickFill(); await outcome(true)
      check(`${kind}-dom-values`, await target.locator('#username').inputValue() === 'synthetic-user' && await target.locator('#password').inputValue() === SECRET)
      if (kind === 'react' || kind === 'vue') {
        await until(() => target.evaluate(secret => window.fixtureState?.user === 'synthetic-user' && window.fixtureState?.password === secret, SECRET), `${kind} controlled state not updated`)
        check(`${kind}-controlled-state`, true)
      }
      if (kind === 'marked-with-search') check('search-not-filled', await target.locator('#search').inputValue() === '')
      check(`${kind}-no-submit`, await target.evaluate(() => window.submissions) === 0)
      if (kind === 'react' || kind === 'vue') await target.screenshot({ path: join(run, `matrix-${kind}.png`) })
    })
  }
  await runCase('dynamic-replacement', 'supported: current visible controls in the same document', async () => {
    await begin('replacement'); await held()
    await target.evaluate(() => window.replaceForm()); release()
    await outcome(true)
    check('replacement-new-input-filled', await target.locator('#password').inputValue() === SECRET)
  })
  for (const kind of ['multiple-forms', 'ambiguous-usernames', 'new-password']) {
    await runCase(kind, 'safe-refusal: ambiguous or registration form unsupported', async () => {
      await begin(kind); await clickFill(); await outcome(false)
      check(`${kind}-no-partial-write`, await blank())
      check(`${kind}-no-submit`, await target.evaluate(() => window.submissions) === 0)
    })
  }
  await runCase('cross-origin-redirect', 'safe-refusal before consume', async () => {
    await begin(); const before = counts(); await held()
    await target.goto(`${SITE}/redirect`); release(); await outcome(false)
    check('redirect-exact-origin', target.url() === 'https://other.example.test/redirected')
    check('redirect-no-consume', seen.consumeAttempts === before.attempts && await blank())
  })
  await runCase('popup-closed', 'one requested fill completes; reopen never replays', async () => {
    await begin(); const before = counts(); await held(); await popup.close(); release()
    await until(async () => await target.locator('#password').inputValue() === SECRET, 'Requested worker fill did not complete after popup close')
    await open(); await delay(300)
    check('popup-close-single-consume', seen.authorizes === before.authorizes + 1 && seen.consumeAttempts === before.attempts + 1)
    check('popup-close-no-submit', await target.evaluate(() => window.submissions) === 0)
  })
  await runCase('network-after-consume', 'safe-refusal; consumed request not retried, explicit next gesture recovers', async () => {
    await begin(); const before = counts(); seen.dropAfterConsume = true
    await clickFill(); await outcome(false)
    check('network-no-partial-write', await blank())
    check('network-consumed-once', seen.consumes === before.consumes + 1 && seen.consumeAttempts === before.attempts + 1)
    seen.dropAfterConsume = false
    await popup.close(); await open(); await delay(300)
    check('network-reopen-no-replay', seen.consumeAttempts === before.attempts + 1 && await blank())
    await clickFill(); await outcome(true)
    check('network-new-gesture-new-operation', seen.authorizes === before.authorizes + 2 && seen.consumeAttempts === before.attempts + 2)
  })
  await runCase('network-before-response-headers', 'safe-refusal: browser may replay the same consumed operation, never a new authorization', async () => {
    await begin(); const before = counts(); seen.dropBeforeHeaders = true
    await clickFill(); await outcome(false)
    check('lost-response-one-successful-consume', seen.authorizes === before.authorizes + 1 && seen.consumes === before.consumes + 1 && await blank())
    check('lost-response-bounded-attempts', seen.consumeAttempts > before.attempts && seen.consumeAttempts <= before.attempts + 2)
  })
  await runCase('revoke-before-consume', 'safe-refusal by synthetic backend at consume', async () => {
    await begin(); const before = counts(); await held(); seen.revoked = true; release()
    await popup.getByText('This item is not released for this action, or the permission is missing. Ask the vault managers.', { exact: true }).waitFor()
    check('revocation-no-delivery', seen.consumes === before.consumes && seen.consumeAttempts === before.attempts + 1 && await blank())
  })
  for (const mode of ['identity-switch', 'logout']) {
    await runCase(mode, 'safe-refusal: synthetic session change while authorize is pending', async () => {
      await begin(); const before = counts(); await held()
      // Intentional fixture state transition, not a claim of a real portal login/logout flow.
      const saved = await worker.evaluate(async () => (await chrome.storage.session.get('authorization')).authorization)
      try {
        await worker.evaluate(async ({ mode, token }) => {
          if (mode === 'logout') await chrome.storage.session.remove('authorization')
          else { const { authorization } = await chrome.storage.session.get('authorization'); await chrome.storage.session.set({ authorization: { ...authorization, accessToken: token } }) }
        }, { mode, token: OTHER_ACCESS })
        release()
        await outcome(false)
        check(`${mode}-no-delivery`, seen.consumes === before.consumes && await blank())
        check(`${mode}-consume-attempts`, seen.consumeAttempts === before.attempts)
      } finally { await worker.evaluate(authorization => chrome.storage.session.set({ authorization }), saved) }
    })
  }
  for (const mode of ['identity-switch', 'logout', 'navigation']) {
    await runCase(`${mode}-during-consume`, 'late reply refused after local context/document change', async () => {
      await begin(); const before = counts(); seen.holdConsume = true
      await clickFill(); await until(() => !!seen.pendingConsume, 'Consume did not reach response barrier')
      const saved = await worker.evaluate(async () => (await chrome.storage.session.get('authorization')).authorization)
      try {
        if (mode === 'navigation') await target.goto(`${SITE}/matrix/native`)
        else await worker.evaluate(async ({ mode, token }) => {
          if (mode === 'logout') await chrome.storage.session.remove('authorization')
          else { const { authorization } = await chrome.storage.session.get('authorization'); await chrome.storage.session.set({ authorization: { ...authorization, accessToken: token } }) }
        }, { mode, token: OTHER_ACCESS })
        seen.holdConsume = false; seen.pendingConsume(); seen.pendingConsume = null
        await until(async () => /Login filled\.|NodeAccess unavailable\.|connection expired\./.test(await popup.locator('body').textContent()), 'Late reply produced no UI outcome')
        check(`${mode}-late-reply-not-injected`, await blank())
        check(`${mode}-late-reply-no-retry`, seen.authorizes === before.authorizes + 1 && seen.consumeAttempts === before.attempts + 1)
      } finally { await worker.evaluate(authorization => chrome.storage.session.set({ authorization }), saved) }
    })
  }
  await runCase('worker-lost', 'safe interruption; no replay on restart; next explicit gesture recovers', async () => {
    await begin(); const before = counts(); await held(); await popup.close()
    const root = await context.newCDPSession(target), versions = new Map()
    root.on('ServiceWorker.workerVersionUpdated', event => { for (const version of event.versions) versions.set(version.versionId, version) })
    await root.send('ServiceWorker.enable')
    await until(() => [...versions.values()].some(v => v.scriptURL === worker.url() && v.runningStatus === 'running'), 'Running worker version not found')
    const version = [...versions.values()].find(v => v.scriptURL === worker.url() && v.runningStatus === 'running')
    await root.send('ServiceWorker.stopWorker', { versionId: version.versionId })
    await until(() => versions.get(version.versionId)?.runningStatus === 'stopped', 'Worker did not stop')
    release(); await root.detach()
    await open(); await delay(300)
    check('worker-restart-no-replay', seen.authorizes === before.authorizes + 1 && seen.consumeAttempts === before.attempts && await blank())
    await clickFill(); await outcome(true)
    worker = context.serviceWorkers().find(candidate => candidate.url() === worker.url()) ?? worker
    check('worker-new-gesture-recovers', seen.authorizes === before.authorizes + 2 && seen.consumes === before.consumes + 1)
  })
  check('matrix-complete', result.matrix.every(entry => entry.outcome !== 'failed'))
  result.sections.matrix = 'passed'
  await begin()
}

try {
  prepareFrameworks()
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
  // Connect is privileged too: bootstrap through the real toolbar action on the portal,
  // never an ordinary extension tab and never a simulated sender.
  target = await context.newPage(); await target.goto(`${PORTAL}/bootstrap`)
  const setup = await realPopup()
  if (!setup) throw new Error('Real toolbar popup required for consent bootstrap')
  try { await setup.locator('[data-testid="vaultnaccess-connect"]').click() } catch (error) {
    // launchWebAuthFlow can close the popup while the mouse-up command is returning.
    result.bootstrapPopupClosed = String(error.message).slice(0, 160)
  }
  await until(() => worker.evaluate(async () => !!(await chrome.storage.session.get('authorization')).authorization), 'Consent did not authorize the real worker', 20000)
  check('real-worker-consent', seen.nonce)
  try { await setup.close() } catch { /* auth window may have closed the action */ }
  await target.close()
  target = await context.newPage(); await target.goto(`${SITE}/login`); await target.bringToFront()
  const denied = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => location.origin }); return false } catch { return true }
  })
  check('foreign-origin-denied-before-gesture', denied)
  popup = await realPopup()
  const hasAction = !!popup
  if (!hasAction) {
    result.sections.activeTab = 'blocked'; result.sections.fill = 'blocked'
    result.gaps.push('Real action popup unavailable: ordinary popup tab validates Sites All CRUD and host link only; no fill sender spoofing.')
    popup = await context.newPage(); await popup.goto(popupURL)
    await popup.getByRole('button', { name: 'Sites', exact: true }).click()
  }
  await popup.locator('.site-panel').getByText('Synthetic suggested login', { exact: true }).waitFor()
  if (hasAction) {
  check('current-site-default-suggestion', seen.lastOrigin === SITE && await popup.getByRole('button', { name: 'This site', exact: true }).getAttribute('aria-pressed') === 'true')
  check('other-origin-not-suggested', await popup.getByText('Unrelated origin login', { exact: true }).count() === 0)
  const afterGesture = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    const [capture] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, func: () => location.origin })
    return { origin: capture.result, documentId: capture.documentId, frameId: capture.frameId }
  })
  check('foreign-document-allowed-after-action', afterGesture.origin === SITE && afterGesture.frameId === 0 && !!afterGesture.documentId)
  result.activeTab.verified = true
    result.sections.activeTab = 'passed'
  }
  await popup.screenshot({ path: join(run, 'sites-suggestions.png') })
  check('list-has-no-secret', !JSON.stringify(seen.lastList).includes(SECRET) && !Object.keys(seen.lastList.items[0]).some(key => /password|encrypted|^iv$/i.test(key)))
  await popup.locator('.site-panel').getByRole('button', { name: 'New item', exact: true }).click()
  await popup.getByLabel('Name', { exact: true }).fill('Created synthetic site')
  await popup.getByLabel('Username', { exact: true }).fill('created-user')
  await popup.getByLabel('Websites for this login (one per line)', { exact: true }).fill(SITE)
  await popup.getByLabel('Password', { exact: true }).fill(CREATED)
  await popup.getByLabel('Allow filling this login', { exact: true }).check()
  await popup.getByRole('button', { name: 'Save', exact: true }).click()
  const created = popup.locator('.site-panel li').filter({ hasText: 'Created synthetic site' })
  await created.waitFor(); check('create-via-popup', seen.creates === 1)
  await created.getByRole('button', { name: 'Edit', exact: true }).click()
  check('edit-does-not-load-password', await popup.getByLabel('Password', { exact: true }).inputValue() === '')
  await popup.getByLabel('Username', { exact: true }).fill('updated-user')
  await popup.getByRole('button', { name: 'Save', exact: true }).click()
  await created.getByText('updated-user', { exact: true }).waitFor(); check('username-metadata-update', seen.updates === 1)
  result.sections.ui = 'passed'
  await popup.screenshot({ path: join(run, 'sites-updated.png') })
  const suggested = popup.locator('.site-panel li').filter({ hasText: 'Synthetic suggested login' })
  if (hasAction) {
  await suggested.getByRole('button', { name: 'Fill', exact: true }).click()
  await until(async () => await target.locator('#password').inputValue() === SECRET, 'worker did not inject password')
  check('real-worker-jwe-fill', seen.authorizes === 1 && seen.consumes === 1 && await target.locator('#username').inputValue() === 'synthetic-user')
  check('no-auto-submit', seen.submissions === 0 && await target.evaluate(() => window.submissions) === 0)
  check('hidden-and-iframe-untouched', await target.locator('#hidden-password').inputValue() === '' && await target.frameLocator('iframe').locator('#frame-password').inputValue() === '')
  const persisted = await worker.evaluate(async () => JSON.stringify({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }))
  check('no-secret-in-extension-storage', !persisted.includes(SECRET) && !persisted.includes(CREATED))
  check('no-secret-in-popup-list', !(await popup.locator('.site-panel').textContent()).includes(SECRET))
  // Navigation while authorize is pending must stop before consume on the replacement document.
  seen.hold = true
  await suggested.getByRole('button', { name: 'Fill', exact: true }).click()
  await until(() => seen.pending !== null, 'navigation test did not reach authorize')
  await target.goto(`${SITE}/replacement`)
  seen.pending(); seen.pending = null; seen.hold = false
  await popup.getByText('NodeAccess unavailable. Try again.', { exact: true }).waitFor()
  check('navigation-refused-before-consume', seen.authorizes === 2 && seen.consumes === 1 && await target.locator('#password').inputValue() === '')
  if (popup && !popup.isClosed()) await popup.close()
  popup = await realPopup()
  if (!popup) throw new Error('action-popup-lost-after-navigation')
  result.sections.fill = 'passed'
  await runMatrix()
  }
  const host = popup.locator('.site-panel li').filter({ hasText: 'Synthetic suggested login' }).getByRole('button', { name: 'Open terminal in NodeAccess: Synthetic host', exact: true })
  const landing = context.waitForEvent('page')
  await host.click(); const terminal = await landing
  await terminal.waitForURL(`${PORTAL}/hosts?hostId=10&connect=1`)
  await terminal.getByTestId('synthetic-terminal').waitFor()
  check('linked-host-connect-intent', terminal.url() === `${PORTAL}/hosts?hostId=10&connect=1`)
  result.sections.terminal = 'passed'
  if (hasAction) {
    if (!popup.isClosed()) await popup.close()
    items.length = 0
    popup = await realPopup()
    if (!popup) throw new Error('action-popup-lost-before-empty-sites')
    await popup.getByText('No items found.', { exact: true }).waitFor()
    const currentHost = popup.getByRole('button', { name: 'Connect with NodeAccess · Synthetic host', exact: true })
    await currentHost.waitFor()
    await popup.screenshot({ path: join(run, 'current-host-without-login.png') })
    const nextPage = context.waitForEvent('page')
    await currentHost.click(); const noLoginTerminal = await nextPage
    await noLoginTerminal.waitForURL(`${PORTAL}/hosts?hostId=10&connect=1`)
    check('current-host-connect-without-login', true)
  }
  check('manifest-unchanged-after-browser', createHash('sha256').update(JSON.stringify(JSON.parse(readFileSync(join(dist, 'manifest.json'))))).digest('hex') === result.manifestSha256)
  check('reviewed-sources-stable', fingerprint() === result.sourceFingerprint)
  check('fixture-valid', !result.fixtureError)
  result.status = hasAction ? 'passed' : 'blocked'
} catch (error) {
  result.error = String(error.message ?? error).slice(0, 400)
  if (context) result.targets = context.pages().map(page => page.url().split('?')[0])
} finally {
  result.cleanup = true
  result.cleanupErrors = []
  const cleanup = async (name, action) => {
    try { await action() } catch {
      result.cleanup = false
      result.status = 'failed'
      // Report the failed phase without paths, credentials or upstream exception text.
      if (!result.cleanupErrors.includes(name)) result.cleanupErrors.push(name)
    }
  }
  await cleanup('pending-authorize', () => seen.pending?.())
  await cleanup('pending-consume', () => seen.pendingConsume?.())
  await cleanup('browser', () => context?.close())
  await cleanup('server-connections', () => server?.closeAllConnections())
  await cleanup('server', () => server?.listening ? new Promise((resolve, reject) => {
    server.close(error => { if (error) reject(error); else resolve() })
  }) : undefined)
  await cleanup('display', () => {
    if (!display || display.exitCode !== null || display.signalCode !== null) return
    return new Promise((resolve, reject) => {
      display.once('exit', resolve)
      display.once('error', reject)
      if (!display.kill()) reject(new Error('Display did not stop'))
    })
  })
  await cleanup('profile', () => rmSync(join(run, 'profile'), { recursive: true, force: true }))
  await cleanup('key', () => rmSync(join(run, 'key.pem'), { force: true }))
  await cleanup('certificate', () => rmSync(join(run, 'cert.pem'), { force: true }))
  result.counts = { creates: seen.creates, updates: seen.updates, authorizes: seen.authorizes, consumes: seen.consumes, passwordReleases: seen.passwordReleases, usernameReleases: seen.usernameReleases, consumeAttempts: seen.consumeAttempts, submissions: seen.submissions }
  result.finishedAt = new Date().toISOString()
  const artifacts = [['result-file', join(run, 'result.json')], ['latest-file', join(OUT, 'latest.json')]]
  for (const [name, file] of artifacts) await cleanup(name, () => writeFileSync(file, JSON.stringify(result, null, 2) + '\n'))
  // If either artifact write failed, refresh any writable copy with the failed status.
  if (result.cleanupErrors.some(name => name === 'result-file' || name === 'latest-file')) {
    for (const [name, file] of artifacts) await cleanup(name, () => writeFileSync(file, JSON.stringify(result, null, 2) + '\n'))
  }
  console.log(JSON.stringify(result))
  process.exitCode = result.status === 'passed' ? 0 : result.status === 'blocked' ? 2 : 1
}
