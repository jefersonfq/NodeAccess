#!/usr/bin/env node
const { chromium } = require('playwright')
const https = require('node:https'), http = require('node:http'), fs = require('node:fs'), path = require('node:path')
const { execFileSync } = require('node:child_process')
const assert = require('node:assert/strict')
// Synthetic portal volume/UX smoke. Node 24, existing Playwright/Chromium and OpenSSL required.
// Run: FRONTEND_PORT=5174 PORTAL_THEME=dark node tools/vault-extension/sites-volume-smoke.cjs
// Reuses a loopback Vite frontend or starts/cleans up its own. No production API requests.
const ROOT = path.resolve(__dirname, '../..')
const theme = process.env.PORTAL_THEME || 'dark'
assert.ok(['light', 'dark'].includes(theme), 'PORTAL_THEME must be light or dark')
const rawPort = process.env.FRONTEND_PORT || '5174'
assert.ok(/^\d{1,5}$/.test(rawPort) && Number(rawPort) >= 1 && Number(rawPort) <= 65535, 'FRONTEND_PORT must be an integer from 1 to 65535')
const isolatedCoverage = Boolean(process.env.NODEACCESS_COVERAGE_SESSION)
let frontendPort = isolatedCoverage ? 0 : Number(rawPort)
process.umask(0o077)
const artifactRoot = path.join(ROOT, '.tmp', 'sites-volume')
fs.mkdirSync(artifactRoot, { recursive: true, mode: 0o700 })
assert.ok(!fs.lstatSync(artifactRoot).isSymbolicLink(), 'Artifact root must not be a symlink')
fs.chmodSync(artifactRoot, 0o700)
const out = fs.mkdtempSync(path.join(artifactRoot, 'run-'))
fs.chmodSync(out, 0o700)
console.log(`Artifacts: ${out}`)
const key = path.join(out, 'localhost.key'), cert = path.join(out, 'localhost.crt')
execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' })
fs.chmodSync(key, 0o600); fs.chmodSync(cert, 0o600)
const sources = [
  'tools/vault-extension/sites-volume-smoke.cjs',
  'apps/extension/src/popup/SitePanel.vue', 'apps/extension/src/core/sites-port.ts', 'apps/extension/src/core/password.ts',
  'apps/frontend/src/components/vault/VaultSites.vue', 'apps/frontend/src/views/VaultView.vue',
  'apps/frontend/src/services/vault-http.ts', 'apps/frontend/src/services/vault-manager.ts',
  'apps/frontend/src/stores/auth.ts', 'apps/frontend/src/stores/ui.ts', 'apps/frontend/src/App.vue',
  'apps/frontend/src/composables/useVaultCatalog.ts', 'apps/frontend/vite.config.ts',
  'packages/shared/src/schemas/vault-sites.schema.ts', 'packages/shared/src/schemas/vault-extension.schema.ts',
]
const fingerprint = () => require('node:crypto').createHash('sha256').update(sources.map(file => `${file}\0${fs.readFileSync(path.join(ROOT, file))}`).join('\0')).digest('hex')
function frontendAvailable() {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port: frontendPort, path: '/@vite/client', timeout: 3000 }, response => {
      let body = ''
      response.on('data', chunk => { body += chunk; if (body.length > 1048576) request.destroy(new Error('Unexpected frontend response size')) })
      response.on('end', () => response.statusCode === 200 && body.includes('createHotContext') ? resolve(true) : reject(new Error('Loopback port is occupied by an unsupported frontend')))
      response.on('error', reject)
    })
    request.on('timeout', () => request.destroy(new Error('Loopback frontend probe timed out')))
    request.on('error', error => error.code === 'ECONNREFUSED' ? resolve(false) : reject(error))
  })
}
async function ensureFrontend() {
  if (!isolatedCoverage && await frontendAvailable()) return null
  const { createServer } = await import('vite')
  const server = await createServer({ root: path.join(ROOT, 'apps/frontend'), cacheDir: path.join(out, 'vite-cache'), envDir: out, configFile: path.join(ROOT, 'apps/frontend/vite.config.ts'),
    server: { host: '127.0.0.1', port: frontendPort, strictPort: true, https: undefined, proxy: {} }, logLevel: 'error' })
  try {
    await server.listen()
    const address = server.httpServer.address()
    assert.ok(address && typeof address === 'object', 'Owned frontend must expose a TCP port')
    frontendPort = address.port
    return server
  } catch (error) { await server.close(); throw error }
}
const results = [], errors = [], shots = []
const fixturePassword = require('node:crypto').randomBytes(24).toString('base64url')
function check(name, condition) { assert.ok(condition, name); results.push(name) }
const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: '41', tenantId: 7, name: 'Synthetic tester', email: 'fixture@example.test', role: 'admin', groupIds: [9], canManageHosts: true, exp: 4102444800 })).toString('base64url')}.harness`
async function main() {
 const fingerprintBefore = fingerprint()
 let ownedFrontend, proxy, browser, page
 try {
 ownedFrontend = await ensureFrontend()
 proxy = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
  if (req.url.startsWith('/api/')) { res.writeHead(502); res.end('Unmocked API blocked'); return }
  const upstream = http.request({ hostname: '127.0.0.1', port: frontendPort, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${frontendPort}` } }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res) })
  upstream.on('error', () => { res.writeHead(502); res.end('Frontend unavailable') }); req.pipe(upstream)
 })
 await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve) })
 const base = `https://127.0.0.1:${proxy.address().port}`
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 960 }, serviceWorkers: 'block' })
  await context.addInitScript(({ token, theme }) => { localStorage.setItem('na_access_token', token); localStorage.setItem('na_refresh_token', 'synthetic-refresh'); localStorage.setItem('na_ui_theme_mode', theme); }, { token, theme })
  const metrics = [], defects = [], network = []
  const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, version: 1, kind: 'login', label: `Synthetic site ${String(i + 1).padStart(4,'0')}`, scope: 'PERSONAL', groupId: null, username: `user${i + 1}@example.test`, origins: ['https://example.test'], url: null, host: null, canManage: true, allowFill: false }))
  const hosts = Array.from({ length: 5000 }, (_, i) => ({ id: i + 1, name: `Synthetic host ${String(i + 1).padStart(4,'0')}` }))
  let failPage = false
  await context.addInitScript(() => {
    window.smokeActions = { clicks: 0, keydowns: 0, inputs: 0 }
    new MutationObserver(() => {
      if (window.smokeExpectedLabel && window.smokeMatchedAt === null && [...document.querySelectorAll('.site-panel > ul > li > strong')].some(el => el.textContent === window.smokeExpectedLabel)) window.smokeMatchedAt = performance.now()
    }).observe(document, { subtree: true, childList: true, characterData: true })
    for (const [event,key] of [['click','clicks'],['keydown','keydowns'],['input','inputs']]) document.addEventListener(event, () => { window.smokeActions[key]++; if (event === 'input') window.lastSmokeInput = performance.now() }, true)
  })
  await context.route('**/api/v1/**', async route => {
    const req = route.request(), endpoint = new URL(req.url()).pathname, body = req.method() === 'POST' ? req.postDataJSON() : null
    let data = {}, status = 200
    if (endpoint === '/api/v1/features') data = { secretsLicensed: true, secrets: true }
    else if (['/api/v1/secrets','/api/v1/pem-keys','/api/v1/groups','/api/v1/notifications'].includes(endpoint)) data = []
    else if (endpoint.endsWith('/sites/write-access')) data = { groups: [{ id: 9, name: 'Synthetic team' }], tenant: false }
    else if (endpoint.endsWith('/sites/hosts')) {
      // ACL before limit: the first 4,500 hosts are inaccessible to this fixture user.
      data = { hosts: hosts.filter(host => host.id > 4500 && host.name.toLowerCase().includes((body.q || '').toLowerCase())).slice(0,50) }
    } else if (endpoint.endsWith('/sites/list')) {
      if (failPage && body.after > 0) { status = 503; failPage = false }
      const allowed = rows.filter(row => row.id % 5 !== 0 && row.id > body.after && (!body.q || `${row.label} ${row.username}`.toLowerCase().includes(body.q.toLowerCase())))
      const pageRows = allowed.slice(0,body.limit)
      data = { items: pageRows, next: allowed.length > pageRows.length ? pageRows.at(-1).id : null }
    } else if (endpoint.endsWith('/sites/create')) {
      assert.equal(body.password, fixturePassword)
      assert.deepEqual(body.origins, ['https://example.test'])
      data = { id: 2501, version: 1 }
      rows.push({ ...rows[0], id: 2501, label: body.label, username: body.username, host: { id: body.hostId, name: 'Synthetic host 4999' } })
    } else if (endpoint.endsWith('/sites/update')) {
      assert.ok(!('password' in body)); const row = rows.find(row => row.id === body.id); row.label = body.label; row.version++; data = { id: row.id, version: row.version }
    }
    if (endpoint.includes('/sites/')) {
      network.push({ endpoint, q: body.q, after: body.after, returned: data.items?.length ?? data.hosts?.length, status })
      await new Promise(resolve => setTimeout(resolve, 80))
    }
    await route.fulfill({ status, contentType:'application/json', body:JSON.stringify(data) })
  })
  page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message))
  const actions = () => page.evaluate(() => ({ ...window.smokeActions }))
  async function measure(name, run) {
    const before = await actions(), requests = network.length, start = performance.now()
    await page.evaluate(() => { window.lastSmokeInput = null })
    await run()
    const after = await actions()
    metrics.push({ name, elapsedMs: Math.round(performance.now()-start), requests: network.length-requests, observedInputToDomMs: name.startsWith('search exact') ? await page.evaluate(() => window.smokeMatchedAt === null ? null : Math.round(window.smokeMatchedAt-window.lastSmokeInput)) : null, ...Object.fromEntries(Object.keys(before).map(key => [key,after[key]-before[key]])) })
  }
  await page.goto(`${base}/vault`, { waitUntil:'domcontentloaded' })
  await page.getByTestId('vault-sites-toggle').waitFor()
  check('lazy API loading', network.length === 0)
  const panel = page.getByTestId('vault-sites'), list = panel.locator('.site-panel > ul > li')
  await measure('open sites with 2500 rows', async () => { await page.getByTestId('vault-sites-toggle').click(); await list.nth(49).waitFor() })
  check('first page 50 visible, no hidden sentinel', await list.count() === 50 && !(await list.allTextContents()).some(text => text.includes('Synthetic site 0005')))
  await measure('load next page', async () => { await panel.getByRole('button',{ name:/^(Carregar mais|Load more)$/ }).click(); await list.nth(99).waitFor() })
  check('second page unique', new Set(await list.locator('strong').allTextContents()).size === 100)
  failPage = true
  await panel.getByRole('button',{ name:/^(Carregar mais|Load more)$/ }).click()
  await panel.getByRole('button',{ name:/^(Tentar novamente|Retry)$/ }).waitFor()
  check('page failure preserves 100 rows', await list.count() === 100)
  await panel.getByRole('button',{ name:/^(Tentar novamente|Retry)$/ }).click()
  await page.waitForResponse(response => response.url().endsWith('/sites/list'))
  await page.waitForTimeout(100)
  const retryCount = await list.count()
  if (retryCount !== 150) defects.push({ name:'pagination retry loses existing pages', expected:150, actual:retryCount })
  else results.push('pagination retry keeps previous pages')
  const search = panel.getByLabel(/^(Buscar sites|Search sites)$/)
  for (const id of [2499,2399,2299,2199,2099]) {
    await page.evaluate(label => { window.smokeExpectedLabel = label; window.smokeMatchedAt = null }, `Synthetic site ${id}`)
    await measure(`search exact username ${id}`, async () => { await search.fill(''); await search.pressSequentially(`user${id}@example.test`,{delay:10}); await panel.getByText(`Synthetic site ${id}`,{exact:true}).waitFor() })
    check(`remote search ${id} renders only matching row`, await list.count() === 1)
  }
  await search.fill('Synthetic site 2500')
  await panel.getByText(/^(Nenhum item encontrado\.|No items found\.)$/).waitFor()
  check('inaccessible exact site absent', await list.count() === 0)
  await search.fill('user2499@example.test'); await list.nth(0).waitFor()
  await panel.getByRole('button',{name:/^(Editar|Edit)$/}).focus()
  await page.keyboard.press('Enter')
  const nameInput = panel.getByLabel(/^(Nome|Name)$/)
  await nameInput.waitFor()
  const nameFocused = await nameInput.evaluate(el => el === document.activeElement)
  if (!nameFocused) defects.push({ name:'keyboard edit loses focus', active: await page.evaluate(() => document.activeElement.tagName) })
  else results.push('keyboard edit focuses first field')
  if (nameFocused) {
    await page.keyboard.press('Tab')
    check('keyboard Tab reaches username', await panel.getByLabel(/^(Usuário|Username)$/).evaluate(el => el === document.activeElement))
    check('keyboard focus indicator visible', await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'))
    await page.keyboard.press('Escape')
    check('Escape restores focus to new item action', await panel.getByRole('button',{name:/^(Novo item|New item)$/}).evaluate(el => el === document.activeElement))
    await panel.getByRole('button',{name:/^(Editar|Edit)$/}).focus(); await page.keyboard.press('Enter'); await nameInput.waitFor()
  }
  check('edit keeps username without password', await panel.getByLabel(/^(Usuário|Username)$/).inputValue() === 'user2499@example.test' && await panel.getByLabel(/^(Senha|Password)$/).inputValue() === '')
  await measure('metadata edit without retyping credentials',async () => { await nameInput.fill('Renamed synthetic row'); await panel.getByRole('button',{name:/^(Salvar|Save)$/}).click(); await panel.getByText('Renamed synthetic row',{exact:true}).waitFor() })
  await panel.getByRole('button',{name:/^(Novo item|New item)$/}).focus(); await page.keyboard.press('Enter'); await nameInput.waitFor()
  const newFocused = await nameInput.evaluate(el => el === document.activeElement)
  if (!newFocused) defects.push({ name:'keyboard create loses focus', active: await page.evaluate(() => document.activeElement.tagName) })
  await nameInput.fill('Volume synthetic login')
  await panel.getByLabel(/^(Usuário|Username)$/).fill('fixture.user')
  await panel.getByLabel(/^(Senha|Password)$/).fill(fixturePassword)
  const origins = panel.getByLabel(/Sites deste login|Websites for this login/)
  await origins.fill('http://example.test')
  await panel.getByRole('button',{name:/^(Salvar|Save)$/}).click()
  await panel.getByRole('alert').waitFor()
  check('invalid website requires zero password re-entry', await panel.getByLabel(/^(Senha|Password)$/).inputValue() === fixturePassword)
  await origins.fill('https://example.test/path?q=fixture')
  await measure('host lookup among 5000 choices',async () => { const input=panel.getByLabel(/^(Buscar host|Search hosts)$/); await input.pressSequentially('4999',{delay:10}); await panel.locator('option[value="4999"]').waitFor({state:'attached'}); await panel.locator('select').filter({has: page.locator('option[value="4999"]')}).selectOption('4999') })
  check('no inaccessible host options', await panel.locator('option[value="1"]').count() === 0)
  await page.setViewportSize({width:360,height:900})
  await panel.getByRole('button',{name:/^(Salvar|Save)$/}).scrollIntoViewIfNeeded()
  const editorUnlabeled = await panel.locator('input,textarea,select').evaluateAll(elements => elements.filter(el=>!el.labels?.length&&!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby')).map(el=>el.tagName))
  check('all editor controls have accessible labels',editorUnlabeled.length===0)
  await page.screenshot({path:path.join(out,'mobile-editor.png'),fullPage:true}); shots.push('mobile-editor.png')
  check('360px editor no horizontal overflow',await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth))
  await measure('save with preserved password',async () => { await panel.getByRole('button',{name:/^(Salvar|Save)$/}).click(); await panel.getByRole('button',{name:/^(Novo item|New item)$/}).waitFor() })
  await search.fill('Volume synthetic login'); await panel.getByText('Volume synthetic login',{exact:true}).waitFor()
  await page.screenshot({path:path.join(out,'mobile-result.png'),fullPage:true}); shots.push('mobile-result.png')
  const unlabeled = await panel.locator('input,textarea,select').evaluateAll(elements => elements.filter(el=>!el.labels?.length&&!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby')).map(el=>el.tagName))
  check('visible form controls have labels',unlabeled.length===0)
  await page.setViewportSize({width:1280,height:960}); await page.screenshot({path:path.join(out,'desktop-result.png'),fullPage:true}); shots.push('desktop-result.png')
  check('no browser runtime errors',errors.length===0)
  const searchTimings = metrics.filter(metric=>metric.name.startsWith('search exact')).map(metric=>metric.observedInputToDomMs).sort((a,b)=>a-b)
  const fingerprintAfter = fingerprint()
  const sourcesStable = fingerprintBefore === fingerprintAfter
  if (!sourcesStable) defects.push({ name: 'Source files changed during browser run' })
  const report = { artifactDirectory: out, frontendPort, frontendOwned: !!ownedFrontend, sources, fingerprintBefore, fingerprintAfter, sourcesStable, searchAfterInputMs:{samples:searchTimings.length,p50:searchTimings[Math.floor(searchTimings.length/2)],p95:searchTimings.at(-1)}, ok:defects.length===0, fixtures:{sites:2500,accessibleSites:2000,hosts:5000,accessibleHosts:500,latencyMs:80}, checks:results, defects, metrics, network, screenshots:shots, errors, limits:['Synthetic in-memory API ACL/filter/pagination, not database load benchmark.','Action counts are automated events, not a human usability study. Total elapsed includes Playwright orchestration; observedInputToDomMs uses a browser MutationObserver.','Host endpoint returns at most 50 choices and uses search, not a host cursor.'] }
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify({ok:report.ok,artifactDirectory:out,sourcesStable,checks:results.length,defects,metrics},null,2))
  if (!report.ok) process.exitCode = 1
 } catch(error) {
  if(page) await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{})
  fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:error.message,checks:results,errors,fingerprintBefore,fingerprintAfter:fingerprint()},null,2)); throw error
 } finally {
   const cleanup = await Promise.allSettled([browser?.close(), proxy?.listening ? new Promise((resolve, reject) => { proxy.close(error => error ? reject(error) : resolve()); proxy.closeAllConnections() }) : undefined, ownedFrontend?.close()])
   for (const result of cleanup) if (result.status === 'rejected') { console.error('Cleanup failed:', result.reason); process.exitCode = 1 }
 }
}
main().catch(error=>{console.error(error);process.exitCode=1})
