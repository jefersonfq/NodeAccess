const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const FRONTEND = process.env.FRONTEND_BASE || 'http://127.0.0.1:5190'
const host = { id: 701, tenantId: 7, name: 'Target outside first page', ip: '10.0.0.7', port: 22, sshUser: 'ops', accessProtocol: 'ssh', authType: 'password', connectionMode: 'direct', scope: 'global', tags: [], associatedLinks: [], accessPermissions: { view: true, connect: true, edit: true, admin: true }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
async function main() {
 const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium-browser' })
 try {
  const context = await browser.newContext()
  await context.addInitScript(() => {
   const token = `${btoa('{}')}.${btoa(JSON.stringify({ sub: '1', userId: 1, tenantId: 7, role: 'admin', name: 'Admin', stage: 'authenticated', exp: 4102444800 }))}.test`
   localStorage.setItem('na_access_token', token); localStorage.setItem('na_refresh_token', 'test')
   localStorage.setItem('na_hosts_default_view', 'home'); localStorage.setItem('nodeaccess_locale', 'en')
  })
  let byIds = [], allowed = true
  await context.route('**/api/v1/**', async route => {
   const url = new URL(route.request().url()), path = url.pathname
   let body = []
   if (path === '/api/v1/hosts/by-ids') { byIds.push(url.searchParams.get('ids')); body = allowed ? [host] : [] }
   else if (path === '/api/v1/hosts') body = { data: [{ ...host, id: 1, name: 'Another host' }], total: 1, page: 1, limit: 500 }
   else if (path === '/api/v1/hosts/sidebar-bootstrap') body = { summary: { all: 2, global: 2, unfiled: 0, maxHosts: 1000, folders: {}, groups: {}, tags: {} }, folders: [], groups: [], tags: [] }
   else if (path === '/api/v1/hosts/associated-links/catalog') body = [{ host, link: { id: 8, label: 'Host console', urlTemplate: 'https://example.test/{ip}', sourceType: 'manual', sourceStatus: 'ready' } }]
   else if (path === '/api/v1/forwardings') body = [{ id: 8, hostId: host.id, hostName: host.name, hostIp: host.ip, description: 'Web', autoStart: false, localPort: 8080, remoteHost: '127.0.0.1', remotePort: 80, bindAddress: '127.0.0.1', hostConnectionMode: 'DIRECT' }]
   else if (path === '/api/v1/features') body = { portForwardingLicensed: true }
   else if (path === '/api/v1/settings') body = { tenant: { id: 7, name: 'Test' }, license: { hasKey: true, featureEntitlements: {}, integrationEntitlements: {} } }
   else if (path === '/api/v1/sessions/access-map') body = { hosts: [], totals: { activeSessions: 0, activeHosts: 0, uniqueUsers: 0, concurrentHosts: 0 }, refreshAfterSeconds: 5 }
   await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  const page = await context.newPage(); page.setDefaultTimeout(20000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  for (const source of ['forwardings', 'links']) {
   await page.goto(`${FRONTEND}/${source}`)
   await page.getByRole('button', { name: /Go to host/i }).click()
   await page.waitForURL('**/hosts?hostId=701')
   await page.getByTestId('linked-host-filter').waitFor()
   await page.locator('[data-host-id="701"]').first().waitFor()
   assert.equal(await page.locator('[data-host-id="1"]').count(), 0)
   await page.reload()
   await page.locator('[data-host-id="701"]').first().waitFor()
  }
  assert.ok(byIds.length >= 2 && byIds.every(id => id === '701'))
  // Clear the explicit filter and restore the regular host list.
  await page.getByTestId('linked-host-filter').locator('.n-tag__close').click()
  await page.locator('[data-host-id="1"]').first().waitFor().catch(async error => { console.error(page.url(), (await page.locator('body').innerText()).slice(-3500), errors); throw error })
  allowed = false
  await page.goto(`${FRONTEND}/hosts?hostId=999`)
  await page.getByTestId('linked-host-filter').waitFor()
  await page.waitForTimeout(500)
  assert.equal(await page.locator('[data-host-id]').count(), 0)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, scenarios: ['forwardings exact host', 'links exact host', 'reload preserves filter', 'clear filter', 'unavailable host does not show unrelated hosts'] }))
 } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
