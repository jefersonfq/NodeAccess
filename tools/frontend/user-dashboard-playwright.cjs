#!/usr/bin/env node
'use strict'

const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
const SCREENSHOT_DIR = process.env.USER_DASHBOARD_SCREENSHOT_DIR || ''

function token() {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: '1', userId: 1, tenantId: 1, name: 'Gestor', role: 'admin',
    email: 'gestor@example.test', stage: 'authenticated', iat: now, exp: now + 3600,
  }
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.harness`
}

const dashboard = {
  user: { id: 42, name: 'Ana Operacoes', email: 'ana.operacoes@example.test', role: 'user' },
  periodDays: 30,
  summary: {
    sessions: 28, activeSessions: 2, failedSessions: 3, hostsAccessed: 7,
    audits: 11, auditEvents: 146, bytesIn: 7340032, bytesOut: 2097152,
    sharedSessionsOwned: 2, sharedSessionsParticipated: 5,
  },
  daily: [
    { date: '2026-08-24', sessions: 2, failedSessions: 0 },
    { date: '2026-08-25', sessions: 6, failedSessions: 1 },
    { date: '2026-08-26', sessions: 4, failedSessions: 0 },
    { date: '2026-08-27', sessions: 7, failedSessions: 2 },
    { date: '2026-08-28', sessions: 5, failedSessions: 0 },
    { date: '2026-08-29', sessions: 4, failedSessions: 0 },
  ],
  topHosts: [
    { hostId: 1, hostName: 'ERP Producao', hostIp: '10.10.1.20', hostDeleted: false, count: 12, lastSeenAt: '2026-08-29T18:30:00.000Z' },
    { hostId: 2, hostName: 'Banco Financeiro', hostIp: '10.10.1.30', hostDeleted: false, count: 8, lastSeenAt: '2026-08-28T14:10:00.000Z' },
  ],
  auditPosture: { running: 1, completed: 8, failed: 1, purged: 1, riskHigh: 1, riskMedium: 2, riskLow: 5 },
  recentSessions: [
    { id: 991, hostName: 'ERP Producao', hostIp: '10.10.1.20', hostDeleted: false, startedAt: '2026-08-29T18:00:00.000Z', endedAt: '2026-08-29T18:30:00.000Z', active: false, connectionMethod: 'direct', errorCode: null },
    { id: 992, hostName: 'Banco Financeiro', hostIp: '10.10.1.30', hostDeleted: false, startedAt: '2026-08-28T14:00:00.000Z', endedAt: '2026-08-28T14:02:00.000Z', active: false, connectionMethod: 'agent', errorCode: 'SSH_TIMEOUT' },
  ],
  timeline: [
    { id: 'session-991', type: 'session', title: 'Sessao concluida', description: 'Acesso ao ERP Producao encerrado normalmente.', hostDeleted: false, occurredAt: '2026-08-29T18:30:00.000Z', severity: 'success', sessionId: 991 },
    { id: 'session-992', type: 'session', title: 'Falha de conexao', description: 'Tempo limite ao conectar no Banco Financeiro.', hostDeleted: false, occurredAt: '2026-08-28T14:02:00.000Z', severity: 'error', sessionId: 992 },
    { id: 'audit-11', type: 'audit', title: 'Risco alto identificado', description: 'Auditoria sinalizou uma operacao para revisao.', hostDeleted: false, occurredAt: '2026-08-27T16:40:00.000Z', severity: 'warning', sessionId: 988 },
    { id: 'sharing-5', type: 'sharing', title: 'Sessao compartilhada', description: 'Usuario participou de uma sessao acompanhada.', hostDeleted: false, occurredAt: '2026-08-26T10:20:00.000Z', severity: 'info', sessionId: 980 },
    { id: 'auth-7', type: 'auth', title: 'Login na plataforma', description: 'Acesso autenticado ao NodeAccess.', hostDeleted: false, occurredAt: '2026-08-25T08:10:00.000Z', severity: 'success', sessionId: null },
  ],
  previousPeriod: { sessions: 21, failedSessions: 5, hostsAccessed: 5, audits: 8 },
  cache: { enabled: true, hit: true, ttlSeconds: 60, generatedAt: '2026-08-30T12:00:00.000Z' },
}

async function createContext(browser, viewport) {
  const context = await browser.newContext({ viewport })
  await context.addInitScript(access => {
    localStorage.setItem('na_access_token', access)
    localStorage.setItem('na_refresh_token', 'dashboard-harness')
    localStorage.setItem('na_ui_theme_mode', 'dark')
  }, token())
  await context.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    const body = path === '/api/v1/user-dashboard/dashboard'
      ? dashboard
      : path === '/api/v1/features'
        ? {}
        : []
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  return context
}

async function validateViewport(browser, viewport, name) {
  const context = await createContext(browser, viewport)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(15_000)
  await page.goto(`${FRONTEND}/admin/dashboard/users/42?dashboardHarness=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })

  const summary = page.getByTestId('user-management-summary')
  const timeline = page.getByTestId('user-activity-timeline')
  await summary.getByText('Requer atencao', { exact: true }).waitFor()
  await page.getByText('89%', { exact: true }).waitFor()
  await timeline.waitFor()

  const summaryBox = await summary.boundingBox()
  const timelineBox = await timeline.boundingBox()
  const detailBox = await page.getByText('Postura de auditoria', { exact: true }).locator('..').locator('..').boundingBox()
  if (!summaryBox || !timelineBox || !detailBox || summaryBox.y >= timelineBox.y || timelineBox.y >= detailBox.y) {
    throw new Error(`Hierarquia visual incorreta em ${name}: ${JSON.stringify({ summaryBox, timelineBox, detailBox })}`)
  }

  await page.getByRole('button', { name: /2 sessoes em 24\/08.*Abrir relatorio/ }).click()
  await page.waitForURL(url => url.pathname.endsWith('/admin/reports/sessions')
    && url.searchParams.get('userId') === '42'
    && url.searchParams.get('dateFrom') === '2026-08-24T00:00:00.000Z'
    && url.searchParams.get('dateTo') === '2026-08-25T00:00:00.000Z')
  await page.goBack({ waitUntil: 'domcontentloaded' })
  await summary.getByText('Requer atencao', { exact: true }).waitFor()

  await timeline.getByRole('button', { name: 'Falhas 1' }).click()
  await timeline.getByText('Falha de conexao', { exact: true }).waitFor()
  if (await timeline.getByText('Sessao concluida', { exact: true }).count()) throw new Error('Filtro de falhas manteve eventos de sucesso')

  await timeline.getByRole('button', { name: 'Todos 5' }).click()
  await timeline.getByRole('button', { name: 'Acessos 1' }).click()
  await timeline.getByText('Login na plataforma', { exact: true }).waitFor()
  await timeline.getByRole('button', { name: 'Todos 5' }).click()
  await timeline.getByLabel('Buscar na timeline').locator('input').fill('auditoria')
  await timeline.getByText('Risco alto identificado', { exact: true }).waitFor()
  await timeline.getByText('1 de 5 evento(s) exibido(s)', { exact: true }).waitFor()
  await timeline.getByLabel('Buscar na timeline').locator('input').fill('')

  await timeline.getByLabel('Filtrar por severidade').click()
  await page.getByText('Atencao', { exact: true }).last().click()
  await timeline.getByText('Risco alto identificado', { exact: true }).waitFor()
  if (await timeline.getByText('Falha de conexao', { exact: true }).count()) throw new Error('Filtro de severidade nao restringiu a timeline')
  await page.keyboard.press('Escape')
  await timeline.getByText('Timeline do usuario', { exact: true }).click()

  const geometry = await page.locator('body').evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }))
  if (geometry.scrollWidth > geometry.clientWidth + 1) throw new Error(`Overflow horizontal em ${name}: ${JSON.stringify(geometry)}`)
  if (errors.length) throw new Error(`Erros no browser em ${name}: ${errors.join(' | ')}`)

  if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/user-dashboard-${name}.png`, fullPage: true })
  await context.close()
  return { viewport, geometry, hierarchy: { summaryY: summaryBox.y, timelineY: timelineBox.y, detailY: detailBox.y } }
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || chromium.executablePath(),
    args: ['--no-sandbox', '--disable-gpu'],
  })
  try {
    const desktop = await validateViewport(browser, { width: 1440, height: 960 }, 'desktop')
    const mobile = await validateViewport(browser, { width: 390, height: 844 }, 'mobile')
    console.log(JSON.stringify({ ok: true, desktop, mobile }, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
