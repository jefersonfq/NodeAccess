const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const FRONTEND = process.env.FRONTEND_BASE || 'http://127.0.0.1:5177'
async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser' })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    await context.addInitScript(() => {
      const payload = { sub: '1', userId: 1, tenantId: 7, role: 'admin', name: 'Admin', email: 'admin@test', stage: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 }
      localStorage.setItem('na_access_token', `${btoa('{}')}.${btoa(JSON.stringify(payload))}.test`)
      localStorage.setItem('na_refresh_token', 'test')
      localStorage.setItem('nodeaccess_locale', 'en')
    })
    let failList = true, failPause = true, failCreate = true, created = false, creates = 0
    const endpoint = { id: 8, tenantId: 7, provider: 'monitoring', name: 'Monitor', status: 'ACTIVE', allowedEventTypes: ['host.unavailable'], lastReceivedAt: null }
    const outbound = { id: 3, name: 'Outbound test', status: 'ACTIVE', targetUrl: 'https://receiver.example', subscribedEvents: ['host.created'], httpMethod: 'POST', timeoutMs: 5000, maxRetries: 3, payloadMode: 'AUTOMATIC' }
    let holdReceipt = false, releaseReceipt, receiptCode = 'INVALID_SIGNATURE', released = false
    let patches = 0, rotations = 0, finishRotation
    const cursors = []
    const errors = []
    await context.route('**/api/v1/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname
      let status = 200, body = []
      const query = new URL(req.url()).searchParams
      if (path === '/api/v1/inbound-webhooks/endpoints/8' && req.method() === 'PATCH') {
        patches++
        if (patches === 1) { status = 503; body = { message: 'Edit failed' } }
        else { Object.assign(endpoint, req.postDataJSON()); body = endpoint }
      } else if (path.endsWith('/rotate-credentials')) {
        rotations++
        await new Promise(resolve => { finishRotation = resolve })
        body = { endpointToken: 'rotated-token', secret: 'rotated-hmac-secret' }
      } else if (path === '/api/v1/webhooks/subscriptions') body = [outbound]
      else if (path === '/api/v1/inbound-webhooks/endpoints' && req.method() === 'POST') {
        creates++
        if (failCreate) { failCreate = false; status = 503; body = { message: 'Temporary creation failure' } }
        else { await new Promise(resolve => setTimeout(resolve, 350)); created = true; body = { endpoint, endpointToken: 'inwh_test_only' } }
      } else if (path === '/api/v1/inbound-webhooks/endpoints') {
        if (failList) { failList = false; status = 503; body = { message: 'Temporary list failure' } }
        else body = created ? [endpoint] : []
      } else if (path.endsWith('/pause')) {
        if (failPause) { failPause = false; status = 500; body = { message: 'Pause failed' } }
        else { endpoint.status = 'PAUSED'; body = {} }
      } else if (path.endsWith('/receipts')) body = [{ id: 5, eventType: 'host.unavailable', status: 'REJECTED', signatureValid: false, errorCode: receiptCode, receivedAt: new Date().toISOString(), payloadJson: '{}' }]
      else if (path.endsWith('/deliveries')) body = [{ id: 6, eventType: 'host.created', status: 'DEAD', attemptCount: 3, responseStatus: 503, createdAt: new Date().toISOString() }]
      else if (path.endsWith('/test')) body = { ok: false, status: 503, latencyMs: 10, snippet: 'Try later', error: null }
      else if (path === '/api/v1/features') body = {}
      else if (path === '/api/v1/settings') body = { tenant: { id: 7, name: 'Test' }, license: { hasKey: true, featureEntitlements: {}, integrationEntitlements: {} } }
      if (path.endsWith('/receipts') || path.endsWith('/deliveries')) {
        const cursor = query.get('beforeId')
        cursors.push({ path, cursor })
        body = cursor ? [{ ...body[0], id: 75 }] : Array.from({ length: 25 }, (_, index) => ({ ...body[0], id: 100 - index, ...(path.endsWith('/receipts') && index > 0 ? { errorCode: 'OTHER' } : {}) }))
      }
      if (path.endsWith('/receipts') && holdReceipt) {
        holdReceipt = false
        await new Promise(resolve => { releaseReceipt = resolve })
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
        released = true
        return
      }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    })
    const page = await context.newPage(); page.setDefaultTimeout(60000)
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${FRONTEND}/admin/webhooks`)
    try { await page.getByRole('button', { name: 'Refresh', exact: true }).click() } catch (error) { console.error('page', await page.locator('body').innerText(), errors); throw error }
    await page.getByRole('button', { name: 'Create first endpoint', exact: true }).click()
    const modal = page.locator('.n-modal').filter({ hasText: 'New inbound endpoint' })
    await modal.getByRole('button', { name: 'Create endpoint', exact: true }).click()
    assert.equal(creates, 0)
    await modal.getByPlaceholder('e.g. Host monitoring').fill('Monitor')
    await modal.getByRole('button', { name: 'Create endpoint', exact: true }).click()
    await page.getByText('Temporary creation failure', { exact: true }).waitFor()
    assert.equal(await modal.getByPlaceholder('e.g. Host monitoring').inputValue(), 'Monitor')
    await modal.getByRole('button', { name: 'Create endpoint', exact: true }).click()
    await page.keyboard.press('Enter')
    await modal.getByText(/inwh_test_only/).waitFor()
    assert.equal(creates, 2, 'One failed attempt and one successful creation')
    assert.equal(await modal.getByRole('button', { name: 'Create endpoint', exact: true }).count(), 0)
    await page.setViewportSize({ width: 390, height: 844 })
    const box = await modal.boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= 391, 'Inbound modal fits mobile width')
    await page.screenshot({ path: '/tmp/nodeaccess-webhooks-inbound.png', fullPage: true })
    await modal.getByRole('button', { name: 'Done', exact: true }).click()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.locator('tr').filter({ hasText: 'Monitor' }).getByRole('button', { name: 'Edit', exact: true }).click()
    const editor = page.locator('.n-modal')
    await editor.getByPlaceholder('e.g. Host monitoring').fill('Monitor edited')
    await editor.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByText('Edit failed', { exact: true }).waitFor()
    assert.equal(await editor.getByPlaceholder('e.g. Host monitoring').inputValue(), 'Monitor edited')
    await editor.getByRole('button', { name: 'Save', exact: true }).click()
    await page.locator('tr').filter({ hasText: 'Monitor edited' }).getByRole('button', { name: 'Edit', exact: true }).click()
    await page.locator('.n-modal form').getByRole('button', { name: 'Rotate credentials', exact: true }).click()
    await page.locator('.n-dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    assert.equal(rotations, 0)
    await page.locator('.n-modal form').getByRole('button', { name: 'Rotate credentials', exact: true }).click()
    await page.locator('.n-dialog').getByRole('button', { name: 'Rotate credentials', exact: true }).click()
    await page.waitForFunction(() => [...document.querySelectorAll('.n-modal form button')].some(button => button.textContent.trim() === 'Save' && button.disabled))
    const rotationDeadline = Date.now() + 10000
    while (!finishRotation) { if (Date.now() > rotationDeadline) throw new Error('Rotation request did not start'); await page.waitForTimeout(20) }
    finishRotation()
    await page.getByText('rotated-hmac-secret', { exact: true }).waitFor()
    assert.equal(rotations, 1)
    await page.locator('.n-modal').getByRole('button', { name: 'Done', exact: true }).click()
    const row = page.locator('tr').filter({ hasText: 'Monitor edited' })
    await row.getByRole('button', { name: 'Pause', exact: true }).click()
    await page.getByText(/Error pausing|Failed to pause/).waitFor()
    await row.getByRole('button', { name: 'Pause', exact: true }).click()
    await row.getByRole('button', { name: 'Activate', exact: true }).waitFor()
    await row.getByRole('button', { name: 'Receipts', exact: true }).click()
    await page.getByText('INVALID_SIGNATURE', { exact: true }).waitFor()
    holdReceipt = true
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    const until = Date.now() + 10000
    while (!releaseReceipt) { if (Date.now() > until) throw new Error('Held request did not start'); await page.waitForTimeout(20) }
    receiptCode = 'NEW_RESULT'
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await page.getByText('NEW_RESULT', { exact: true }).waitFor()
    releaseReceipt()
    while (!released) { if (Date.now() > until) throw new Error('Held request did not finish'); await page.waitForTimeout(20) }
    await page.waitForTimeout(200)
    await page.getByText('NEW_RESULT', { exact: true }).waitFor()
    assert.equal(await page.getByText('INVALID_SIGNATURE', { exact: true }).count(), 0)

    await page.getByRole('button', { name: 'Load more', exact: true }).click()
    await page.getByRole('button', { name: 'Load more', exact: true }).waitFor({ state: 'hidden' })
    assert.ok(cursors.some(item => item.path.endsWith('/receipts') && item.cursor === '76'))
    await page.keyboard.press('Escape')
    await page.locator('tr').filter({ hasText: 'Outbound test' }).getByRole('button', { name: 'Deliveries', exact: true }).click()
    await page.getByText('503', { exact: true }).first().waitFor()
    await page.getByRole('button', { name: 'Load more', exact: true }).click()
    await page.getByRole('button', { name: 'Load more', exact: true }).waitFor({ state: 'hidden' })
    assert.ok(cursors.some(item => item.path.endsWith('/deliveries') && item.cursor === '76'))
    await page.screenshot({ path: '/tmp/nodeaccess-webhooks-deliveries.png', fullPage: true })
    await page.keyboard.press('Escape')
    await page.locator('tr').filter({ hasText: 'Outbound test' }).getByRole('button', { name: 'Edit', exact: true }).click()
    await page.locator('.n-modal').getByRole('button', { name: /Test/ }).click()
    await page.locator('.n-modal').getByText(/HTTP 503/).waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    const outboundBox = await page.locator('.n-modal').boundingBox()
    assert.ok(outboundBox.x >= 0 && outboundBox.x + outboundBox.width <= 391, 'Outbound modal fits mobile width')
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ ok: true, creates, scenarios: ['503 list retry', 'required fields', '503 preserves form', 'duplicate submit blocked', 'one-time token', 'mobile modal', 'pause failure and recovery', 'receipt signature error', 'outbound delivery failure', 'stale history response ignored', 'outbound connectivity error', 'outbound mobile modal', 'inbound edit recovery', 'rotation cancel and confirm', 'cursor pagination both histories'] }))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
