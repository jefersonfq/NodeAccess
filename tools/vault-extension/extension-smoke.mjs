#!/usr/bin/env node
// NA-0183 — loads the built VaultNAccess extension (unpacked) in Chromium and drives connect → search → open →
// disconnect against a simulated portal (Playwright routes). Checks the MV3 wiring that unit tests cannot reach:
// service-worker consent flow, storage.session only, non-extractable device key in IndexedDB, nothing in
// storage.local/sync and no token in URLs. Protocol security is covered by the backend unit/MySQL suites.
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:https'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { resolveExecutable } from '../shared/trusted-executable.cjs'

const ROOT = resolve(import.meta.dirname, '../..')
const PORTAL = 'https://vault.example.test'
// Coverage runs (tools/coverage/browser.mjs) supply a private artifacts directory and the pinned Chromium.
const OUT = process.env.ARTIFACTS_DIR ? resolve(process.env.ARTIFACTS_DIR) : resolve(ROOT, '.tmp/NA-0183/extension-smoke')
mkdirSync(OUT, { recursive: true })
const result = { startedAt: new Date().toISOString(), checks: {}, status: 'failed' }
const check = (name, ok, detail = '') => { result.checks[name] = ok ? 'PASS' : `FAIL ${detail}`.trim(); if (!ok) throw new Error(`${name} ${detail}`) }

execFileSync(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'apps/extension/vite.config.ts', '--logLevel', 'error'],
  { cwd: ROOT, env: { ...process.env, VAULTNACCESS_PORTAL_ORIGIN: PORTAL }, stdio: 'inherit' })
const dist = resolve(ROOT, 'apps/extension/dist')
const profile = mkdtempSync(join(OUT, 'profile-'))
const access = 'A'.repeat(43), code = 'C'.repeat(43)
const seen = { token: 0, items: 0, consentQuery: null, urls: [], id: '' }
let context, server
try {
  // Disposable self-signed certificate; the browser is told to trust it only for this run.
  execFileSync(resolveExecutable('openssl'), ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-days', '1', '-subj', '/CN=vault.example.test',
    '-addext', 'subjectAltName=DNS:vault.example.test', '-keyout', join(profile, 'key.pem'), '-out', join(profile, 'cert.pem')], { stdio: 'ignore' })
  server = createServer({ key: readFileSync(join(profile, 'key.pem')), cert: readFileSync(join(profile, 'cert.pem')) }, (req, res) => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      const url = new URL(req.url ?? '/', PORTAL), headers = req.headers
      seen.urls.push(url.pathname + url.search)
      ;(seen.origins ??= []).push(`${req.method} ${url.pathname} ${headers.origin ?? '-'}`)
      const send = (status, body, extra = {}, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type, 'DPoP-Nonce': 'abc.' + 'n'.repeat(32), 'Cache-Control': 'no-store', ...extra }); res.end(body) }
      if (url.pathname === '/vault/extension/connect') {
        seen.consentQuery = Object.fromEntries(url.searchParams)
        const back = `${url.searchParams.get('redirectUri')}?code=${code}&state=${url.searchParams.get('state')}`
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
        return send(200, JSON.stringify({ accessToken: access, tokenType: 'DPoP', expiresAt: 1_800_000, serverNow: 0 }))
      }
      if (url.pathname.endsWith('/extension/items')) {
        seen.items++
        if (headers.authorization !== `DPoP ${access}`) return send(401, '{}')
        return send(200, JSON.stringify({ items: [{ kind: 'secret', sourceId: 3, label: 'smoke-item', description: null, scope: 'shared', portalPath: '/vault?kind=secret&id=3' }], nextCursor: null }))
      }
      return send(200, '<title>portal</title>', {}, 'text/html')
    })
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const port = server.address().port
  context = await chromium.launchPersistentContext(join(profile, 'browser'), { channel: 'chromium', headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, `--host-resolver-rules=MAP vault.example.test:443 127.0.0.1:${port}`, '--ignore-certificate-errors'] })
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15_000 })
  const id = new URL(worker.url()).host
  seen.id = id
  check('extension-id', /^[a-p]{32}$/.test(id), id)
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'))
  check('manifest-permissions', JSON.stringify(manifest.permissions) === '["identity","storage"]' && JSON.stringify(manifest.host_permissions) === `["${PORTAL}/*"]`
    && !manifest.content_scripts && !manifest.externally_connectable && !manifest.web_accessible_resources)

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
  await popup.getByTestId('vaultnaccess-connect').click()
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
  check('session-holds-only-authorization', JSON.stringify(Object.keys(storage.session).sort((a, b) => a.localeCompare(b))) === '["authorization"]' && storage.session.authorization.accessToken === access)
  check('device-key-non-extractable', storage.key.extractable === false && storage.key.hasD === false, JSON.stringify(storage.key))
  check('no-token-in-urls', !seen.urls.some(u => u.includes(access)) && !seen.urls.some(u => u.includes('code=') && !u.startsWith('/vault/extension/connect')))

  const opened = context.waitForEvent('page')
  await popup.getByText('smoke-item').click()
  const tab = await opened
  check('open-in-portal', tab.url() === `${PORTAL}/vault?kind=secret&id=3`, tab.url())
  const recents = await popup.evaluate(async () => (await chrome.storage.session.get('recents')).recents)
  check('recents-are-ids', JSON.stringify(recents) === '["secret:3"]', JSON.stringify(recents))
  await shots('connected')
  check('popup-layout-fits', layout.every(Boolean), JSON.stringify(layout))
  await popup.getByText(/Desconectar|Disconnect/).click()
  await popup.getByTestId('vaultnaccess-connect').waitFor({ timeout: 10_000 })
  const after = await popup.evaluate(async () => chrome.storage.session.get(null))
  check('disconnect-clears-session', Object.keys(after).length === 0, JSON.stringify(Object.keys(after)))
  result.status = 'passed'
} catch (error) {
  result.error = String(error?.message ?? error).slice(0, 400)
  result.seen = { origins: seen.origins, token: seen.token, items: seen.items, consent: !!seen.consentQuery, paths: seen.urls.map(u => u.split('?')[0]) }
  try { result.popupError = await context?.pages().find(p => p.url().endsWith('popup.html'))?.getByTestId('vaultnaccess-error').textContent({ timeout: 1000 }) } catch { /* none */ }
} finally {
  await context?.close().catch(() => {})
  server?.close()
  rmSync(profile, { recursive: true, force: true })
  result.finishedAt = new Date().toISOString()
  writeFileSync(join(OUT, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result))
  process.exitCode = result.status === 'passed' ? 0 : 1
}
