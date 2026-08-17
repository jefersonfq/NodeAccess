#!/usr/bin/env node
const path = require('node:path')
const dotenv = require('dotenv')
const jwt = require('jsonwebtoken')
const { chromium } = require('playwright')

dotenv.config({ path: path.resolve(__dirname, '../../apps/backend/.env'), override: true })

const frontend = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5180').replace(/\/$/, '')
const host = {
  id: Number(process.env.HOST_ID || 7026),
  name: process.env.HOST_NAME || 'VPN KING HOST',
  ip: process.env.HOST_IP || '177.153.202.21',
  port: Number(process.env.HOST_PORT || 2251),
  authType: process.env.HOST_AUTH_TYPE || 'pem_password',
  accessProtocol: 'ssh',
}

function accessToken() {
  return jwt.sign({
    sub: '1', email: 'admin@nodeaccess.local', role: 'admin', isPlatformAdmin: true,
    tenantId: 1, canManageHosts: true, canViewLiveSessions: false,
    forcePasswordChange: false, sessionVersion: 0, stage: 'authenticated',
  }, process.env.JWT_SECRET, { expiresIn: '10m' })
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  await context.addInitScript(({ token, pendingHost }) => {
    localStorage.setItem('na_access_token', token)
    localStorage.setItem('na_refresh_token', 'live-readonly-harness')
    sessionStorage.setItem('na:pending-terminal-host', JSON.stringify(pendingHost))
  }, { token: accessToken(), pendingHost: host })

  const page = await context.newPage()
  const responses = []
  const errors = []
  const requests = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => { if (request.url().includes('/api/v1/')) requests.push(`${request.method()} ${new URL(request.url()).pathname}`) })
  page.on('response', async (response) => {
    if (!response.url().includes('/integrations/jira/session-policy')) return
    responses.push({ status: response.status(), body: await response.json().catch(() => null) })
  })
  await page.goto(`${frontend}/terminal?jiraBreakGlassLive=${Date.now()}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(8_000)

  const ticketModalVisible = await page.locator('[role="dialog"]').filter({ hasText: /ticket do atendimento/i }).isVisible().catch(() => false)
  const breakGlassVisible = await page.getByTestId('jira-break-glass').isVisible().catch(() => false)
  const matchingText = (await page.locator('body').innerText()).split('\n').filter((line) => /break.?glass|acesso emergencial|ticket do atendimento/i.test(line))
  const authorizationRequests = requests.filter((request) => request === 'POST /api/v1/integrations/jira/session-authorizations')
  const terminalContainers = await page.locator('[data-terminal-container="true"]').count()
  const report = { frontend, finalUrl: page.url(), bodyPreview: (await page.locator('body').innerText()).slice(0, 500), host, policyResponses: responses, ticketModalVisible, breakGlassVisible, matchingText, authorizationRequests, terminalContainers, requests: requests.slice(-30), errors }
  console.log(JSON.stringify(report))
  await browser.close()
  if (breakGlassVisible || ticketModalVisible || matchingText.length || authorizationRequests.length || !responses.length || !terminalContainers || errors.length) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
