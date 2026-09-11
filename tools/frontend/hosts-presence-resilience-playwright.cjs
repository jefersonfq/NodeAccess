#!/usr/bin/env node
const { chromium } = require('playwright')
const assert = require('node:assert/strict')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')

function token() {
  const now = Math.floor(Date.now() / 1000)
  const payload = { sub: '1', userId: 1, tenantId: 7, name: 'Admin', role: 'admin', email: 'admin@example.test', stage: 'authenticated', iat: now, exp: now + 3600 }
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.harness`
}

const host = {
  id: 21, tenantId: 7, name: 'DB Produção', description: null, ip: '10.0.0.21', port: 22,
  accessProtocol: 'ssh', operatingSystem: 'linux', sshUser: 'ops', authType: 'password', connectionMode: 'direct',
  scope: 'global', ownerId: null, groupId: null, folderId: null, bastionId: null, pemKeyId: null,
  inventoryParentId: 810, inventoryParentName: 'Produção corporativa', tags: [], associatedLinks: [],
  accessPermissions: { view: true, connect: true, edit: true, admin: true },
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}
const folderNodes = [
  { id: 800, parentId: null, type: 'ROOT', hostId: null, name: 'Raiz corporativa', path: '/Raiz corporativa', depth: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 810, parentId: 800, type: 'FOLDER', hostId: null, name: 'Produção corporativa', path: '/Raiz corporativa/Produção corporativa', depth: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
]

async function waitUntil(check, message) {
  const deadline = Date.now() + 10000
  while (!check()) {
    if (Date.now() > deadline) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser' })
  try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  let sessions = [
    { id: 101, userId: 1, name: 'Alice' },
    { id: 102, userId: 1, name: 'Alice' },
    { id: 103, userId: 2, name: 'Bob' },
  ]
  let failPresence = false
  let reads = 0
  let holdNextPresence = false
  let releasePresence
  let delayedFinished = false
  const runtimeErrors = []

  await context.addInitScript((authToken) => {
    localStorage.setItem('na_access_token', authToken)
    localStorage.setItem('na_refresh_token', 'corporate-folders-harness')
    localStorage.setItem('na_hosts_default_view', 'all')
  }, token())

  await context.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    let status = 200
    let body = []

    if (path === '/api/v1/hosts/sidebar-bootstrap') {
      const count = 1
      body = { summary: { all: count, global: count, unfiled: 0, maxHosts: 50, folders: {}, groups: {}, tags: {} }, folders: [], groups: [], tags: [] }
    } else if (path === '/api/v1/hosts') {
      body = { data: [host], total: 1, page: 1, limit: 40, totalPages: 1 }
    } else if (path === '/api/v1/inventory') {
      body = [...folderNodes, { id: 811, parentId: 810, type: 'HOST', hostId: host.id, name: host.name, path: `/Raiz corporativa/Produção corporativa/${host.name}`, depth: 2, createdAt: host.createdAt, updatedAt: host.updatedAt }]
    } else if (path === '/api/v1/sessions/access-map') {
      reads += 1
      const now = new Date().toISOString()
      const uniqueUsers = new Set(sessions.map(session => session.userId)).size
      body = { generatedAt: now, refreshAfterSeconds: 5,
        totals: { activeSessions: sessions.length, activeHosts: sessions.length ? 1 : 0, uniqueUsers, concurrentHosts: uniqueUsers > 1 ? 1 : 0 },
        hosts: sessions.length ? [{ host: { ...host, scope: 'GLOBAL', accessProtocol: 'SSH', groupName: null },
          activeSessions: sessions.length, uniqueUsers, oldestStartedAt: now, lastStartedAt: now, lastSeenAt: now,
          sessions: sessions.map(session => ({ id: session.id, user: { id: session.userId, name: session.name, email: `${session.name}@example.test`, avatarUrl: null, avatarVersion: null }, startedAt: now, lastSeenAt: now, durationSeconds: 10, connectionMethod: 'direct', accessType: 'authenticated', clientIp: null, agentRemoteIp: null, agentNameSnapshot: null })) }] : [] }
      if (failPresence) { status = 503; body = { message: 'Presence temporarily unavailable' } }
    } else if (path === '/api/v1/features') body = {}
    else if (path === '/api/v1/settings') body = { tenant: { id: 7, name: 'Acme', slug: 'acme' }, license: { maxUsers: 10, maxHosts: 50, activeUsers: 1, registeredHosts: 1, hasKey: true, featureEntitlements: {}, integrationEntitlements: {} } }
    else if (path === '/api/v1/groups' || path === '/api/v1/tags' || path === '/api/v1/folders' || path === '/api/v1/bastions' || path === '/api/v1/pem-keys') body = []

    if (path === '/api/v1/sessions/access-map' && holdNextPresence) {
      holdNextPresence = false
      await new Promise(resolve => { releasePresence = resolve })
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      delayedFinished = true
      return
    }
    await route.fulfill({ status, contentType: 'application/json', body: body == null ? '' : JSON.stringify(body) })
  })

  const page = await context.newPage()
  const pending = new Set()
  page.on('request', req => pending.add(req.url()))
  page.on('requestfinished', req => pending.delete(req.url()))
  page.on('requestfailed', req => pending.delete(req.url()))
  page.setDefaultTimeout(60_000)
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  page.on('requestfailed', req => console.error('requestfailed:', req.url(), req.failure()))
  await page.goto(`${FRONTEND}/hosts?presenceHarness=${Date.now()}`, { waitUntil: 'domcontentloaded' })

  await page.getByText(/View all hosts →|Ver todos os hosts →/).click()
  const pill = page.locator('[data-host-presence-pill]').first()
  async function expectCounts(active, users) {
    await page.waitForFunction(({ active, users }) => {
      const pill = document.querySelector('[data-host-presence-pill]')
      return pill?.getAttribute('data-active-sessions') === String(active)
        && pill?.getAttribute('data-unique-users') === String(users)
    }, { active, users })
  }
  async function event(sessionId, action = 'ended', tenantId = 7) {
    await page.evaluate(async detail => {
      const { sessionsService } = await import('/src/services/sessions.service.ts')
      sessionsService.clearAccessMapCache('presence-harness-event')
      window.dispatchEvent(new CustomEvent('nodeaccess:session-presence-changed', { detail }))
    },
      { sessionId, hostId: 21, tenantId, userId: 1, action, changedAt: new Date().toISOString() })
  }
  try { await expectCounts(3, 2) } catch (error) { console.error('pending', [...pending], 'errors', runtimeErrors, 'body', (await page.locator('body').innerText()).slice(-2000)); throw error }
  await pill.hover()
  await page.getByText('Alice@example.test', { exact: false }).first().waitFor()
  await page.getByText('Bob@example.test', { exact: false }).first().waitFor()
  await page.mouse.move(0, 0)
  const beforeForeign = reads
  await event(101, 'ended', 99)
  await expectCounts(3, 2)
  assert.equal(reads, beforeForeign, 'Foreign tenant event must be ignored')
  sessions = sessions.filter(session => session.id !== 101)
  await event(101)
  await expectCounts(2, 2)
  await event(101)
  await expectCounts(2, 2)
  sessions = sessions.filter(session => session.id !== 102)
  await event(102, 'timeout')
  await expectCounts(1, 1)
  sessions.push({ id: 104, userId: 1, name: 'Alice' })
  await event(104, 'started')
  await expectCounts(2, 2)
  await event(102)
  await expectCounts(2, 2)
  holdNextPresence = true
  await event(104, 'started')
  await waitUntil(() => releasePresence, 'delayed request did not start')
  sessions = sessions.filter(session => session.id !== 103)
  await event(103)
  await expectCounts(1, 1)
  releasePresence()
  await waitUntil(() => delayedFinished, 'delayed request did not finish')
  await page.waitForTimeout(200)
  await expectCounts(1, 1)
  sessions.push({ id: 105, userId: 2, name: 'Bob' })
  await event(105, 'started')
  await expectCounts(2, 2)
  failPresence = true
  await event(104, 'started')
  await page.locator('[data-presence-unavailable]').waitFor()
  failPresence = false
  await event(104, 'started')
  await expectCounts(2, 2)
  await page.locator('[data-presence-unavailable]').waitFor({ state: 'hidden' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expectCounts(2, 2)
  await page.screenshot({ path: '/tmp/nodeaccess-hosts-presence.png', fullPage: true })
  sessions = []
  await event(105, 'cleanup')
  await event(104, 'cleanup')
  await page.locator('[data-host-presence-pill]').waitFor({ state: 'hidden' })
  assert.deepEqual(runtimeErrors, [])
  console.log(JSON.stringify({ ok: true, scenarios: ['two users / three sessions', 'popover identities', 'foreign tenant ignored', 'one tab closed', 'duplicate ended event', 'timeout', 'reconnected session', 'late old-session event', 'late API response cannot restore ended session', '503 explicit unavailable', 'recovery', 'state preserved at 390px', 'last sessions cleaned'], reads }))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
