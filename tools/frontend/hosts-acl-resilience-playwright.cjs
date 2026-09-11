#!/usr/bin/env node
const { chromium } = require('playwright')

const TARGET_HOST = process.env.ACL_TARGET === 'host'
const TARGET_NODE = TARGET_HOST ? 811 : 810
const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')

function token(overrides = {}) {
  const now = Math.floor(Date.now() / 1000)
  const payload = { sub: '1', userId: 1, tenantId: 7, name: 'Admin', role: 'admin', email: 'admin@example.test', stage: 'authenticated', iat: now, exp: now + 3600, ...overrides }
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

let ownedBrowser
async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser' })
  ownedBrowser = browser
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  let delayedSearch
  let rejectSearch = true
  let rejectOwnAccess = true
  const ownRequests = []
  let delayedAlice
  let rejectList = true
  let rejectSave = true
  let rejectPreview = true
  let delayPreview = false
  let pendingPreview
  let writes = 0
  let rejectDelete = true
  let aclEntries = []
  let deleted = false
  let rejectNextDelete = true
  let filteredListRequests = 0
  const runtimeErrors = []

  await context.addInitScript((authToken) => {
    localStorage.setItem('na_access_token', authToken)
    localStorage.setItem('na_refresh_token', 'corporate-folders-harness')
    localStorage.setItem('na_hosts_default_view', 'all')
  }, token())

  const handleApi = async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    let status = 200
    let body = []

    const emptyPermissions = { view: false, connect: false, edit: false, admin: false }
const inherited = path.includes('/nodes/800/') ? [] : [{ id: 999, inventoryNodeId: 800, inventoryNodeName: 'Raiz corporativa', principalType: 'GROUP', principalId: 301, principalName: 'Inherited Ops', permissions: { ...emptyPermissions, view: true }, inheritToChildren: true, local: false, canAdminOrigin: true }]
    if (path.endsWith('/effective-permissions/users/101')) { delayedAlice = route; return }
    if (path.endsWith('/effective-permissions/users/102')) return route.fulfill({ json: { ...emptyPermissions, explanation: { access: 'none', sourceCount: 0, localSourceCount: 0, inheritedSourceCount: 0, principalTypes: [] }, sources: [] } })
    if (path.endsWith('/my-access')) {
      ownRequests.push(request.url())
      if (rejectOwnAccess) { rejectOwnAccess = false; return route.fulfill({ status: 503, json: { message: 'Transient own access failure' } }) }
      return route.fulfill({ json: { ...emptyPermissions, view: true, edit: true, explanation: { access: 'edit', sourceCount: 0, localSourceCount: 0, inheritedSourceCount: 0, principalTypes: [] }, sources: [] } })
    }
    if (path.endsWith('/acl/users') || path === '/api/v1/users') {
      const search = url.searchParams.get('search') || ''
      if (search === 'old') { delayedSearch = route; return }
      if (search === 'new' && rejectSearch) { rejectSearch = false; return route.fulfill({ status: 503, json: { message: 'Search unavailable' } }) }
      const extra = [{ id: 205, name: 'Beyond first page', email: 'beyond@example.test' }]
      return route.fulfill({ json: { data: search === 'new' || url.searchParams.get('page') === '2' ? extra : [{ id: 101, name: 'Alice Ops' }, { id: 102, name: 'Bob Isolated' }], total: search === 'new' ? 1 : 3 } })
    }
    if (path === '/api/v1/groups') return route.fulfill({ json: [{ id: 301, name: 'Ops Group' }] })
    if (path === '/api/v1/inventory/hosts/21/node') return route.fulfill({ json: { id: 811 } })
    if (path.endsWith('/acl/impact-preview')) {
      if (rejectPreview) { rejectPreview = false; return route.fulfill({ status: 503, json: { message: 'Preview unavailable' } }) }
      const dto = request.postDataJSON()
      if (delayPreview) { delayPreview = false; pendingPreview = { route, dto }; return }
      return route.fulfill({ json: { ...dto, inventoryNodeId: TARGET_NODE, affectedHostCount: 1, activeSessionCount: 0, before: null, after: dto.permissions, mayRevokeConnect: false,
        remainingAccess: { scope: 'item', usersEvaluated: 1, retainConnect: 1, loseConnect: 0, examples: [{ userId: 101, name: 'Alice Ops', before: { ...emptyPermissions, view: true, connect: true }, after: { ...emptyPermissions, view: true, connect: true }, remainingSources: ['Ops Group · Parent folder'] }] } } })
    }
    if (method === 'DELETE' && path.includes('/acl/')) {
      if (rejectDelete) { rejectDelete = false; return route.fulfill({ status: 500, json: { message: 'Revoke unavailable' } }) }
      aclEntries = aclEntries.filter(entry => !path.endsWith(`/acl/${entry.principalType}/${entry.principalId}`))
      return route.fulfill({ status: 204 })
    }
    if (path.endsWith('/acl')) {
      if (method === 'GET') {
        if (rejectList) { rejectList = false; return route.fulfill({ status: 500, json: { message: 'ACL unavailable' } }) }
        return route.fulfill({ json: [...inherited, ...aclEntries] })
      }
      if (method === 'PUT') {
        if (!path.endsWith(`/nodes/${TARGET_NODE}/acl`)) throw new Error('ACL saved on the wrong inventory node')
        writes++
        if (rejectSave) { rejectSave = false; return route.fulfill({ status: 403, json: { message: 'Permission revoked while editing' } }) }
        const dto = request.postDataJSON()
        aclEntries = [...aclEntries.filter(entry => entry.principalType !== dto.principalType || entry.principalId !== dto.principalId), { ...dto, id: dto.principalId, inventoryNodeId: TARGET_NODE, inventoryNodeName: host.name, principalName: dto.principalType === 'USER' ? 'Alice Ops' : 'Ops Group', local: true, inheritToChildren: true, createdAt: host.createdAt, updatedAt: host.updatedAt }]
        return route.fulfill({ json: [...inherited, ...aclEntries] })
      }
    }
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
  }
  await context.route('**/api/v1/**', handleApi)

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

  await folder.click()
  if (TARGET_HOST) {
    const card = page.locator('[data-host-id="21"]').first()
    await card.locator('[data-host-actions-button="true"]').click()
    await page.locator('.n-dropdown-menu:visible').last().getByText(/^ACL corporativa$|^Corporate ACL$/i).click()
  } else {
    await folder.click({ button: 'right' })
    await page.locator('.n-dropdown-menu:visible').last().getByText(/Gerenciar permissões|Manage permissions/i).click()
  }
  const modal = page.locator('.acl-modal-body')
  await modal.getByText('ACL unavailable', { exact: false }).first().waitFor()
  await modal.getByRole('button', { name: /Tentar novamente|Try again|Retry/ }).click()
  const effective = modal.locator('section[aria-labelledby="acl-effective-title"]')
  await effective.locator('.n-select').click()
  await page.getByText('Alice Ops', { exact: true }).last().click()
  for (let i = 0; !delayedAlice && i < 100; i++) await page.waitForTimeout(20)
  if (!delayedAlice) throw new Error('Alice request not started')
  await effective.locator('.n-select').click()
  await page.getByText('Bob Isolated', { exact: true }).last().click()
  await effective.locator('.acl-diagnosis').waitFor()
  const bobDiagnosis = await effective.locator('.acl-diagnosis').innerText()
  await delayedAlice.fulfill({ json: { view: true, connect: true, edit: true, admin: true, explanation: { access: 'admin', sourceCount: 1, localSourceCount: 1, inheritedSourceCount: 0, principalTypes: ['USER'] }, sources: [] } })
  await page.waitForTimeout(300)
  if (await effective.locator('.acl-diagnosis').innerText() !== bobDiagnosis) throw new Error('Alice response replaced Bob permissions')
  const grant = modal.locator('.acl-grant')
  await grant.locator('.n-select').nth(1).click()
  await page.getByText('Ops Group', { exact: true }).last().click()
  const save = grant.getByRole('button', { name: /Salvar ACL|Save ACL/ })
  await save.click()
  await page.getByText('Preview unavailable', { exact: true }).waitFor()
  if (writes) throw new Error('Failed preview wrote ACL')
  await save.click()
  let dialog = page.locator('.n-dialog:visible').last()
  await dialog.getByRole('button', { name: /Cancelar|Cancel/ }).click()
  if (writes) throw new Error('Canceled preview wrote ACL')
  await save.click()
  dialog = page.locator('.n-dialog:visible').last()
  await dialog.getByRole('button', { name: /Confirmar|Confirm/ }).click()
  await page.getByText('Permission revoked while editing', { exact: true }).waitFor()
  if (aclEntries.length) throw new Error('Failed save changed entries')
  await save.click()
  await page.locator('.n-dialog:visible').last().getByRole('button', { name: /Confirmar|Confirm/ }).click()
  await modal.locator('section[aria-labelledby="acl-local-title"]').getByText('Ops Group', { exact: true }).waitFor()
  if (writes !== 2 || aclEntries.length !== 1) throw new Error('Retry did not preserve one grant')
  await grant.locator('.n-select').first().click()
  await page.locator('.n-base-select-option').filter({ hasText: /^(Usuário|User)$/ }).click()
  await grant.locator('.n-select').nth(1).click()
  await page.getByText('Alice Ops', { exact: true }).last().click()
  await grant.locator('.n-checkbox').nth(3).click()
  delayPreview = true
  await save.click()
  for (let i = 0; !pendingPreview && i < 100; i++) await page.waitForTimeout(20)
  if (!pendingPreview) throw new Error('Delayed preview not requested')
  // Change the form while the server computes the original preview.
  await grant.locator('.n-select').first().click()
  await page.locator('.n-base-select-option').filter({ hasText: /^(Grupo|Group)$/ }).click()
  await grant.locator('.n-select').nth(1).click()
  await page.getByText('Ops Group', { exact: true }).last().click()
  await pendingPreview.route.fulfill({ json: { ...pendingPreview.dto, inventoryNodeId: TARGET_NODE, affectedHostCount: 1, activeSessionCount: 0, before: null, after: pendingPreview.dto.permissions, mayRevokeConnect: false } })
  await page.locator('.n-dialog:visible').last().getByRole('button', { name: /Confirmar|Confirm/ }).click()
  const local = modal.locator('section[aria-labelledby="acl-local-title"]')
  await local.getByText('Alice Ops', { exact: true }).waitFor()
  const direct = aclEntries.find(entry => entry.principalType === 'USER')
  if (!direct || !Object.values(direct.permissions).every(Boolean)) throw new Error('Admin grant did not include all permissions')
  const groupRow = local.locator('tr').filter({ hasText: 'Ops Group' })
  await groupRow.getByRole('button', { name: /Revogar|Revoke/ }).click()
  dialog = page.locator('.n-dialog:visible').last()
  await dialog.locator('[data-acl-remaining]').getByText('Ops Group · Parent folder', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: /Revogar|Revoke/ }).click()
  await page.getByText('Revoke unavailable', { exact: true }).waitFor()
  if (aclEntries.length !== 2) throw new Error('Failed revoke removed an entry')
  await dialog.getByRole('button', { name: /Revogar|Revoke/ }).click()
  await local.getByText('Ops Group', { exact: true }).waitFor({ state: 'detached' })
  await local.getByText('Alice Ops', { exact: true }).waitFor()
  if (aclEntries.length !== 1 || aclEntries[0].principalType !== 'USER') throw new Error('Revocation changed another principal')
  // Edit the existing individual rule without selecting the principal again.
  await local.locator('tr').filter({ hasText: 'Alice Ops' }).getByRole('button', { name: /Editar|Edit/ }).click()
  await page.waitForTimeout(100)
  if (await grant.locator('.n-checkbox--checked').count() !== 4) throw new Error('Edit did not prefill permissions')
  await grant.locator('.n-checkbox').nth(3).click()
  await grant.locator('.n-checkbox').nth(1).click()
  await save.click()
  await page.locator('.n-dialog:visible').last().getByRole('button', { name: /Confirmar|Confirm/ }).click()
  await page.waitForTimeout(200)
  if (aclEntries.length !== 1 || aclEntries[0].permissions.connect || !aclEntries[0].permissions.edit) throw new Error('Editing duplicated the rule or conflated Edit and Connect')

  // Server pagination, error/retry and an old search arriving after the new one.
  await effective.getByRole('button', { name: /Load more users|Carregar mais usuários/ }).click()
  await effective.locator('.n-select').click()
  await page.getByText('Beyond first page · beyond@example.test', { exact: true }).last().waitFor()
  const searchInput = effective.locator('input').first()
  await searchInput.fill('old')
  for (let i = 0; !delayedSearch && i < 100; i++) await page.waitForTimeout(20)
  if (!delayedSearch) throw new Error('Delayed search was not requested')
  await searchInput.fill('new')
  await effective.getByText(/Unable to search users|Não foi possível buscar usuários/).waitFor()
  await page.keyboard.press('Escape')
  await effective.getByRole('button', { name: /Try again|Tentar novamente/ }).click()
  await effective.locator('.n-select').click()
  await page.getByText('Beyond first page · beyond@example.test', { exact: true }).last().waitFor()
  await delayedSearch.fulfill({ json: { data: [{ id: 9999, name: 'STALE USER' }], total: 1 } })
  await page.waitForTimeout(100)
  if (await page.getByText('STALE USER', { exact: true }).count()) throw new Error('Stale search overwrote current users')
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(300)
  const bounds = await modal.boundingBox()
  if (!bounds || bounds.x < 0 || bounds.x + bounds.width > 390) throw new Error('ACL modal does not fit mobile viewport')
  await page.screenshot({ path: '/tmp/nodeaccess-acl-resilience.png' })
  // Navigate to the ancestor through its own authorized origin action.
  await page.setViewportSize({ width: 1440, height: 900 })
  await modal.getByRole('button', { name: /Manage in folder Raiz corporativa|Gerenciar na pasta Raiz corporativa/ }).click()
  await page.waitForFunction(() => document.querySelector('.n-card-header__main')?.textContent?.includes('Raiz corporativa'))
  await modal.locator('section[aria-labelledby="acl-inherited-title"]').getByText(/No inherited ACL|Nenhuma ACL herdada/).waitFor()

  // Ordinary users can inspect their own actions without browsing ACL principals.
  const userContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await userContext.addInitScript(authToken => { localStorage.setItem('na_access_token', authToken); localStorage.setItem('na_hosts_default_view', 'all') }, token({ sub: '102', userId: 102, role: 'user', canManageHosts: false }))
  const userRequests = []
  await userContext.route('**/api/v1/**', route => { userRequests.push(new URL(route.request().url()).pathname); return handleApi(route) })
  const userPage = await userContext.newPage()
  await userPage.goto(`${FRONTEND}/hosts`)
  const userToggle = userPage.getByRole('button', { name: /Corporate folders|Pastas corporativas/ })
  if (await userToggle.getAttribute('aria-expanded') === 'false') await userToggle.click()
  await userPage.locator('[data-corporate-folder-node-id="810"]').click()
  await userPage.locator('[data-host-id="21"]').first().locator('[data-host-actions-button="true"]').click()
  await userPage.locator('.n-dropdown-menu:visible').last().getByText(/My access|Meu acesso/, { exact: true }).click()
  const own = userPage.locator('.my-host-access-modal')
  await own.getByText(/Unable to retrieve your access|Não foi possível consultar seu acesso/).waitFor()
  await own.getByRole('button', { name: /Try again|Tentar novamente/ }).click()
  await own.locator('[data-acl-permission-summary]').waitFor()
  const ownText = await own.innerText()
  if (!/Connect: Not allowed|Conectar: Não permitido/.test(ownText) || !/Edit: Allowed|Editar: Permitido/.test(ownText)) throw new Error('My access conflated Edit and Connect')
  if (userRequests.some(path => path.includes('/acl') || path === '/api/v1/users')) throw new Error('My access requested other users or full ACL')
  if (ownRequests.length !== 2 || ownRequests.some(url => new URL(url).searchParams.has('userId'))) throw new Error('My access impersonation or retry issue')
  await userContext.close()
  if (runtimeErrors.length) throw new Error(runtimeErrors.join(' | '))
  console.log(JSON.stringify({ ok: true, target: TARGET_HOST ? 'host' : 'folder', loadRetry: true, outOfOrderUsers: true, previewFailure: true, cancellation: true, permissionRevokedDuringSave: true, saveRetry: true, individualAdminGrant: true, confirmedSnapshotPreserved: true, failedRevokePreservesGrants: true, groupRevokePreservesUser: true, editPrefills: true, paginatedSearch: true, staleSearchIgnored: true, remainingPreview: true, originNavigation: true, ownAccessPrivacy: true }))
  await browser.close()
}
main().catch(async error => { console.error(error); if (ownedBrowser) await ownedBrowser.close(); process.exitCode = 1 })
