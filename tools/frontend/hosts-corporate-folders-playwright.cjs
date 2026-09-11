#!/usr/bin/env node
const { chromium } = require('playwright')

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

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  let deleted = false
  let rejectNextDelete = true
  let filteredListRequests = 0
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
    const method = request.method()
    let status = 200
    let body = []

    if (path === '/api/v1/hosts/sidebar-bootstrap') {
      const count = deleted ? 0 : 1
      body = { summary: { all: count, global: count, unfiled: 0, maxHosts: 50, folders: {}, groups: {}, tags: {} }, folders: [], groups: [], tags: [] }
    } else if (path === '/api/v1/hosts') {
      if (url.searchParams.get('inventoryNodeId') === '810') filteredListRequests += 1
      body = { data: deleted ? [] : [host], total: deleted ? 0 : 1, page: 1, limit: 40, totalPages: deleted ? 0 : 1 }
    } else if (path === `/api/v1/hosts/${host.id}/delete-check`) {
      body = { canDelete: true, blockers: { sessions: 0, sessionAudits: 0, mcpInteractiveSessions: 0 } }
    } else if (path === `/api/v1/hosts/${host.id}` && method === 'DELETE') {
      if (rejectNextDelete) {
        rejectNextDelete = false
        status = 409
        body = { message: 'Exclusão bloqueada pelo teste' }
      } else {
        deleted = true
        status = 204
        body = null
      }
    } else if (path === '/api/v1/inventory') {
      body = deleted ? folderNodes : [...folderNodes, { id: 811, parentId: 810, type: 'HOST', hostId: host.id, name: host.name, path: `/Raiz corporativa/Produção corporativa/${host.name}`, depth: 2, createdAt: host.createdAt, updatedAt: host.updatedAt }]
    } else if (path === '/api/v1/sessions/access-map') {
      body = { generatedAt: new Date().toISOString(), refreshAfterSeconds: 30, totals: { activeSessions: 0, activeHosts: 0, uniqueUsers: 0, concurrentHosts: 0 }, hosts: [] }
    } else if (path === '/api/v1/features') body = {}
    else if (path === '/api/v1/settings') body = { tenant: { id: 7, name: 'Acme', slug: 'acme' }, license: { maxUsers: 10, maxHosts: 50, activeUsers: 1, registeredHosts: deleted ? 0 : 1, hasKey: true, featureEntitlements: {}, integrationEntitlements: {} } }
    else if (path === '/api/v1/groups' || path === '/api/v1/tags' || path === '/api/v1/folders' || path === '/api/v1/bastions' || path === '/api/v1/pem-keys') body = []

    await route.fulfill({ status, contentType: 'application/json', body: body == null ? '' : JSON.stringify(body) })
  })

  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  await page.goto(`${FRONTEND}/hosts?corporateFolderHarness=${Date.now()}`, { waitUntil: 'domcontentloaded' })

  const corporateToggle = page.getByRole('button', { name: /Pastas corporativas|Corporate folders/ })
  await corporateToggle.waitFor()
  if (await corporateToggle.getAttribute('aria-expanded') === 'false') await corporateToggle.click()
  const folder = page.locator('[data-corporate-folder-node-id="810"]')
  const treeHost = page.locator('.inventory-host-node-label').filter({ hasText: host.name })
  const toggleAll = page.locator('[data-corporate-folders-toggle-all="true"]')

  const actionAlignment = await page.evaluate(() => {
    const selectors = ['[data-corporate-folders-toggle-all="true"]']
    const boxes = selectors.map(selector => document.querySelector(selector)?.getBoundingClientRect())
    const header = document.querySelector('.sidebar-panel-row .sidebar-panel-toggle')?.getBoundingClientRect()
    return { tops: boxes.map(box => box?.top ?? -1), headerTop: header?.top ?? -2 }
  })
  if (new Set(actionAlignment.tops).size !== 1 || Math.abs(actionAlignment.tops[0] - actionAlignment.headerTop) > 1) {
    throw new Error(`Ações corporativas desalinhadas: ${JSON.stringify(actionAlignment)}`)
  }

  if (await toggleAll.getAttribute('data-corporate-folders-all-expanded') !== 'true') await toggleAll.click()
  if (await toggleAll.textContent() !== '−') throw new Error('Controle não mudou para recolher apó expandir tudo')
  await toggleAll.click()
  await page.waitForFunction(() => document.querySelector('.inventory-sidebar-tree')?.getAttribute('data-expanded-key-count') === '0')
  await treeHost.waitFor({ state: 'hidden' })
  if (await toggleAll.textContent() !== '＋') throw new Error('Controle não mudou para expandir apó recolher tudo')
  await toggleAll.focus()
  await toggleAll.press('Enter')
  await treeHost.waitFor()

  await toggleAll.click()
  const sidebarSearch = page.locator('.hosts-sidebar-panel input').first()
  await sidebarSearch.fill(host.name)
  await treeHost.waitFor()
  await sidebarSearch.fill('')
  await treeHost.waitFor({ state: 'hidden' })
  await toggleAll.click()
  await treeHost.waitFor()

  await folder.click()
  await page.locator(`[data-host-id="${host.id}"]`).waitFor()

  async function deleteFromCard() {
    const card = page.locator(`[data-host-id="${host.id}"]`).first()
    await card.locator('[data-host-actions-button="true"]').click()
    await page.locator('.n-dropdown-menu:visible').last().getByText(/Excluir|Delete/, { exact: true }).click()
    await page.locator('.n-dialog:visible').last().getByRole('button', { name: /Excluir|Delete/ }).click()
  }

  await deleteFromCard()
  await page.getByText('Exclusão bloqueada pelo teste', { exact: true }).waitFor()
  await page.locator(`[data-host-id="${host.id}"]`).waitFor()

  const requestsBeforeSuccess = filteredListRequests
  await deleteFromCard()
  await page.getByText(/Host excluído|Host deleted/, { exact: true }).waitFor()
  await page.locator(`[data-host-id="${host.id}"]`).waitFor({ state: 'detached' })
  await page.locator('.n-empty').first().waitFor()

  if (filteredListRequests <= requestsBeforeSuccess) throw new Error('A pasta corporativa não foi recarregada após a exclusão')
  if (runtimeErrors.length) throw new Error(`Erros no browser: ${runtimeErrors.join(' | ')}`)

  console.log(JSON.stringify({ ok: true, actionsAligned: true, expandCollapseAll: true, searchExpansionTemporary: true, keyboardActivation: true, failedDeletePreservedHost: true, successfulDeleteRemovedHost: true, corporateFolderRefetched: true, filteredListRequests }, null, 2))
  await context.close()
  await browser.close()
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
