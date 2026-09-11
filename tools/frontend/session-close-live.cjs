// Run after test:terminal-pty:real, against the same disposable HOST_ID/CDP browser.
const { chromium } = require('playwright')
const fs = require('node:fs')
const hostId = Number(process.env.HOST_ID)
const cdp = process.env.CDP_BASE || 'http://127.0.0.1:9362'
const frontend = process.env.FRONTEND_BASE || 'http://127.0.0.1:5176'
async function main() {
  if (!hostId) throw new Error('HOST_ID must identify the disposable test host')
  const browser = await chromium.connectOverCDP(cdp)
  try {
    const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith(frontend + '/terminal'))
    if (!page) throw new Error('Connect the disposable host in the CDP browser first')
    await page.bringToFront()
    const api = path => page.evaluate(async path => {
      const response = await fetch('/api/v1' + path, { headers: { Authorization: 'Bearer ' + localStorage.getItem('na_access_token') } })
      if (!response.ok) throw new Error('API status ' + response.status)
      return response.json()
    }, path)
    const before = await api('/sessions/access-map')
    const hostBefore = before.hosts.find(item => item.host.id === hostId)
    if (!hostBefore?.sessions?.length) throw new Error('Disposable session is not reported active before closing')
    const sessionId = await page.evaluate(() => window.__NODEACCESS_TERMINAL_HARNESS__?.events?.filter(event => event.name === 'terminal-ready').at(-1)?.sessionId)
    if (!hostBefore.sessions.some(item => item.id === sessionId)) throw new Error('Cannot identify the current terminal session')
    const ids = [sessionId]
    const summaryBefore = await api('/user-dashboard/summary')
    await page.locator(`[data-terminal-close-tab="${hostId}"]`).click()
    await page.waitForURL(url => url.pathname === '/hosts')
    const deadline = Date.now() + 8000
    let after
    do {
      after = await api('/sessions/access-map')
      if (!after.hosts.some(item => item.sessions.some(session => ids.includes(session.id)))) break
      await page.waitForTimeout(200)
    } while (Date.now() < deadline)
    if (after.hosts.some(item => item.sessions.some(session => ids.includes(session.id)))) throw new Error('Closed session still appears active')
    const summaryAfter = await api('/user-dashboard/summary')
    if (summaryAfter.activeSessions >= summaryBefore.activeSessions) throw new Error('Dashboard active count did not decrease')
    await page.goto(frontend + '/dashboard')
    await page.getByText(/Active sessions|Sessões ativas/i).first().waitFor()
    const client = await page.context().newCDPSession(page)
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync('/tmp/nodeaccess-session-close-dashboard.png', Buffer.from(screenshot.data, 'base64'))
    await client.detach()
    const result = { ok: true, hostId, closedSessionIds: ids, activeBefore: summaryBefore.activeSessions, activeAfter: summaryAfter.activeSessions }
    fs.writeFileSync(process.env.REPORT_PATH || '/tmp/nodeaccess-session-close-live.json', JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
