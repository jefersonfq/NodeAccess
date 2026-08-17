#!/usr/bin/env node
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
const SESSION_ID = 9908
const startedAt = '2026-08-16T21:42:37.000Z'
const commands = [
  { index: 1, command: 'iptables -S', output: '-P INPUT ACCEPT\n[NodeAccess exit=0]', submittedAt: startedAt, outputEndedAt: '2026-08-16T21:42:38.000Z', confidence: 'high', actorUserId: 1 },
  { index: 2, command: 'systemctl status netfilter-persistent --no-pager', output: 'Unit netfilter-persistent.service could not be found.\n[NodeAccess exit=4]', submittedAt: '2026-08-16T21:42:39.000Z', outputEndedAt: '2026-08-16T21:42:40.000Z', confidence: 'high', actorUserId: 1 },
]
const detail = {
  sessionId: SESSION_ID, tenantId: 1, userId: 1, userNameSnapshot: 'Audit Admin', userEmailSnapshot: 'admin@example.test',
  hostId: 7026, hostNameSnapshot: 'VPN KING HOST', hostIpSnapshot: '177.153.202.21', hostDeleted: false,
  connectionMethod: 'mcp_action_run', routeSnapshot: { auditKind: 'ai_action_run', actionRunId: 8, channel: 'mcp', mode: 'approval_required', mcpTokenId: 33, mcpTokenName: 'full_governado', approvedById: 1, hasPty: false },
  clientIp: null, userAgent: 'NodeAccess ActionRun/8', agentRemoteIp: null, ticketProvider: null, ticketKey: null, ticketUrl: null,
  startedAt, endedAt: '2026-08-16T21:42:44.000Z', status: 'FAILED', chunkCount: 1, commandCount: 2,
  bytesIn: 62, bytesOut: 112, aiSummaryStatus: 'PENDING', aiSummaryText: null, aiRiskLevel: null,
  aiSummaryStructured: null, criticalEvents: [], sharedSessionContext: null,
}

function token() {
  const payload = { sub: '1', tenantId: 1, role: 'admin', isPlatformAdmin: true, email: 'admin@example.test', stage: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }
  return `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.harness`
}

async function mock(context) {
  await context.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const p = url.pathname
    let body = []
    if (p === '/api/v1/session-audit') body = { data: [detail], total: 1, page: 1, limit: 20 }
    else if (p === `/api/v1/session-audit/${SESSION_ID}`) body = detail
    else if (p.endsWith('/commands')) body = commands
    else if (p.endsWith('/command-stats')) body = { total: 2, participants: [{ key: 'owner:1', userId: 1, name: 'Audit Admin', role: 'owner', count: 2 }] }
    else if (p.endsWith('/preview')) body = []
    else if (p === '/api/v1/settings') body = { license: { sessionAuditAiEnabled: false } }
    else if (p === '/api/v1/integrations/jira') body = { enabled: false, hasApiToken: false, healthStatus: 'unknown' }
    else if (p === '/api/v1/features') body = {}
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function validate(browser, viewport) {
  const context = await browser.newContext({ viewport })
  await mock(context)
  await context.addInitScript((value) => localStorage.setItem('na_access_token', value), token())
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${FRONTEND}/admin/session-audit`, { waitUntil: 'domcontentloaded' })
  await page.getByText('Automação IA/MCP', { exact: true }).waitFor()
  if (await page.getByRole('button', { name: /Playback/i }).count()) throw new Error('Automation row exposed terminal playback')
  await page.getByText('VPN KING HOST', { exact: true }).click()
  await page.getByTestId('automation-audit-banner').waitFor()
  await page.getByTestId('open-action-run').waitFor()
  if (!(await page.getByTestId('automation-audit-banner').innerText()).includes('full_governado')) throw new Error('MCP token trace is missing')
  if (await page.getByTestId('session-playback-panel').count()) throw new Error('Automation detail rendered fake terminal playback')
  const rows = page.locator('[data-audit-command-row="true"]')
  if (await rows.count() !== 2) throw new Error('Automation command timeline is incomplete')
  if (!(await rows.allTextContents()).join('\n').includes('iptables -S')) throw new Error('Commands are missing')
  const failedRow = page.locator('[data-audit-command-row="true"][data-command-index="2"]')
  if (!(await failedRow.getByTestId('automation-exit-code').innerText()).includes('exit 4')) throw new Error('Exit evidence is missing')
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`)
  const commandCount = await rows.count()
  await context.close()
  return { viewport, commands: commandCount, tokenVisible: true, playbackHidden: true }
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser' })
  try {
    const results = []
    for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) results.push(await validate(browser, viewport))
    console.log(JSON.stringify({ ok: true, results }, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
