#!/usr/bin/env node
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser'
const CDP_URL = process.env.CHROMIUM_CDP_URL || ''
let ownedBrowser

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function main() {
  const browser = CDP_URL
    ? await chromium.connectOverCDP(CDP_URL)
    : await chromium.launch({ headless: true, executablePath: EXECUTABLE_PATH })
  if (!CDP_URL) ownedBrowser = browser
  let context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.addInitScript(() => {
    localStorage.setItem('na_access_token', 'expired.access.token')
    localStorage.setItem('na_refresh_token', 'expired-refresh-token')
  })

  const requests = []
  await context.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    requests.push({ path, authorization: request.headers().authorization || null })
    if (path === '/api/v1/host-links/jit-regression/public-info') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ expiresAt: new Date(Date.now() + 600000).toISOString(), pinRequired: true, status: 'active' }),
      })
      return
    }
    if (path === '/api/v1/auth/refresh') {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'expired' }) })
      return
    }
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'authentication required' }) })
  })

  let page = await context.newPage()
  await page.goto(`${FRONTEND}/jit-access/jit-regression`)
  await page.locator('#jit-guest-name').waitFor()
  await page.locator('#jit-pin').waitFor()
  assert(new URL(page.url()).pathname === '/jit-access/jit-regression', 'JIT redirected away from its public entry page')
  const infoRequest = requests.find((item) => item.path.endsWith('/public-info'))
  assert(infoRequest && infoRequest.authorization === null, 'JIT public-info leaked the stale bearer token')
  assert(!requests.some((item) => item.path === '/api/v1/auth/refresh'), 'JIT unexpectedly attempted session refresh')

  // Submit a wrong PIN, correct it, then mount a real terminal in a fresh
  // anonymous context. Any authenticated HTTP request must fail this test.
  await context.close()
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const publicRequests = []
  let attempts = 0
  await context.route('**/api/v1/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    publicRequests.push(path)
    if (path.endsWith('/public-info')) return route.fulfill({ json: { expiresAt: new Date(Date.now() + 600000).toISOString(), pinRequired: true, status: 'active' } })
    if (path.endsWith('/public-resolve')) {
      attempts++
      assert(!request.headers().authorization, 'Anonymous resolve sent a bearer token')
      if (attempts === 1) return route.fulfill({ status: 401, json: { message: 'PIN incorreto' } })
      return route.fulfill({ json: { guestName: 'Convidado', expiresAt: new Date(Date.now() + 600000).toISOString(), accessToken: 'scoped-jit-token', host: { id: 42, name: 'JIT test host', ip: '127.0.0.1', port: 22, authType: 'password', accessProtocol: 'ssh' } } })
    }
    return route.fulfill({ status: 401, json: { message: 'Unexpected authenticated request' } })
  })
  let publicSocket
  await context.routeWebSocket('**/ws/ssh**', ws => {
    publicSocket = ws
    ws.send(JSON.stringify({ type: 'connected', sessionId: 123 }))
    ws.onMessage(message => {
      if (typeof message === 'string' && message.includes('ping')) ws.send(JSON.stringify({ type: 'pong' }))
    })
  })
  page = await context.newPage()
  await page.goto(`${FRONTEND}/jit-access/jit-success`)
  await page.locator('#jit-guest-name').fill('Convidado')
  await page.locator('#jit-pin').fill('1111')
  await page.locator('#jit-pin').press('Enter')
  await page.getByText('PIN incorreto', { exact: true }).waitFor()
  assert(new URL(page.url()).pathname === '/jit-access/jit-success', 'Wrong public PIN triggered login')
  await page.locator('#jit-pin').fill('2222')
  await page.locator('#jit-pin').press('Enter')
  await page.locator('.xterm-screen').waitFor()
  await page.waitForTimeout(500)
  assert(new URL(page.url()).pathname === '/jit-access/jit-success', 'Successful JIT terminal triggered login')
  assert(publicRequests.every(path => path.endsWith('/public-info') || path.endsWith('/public-resolve')), `JIT made authenticated requests: ${publicRequests.join(', ')}`)
  assert(attempts === 2, 'PIN retry did not complete')
  assert(publicSocket, 'Public terminal did not open its WebSocket')
  publicSocket.send(JSON.stringify({ type: 'error', message: 'Public token expired', code: 'JIT_LINK_EXPIRED' }))
  await page.waitForTimeout(500)
  assert(new URL(page.url()).pathname === '/jit-access/jit-success', 'Expired public token redirected to application login')
  assert(!publicRequests.includes('/api/v1/auth/refresh'), 'Expired public token refreshed the application session')
  await context.close()

  // Expired/revoked links must not submit, even when the user presses Enter.
  for (const status of ['expired', 'revoked']) {
    context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    let resolves = 0
    await context.route('**/api/v1/**', route => {
      if (route.request().url().endsWith('/public-resolve')) resolves++
      return route.fulfill({ json: { status, pinRequired: false, expiresAt: new Date().toISOString() } })
    })
    page = await context.newPage()
    await page.goto(`${FRONTEND}/jit-access/${status}-test`)
    await page.locator('.n-alert').waitFor()
    await page.locator('#jit-guest-name').fill('Convidado')
    await page.locator('#jit-guest-name').press('Enter')
    assert(await page.locator('button').isDisabled(), `${status} link enabled entry`)
    assert(resolves === 0, `${status} link submitted credentials`)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile JIT page overflows')
    await context.close()
  }

  // Hold the response while the user submits repeatedly; then simulate a
  // transient server failure and verify that the same form can be retried.
  context = await browser.newContext()
  let pendingResolve
  let resolveCount = 0
  let socketCount = 0
  const failureRequests = []
  await context.routeWebSocket('**/ws/ssh**', ws => { socketCount++; ws.close() })
  await context.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    failureRequests.push(path)
    if (path.endsWith('/public-info')) return route.fulfill({ json: { status: 'active', pinRequired: false, expiresAt: new Date(Date.now() + 600000).toISOString() } })
    if (path.endsWith('/public-resolve')) { resolveCount++; pendingResolve = route; return }
    return route.fulfill({ status: 401, json: { message: 'Unexpected private request' } })
  })
  page = await context.newPage()
  await page.goto(`${FRONTEND}/jit-access/delayed-test`)
  await page.locator('#jit-guest-name').fill('Convidado')
  await page.locator('button').waitFor({ state: 'visible' })
  await page.waitForFunction(() => !document.querySelector('button').disabled)
  await page.locator('#jit-guest-name').press('Enter')
  await page.waitForFunction(() => document.querySelector('button').disabled)
  // Dispatch a burst rather than waiting on a disabled input.
  await page.locator('#jit-guest-name').evaluate(input => {
    for (let i = 0; i < 5; i++) input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
  })
  await page.waitForTimeout(200)
  assert(resolveCount === 1, 'Repeated Enter created duplicate resolve requests')
  await pendingResolve.fulfill({ status: 503, json: { message: 'Servidor temporariamente indisponível' } })
  await page.getByText('Servidor temporariamente indisponível', { exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('button')?.disabled === false, undefined, { timeout: 5000 })
  assert(await page.locator('#jit-guest-name').inputValue() === 'Convidado', 'Transient error erased guest input')
  pendingResolve = null
  await page.locator('#jit-guest-name').press('Enter')
  for (let i = 0; !pendingResolve && i < 100; i++) await page.waitForTimeout(25)
  assert(resolveCount === 2 && pendingResolve, 'Retry did not submit')
  // Client-side navigation exercises unmount while the request is still alive.
  await page.evaluate(() => {
    history.pushState({}, '', '/auth/login')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  await page.locator('#jit-guest-name').waitFor({ state: 'detached' })
  await pendingResolve.fulfill({ json: { guestName: 'Convidado', expiresAt: new Date(Date.now() + 600000).toISOString(), accessToken: 'late-scoped-token', host: { id: 42, name: 'Late host', ip: '127.0.0.1', port: 22, authType: 'password', accessProtocol: 'ssh' } } })
  await page.waitForTimeout(400)
  assert(socketCount === 0 && await page.locator('.xterm-screen').count() === 0, 'Late response opened an abandoned terminal')
  const remainingTabs = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('terminals').tabs.length)
  assert(remainingTabs === 0, 'Late response left an invisible terminal tab in the store')
  assert(!failureRequests.includes('/api/v1/auth/refresh'), 'Public failure attempted private refresh')
  await context.close()

  context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  page = await context.newPage()
  await page.goto(`${FRONTEND}/host-links/own-session-regression`)
  await page.waitForURL((url) => url.pathname === '/auth/login')
  assert(new URL(page.url()).searchParams.get('redirect') === '/host-links/own-session-regression', 'Own-session login did not preserve its destination')

  await context.close()
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  page = await context.newPage()
  await page.goto(`${FRONTEND}/shared-sessions/live-session-regression`)
  await page.waitForURL((url) => url.pathname === '/auth/login')
  assert(
    new URL(page.url()).searchParams.get('redirect') === '/shared-sessions/live-session-regression',
    `Live-session login did not preserve its destination: ${page.url()}`,
  )

  console.log(JSON.stringify({
    ok: true,
    flows: {
      jit: 'anonymous terminal, PIN retry, no authenticated Jira call, expired public token stays public',
      jitFaults: 'expired/revoked mobile entry, duplicate Enter, delayed response, 503 retry, navigation during resolve',
      ownSession: 'login required with destination preserved',
      liveSession: 'login required with destination preserved',
    },
  }, null, 2))
  await context.close()
  if (!CDP_URL) await browser.close()
}

main().catch(async (error) => {
  console.error(error)
  if (ownedBrowser) await ownedBrowser.close()
  process.exitCode = 1
})
