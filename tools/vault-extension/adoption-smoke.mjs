#!/usr/bin/env node
// NA-0203: real MV3 popup/worker/injection, synthetic HTTPS backend and login page.
// No manifest rewriting, host-permission expansion, worker patching or sender spoofing.
// Run with Node24 through bin/dev. Result is failed/blocked unless every mandatory check passes.
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { VaultSiteCreateSchema, VaultSiteUpdateSchema, VaultSiteVersionSchema } from '../../packages/shared/src/schemas/vault-sites.schema.ts'
import { PORTAL, SITE, harnessTools, syntheticState, loginHtml, readRequest, isSiteHost, admitPortal, siteMetadata, siteFill, realPopup as openPopup, launchFixture } from './smoke-kit.mjs'

const ROOT = resolve(import.meta.dirname, '../..')
const OUT = join(ROOT, '.tmp/NA-0203/adoption-browser')
mkdirSync(OUT, { recursive: true })
const run = mkdtempSync(join(OUT, 'run-')), dist = join(run, 'extension')
const SECRET = randomBytes(18).toString('hex'), CREATED = randomBytes(18).toString('hex')
const result = { startedAt: new Date().toISOString(), status: 'failed', sections: { assistance: 'pending', capture: 'pending', preferences: 'pending', generator: 'pending', hello: 'pending' }, checks: {}, matrix: [], gaps: [], activeTab: { verified: false, method: null },
  boundaries: ['Synthetic HTTPS API, not real backend authorization/DB', 'Hello approval is an explicit fixture state change, not physical Windows Hello; pending references, worker, popup and injection are real', 'Server revocation cannot retract an envelope after transaction commit; local context checks stop pending injection, not an already dispatched script'], runDirectory: run }
const sources = ['apps/extension/src/background.ts', 'apps/extension/src/popup/App.vue', 'apps/extension/src/popup/SitePanel.vue',
  'apps/extension/src/popup/main.ts', 'apps/extension/src/adapters/site-fill.ts', 'apps/extension/src/core/site-fill.ts',
  'apps/extension/src/adapters/site-preferences.ts',
  'apps/extension/src/core/sites-client.ts', 'apps/extension/src/core/client.ts', 'apps/extension/manifest.ts',
  'packages/shared/src/schemas/vault-sites.schema.ts', 'packages/shared/src/schemas/vault-site-fill.schema.ts', 'tools/vault-extension/adoption-smoke.mjs', 'tools/vault-extension/smoke-kit.mjs', 'apps/extension/src/adapters/site-assistance.ts', 'apps/extension/src/adapters/site-interactions.ts', 'apps/extension/src/core/site-interactions.ts', 'apps/extension/src/core/portal-fill-intent.ts', 'apps/extension/src/core/site-preferences.ts', 'apps/extension/src/core/password.ts']
const fingerprint = () => createHash('sha256').update(sources.map(file => `${file}\0${readFileSync(join(ROOT, file))}`).join('\0')).digest('hex')
result.sourceFingerprint = fingerprint()
result.sourceFiles = sources
writeFileSync(join(run, 'sources-before.json'), JSON.stringify(Object.fromEntries(sources.map(file => [file, createHash('sha256').update(readFileSync(join(ROOT, file))).digest('hex')])), null, 2))
const { check, delay, until } = harnessTools(result)
const { seen, items, operations } = syntheticState()
const PROOF = randomBytes(32).toString('base64url'); let proofReady = true, proofRequested = false
const passwords = new Map([[1, SECRET]])
let expectedUpdate = { id: 1, username: 'synthetic-user' }
const pendingPages = []
const state = {}
let context, target, worker, popup, popupURL
async function route(req, res) {
  const { url, body, send } = await readRequest(req, res)
  if (isSiteHost(req)) {
    if (url.pathname === '/change') return send(200, loginHtml.replace('<label>Username<input id="username" autocomplete="username"></label>', '').replace('autocomplete="current-password"', 'autocomplete="new-password"').replace('<button type="submit">', '<input id="confirm" type="password" autocomplete="new-password"><input id="old" type="password" autocomplete="current-password"><button type="submit">'), 'text/html')
    if (url.pathname === '/redirect') return send(302, '', 'text/plain', { Location: 'https://other.example.test/redirected' })
    if (url.pathname === '/submitted') { seen.submissions++; return send(200, {}) }
    return send(200, loginHtml, 'text/html')
  }
  const path = admitPortal({ req, url, body, send, seen, check })
  if (path === null) return
  if (path === '/capabilities') return send(200, { apiVersion: 1, minExtensionVersion: '0.1.0', kinds: ['secret', 'pem'],
    features: { reveal: false, copy: false, create: true, sites: true, fill: true }, writeAccess: { groups: [], tenant: false }, portalOrigin: PORTAL,
    preferenceScope: 'f'.repeat(64), proofUntil: proofReady ? 60000 : 0, expiresAt: 1800000, serverNow: 0 })
  if (path === '/proof-request') { proofRequested = true; return send(200, { request: PROOF, url: `${PORTAL}/vault/extension/confirm?request=${PROOF}` }) }
  if (path === '/proof-claim') return send(200, proofReady ? { state: 'APPROVED', proofUntil: 60000, serverNow: 0 } : { state: 'PENDING' })
  if (siteMetadata({ path, body, send, seen, items, check })) return
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
  if (await siteFill({ req, res, path, body, send, seen, items, operations, check, delay, gate: () => proofReady,
    plaintext: (item, mode) => mode === 'username' ? item.username : passwords.get(item.id) })) return
  return send(404, {})
}

const realPopup = () => openPopup({ target, context, worker, popupURL, result, until, maskPasswords: true })


try {
  const launched = await launchFixture({ root: ROOT, run, dist, result, check, route, state })
  context = state.context; worker = launched.worker; seen.id = launched.id; popupURL = launched.popupURL
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
  const { server, display } = state
  try { await state.context?.close() } catch { result.cleanupFailed = true }
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
