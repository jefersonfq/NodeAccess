#!/usr/bin/env node
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
const CDP_URL = process.env.CHROMIUM_CDP_URL || ''

function token() {
  const now = Math.floor(Date.now() / 1000)
  const payload = { sub: '11', tenantId: 7, name: 'Admin', role: 'admin', email: 'admin@example.test', stage: 'authenticated', iat: now, exp: now + 3600 }
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.harness`
}

const eligibleHost = {
  id: 21, name: 'Gateway produção', description: null, ip: '10.0.0.21', port: 22, sshUser: 'ops',
  accessProtocol: 'ssh', operatingSystem: 'linux', authType: 'pem', pemKeyId: 4,
  hasPasswordCredential: false, onePasswordRef: null, connectionMode: 'direct', effectiveBastionId: null,
  groupId: null, folderId: null, tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}
const ineligibleHost = { ...eligibleHost, id: 22, name: 'Servidor via salto', effectiveBastionId: 90 }

async function main() {
  const browser = CDP_URL
    ? await chromium.connectOverCDP(CDP_URL)
    : await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser' })
  const state = { bastions: [], payloads: [] }
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  await context.addInitScript((authToken) => {
    localStorage.setItem('na_access_token', authToken)
    localStorage.setItem('na_refresh_token', 'harness')
  }, token())
  await context.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    let body = []
    let status = 200
    if (path === '/api/v1/bastions' && request.method() === 'POST') {
      const payload = request.postDataJSON()
      state.payloads.push(payload)
      const created = {
        id: 31, tenantId: 7, sourceHostId: 21, sourceType: 'host', name: eligibleHost.name,
        ip: eligibleHost.ip, port: eligibleHost.port, sshUser: eligibleHost.sshUser, authType: eligibleHost.authType,
        pemKeyId: 4, pemKeySource: 'registered', sourceHost: { id: 21, name: eligibleHost.name, ip: eligibleHost.ip, port: 22, connectionMode: 'direct' },
        usage: { directHostCount: 1, groupCount: 1, inheritedHostCount: 2, totalHostCount: 3, directHostNames: ['App 01'], groupNames: ['Produção'], inheritedHostNames: ['DB 01', 'DB 02'] },
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }
      state.bastions = [created]
      body = created
      status = 201
    } else if (path === '/api/v1/bastions') body = state.bastions
    else if (path === '/api/v1/hosts') body = { data: [eligibleHost, ineligibleHost], page: 1, limit: 200, total: 2, totalPages: 1 }
    else if (path === '/api/v1/hosts/sidebar-bootstrap') body = { summary: { all: 2, global: 2, unfiled: 0, maxHosts: 50, folders: {}, groups: {}, tags: {} }, folders: [], groups: [], tags: [] }
    else if (path === '/api/v1/inventory') body = []
    else if (path === '/api/v1/pem-keys') body = []
    else if (path === '/api/v1/features') body = { agentsLicensed: true, integrationsLicensed: true }
    else if (path === '/api/v1/settings') body = { tenant: { id: 7, name: 'Acme', slug: 'acme' }, license: { maxUsers: 10, maxHosts: 50, activeUsers: 1, registeredHosts: 2, hasKey: true, featureEntitlements: {}, integrationEntitlements: {} } }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })

  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(`${FRONTEND}/admin/bastions`, { waitUntil: 'networkidle' })
  await page.getByTestId('enable-host-bastion').click()
  const modal = page.locator('.n-modal').last()
  await modal.getByTestId('bastion-source-host').click()
  await page.getByText(/Gateway produção/).last().click()
  await modal.getByTestId('save-bastion').click()
  await page.getByTestId('bastions-table').getByText('Gateway produção').waitFor()
  const tableText = await page.getByTestId('bastions-table').innerText()
  if (!/Host cadastrado|Registered host|admin\.bastions\.source\.host/i.test(tableText)) throw new Error(`Origem do bastion ausente: ${tableText}`)
  if (!/1 host direto|1 direct host/i.test(tableText)) throw new Error(`Contagem de uso ausente: ${tableText}`)
  if (state.payloads.length !== 1 || JSON.stringify(state.payloads[0]) !== JSON.stringify({ sourceHostId: 21 })) {
    throw new Error(`Payload deve conter somente sourceHostId: ${JSON.stringify(state.payloads)}`)
  }

  await page.getByTestId('enable-host-bastion').click()
  await page.getByText(/Nenhum host elegível|No eligible host|admin\.bastions\.modal\.noEligibleHosts/i).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(500)
  const box = await page.locator('.n-modal').last().boundingBox()
  if (!box || box.x < 0 || box.x + box.width > 390) throw new Error(`Modal fora do viewport mobile: ${JSON.stringify(box)}`)

  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(`${FRONTEND}/hosts`, { waitUntil: 'networkidle' })
  await page.locator('[data-host-new-button="true"]').first().click()
  await page.getByText(/Routing and bastion|Roteamento e bastion/i).click()
  const roleBlock = page.getByTestId('host-bastion-role')
  await roleBlock.waitFor()
  await roleBlock.getByText(/Save the Host first|Salve o Host primeiro/i).waitFor()
  if (!await roleBlock.getByTestId('enable-host-bastion').isDisabled()) throw new Error('Ação de bastion deveria aguardar o primeiro salvamento')
  if (pageErrors.length) throw new Error(`Erros de UI: ${pageErrors.join(' | ')}`)

  console.log(JSON.stringify({ ok: true, cdp: !!CDP_URL, persisted: state.payloads.length, sourceOnly: true, mobile: true, hostConnectionEntry: true }))
  await context.close()
  await browser.close()
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
