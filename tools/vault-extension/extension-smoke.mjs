#!/usr/bin/env node
// NA-0183 — loads the built VaultNAccess extension (unpacked) in Chromium and drives connect → search → open →
// disconnect against a simulated portal (Playwright routes). Checks the MV3 wiring that unit tests cannot reach:
// service-worker consent flow, storage.session only, non-extractable device key in IndexedDB, nothing in
// storage.local/sync and no token in URLs. Protocol security is covered by the backend unit/MySQL suites.
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:https'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { CompactEncrypt, calculateJwkThumbprint, importJWK } from 'jose'
import { resolveExecutable } from '../shared/trusted-executable.cjs'
import { checkPackageInBrowser } from './package-smoke.mjs'

const ROOT = resolve(import.meta.dirname, '../..')
const PORTAL = 'https://vault.example.test'
const BUILD = 'aaaaaaaaaaaa'
const SECRET = 'Smoke-only-never-real-7!'
const personalItems = []
let writeCount = 0, lastWriteOperation = ''
// Coverage runs (tools/coverage/browser.mjs) supply a private artifacts directory and the pinned Chromium.
const OUT = process.env.ARTIFACTS_DIR ? resolve(process.env.ARTIFACTS_DIR) : resolve(ROOT, '.tmp/NA-0183/extension-smoke')
mkdirSync(OUT, { recursive: true })
const result = { startedAt: new Date().toISOString(), checks: {}, status: 'failed' }
const sourceFiles = ['apps/extension/src/background.ts', 'apps/extension/src/core/portal-fill-intent.ts', 'apps/extension/src/popup/main.ts', 'apps/extension/src/core/client.ts', 'apps/extension/src/core/ports.ts', 'apps/extension/src/adapters/chromium.ts', 'apps/extension/src/popup/App.vue', 'apps/extension/src/popup/ItemEditor.vue', 'packages/shared/src/schemas/vault-extension.schema.ts', 'apps/backend/src/modules/vault-security/vault-extension.service.ts', 'tools/vault-extension/extension-smoke.mjs', 'apps/extension/src/popup/PopupIcon.vue']
const fingerprint = () => createHash('sha256').update(sourceFiles.map(file => `${file}\0${readFileSync(join(ROOT, file), 'utf8')}`).join('\0')).digest('hex')
result.sourceFingerprint = fingerprint()
result.sourceFiles = sourceFiles
const check = (name, ok, detail = '') => { result.checks[name] = ok ? 'PASS' : `FAIL ${detail}`.trim(); if (!ok) throw new Error(`${name} ${detail}`) }

const dist = resolve(OUT, 'dist')
execFileSync(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'apps/extension/vite.config.ts', '--outDir', dist, '--logLevel', 'error'],
  { cwd: ROOT, env: { ...process.env, VAULTNACCESS_PORTAL_ORIGIN: PORTAL, VAULTNACCESS_BUILD_ID: BUILD, VAULTNACCESS_OUT_DIR: 'dist' }, stdio: 'inherit' })
const profile = mkdtempSync(join(OUT, 'profile-'))
const access = 'A'.repeat(43), code = 'C'.repeat(43)
const seen = { token: 0, items: 0, consentQuery: null, urls: [], id: '', announced: BUILD, trusted: false, portalLogin: true, lastRenewal: '', forgotten: 0 }
let context, server, display
const delay = ms => new Promise(done => setTimeout(done, ms))
async function until(test, message, timeout = 20000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await test()) return; await delay(100) }
  throw new Error(message)
}
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


const outsideClick = String.raw`
import ctypes, os, sys, time
X=ctypes.CDLL('libX11.so.6'); T=ctypes.CDLL('libXtst.so.6')
X.XOpenDisplay.argtypes=[ctypes.c_char_p]; X.XOpenDisplay.restype=ctypes.c_void_p
d=X.XOpenDisplay(os.environ['DISPLAY'].encode()); assert d
X.XDefaultRootWindow.argtypes=[ctypes.c_void_p]; X.XDefaultRootWindow.restype=ctypes.c_ulong
X.XCreateSimpleWindow.argtypes=[ctypes.c_void_p,ctypes.c_ulong,ctypes.c_int,ctypes.c_int,ctypes.c_uint,ctypes.c_uint,ctypes.c_uint,ctypes.c_ulong,ctypes.c_ulong]; X.XCreateSimpleWindow.restype=ctypes.c_ulong
X.XMapRaised.argtypes=[ctypes.c_void_p,ctypes.c_ulong]; X.XSetInputFocus.argtypes=[ctypes.c_void_p,ctypes.c_ulong,ctypes.c_int,ctypes.c_ulong]
X.XDestroyWindow.argtypes=[ctypes.c_void_p,ctypes.c_ulong]; X.XFlush.argtypes=[ctypes.c_void_p]; X.XCloseDisplay.argtypes=[ctypes.c_void_p]
T.XTestFakeMotionEvent.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_ulong]
T.XTestFakeButtonEvent.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_int,ctypes.c_ulong]
w=0
try:
 if sys.argv[1]=='other-window':
  w=X.XCreateSimpleWindow(d,X.XDefaultRootWindow(d),40,300,180,100,0,0,0xffffff)
  X.XMapRaised(d,w); X.XSetInputFocus(d,w,1,0); X.XFlush(d); time.sleep(.1)
 T.XTestFakeMotionEvent(d,-1,100,350,0)
 T.XTestFakeButtonEvent(d,1,1,0); T.XTestFakeButtonEvent(d,1,0,0); X.XFlush(d); time.sleep(.2)
finally:
 if w: X.XDestroyWindow(d,w)
 X.XFlush(d); X.XCloseDisplay(d)
`

/** Only bootstrap uses the real action target; ordinary extension tabs below exercise non-worker UI. */
async function connectFromToolbar(target, worker, id, outcome, inspect) {
  await target.bringToFront()
  const root = await context.newCDPSession(target)
  const before = new Set((await root.send('Target.getTargets')).targetInfos.map(info => info.targetId))
  const find = async () => (await root.send('Target.getTargets')).targetInfos.find(info => info.url === `chrome-extension://${id}/popup.html` && !before.has(info.targetId))
  let info
  try {
    await target.keyboard.press('Alt+Shift+V')
    try { await until(find, 'Browser shortcut did not open action', 1500); result.toolbarMethod = 'Playwright keyboard Alt+Shift+V' }
    catch {
      execFileSync(resolveExecutable('python3'), ['-c', xkeys], { env: { ...process.env, DISPLAY: result.display }, stdio: 'pipe' })
      await until(find, 'OS shortcut did not open real toolbar action', 5000)
      result.toolbarMethod = 'XTest OS keyboard Alt+Shift+V'
    }
    info = await find(); result.toolbarTargetType = info.type
    const { sessionId } = await root.send('Target.attachToTarget', { targetId: info.targetId, flatten: false })
    let serial = 0
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++serial
      const timer = setTimeout(() => { root.off('Target.receivedMessageFromTarget', listener); reject(new Error(`Toolbar CDP timeout: ${method}`)) }, 10000)
      const listener = event => {
        if (event.sessionId !== sessionId) return
        const reply = JSON.parse(event.message)
        if (reply.id !== id) return
        clearTimeout(timer); root.off('Target.receivedMessageFromTarget', listener)
        if (reply.error) reject(new Error(reply.error.message)); else resolve(reply.result)
      }
      root.on('Target.receivedMessageFromTarget', listener)
      void root.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(error => { clearTimeout(timer); root.off('Target.receivedMessageFromTarget', listener); reject(error) })
    })
    if (inspect) return await inspect({ send, root, targetId: info.targetId })
    let point
    await until(async () => {
      const reply = await send('Runtime.evaluate', { expression: `(()=>{const b=document.querySelector('[data-testid="vaultnaccess-connect"]');if(!b||b.disabled)return null;b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`, returnByValue: true })
      point = reply.result.value; return !!point
    }, 'Connect button missing in actual toolbar')
    const screenshot = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, `toolbar-${outcome}.png`), Buffer.from(screenshot.data, 'base64'))
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    try { await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 }) }
    catch (error) { result.toolbarClosedDuringConsent = String(error.message).slice(0, 160) }
    await until(() => worker.evaluate(async outcome => {
      const value = await chrome.storage.session.get(['authorization', 'connectFailure'])
      return outcome === 'offline' ? value.connectFailure?.reason === 'offline' : !!value.authorization
    }, outcome), `Real toolbar consent did not complete: ${outcome}`).catch(async error => {
      result.toolbarFailure = await worker.evaluate(async () => { const v = await chrome.storage.session.get(['authorization', 'connectFailure']); return { authorized: !!v.authorization, failure: v.connectFailure?.reason ?? null } })
      try { const v = await send('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true }); result.toolbarText = v.result.value?.slice(0, 800) } catch { /* popup may be closed */ }
      throw error
    })
    if (outcome === 'offline') {
      await until(async () => {
        const view = await send('Runtime.evaluate', { expression: `(()=>({text:document.querySelector('[data-testid="vaultnaccess-error"]')?.textContent??'',enabled:document.querySelector('[data-testid="vaultnaccess-connect"]')?.disabled===false}))()`, returnByValue: true })
        return /Não foi possível conectar ao NodeAccess|Could not reach NodeAccess/.test(view.result.value.text) && view.result.value.enabled
      }, 'Real toolbar must explain offline portal and allow retry', 15000)
      for (const colorScheme of ['light', 'dark']) {
        await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: colorScheme }] })
        const shot = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, `popup-offline-${colorScheme}.png`), Buffer.from(shot.data, 'base64'))
      }
      const view = await send('Runtime.evaluate', { expression: 'document.documentElement.scrollWidth <= innerWidth', returnByValue: true })
      return view.result.value
    }
  } finally {
    if (info) await root.send('Target.closeTarget', { targetId: info.targetId }).catch(() => {})
    await root.detach()
  }
}

try {
  // Disposable self-signed certificate; the browser is told to trust it only for this run.
  execFileSync(resolveExecutable('openssl'), ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-days', '1', '-subj', '/CN=vault.example.test',
    '-addext', 'subjectAltName=DNS:vault.example.test', '-keyout', join(profile, 'key.pem'), '-out', join(profile, 'cert.pem')], { stdio: 'ignore' })
  server = createServer({ key: readFileSync(join(profile, 'key.pem')), cert: readFileSync(join(profile, 'cert.pem')) }, (req, res) => {
    // NA-0190: portal down — the connection is dropped without any HTTP answer.
    if (seen.offline) { req.socket.destroy(); return }
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      const url = new URL(req.url ?? '/', PORTAL), headers = req.headers
      seen.urls.push(url.pathname + url.search)
      ;(seen.origins ??= []).push(`${req.method} ${url.pathname} ${headers.origin ?? '-'}`)
      const send = (status, body, extra = {}, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type, 'DPoP-Nonce': 'abc.' + 'n'.repeat(32), 'Cache-Control': 'no-store', ...extra }); res.end(body) }
      // NA-0190: build id announced by the portal dev server.
      if (url.pathname === '/vaultnaccess-build.json') return send(200, JSON.stringify({ buildId: seen.announced }))
      if (url.pathname === '/vault/extension/connect') {
        seen.consentQuery = Object.fromEntries(url.searchParams)
        const back = `${url.searchParams.get('redirectUri')}?code=${code}&state=${url.searchParams.get('state')}&lang=pt-BR`
        return send(302, '', { Location: back }, 'text/plain')
      }
      // Same rule as the backend: Origin is mandatory on POST, optional on GET (Chromium omits it there).
      if (url.pathname.startsWith('/api/') && (req.method === 'POST' || headers.origin !== undefined) && headers.origin !== `chrome-extension://${seen.id}`) return send(400, '{}')
      if (url.pathname.startsWith('/api/') && !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(String(headers.dpop ?? ''))) return send(401, '{}', { 'WWW-Authenticate': 'DPoP error="invalid_token"' })
      if (url.pathname.endsWith('/extension/token')) {
        seen.token++
        if (seen.token === 1) return send(401, '{}', { 'WWW-Authenticate': 'DPoP error="use_dpop_nonce"' })
        const body = JSON.parse(raw || '{}')
        if (body.code !== code || headers['x-extension-version'] !== '0.1.0') return send(400, '{}')
        seen.trusted = true
        return send(200, JSON.stringify({ accessToken: access, tokenType: 'DPoP', expiresAt: 1_800_000, serverNow: 0 }))
      }
      // NA-0193: trusted device renewal (automatic while the portal login lives, else the authenticator code) and forget.
      if (url.pathname.endsWith('/extension/renew')) {
        const body = JSON.parse(raw || '{}')
        if (!seen.trusted) return send(401, JSON.stringify({ code: 'EXTENSION_UNAUTHORIZED' }))
        if (body.otp === undefined && !seen.portalLogin) return send(401, JSON.stringify({ code: 'EXTENSION_REAUTH_REQUIRED' }))
        if (body.otp !== undefined && body.otp !== '123456') return send(403, JSON.stringify({ code: 'VAULT_REAUTH_FAILED' }))
        seen.lastRenewal = body.otp === undefined ? 'SESSION' : 'OTP'
        return send(200, JSON.stringify({ accessToken: access, tokenType: 'DPoP', expiresAt: 1_800_000, serverNow: 0 }))
      }
      // NA-0195 (E2): capabilities, authenticator-code proof and a real JWE release (same library as the server).
      if (url.pathname.endsWith('/extension/capabilities')) {
        return send(200, JSON.stringify({ apiVersion: 1, minExtensionVersion: '0.1.0', kinds: ['secret', 'pem'], features: { reveal: true, copy: true, create: true },
          portalOrigin: PORTAL, expiresAt: 1_800_000, serverNow: 0 }))
      }
      if (url.pathname.endsWith('/extension/unlock')) {
        if (JSON.parse(raw || '{}').otp !== '123456') return send(403, JSON.stringify({ code: 'VAULT_REAUTH_FAILED' }))
        seen.proof = true
        return send(200, JSON.stringify({ proofUntil: 60_000, serverNow: 0 }))
      }
      // NA-0200 (E5b): confirmation in the portal; the test approves it after the confirmation tab opens.
      if (url.pathname.endsWith('/extension/proof-request')) {
        seen.proofRequests = (seen.proofRequests ?? 0) + 1
        const request = 'Q'.repeat(43)
        return send(200, JSON.stringify({ request, url: `${PORTAL}/vault/extension/confirm?request=${request}`, expiresAt: 120_000, serverNow: 0 }))
      }
      if (url.pathname.endsWith('/extension/proof-claim')) {
        if (JSON.parse(raw || '{}').request !== 'Q'.repeat(43)) return send(409, JSON.stringify({ code: 'EXTENSION_PROOF_UNAVAILABLE' }))
        if (!seen.portalApproved) return send(200, JSON.stringify({ state: 'PENDING' }))
        seen.proof = true; seen.portalApproved = false
        return send(200, JSON.stringify({ state: 'APPROVED', proofUntil: 60_000, serverNow: 0 }))
      }
      if (url.pathname.endsWith('/extension/deliver')) {
        if (!seen.proof) return send(423, JSON.stringify({ code: 'VAULT_STEP_UP_REQUIRED' }))
        const body = JSON.parse(raw || '{}')
        seen.deliveries = (seen.deliveries ?? 0) + 1
        void (async () => {
          const context = { version: 1, operationId: 'o'.repeat(43), tenantId: 7, userId: 41, clientId: 'c'.repeat(64), action: body.action, itemRef: `secret:${body.secretId}`,
            recipientThumbprint: await calculateJwkThumbprint(body.recipient, 'sha256'), policyVersion: 1, secretVersion: 'f'.repeat(64), expiresAt: 9, origin: PORTAL }
          const envelope = await new CompactEncrypt(new TextEncoder().encode(SECRET)).setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM', typ: 'vaultnaccess+jwe', vault: context })
            .encrypt(await importJWK(body.recipient, 'RSA-OAEP-256'))
          send(200, JSON.stringify({ envelope, context, serverNow: 0 }))
        })()
        return undefined
      }
      if (url.pathname.endsWith('/extension/forget')) {
        if (JSON.parse(raw || '{}').extensionId !== seen.id) return send(400, '{}')
        seen.trusted = false; seen.forgotten++
        return send(200, JSON.stringify({ state: 'FORGOTTEN' }))
      }
      if (url.pathname.endsWith('/extension/hosts')) {
        if (headers.authorization !== `DPoP ${access}`) return send(401, '{}')
        return send(200, JSON.stringify({ hosts: url.searchParams.get('kind') === 'secret' ? [{ id: 10, name: 'Visible host' }, { id: 11, name: 'host-'.repeat(36) }] : [], nextCursor: null }))
      }
      if (url.pathname.endsWith('/extension/items')) {
        seen.items++
        if (headers.authorization !== `DPoP ${access}`) return send(401, '{}')
        const all = [{ kind: 'secret', sourceId: 3, label: 'smoke-item', description: null, scope: 'shared', portalPath: '/vault?kind=secret&id=3' },
          { kind: 'pem', sourceId: 5, label: 'zeta-key', description: null, scope: 'personal', portalPath: '/vault?kind=pem&id=5' }]
        all.push(...personalItems)
        const q = (url.searchParams.get('q') ?? '').toLowerCase()
        return send(200, JSON.stringify({ items: all.filter(i => i.label.includes(q)), nextCursor: null }))
      }
      if (url.pathname.endsWith('/extension/write')) {
        if (headers.authorization !== `DPoP ${access}`) return send(401, '{}')
        const body = JSON.parse(raw), id = body.id ?? 100 + personalItems.length
        writeCount++; lastWriteOperation = body.operation
        if (body.operation === 'create-secret' || body.operation === 'import-pem') {
          const kind = body.operation === 'import-pem' ? 'pem' : 'secret'
          personalItems.push({ kind, sourceId: id, label: body.alias ?? body.name, description: body.description ?? null, scope: 'personal', portalPath: `/vault?kind=${kind}&id=${id}` })
        } else if (body.operation === 'update-secret') {
          const item = personalItems.find(i => i.sourceId === id)
          if (!item) return send(403, JSON.stringify({ code: 'EXTENSION_ITEM_DENIED' }))
          item.label = body.alias; item.description = body.description
        }
        return send(200, JSON.stringify({ id }))
      }
      return send(200, '<title>portal</title>', {}, 'text/html')
    })
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const port = server.address().port
  display = spawn(resolveExecutable('Xvfb'), ['-displayfd', '3', '-screen', '0', '1280x900x24', '-nolisten', 'tcp', '-nolisten', 'unix'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] })
  display.stderr.on('data', data => { result.displayError = ((result.displayError ?? '') + data.toString()).slice(0, 500) })
  const number = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Xvfb startup timeout')), 5000)
    display.once('exit', code => { clearTimeout(timer); reject(new Error(`Xvfb exit ${code}`)) })
    display.once('error', reject); display.stdio[3].once('data', data => { clearTimeout(timer); done(data.toString().trim()) })
  })
  result.display = `:${number}`
  context = await chromium.launchPersistentContext(join(profile, 'browser'), { channel: 'chromium', headless: false, env: { ...process.env, DISPLAY: result.display }, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, `--host-resolver-rules=MAP vault.example.test:443 127.0.0.1:${port}`, '--ignore-certificate-errors'] })
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15_000 })
  const id = new URL(worker.url()).host
  seen.id = id
  check('extension-id', /^[a-p]{32}$/.test(id), id)
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'))
  check('manifest-permissions', JSON.stringify(manifest.permissions) === '["identity","storage","activeTab","scripting"]' && JSON.stringify(manifest.host_permissions) === `["${PORTAL}/*"]`
    && !manifest.content_scripts && !manifest.externally_connectable && !manifest.web_accessible_resources)
  check('shortcut-alt-shift-v', manifest.commands?._execute_action?.suggested_key?.default === 'Alt+Shift+V', JSON.stringify(manifest.commands))

  // Unpacked updates require Chrome's normal developer-mode opt-in. Configure
  // only this disposable profile through the real UI, never a security bypass flag.
  const developerPage = await context.newPage()
  await developerPage.goto('chrome://extensions/')
  const beforeDeveloperMode = await developerPage.evaluate(async () => (await chrome.developerPrivate.getProfileConfiguration()).inDeveloperMode)
  if (!beforeDeveloperMode) await developerPage.locator('extensions-toolbar #devMode').click()
  await until(() => developerPage.evaluate(async () => (await chrome.developerPrivate.getProfileConfiguration()).inDeveloperMode === true), 'Disposable profile developer mode did not enable', 10_000)
  result.developerMode = { before: beforeDeveloperMode, after: true, scope: 'temporary Chromium profile only; enabled through chrome://extensions UI' }
  await developerPage.close()
  const popup = await context.newPage()
  await popup.setViewportSize({ width: 360, height: 600 })
  // NA-0189: light/dark screenshots of each popup state for visual review, and no horizontal overflow at the popup width.
  const layout = []
  const shots = async state => {
    for (const colorScheme of ['light', 'dark']) {
      await popup.emulateMedia({ colorScheme })
      await popup.getByTestId('vaultnaccess-popup').screenshot({ path: join(OUT, `popup-${state}-${colorScheme}.png`) })
    }
    await popup.emulateMedia({ colorScheme: null })
    layout.push(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  }
  await popup.goto(`chrome-extension://${id}/popup.html`)
  await popup.getByTestId('vaultnaccess-connect').waitFor({ timeout: 10_000 })
  check('popup-disconnected', true)
  await shots('disconnected')
  const toolbarTarget = await context.newPage(); await toolbarTarget.goto(`${PORTAL}/bootstrap`)
  await popup.goto('about:blank')
  seen.offline = true
  layout.push(await connectFromToolbar(toolbarTarget, worker, id, 'offline'))
  check('offline-portal-explained', true) // Message and enabled retry asserted in the actual action above.
  seen.offline = false
  await popup.goto('about:blank')
  await connectFromToolbar(toolbarTarget, worker, id, 'connected')
  await toolbarTarget.close()
  await popup.goto(`chrome-extension://${id}/popup.html`)
  await popup.getByTestId('vaultnaccess-results').getByText('smoke-item').waitFor({ timeout: 20_000 })
  check('connect-and-search', seen.token === 2 && seen.items >= 1, JSON.stringify({ token: seen.token, items: seen.items }))
  const q = seen.consentQuery ?? {}
  check('consent-parameters', q.extensionId === id && q.redirectUri === `https://${id}.chromiumapp.org/` && q.codeChallengeMethod === 'S256'
    && /^[\w-]{43}$/.test(q.codeChallenge ?? '') && /^[\w-]{43}$/.test(q.deviceJkt ?? '') && Object.keys(q).length === 6, JSON.stringify(q))

  const storage = await popup.evaluate(async () => ({
    local: await chrome.storage.local.get(null), sync: await chrome.storage.sync.get(null), session: await chrome.storage.session.get(null),
    key: await new Promise(done => { const r = indexedDB.open('vaultnaccess'); r.onsuccess = () => { const g = r.result.transaction('device').objectStore('device').get('current'); g.onsuccess = () => done({ extractable: g.result?.privateKey?.extractable, hasD: 'd' in (g.result?.publicJwk ?? {}) }) } }),
  }))
  check('no-local-or-sync-storage', Object.keys(storage.local).length === 0 && Object.keys(storage.sync).length === 0, JSON.stringify({ local: Object.keys(storage.local), sync: Object.keys(storage.sync) }))
  // NA-0192: besides the authorization, only the portal language code.
  check('session-holds-only-authorization', JSON.stringify(Object.keys(storage.session).sort((a, b) => a.localeCompare(b))) === '["authorization","locale"]'
    && storage.session.authorization.accessToken === access && storage.session.locale === 'pt-BR')
  check('portal-language-after-connect', await popup.getByText('Conectado', { exact: false }).count() > 0)
  check('device-key-non-extractable', storage.key.extractable === false && storage.key.hasD === false, JSON.stringify(storage.key))
  check('no-token-in-urls', !seen.urls.some(u => u.includes(access)) && !seen.urls.some(u => u.includes('code=') && !u.startsWith('/vault/extension/connect')))

  // NA-0192: search while typing (no Enter), then keyboard: "/" focuses the search, ↓ selects, Enter opens.
  check('associated-hosts-load-on-demand', !seen.urls.some(url => url.startsWith('/api/v1/vault-security/extension/hosts')))
  await popup.getByTestId('vaultnaccess-hosts-secret-3').click()
  await popup.getByTestId('vaultnaccess-host-list').getByRole('button', { name: 'Conectar pelo NodeAccess · Visible host', exact: true }).waitFor()
  await shots('associated-hosts')
  check('associated-host-long-name-fits', await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  const hostOpened = context.waitForEvent('page')
  await popup.getByTestId('vaultnaccess-host-list').getByRole('button', { name: 'Conectar pelo NodeAccess · Visible host', exact: true }).click()
  const hostTab = await hostOpened
  check('associated-host-opens-portal', hostTab.url() === `${PORTAL}/hosts?hostId=10&connect=1`)
  await hostTab.close()
  await popup.getByTestId('vaultnaccess-hosts-pem-5').click()
  await popup.getByTestId('vaultnaccess-host-list').getByText('Nenhum host disponível para você.').waitFor()
  check('associated-host-empty-without-hidden-count', await popup.getByTestId('vaultnaccess-host-list').getByRole('button').count() === 0)
  await popup.getByTestId('vaultnaccess-hosts-pem-5').click()
  const typedBefore = seen.items
  await popup.getByTestId('vaultnaccess-search').fill('zeta')
  await popup.getByTestId('vaultnaccess-results').getByText('zeta-key').waitFor({ timeout: 5_000 })
  await popup.getByTestId('vaultnaccess-results').getByText('smoke-item').waitFor({ state: 'detached', timeout: 5_000 })
  check('search-while-typing', seen.items > typedBefore && seen.urls.some(u => u.includes('q=zeta')))
  await popup.keyboard.press('Escape')
  await popup.getByTestId('vaultnaccess-results').getByText('smoke-item').waitFor({ timeout: 5_000 })
  await popup.locator('body').click({ position: { x: 5, y: 5 } })
  await popup.keyboard.press('/')
  check('slash-focuses-search', await popup.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'vaultnaccess-search'))
  await popup.keyboard.press('ArrowDown')
  check('arrow-selects-first-result', await popup.evaluate(() => document.activeElement?.textContent?.includes('smoke-item') === true))
  const opened = context.waitForEvent('page')
  await popup.keyboard.press('Enter')
  const tab = await opened
  check('open-in-portal', tab.url() === `${PORTAL}/vault?kind=secret&id=3`, tab.url())
  const recents = await popup.evaluate(async () => (await chrome.storage.session.get('recents')).recents)
  check('recents-are-ids', JSON.stringify(recents) === '["secret:3"]', JSON.stringify(recents))
  // NA-0195 (E2): reveal asks for the code, shows the value; copy needs a second gesture and reaches the real clipboard.
  await popup.getByTestId('vaultnaccess-reveal-3').click()
  await popup.getByTestId('vaultnaccess-proof-otp').fill('123456'); await popup.getByTestId('vaultnaccess-proof-submit').click()
  await popup.getByTestId('vaultnaccess-revealed').filter({ hasText: SECRET }).waitFor({ timeout: 10_000 })
  await shots('revealed')
  check('reveal-with-code', seen.deliveries === 1)
  await popup.getByTestId('vaultnaccess-copy-3').click()
  await popup.getByTestId('vaultnaccess-copy-confirm').click()
  await popup.getByText(/Senha copiada|Password copied/).waitFor({ timeout: 10_000 })
  // Extension origins cannot be granted clipboard-read: read the browser clipboard from a portal page instead.
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: PORTAL })
  const reader = await context.newPage()
  await reader.goto(`${PORTAL}/clipboard-check`)
  const clip = await reader.evaluate(() => navigator.clipboard.readText()).catch(error => `read failed: ${error}`)
  await reader.close()
  check('copy-to-clipboard', clip === SECRET && seen.deliveries === 2, clip === SECRET ? '' : 'clipboard differs')
  const kept = await popup.evaluate(async () => JSON.stringify({ s: await chrome.storage.session.get(null), l: await chrome.storage.local.get(null), ls: { ...localStorage } }))
  check('value-not-stored', !kept.includes(SECRET))
  // NA-0201 E3: real form and keyboard behavior against disposable metadata; protocol/ACL use backend suites.
  // NA-0205: button affordance and reduced motion are checked in Chromium, not snapshots of CSS text.
  const actionStyle = await popup.getByTestId('vaultnaccess-create').evaluate(e => ({ border: getComputedStyle(e).borderTopStyle, height: e.getBoundingClientRect().height }))
  check('creation-controls-look-like-buttons', actionStyle.border === 'solid' && actionStyle.height >= 36)
  await popup.emulateMedia({ reducedMotion: 'reduce' })
  check('reduced-motion-disables-interaction-effects', await popup.getByTestId('vaultnaccess-create').evaluate(e => getComputedStyle(e).transitionDuration === '0s'))
  await popup.emulateMedia({ reducedMotion: 'no-preference' })
  await shots('creation-actions')
  for (const dismissal of ['close-button', 'page-click', 'other-window']) {
    const returnPage = await context.newPage(); await returnPage.goto(PORTAL)
    await connectFromToolbar(returnPage, worker, id, dismissal, async ({ send, root, targetId }) => {
      await until(async () => {
        const r = await send('Runtime.evaluate', { expression: `!!document.querySelector('[data-testid="vaultnaccess-close"]')`, returnByValue: true })
        return r.result.value
      }, 'Close control missing in toolbar')
      const size = await send('Runtime.evaluate', { expression: '({width:innerWidth,scroll:document.documentElement.scrollWidth})', returnByValue: true })
      check(`toolbar-width-${dismissal}`, size.result.value.width >= 360 && size.result.value.scroll <= size.result.value.width)
      const absent = async () => !(await root.send('Target.getTargets')).targetInfos.some(t => t.targetId === targetId)
      if (dismissal === 'close-button') {
        const r = await send('Runtime.evaluate', { expression: `(()=>{const b=document.querySelector('[data-testid="vaultnaccess-close"]');const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`, returnByValue: true })
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...r.result.value, button: 'left', clickCount: 1 })
        // Closing the target can end CDP before the release acknowledgement; target disappearance is the assertion.
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...r.result.value, button: 'left', clickCount: 1 }).catch(() => {})
      } else {
        execFileSync(resolveExecutable('python3'), ['-c', outsideClick, dismissal], { env: { ...process.env, DISPLAY: result.display }, stdio: 'pipe' })
      }
      await until(absent, `Native popup did not close: ${dismissal}`, 5000).catch(async error => {
        const screenshot = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, `close-failure-${dismissal}.png`), Buffer.from(screenshot.data, 'base64'))
        const diagnostic = await send('Runtime.evaluate', { expression: `(()=>{const b=document.querySelector('[data-testid="vaultnaccess-close"]');const r=b?.getBoundingClientRect();return {width:innerWidth,height:innerHeight,visibility:document.visibilityState,focused:document.hasFocus(),button:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,hit:r?document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,180):null}})()`, returnByValue: true })
        result.dismissalFailure = diagnostic.result.value
        throw error
      })
      check(`toolbar-dismiss-${dismissal}`, true)
    })
    await returnPage.close()
  }
  await popup.bringToFront()
  check('closing-popup-keeps-device-connected', await worker.evaluate(async () => !!(await chrome.storage.session.get('authorization')).authorization))
  await popup.getByTestId('vaultnaccess-create').click()
  await popup.locator('#item-name').fill('personal-smoke')
  await popup.getByRole('button', { name: 'Gerar senha', exact: true }).click()
  check('generated-password-length', (await popup.locator('#item-value').inputValue()).length === 24)
  await popup.locator('#item-value').fill('E3-disposable-marker')
  await popup.locator('#item-name').fill('invalid alias')
  await popup.getByRole('button', { name: 'Salvar', exact: true }).click()
  check('invalid-form-keeps-secret-without-write', writeCount === 0 && await popup.locator('#item-value').inputValue() === 'E3-disposable-marker')
  check('invalid-form-focuses-name', await popup.locator('#item-name').evaluate(e => e === document.activeElement))
  await popup.locator('#item-name').fill('personal-smoke')
  await shots('personal-editor')
  await popup.getByRole('button', { name: 'Salvar', exact: true }).click()
  await popup.getByTestId('vaultnaccess-results').getByText('personal-smoke', { exact: true }).waitFor()
  check('create-personal-item', writeCount === 1 && lastWriteOperation === 'create-secret')
  check('shared-no-edit-action', await popup.getByRole('button', { name: 'Editar dados: smoke-item', exact: true }).count() === 0)
  await popup.getByRole('button', { name: 'Editar dados: personal-smoke', exact: true }).click()
  check('metadata-does-not-load-value', await popup.locator('#item-value').count() === 0)
  await popup.locator('#item-name').fill('personal-renamed')
  await popup.getByRole('button', { name: 'Salvar', exact: true }).click()
  await popup.getByTestId('vaultnaccess-results').getByText('personal-renamed', { exact: true }).waitFor()
  await popup.getByRole('button', { name: 'Trocar senha: personal-renamed', exact: true }).click()
  await popup.locator('#item-value').fill('E3-disposable-replacement')
  await popup.getByRole('button', { name: 'Salvar', exact: true }).click()
  await popup.getByTestId('vaultnaccess-results').waitFor()
  check('explicit-value-replacement', writeCount === 3 && lastWriteOperation === 'rotate-secret')
  await popup.getByTestId('vaultnaccess-import').click()
  await popup.locator('#item-name').fill('personal-pem')
  await popup.locator('#item-file').setInputFiles({ name: 'disposable.pem', mimeType: 'text/plain', buffer: Buffer.from('E3-disposable-key-material') })
  await popup.getByRole('button', { name: 'Salvar', exact: true }).click()
  await popup.getByTestId('vaultnaccess-results').getByText('personal-pem', { exact: true }).waitFor()
  check('import-personal-pem', writeCount === 4 && lastWriteOperation === 'import-pem')
  const afterWrite = await popup.evaluate(async () => JSON.stringify({ s: await chrome.storage.session.get(null), l: await chrome.storage.local.get(null), ls: { ...localStorage } }))
  check('write-material-not-stored', !afterWrite.includes('E3-disposable'))
  await popup.getByTestId('vaultnaccess-create').click()
  await popup.locator('#item-value').fill('E3-discarded')
  await popup.keyboard.press('Escape')
  check('editor-escape-returns-to-search', await popup.getByTestId('vaultnaccess-search').evaluate(e => e === document.activeElement))
  // NA-0200 (E5b, SEC-16): a fresh popup without proof confirms in the portal; the confirmation tab carries only the request.
  seen.proof = false; await popup.reload()
  await popup.getByTestId('vaultnaccess-results').getByText('smoke-item').waitFor({ timeout: 10_000 })
  await popup.getByTestId('vaultnaccess-reveal-3').click()
  await shots('proof')
  const confirmTab = context.waitForEvent('page')
  await popup.getByTestId('vaultnaccess-proof-portal').click()
  const confirmPage = await confirmTab
  check('portal-confirm-tab', confirmPage.url() === `${PORTAL}/vault/extension/confirm?request=${'Q'.repeat(43)}`, confirmPage.url())
  await popup.getByTestId('vaultnaccess-portal-waiting').waitFor({ timeout: 10_000 })
  await popup.goto('about:blank')
  seen.portalApproved = true
  await popup.goto(`chrome-extension://${seen.id}/popup.html`)
  await popup.getByTestId('vaultnaccess-resume').waitFor({ timeout: 15_000 })
  check('resume-without-automatic-delivery', seen.deliveries === 2)
  await popup.getByTestId('vaultnaccess-resume').click()
  await popup.getByTestId('vaultnaccess-revealed').filter({ hasText: SECRET }).waitFor({ timeout: 15_000 })
  check('reveal-after-portal-confirmation', seen.deliveries === 3 && seen.proofRequests === 1)
  const keptRequest = await popup.evaluate(async () => (await chrome.storage.session.get('portalProof')).portalProof ?? null)
  check('portal-request-redeemed-once', keptRequest === null)
  await confirmPage.close()
  // NA-0195: the footer names the device as the portal's Connected devices does (first 16 chars of the key thumbprint, in groups of 4).
  const device = (await popup.getByTestId('vaultnaccess-device').textContent())?.trim() ?? ''
  check('device-identifier-footer', /^(Dispositivo|Device) [A-Za-z0-9_-]{4}(-[A-Za-z0-9_-]{4}){3}$/.test(device), device)
  await shots('connected')
  check('popup-layout-fits', layout.every(Boolean), JSON.stringify(layout))
  // NA-0193: an extension reload drops the session authorization; the trusted device comes back by itself while the portal login lives.
  const dropAuthorization = () => popup.evaluate(async () => chrome.storage.session.remove(['authorization']))
  await dropAuthorization(); await popup.reload()
  await popup.getByTestId('vaultnaccess-results').getByText('smoke-item').waitFor({ timeout: 10_000 })
  check('renew-automatic', seen.lastRenewal === 'SESSION')
  // Portal login ended: only the authenticator code is asked; a wrong code is explained, the right one reconnects.
  seen.portalLogin = false
  await dropAuthorization(); await popup.reload()
  await popup.getByTestId('vaultnaccess-code').waitFor({ timeout: 10_000 })
  await shots('code')
  await popup.getByTestId('vaultnaccess-otp').fill('000000'); await popup.getByTestId('vaultnaccess-otp-submit').click()
  await popup.getByTestId('vaultnaccess-error').filter({ hasText: /Código incorreto|Wrong code/ }).waitFor({ timeout: 10_000 })
  await popup.getByTestId('vaultnaccess-otp').fill('123456'); await popup.getByTestId('vaultnaccess-otp-submit').click()
  await popup.getByTestId('vaultnaccess-results').getByText('smoke-item').waitFor({ timeout: 10_000 })
  check('renew-with-code', seen.lastRenewal === 'OTP')
  await popup.getByText(/Desconectar|Disconnect/).click()
  await popup.getByTestId('vaultnaccess-connect').waitFor({ timeout: 10_000 })
  const after = await popup.evaluate(async () => chrome.storage.session.get(null))
  check('disconnect-clears-session', JSON.stringify(Object.keys(after)) === '["locale"]', JSON.stringify(Object.keys(after)))
  // NA-0193: "Disconnect" ended the trust: reopening asks for the portal consent again, not for a code.
  await popup.reload()
  await popup.getByTestId('vaultnaccess-connect').waitFor({ timeout: 10_000 })
  check('disconnect-ends-trust', seen.forgotten === 1 && await popup.getByTestId('vaultnaccess-code').count() === 0)
  // NA-0190: same build => no prompt; another build announced => "Update" reloads the unpacked extension.
  check('no-update-prompt-for-same-build', await popup.getByTestId('vaultnaccess-update').count() === 0)
  seen.announced = 'bbbbbbbbbbbb'
  await popup.reload()
  await popup.getByTestId('vaultnaccess-update').waitFor({ timeout: 10_000 })
  await shots('update')
  // runtime.reload() can close the target before Playwright acknowledges the click.
  // Observe every rejection immediately; a target-close error is acceptable only
  // after the old worker closes and a distinct same-extension worker starts.
  const observe = promise => promise.then(value => ({ value }), error => ({ error }))
  const closed = observe(popup.waitForEvent('close', { timeout: 10_000 }))
  const workerClosed = observe(worker.waitForEvent('close', { timeout: 10_000 }))
  const restarted = observe(context.waitForEvent('serviceworker', {
    predicate: candidate => candidate !== worker && candidate.url() === worker.url(), timeout: 10_000,
  }))
  let contextClosed = false
  const onContextClosed = () => { contextClosed = true }
  context.on('close', onContextClosed)
  const clicked = await observe(popup.getByTestId('vaultnaccess-update-apply').click())
  const [oldPopup, oldWorker] = await Promise.all([closed, workerClosed])
  result.updateRestart = { clickError: clicked.error ? String(clicked.error.message ?? clicked.error) : null,
    popupClosed: !oldPopup.error && popup.isClosed(), oldWorkerClosed: !oldWorker.error,
    newWorkerObserved: false, contextAlive: !contextClosed }
  context.off('close', onContextClosed)
  if (clicked.error && !String(clicked.error.message).startsWith('locator.click: Target page, context or browser has been closed')) throw clicked.error
  for (const outcome of [oldPopup, oldWorker]) if (outcome.error) throw outcome.error
  if (contextClosed) throw new Error('Update closed the browser context instead of restarting the extension')
  const extensionStatus = await context.newPage()
  await extensionStatus.goto('chrome://extensions/')
  result.updateRestart.extensionState = await extensionStatus.evaluate(async extensionId => {
    const entries = await chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true })
    const entry = entries.find(candidate => candidate.id === extensionId)
    return entry ? { id: entry.id, state: entry.state, disableReasons: entry.disableReasons,
      manifestErrors: entry.manifestErrors?.map(error => error.message), runtimeErrorCount: entry.runtimeErrors?.length } : null
  }, id)
  if (result.updateRestart.extensionState?.state !== 'ENABLED') throw new Error('Extension did not remain enabled after reload')
  const reopened = await context.newPage()
  await reopened.goto(`chrome-extension://${id}/popup.html`)
  await reopened.getByTestId('vaultnaccess-connect').waitFor({ timeout: 10_000 })
  result.updateRestart.popupFunctional = true
  const newWorker = await restarted
  result.updateRestart.newWorkerObserved = !newWorker.error
  if (newWorker.error) throw newWorker.error
  const restartedId = await newWorker.value.evaluate(() => chrome.runtime.id)
  check('update-reloads-extension', result.updateRestart.popupClosed && result.updateRestart.oldWorkerClosed
    && newWorker.value !== worker && restartedId === id && result.updateRestart.contextAlive && result.updateRestart.popupFunctional)
  await reopened.close()
  await extensionStatus.close()
  // NA-0194: the signed release of the same sources, loaded in Chromium with its own id.
  await context.close(); context = undefined
  await checkPackageInBrowser(check)
  check('reviewed-sources-stable-during-run', fingerprint() === result.sourceFingerprint)
  result.status = 'passed'
} catch (error) {
  result.error = String(error?.message ?? error).slice(0, 400)
  result.seen = { origins: seen.origins, token: seen.token, items: seen.items, consent: !!seen.consentQuery, paths: seen.urls.map(u => u.split('?')[0]) }
  try { result.popupError = await context?.pages().find(p => p.url().endsWith('popup.html'))?.getByTestId('vaultnaccess-error').textContent({ timeout: 1000 }) } catch { /* none */ }
} finally {
  await context?.close().catch(() => {})
  server?.close()
  display?.kill('SIGTERM')
  rmSync(profile, { recursive: true, force: true })
  result.finishedAt = new Date().toISOString()
  writeFileSync(join(OUT, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result))
  process.exitCode = result.status === 'passed' ? 0 : 1
}
