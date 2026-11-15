// Real application/Chromium; synthetic bootstrap only, no customer data or backend writes.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { chromium } = require('playwright')
const { artifactPath } = require('../shared/private-artifacts.cjs')
const { attachBrowserCoverage } = require('../coverage/playwright-coverage.cjs')
const { loadSecurityCenter } = require('../security-center/build.cjs')

const base = process.env.FRONTEND_BASE || 'http://127.0.0.1:5174'
const output = process.env.SECURITY_CENTER_OUTPUT || (process.env.REPORT_PATH ? path.dirname(process.env.REPORT_PATH) : artifactPath('security-center'))
const root = path.resolve(__dirname, '../..')
const internalCatalog = JSON.parse(fs.readFileSync(path.join(root, 'docs/security/controls-catalog.json'), 'utf8'))
const publicCatalog = loadSecurityCenter(root)
const forbidden = [internalCatalog.internalClassification, ...internalCatalog.controls.flatMap(control => [
  control.internalDescription, control.review?.sourceRevision, control.review?.sourceHash,
  ...(control.review?.sourceFiles || []), ...(control.review?.testFiles || []),
  ...(['planned', 'unverified'].includes(control.state) ? [control.id, control.public?.title] : []),
])].filter(value => typeof value === 'string' && value.length > 10)
function assertPublicOnly(text) {
  for (const value of forbidden) assert.ok(!text.includes(value), 'Private catalog metadata or unverified control escaped the public projection')
}
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Use a disposable loopback frontend')
function token(role, forcePasswordChange = false, tenantId = 7) {
  const now = Math.floor(Date.now() / 1000)
  return `e30.${Buffer.from(JSON.stringify({ sub: '17', tenantId, role, name: 'Pessoa de teste', email: 'person@example.invalid', stage: 'authenticated', iat: now, exp: now + 3600, forcePasswordChange })).toString('base64url')}.simulation`
}
async function session(browser, { role = 'user', theme = 'light', width = 1366, authenticated = true, forcePasswordChange = false, tenantId = 7, expired = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' })
  const requests = [], errors = []
  await context.addInitScript(({ access, theme }) => {
    if (access) localStorage.setItem('na_access_token', access)
    localStorage.setItem('na_ui_theme_mode', theme)
    localStorage.setItem('nodeaccess_locale', 'pt-BR')
  }, { access: authenticated ? token(role, forcePasswordChange, tenantId) : null, theme })
  await context.route('**/api/v1/**', async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname
    requests.push({ path: pathname, method: request.method() })
    if (expired && pathname === '/api/v1/settings/manual') {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"Expired synthetic session"}' })
      return
    }
    let body = []
    if (pathname === '/api/v1/settings/manual') body = { enabled: false }
    else if (pathname === '/api/v1/hosts/sidebar-bootstrap') body = { folders: [], groups: [], tags: [], summary: { all: 0, global: 0, unfiled: 0, maxHosts: 20, folders: {}, groups: {}, tags: {} } }
    else if (pathname === '/api/v1/settings') body = { tenant: { id: 7, name: 'Tenant de teste', slug: 'test' }, license: { maxUsers: 20, maxHosts: 20, featureEntitlements: {}, integrationEntitlements: {} }, tenantSettings: {}, sessionLimits: { activeSessions: 0, maxPerUser: 3, maxPerTenant: 20 } }
    else if (pathname === '/api/v1/features') body = {}
    else if (pathname === '/api/v1/hosts' || pathname === '/api/v1/users') body = { data: [], total: 0, page: 1, totalPages: 0 }
    else if (pathname === '/api/v1/session-supervision/permission') body = { enabled: false }
    else if (pathname === '/api/v1/session-audit/policy') body = null
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  await attachBrowserCoverage(page, browser)
  return { context, page, requests, errors }
}
async function verifySectionNavigation(page, label) {
  const main = page.locator('[data-security-center]')
  const audit = main.getByRole('link', { name: 'Auditoria e privacidade', exact: true })
  const first = main.getByRole('navigation', { name: 'Nesta página' }).getByRole('link').first()
  await page.waitForFunction(() => !document.querySelector('[class*="page-enter"], [class*="page-leave"], .route-loading-bar'))
  await page.evaluate(() => {
    const state = { root: document.querySelector('[data-security-center]'), effects: [] }
    const inspect = element => {
      if (!(element instanceof Element)) return
      if (element.matches('[class*="page-enter"], [class*="page-leave"], .route-loading-bar') || element.querySelector('[class*="page-enter"], [class*="page-leave"], .route-loading-bar')) state.effects.push('transition-or-loading')
    }
    state.observer = new MutationObserver(records => {
      for (const record of records) {
        inspect(record.target)
        if (/page-(enter|leave)|route-loading-bar/.test(record.oldValue || '')) state.effects.push('transient-class')
        for (const node of record.addedNodes) inspect(node)
      }
    })
    state.observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true })
    window.__securityAnchorReview = state
  })
  async function check(action, expectedHash, name) {
    await action()
    await page.waitForURL(url => url.hash === expectedHash)
    await page.waitForTimeout(400)
    const result = await page.evaluate(hash => {
      const state = window.__securityAnchorReview
      const target = document.getElementById(hash.slice(1))
      const box = target?.getBoundingClientRect()
      return { sameRoot: state.root === document.querySelector('[data-security-center]'), connected: state.root.isConnected, effects: [...state.effects], targetVisible: !!box && box.top >= 0 && box.top < innerHeight, hash: location.hash }
    }, expectedHash)
    fs.writeFileSync(path.join(output, `${label}-anchor-${name}.json`), JSON.stringify(result, null, 2))
    assert.equal(result.sameRoot && result.connected, true, 'Anchor navigation must preserve the mounted page DOM')
    assert.deepEqual(result.effects, [], 'Anchor navigation must not trigger page transitions or the route loading bar')
    assert.equal(result.targetVisible, true, 'Anchor target must be in the viewport')
  }
  try {
    await check(() => audit.click(), '#security-audit', 'audit-click')
    await check(() => audit.click(), '#security-audit', 'audit-repeat')
    const firstHash = await first.getAttribute('href')
    await check(async () => { await first.focus(); await page.keyboard.press('Enter') }, firstHash, 'keyboard')
    await check(() => page.goBack(), '#security-audit', 'back')
    await check(() => page.goForward(), firstHash, 'forward')
    await check(async () => { await audit.focus(); await page.keyboard.press('Enter') }, '#security-audit', 'audit-keyboard')
  } finally {
    await page.evaluate(() => { window.__securityAnchorReview.observer.disconnect(); delete window.__securityAnchorReview })
  }
}
async function main() {
  fs.mkdirSync(output, { recursive: true, mode: 0o700 })
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser' })
  const report = { passed: false, captureRunId: process.env.BROWSER_COVERAGE_RUN_ID || null, catalogSha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'docs/security/controls-catalog.json'))).digest('hex'), scenarios: [] }
  try {
    assertPublicOnly(JSON.stringify(publicCatalog))
    if (process.env.SECURITY_CENTER_DIST_CHECK === 'true') {
      const files = fs.readdirSync(path.join(root, 'apps/frontend/dist/assets')).filter(file => file.endsWith('.js'))
      let centerFound = false
      for (const file of files) {
        const contents = fs.readFileSync(path.join(root, 'apps/frontend/dist/assets', file), 'utf8')
        if (contents.includes('data-security-center')) centerFound = true
        assertPublicOnly(contents)
      }
      assert.ok(centerFound, 'Production build must contain the actual security view')
      report.bundle = { inspectedJavaScriptFiles: files.length, privateMetadataAbsent: true }
    }
    for (const options of [{ authenticated: false, expected: '/auth/login' }, { expired: true, expected: '/auth/login' }, { forcePasswordChange: true, expected: '/profile' }]) {
      const { context, page } = await session(browser, options)
      await page.goto(`${base}/security`)
      await page.waitForURL(url => url.pathname === options.expected)
      assert.equal(await page.locator('[data-security-center]').count(), 0)
      report.scenarios.push({ name: options.authenticated === false ? 'unauthenticated guard' : options.expired ? '401 expires session' : 'password-change guard', passed: true })
      await context.close()
    }
    let publicText
    for (const role of ['user', 'admin']) for (const theme of ['light', 'dark']) {
      const { context, page, requests, errors } = await session(browser, { role, theme, tenantId: role === 'admin' ? 8 : 7 })
      await page.goto(`${base}/security`, { waitUntil: 'networkidle' })
      const main = page.locator('[data-security-center]')
      await main.getByRole('heading', { level: 1, name: 'Central de Segurança' }).waitFor()
      const text = await main.innerText()
      assertPublicOnly(text)
      assert.equal(await main.locator('.security-section').count(), publicCatalog.sections.length + 1)
      if (publicText) assert.equal(text, publicText, 'Informational catalog must not expose tenant-specific data')
      publicText = text
      assert.match(await main.locator('[data-security-scope]').innerText(), /informativ|diagnóstico/i)
      await page.getByRole('menuitem', { name: 'Central de Segurança', exact: true }).waitFor()
      assert.equal(await page.getByRole('menuitem', { name: 'Manual de uso', exact: true }).count(), 0)
      assert.ok(requests.some(item => item.path === '/api/v1/settings/manual'), 'Manual-disabled condition must be observed')
      const nav = main.getByRole('navigation', { name: 'Nesta página' })
      const links = nav.getByRole('link')
      assert.ok(await links.count() >= 2)
      for (const link of await links.all()) {
        const href = await link.getAttribute('href')
        assert.ok(href.startsWith('#'))
        assert.equal(await main.locator(`[id="${href.slice(1)}"]`).count(), 1)
      }
      await verifySectionNavigation(page, `${role}-${theme}`)
      await links.first().focus()
      assert.equal(await links.first().evaluate(el => el === document.activeElement), true)
      await page.keyboard.press('Enter')
      assert.ok(new URL(page.url()).hash)
      const profile = main.getByRole('link', { name: 'Revisar meu perfil' })
      assert.equal(await profile.getAttribute('href'), '/profile')
      assert.equal(await main.locator('[data-security-review] time').getAttribute('datetime'), '2026-11-06')
      assert.equal(await main.locator('input, select, textarea').count(), 0, 'Informational center must not expose settings')
      const requestCount = requests.length
      await page.waitForTimeout(700)
      assert.equal(requests.length, requestCount, 'The static center must not add polling requests')
      assert.equal(requests.filter(item => item.method !== 'GET').length, 0)
      assert.deepEqual(errors, [])
      await main.evaluate(el => el.scrollIntoView({ block: 'start' }))
      await page.screenshot({ path: path.join(output, `${role}-${theme}-desktop.png`), fullPage: true })
      await page.setViewportSize({ width: 390, height: 844 })
      await main.waitFor()
      await page.waitForTimeout(300)
      const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }))
      assert.ok(dimensions.scroll <= dimensions.width + 1, 'Mobile must not scroll horizontally')
      const overflow = await main.locator('p, h1, h2, li, nav').evaluateAll(nodes => nodes.map(el => ({ tag: el.tagName, width: el.clientWidth, scroll: el.scrollWidth, left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right })).filter(box => box.right > innerWidth + 1 || box.left < -1 || box.scroll > box.width + 1))
      assert.deepEqual(overflow, [], 'Mobile content must fit its actual scroll container')
      await verifySectionNavigation(page, `${role}-${theme}-mobile`)
      await main.evaluate(el => el.scrollIntoView({ block: 'start' }))
      await page.screenshot({ path: path.join(output, `${role}-${theme}-mobile.png`), fullPage: true })
      // Emulate text-only enlargement: double computed fonts, preserving viewport/layout widths.
      await main.evaluate(container => {
        const nodes = [container, ...container.querySelectorAll('*')]
        const sizes = nodes.map(el => Number.parseFloat(getComputedStyle(el).fontSize))
        nodes.forEach((el, index) => {
          el.dataset.originalStyle = el.getAttribute('style') || ''
          el.style.fontSize = `${sizes[index] * 2}px`
        })
      })
      const enlarged = await main.locator('p, h1, h2, h3, li, nav, a').evaluateAll(nodes => nodes.map(el => ({ tag: el.tagName, width: el.clientWidth, scroll: el.scrollWidth, left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right })).filter(box => box.right > innerWidth + 1 || box.left < -1 || box.scroll > box.width + 1))
      assert.deepEqual(enlarged, [], 'Text enlarged to 200% must fit the mobile content bounds')
      await links.first().focus()
      await page.keyboard.press('Enter')
      assert.ok(new URL(page.url()).hash)
      await main.evaluate(el => el.scrollIntoView({ block: 'start' }))
      await page.screenshot({ path: path.join(output, `${role}-${theme}-mobile-text-200.png`), fullPage: true })
      await main.evaluate(container => {
        for (const el of [container, ...container.querySelectorAll('*')]) {
          el.setAttribute('style', el.dataset.originalStyle)
          delete el.dataset.originalStyle
        }
      })
      await profile.click()
      await page.waitForURL(url => url.pathname === '/profile')
      await page.setViewportSize({ width: 1366, height: 900 })
      await page.waitForTimeout(300)
      await page.getByRole('menuitem', { name: 'Central de Segurança', exact: true }).click()
      await page.waitForURL(url => url.pathname === '/security')
      await main.getByRole('heading', { level: 1, name: 'Central de Segurança' }).waitFor()
      const headingBounds = await main.locator('h1').evaluate(el => ({ top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom, viewport: innerHeight }))
      assert.ok(headingBounds.top >= 0 && headingBounds.bottom <= headingBounds.viewport, `Menu navigation must restore the Security Center heading into the viewport: ${JSON.stringify(headingBounds)}`)
      report.scenarios.push({ name: 'static center, menu without manual, keyboard, profile and responsive layout', role, theme, textEnlargement: '200% computed font size at 390px', passed: true })
      await context.close()
    }
    const deepLink = await session(browser)
    await deepLink.page.goto(`${base}/security#security-practices`, { waitUntil: 'networkidle' })
    const targetTop = await deepLink.page.locator('#security-practices').evaluate(el => el.getBoundingClientRect().top)
    assert.ok(targetTop >= 0 && targetTop < 900, 'A valid deep link must reach its section in the viewport')
    // A fragment-only navigation does not mount a new page; exercise an actual entry.
    await deepLink.page.goto(`${base}/profile`, { waitUntil: 'networkidle' })
    await deepLink.page.goto(`${base}/security#unknown-section`, { waitUntil: 'networkidle' })
    const initialTop = await deepLink.page.locator('[data-security-center] h1').evaluate(el => el.getBoundingClientRect().top)
    assert.ok(initialTop >= 0 && initialTop < 100, 'An unknown fragment must fall back to the page heading')
    // Use the installed application router to distinguish query changes from fragments.
    await deepLink.page.evaluate(async () => {
      window.__securityBeforeQuery = document.querySelector('[data-security-center]')
      const router = document.querySelector('#app').__vue_app__.config.globalProperties.$router
      await router.push({ name: 'security-center', query: { review: 'anchor-contract' }, hash: '#security-audit' })
    })
    await deepLink.page.waitForFunction(() => document.querySelector('[data-security-center]') !== window.__securityBeforeQuery && !document.querySelector('[class*="page-enter"], [class*="page-leave"]'))
    assert.equal(new URL(deepLink.page.url()).searchParams.get('review'), 'anchor-contract')
    await verifySectionNavigation(deepLink.page, 'query-preserved')
    assert.equal(new URL(deepLink.page.url()).searchParams.get('review'), 'anchor-contract', 'Section links must preserve the existing query')
    await deepLink.page.evaluate(() => { delete window.__securityBeforeQuery })
    assert.deepEqual(deepLink.errors, [])
    await deepLink.context.close()
    report.scenarios.push({ name: 'valid deep link and unknown fragment fallback', passed: true })
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, 'docs/security/controls-catalog.json'))).digest('hex'), report.catalogSha256, 'Catalog changed during browser validation')
    report.passed = true
  } finally {
    fs.writeFileSync(process.env.REPORT_PATH || path.join(output, 'report.json'), JSON.stringify(report, null, 2))
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
