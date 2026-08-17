#!/usr/bin/env node
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
const now = '2026-08-16T21:42:37.000Z'
const base = {
  id: 12, tenantId: 1, hostId: 7026, hostName: 'VPN KING HOST', hostIp: '177.153.202.21',
  requestedById: 1, requestedByName: 'Audit Admin', mcpTokenId: 33, mcpTokenName: 'full_governado',
  objective: 'Investigar postura de firewall sem alterar o host', status: 'WAITING_USER', expiresAt: '2026-08-16T22:42:37.000Z',
  lastActivityAt: now, closedAt: null, closeReason: null, createdAt: now,
  actionRuns: [{ id: 8, tenantId: 1, hostId: 7026, requestedById: 1, approvedById: 1, channel: 'mcp', mode: 'approval_required', status: 'completed', summary: 'Inspecionar iptables e Fail2Ban', approvalReason: 'Solicitado', errorMessage: null, startedAt: now, finishedAt: now, createdAt: now, updatedAt: now, scriptArtifactId: null, mcpTokenId: 33, investigationId: 12 }],
  reports: [],
}
const completed = { ...base, status: 'COMPLETED', closedAt: now, closeReason: 'user_confirmed', reports: [{
  id: 4, investigationId: 12, createdById: 1, provider: 'openai', model: 'gpt-test', summary: 'Firewall analisado; nenhuma alteração foi realizada.',
  facts: ['Política INPUT está ativa'], hypotheses: ['Fail2Ban pode precisar de ajuste'], risks: ['Porta administrativa exposta'],
  recommendations: ['Revisar allowlist'], actions: ['iptables -S'], evidence: [{ actionRunId: 8, stepIds: ['iptables-rules'] }],
  redactionApplied: true, checksum: 'a'.repeat(64), createdAt: now,
}] }

function token() {
  const payload = { sub: '1', tenantId: 1, role: 'admin', isPlatformAdmin: true, email: 'admin@example.test', stage: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 }
  return `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.harness`
}

async function mock(context, state) {
  await context.route('**/api/v1/**', async route => {
    const { pathname } = new URL(route.request().url())
    let body = []
    if (pathname === '/api/v1/ai-investigations') body = [{ ...base, actionRuns: [], reports: [], actionRunCount: 1 }]
    else if (pathname === '/api/v1/ai-investigations/12') body = state === 'completed' ? completed : base
    else if (pathname === '/api/v1/settings') body = { license: { aiSshActionsEnabled: true, mcpEnabled: true } }
    else if (pathname === '/api/v1/features') body = { featureMcp: true }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function validate(browser, viewport, state) {
  const context = await browser.newContext({ viewport })
  await mock(context, state)
  await context.addInitScript(value => localStorage.setItem('na_access_token', value), token())
  const page = await context.newPage(), errors = []
  page.setDefaultTimeout(10000)
  page.setDefaultNavigationTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${FRONTEND}/admin/ai-investigations`, { waitUntil: 'domcontentloaded' })
  try { await page.getByTestId('ai-investigations-list').waitFor({ timeout: 10000 }) }
  catch (error) { throw new Error(`Tela não carregou em ${page.url()}: ${(await page.locator('body').innerText()).slice(0, 800)} | ${errors.join(' | ')}`, { cause: error }) }
  await page.getByText('VPN KING HOST', { exact: false }).waitFor()
  await page.getByRole('button', { name: '#12' }).click()
  await page.getByTestId('ai-investigation-detail').waitFor()
  await page.getByText('full_governado', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Abrir comandos e saídas' }).waitFor()
  if (await page.getByText(/Playback/i).count()) throw new Error('Investigação apresentou playback inexistente')
  if (state === 'open') {
    await page.getByTestId('investigation-guidance').waitFor()
    if (!(await page.getByTestId('investigation-status').innerText()).includes('Aguardando sua decisão')) throw new Error('Decisão do usuário não está clara')
  } else {
    await page.getByTestId('investigation-reports').waitFor()
    for (const text of ['Fatos observados', 'Hipóteses — exigem validação', 'Próximos passos', 'ActionRun #8', 'Dados sensíveis mascarados']) await page.getByText(text, { exact: false }).first().waitFor()
    if (await page.getByTestId('investigation-guidance').count()) throw new Error('Investigação concluída ainda solicita decisão')
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
  if (overflow) throw new Error(`Overflow horizontal em ${viewport.width}px`)
  await context.close()
  const result = { viewport, state, tokenVisible: true, actionRunLinked: true, noFakePlayback: true }
  console.log(`[ok] ${viewport.width}x${viewport.height} ${state}`)
  return result
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || chromium.executablePath(), args: ['--no-sandbox', '--disable-gpu'] })
  try {
    const results = []
    for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
      results.push(await validate(browser, viewport, 'open'))
      results.push(await validate(browser, viewport, 'completed'))
    }
    console.log(JSON.stringify({ ok: true, results }, null, 2))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
