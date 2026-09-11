#!/usr/bin/env node
const { chromium } = require('playwright')

const OUTCOME = process.env.IMPORT_TEST_OUTCOME || 'committed'
const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')

function token() {
  const now = Math.floor(Date.now() / 1000)
  const payload = { sub: '9', userId: 9, tenantId: 7, name: 'Admin', role: 'admin', email: 'admin@example.test', stage: 'authenticated', canManageHosts: true, iat: now, exp: now + 3600 }
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.harness`
}

function sshRecord(host, user) {
  const fields = Array.from({ length: 66 }, () => '')
  fields[0] = '#109#0'; fields[1] = host; fields[2] = '22'; fields[3] = user
  return fields.join('%')
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser' })
  try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  let previewPayload
  let previewCalls = 0
  let commitCalls = 0
  let releasePreview
  let signalPreview
  const heldPreview = new Promise(resolve => { signalPreview = resolve })
  const errors = []
  await context.addInitScript((authToken) => {
    localStorage.setItem('na_access_token', authToken)
    localStorage.setItem('na_refresh_token', 'duplicate-import-harness')
  }, token())

  await context.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    let body = []
    let status = 200
    if (path === '/api/v1/hosts/sidebar-bootstrap') body = { summary: { all: 0, global: 0, unfiled: 0, maxHosts: 100, folders: {}, groups: {}, tags: {} }, folders: [], groups: [], tags: [] }
    else if (path === '/api/v1/hosts') body = { data: [{
      id: 54, name: 'Mesmo endpoint, outro usuário', ip: 'duplicate.example.test', port: 22, accessProtocol: 'ssh', sshUser: 'auditor',
      authType: 'password', connectionMode: 'direct', scope: 'global', tags: [], associatedLinks: [], accessPermissions: { view: true, connect: true, edit: true, admin: true },
    }], total: 1, page: 1, limit: 500, totalPages: 1 }
    else if (path === '/api/v1/inventory') body = [{ id: 1, parentId: null, type: 'ROOT', hostId: null, name: 'Inventário', path: '/', depth: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]
    else if (path === '/api/v1/inventory/nodes/1/acl') body = [{ id: 1, inventoryNodeId: 1, inventoryNodeName: 'Inventário', principalType: 'GROUP', principalId: 1, principalName: 'Operações', permissions: { view: true, connect: true, edit: true, admin: false }, inheritToChildren: true, local: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]
    else if (path === '/api/v1/settings') body = { tenant: { id: 7, name: 'Acme', slug: 'acme' }, license: { maxUsers: 20, maxHosts: 100, activeUsers: 1, registeredHosts: 1, hasKey: true, featureEntitlements: {}, integrationEntitlements: {} } }
    else if (path === '/api/v1/groups' || path === '/api/v1/folders' || path === '/api/v1/pem-keys' || path === '/api/v1/bastions') body = []
    else if (path === '/api/v1/features') body = {}
    else if (path === '/api/v1/sessions/access-map') body = { generatedAt: new Date().toISOString(), refreshAfterSeconds: 30, totals: { activeSessions: 0, activeHosts: 0, uniqueUsers: 0, concurrentHosts: 0 }, hosts: [] }
    else if (path === '/api/v1/host-imports/history') { body = { items: [], total: 0 }; if (OUTCOME === 'history-failure' && commitCalls > 1) { status = 503; body = { message: 'History unavailable' } } }
    else if (path === '/api/v1/host-imports/preview') {
      previewCalls++
      previewPayload = request.postDataJSON()
      const [fresh, duplicate] = previewPayload.hosts
      body = {
        previewId: '11111111-1111-4111-8111-111111111111', expiresAt: new Date(Date.now() + 900000).toISOString(),
        summary: { detected: 2, ready: 1, blocked: 0, foldersToCreate: 1, aclMappings: 0, warnings: 1, credentialsDetected: 0, credentialsToImport: 0, duplicates: 1, hostsToCreate: 1, hostsToUpdate: 0, hostsToSkip: 1, privateHostsViaAgent: 0, unresolvedBastions: 0, reversible: true },
        report: [
          { sourceId: fresh.sourceId, name: fresh.name, status: 'ready', destinationPath: `Inventário / ${fresh.folderPath.join(' / ')}`, warnings: [] },
          { sourceId: duplicate.sourceId, name: duplicate.name, status: 'duplicate', destinationPath: `Inventário / ${duplicate.folderPath.join(' / ')}`, warnings: ['duplicate-existing-host'], existingHostId: 55, existingHost: { id: 55, name: 'Servidor já cadastrado', ip: duplicate.ip, port: duplicate.port, sshUser: duplicate.sshUser, accessibleToActor: true } },
        ],
      }
      if (OUTCOME === 'csv-validation') {
        body.summary = { ...body.summary, detected: 3, ready: 3, duplicates: 0, warnings: 0, hostsToCreate: 3, hostsToSkip: 0 }
        body.report = previewPayload.hosts.map(host => ({ sourceId: host.sourceId, name: host.name, status: 'ready', destinationPath: 'Inventário', warnings: [] }))
      }
    } else if (path === '/api/v1/host-imports/commit') {
      commitCalls++
      if (commitCalls === 1) {
        status = 404
        body = { message: 'Preview expirado ou já utilizado' }
      } else {
      const [fresh, duplicate] = previewPayload.hosts
      body = { status: 'committed', createdHosts: 1, createdFolders: 1, createdSecrets: 0, appliedAclMappings: 0, rolledBackHosts: 0, rolledBackFolders: 0, rolledBackSecrets: 0, importId: 44, rows: [
        { sourceId: fresh.sourceId, name: fresh.name, status: 'created', message: 'Importado', hostId: 101 },
        { sourceId: duplicate.sourceId, name: duplicate.name, status: 'skipped', message: 'Duplicado ignorado', hostId: 55 },
      ] }
      if (OUTCOME === 'rolled_back' || OUTCOME === 'partially_rolled_back') {
        const partial = OUTCOME === 'partially_rolled_back'
        body = { ...body, status: OUTCOME, createdHosts: partial ? 1 : 0, createdFolders: 0, rolledBackHosts: partial ? 0 : 1, rows: [
          { sourceId: fresh.sourceId, name: fresh.name, status: partial ? 'failed' : 'rolled_back', hostId: 101, message: partial ? 'Alteração não desfeita; confira este host antes de tentar novamente' : 'Alteração desfeita' },
          { sourceId: 'commit', name: 'Importação', status: 'failed', message: 'Falha simulada de registro' },
        ] }
      }
      }
    }
    if (OUTCOME === 'stale-preview' && path === '/api/v1/host-imports/preview' && previewCalls === 1) {
      await new Promise(resolve => { releasePreview = resolve; signalPreview() })
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })

  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(20_000)
  await page.goto(`${FRONTEND}/hosts?duplicateImportHarness=${Date.now()}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /Importar Hosts|Import Hosts/ }).click()
  const modal = page.locator('.n-modal:visible').last()
  if (OUTCOME === 'csv-validation') {
    await modal.getByText('CSV', { exact: true }).click()
    await modal.locator('input[type="file"][accept=".csv,text/csv"]').setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('name,ip,port,sshUser\nValido,valid.example.test,22,root\nPorta invalida,port.example.test,22abc,root\nSem endereco,,22,root') })
    const validate = modal.getByRole('button', { name: /Validar importação|Validate import/ })
    await modal.locator('[data-import-malformed]').waitFor()
    if (await modal.locator('tbody tr').count() !== 3) throw new Error('CSV silently discarded an invalid row')
    if (!await validate.isDisabled() || previewCalls) throw new Error('Malformed CSV can be submitted')
    const portRow = modal.locator('tbody tr').filter({ hasText: 'Porta invalida' })
    await portRow.locator('[data-import-edit-host]').click()
    await modal.locator('[data-import-port-input]').fill('0')
    if (!await validate.isDisabled()) throw new Error('Invalid correction silently became port 22')
    await modal.locator('[data-import-port-input]').fill('2222')
    const addressRow = modal.locator('tbody tr').filter({ hasText: 'Sem endereco' })
    await addressRow.locator('[data-import-edit-host]').click()
    await modal.locator('[data-import-ip-input]').fill('fixed.example.test')
    await modal.locator('[data-import-malformed]').waitFor({ state: 'hidden' })
    if (!await validate.isEnabled()) throw new Error('Corrected CSV remains blocked')
    await validate.click()
    await modal.getByRole('button', { name: /Confirmar e importar|Confirm and import/ }).waitFor()
    if (previewPayload.hosts.length !== 3 || previewPayload.hosts[1].port !== 2222 || previewPayload.hosts[2].ip !== 'fixed.example.test') throw new Error('Corrected preview payload does not match edits')
    if (errors.length) throw new Error(errors.join(' | '))
    console.log(JSON.stringify({ ok: true, outcome: OUTCOME, invalidRowsPreserved: true, invalidPortBlocked: true, correctedPayloadVerified: true }))
    return
  }
  await modal.getByText('MobaXterm', { exact: true }).click()
  const fixture = `[Bookmarks]\nSubRep=Sercomtel\nServidor novo=${sshRecord('new.example.test', 'suporte')}\nServidor duplicado=${sshRecord('duplicate.example.test', 'suporte')}`
  await modal.getByLabel(/Selecionar arquivo de sessões MobaXterm|Select a MobaXterm sessions file/).setInputFiles({ name: 'duplicates.mxtsessions', mimeType: 'text/plain', buffer: Buffer.from(fixture) })

  await modal.locator('.na-status-success').filter({ hasText: /2 prontos|2 ready/ }).waitFor()
  await modal.getByText(/Jump Host.*não participa|Jump Host.*not part/i).first().waitFor()
  const duplicateRowBeforeServer = modal.locator('tbody tr').filter({ hasText: 'Servidor duplicado' })
  await duplicateRowBeforeServer.getByText(/Pronto|Ready/, { exact: true }).waitFor()
  if (OUTCOME === 'stale-preview') {
    await modal.getByRole('button', { name: /Validar importação|Validate import/ }).click()
    await heldPreview
    const editedRow = modal.locator('tbody tr').filter({ hasText: 'Servidor novo' })
    await editedRow.locator('[data-import-edit-host]').click()
    await modal.locator('[data-import-port-input]').fill('2222')
    await modal.locator('tr:has([data-import-port-input]) [data-import-edit-host]').click()
    const response = page.waitForResponse(r => r.url().endsWith('/host-imports/preview'))
    releasePreview()
    await response
  }
  await modal.getByRole('button', { name: /Validar importação|Validate import/ }).click()
  await modal.locator('.na-status-success').filter({ hasText: /1 pronto|1 ready/ }).waitFor()
  const duplicateSummary = modal.locator('.na-status-warning').filter({ hasText: /1 ignorado por duplicidade|1 skipped as duplicates/ })
  if (!await duplicateSummary.count()) throw new Error(`Resumo de duplicados ausente:\n${await modal.innerText()}`)
  if (await modal.getByText(/1 bloqueado|1 blocked/).count()) throw new Error('Duplicado ainda foi apresentado como bloqueado')
  const duplicateStatus = modal.locator('[data-import-server-status="duplicate"]')
  await duplicateStatus.waitFor()
  await duplicateStatus.click()
  await page.locator('.n-popover:visible').last().getByText(/Servidor já cadastrado.*duplicate\.example\.test:22.*suporte.*Jump Host/i).waitFor()
  await modal.getByLabel(/Filtrar hosts do preview|Filter preview hosts/).click()
  await page.getByText(/Duplicados|Duplicates/, { exact: true }).last().click()
  const duplicateRows = modal.locator('tbody tr')
  await modal.locator('tbody tr').filter({ hasText: 'Servidor duplicado' }).waitFor()
  if (await duplicateRows.count() !== 1 || !await duplicateRows.first().getByText('Servidor duplicado', { exact: true }).count()) {
    throw new Error(`Filtro autoritativo de duplicados não isolou a linha detectada apenas pelo servidor:\n${await modal.innerText()}`)
  }
  await modal.getByLabel(/Filtrar hosts do preview|Filter preview hosts/).click()
  await page.getByText(/Todos|All/, { exact: true }).last().click()
  const sessionsPreview = modal.locator('[data-import-sessions-preview="true"]')
  if ((await sessionsPreview.innerText()).includes('Servidor duplicado')) throw new Error('Preview de Sessões ainda inclui o duplicado ignorado')

  const confirmSummary = modal.locator('[data-import-confirm-summary="true"]')
  await confirmSummary.getByText(/1 criar|1 create/).waitFor()
  await confirmSummary.getByText(/1 ignorar por duplicidade|1 skip as duplicate/).waitFor()
  await confirmSummary.getByText(/0 com erro|0 with errors/).waitFor()
  const confirm = modal.getByRole('button', { name: /Confirmar e importar|Confirm and import/ })
  await confirm.focus()
  await confirm.press('Enter')
  const recovery = modal.locator('[data-import-preview-recovery="true"]')
  await recovery.getByText(/correções foram preservadas|edits were preserved/i).waitFor()
  await modal.locator('tbody tr').filter({ hasText: 'Servidor novo' }).waitFor()
  await modal.getByRole('button', { name: /Validar importação|Validate import/ }).click()
  if (previewCalls !== (OUTCOME === 'stale-preview' ? 3 : 2)) throw new Error(`Número inesperado de chamadas de preview: ${previewCalls}`)
  if (OUTCOME === 'stale-preview' && previewPayload.hosts[0].port !== 2222) throw new Error('Late preview lost the correction')
  await modal.getByRole('button', { name: /Confirmar e importar|Confirm and import/ }).click()
  if (OUTCOME === 'rolled_back' || OUTCOME === 'partially_rolled_back') {
    await modal.getByText(OUTCOME === 'rolled_back' ? /Importação cancelada.*alterações desfeitas|Import cancelled.*changes rolled back/i : /Importação interrompida.*reversão incompleta|Import interrupted.*rollback incomplete/i).waitFor()
    await modal.getByText('Falha simulada de registro', { exact: true }).waitFor()
    if (OUTCOME === 'partially_rolled_back') await modal.getByText(/Alguns recursos permaneceram|Some resources remain/).waitFor()
    await modal.getByRole('button', { name: /Validar importação|Validate import/ }).waitFor()
  } else {
    await modal.getByText(/1 importado.*1 ignorado por duplicidade.*0 falhas|1 imported.*1 skipped as duplicates.*0 failures/i).waitFor()
    if (await modal.getByText(/falharam|failed/i).count()) throw new Error('Resultado sem falhas ainda usa linguagem de erro')
  }
  await page.evaluate(() => { const original = URL.createObjectURL; URL.createObjectURL = blob => { window.__importReport = blob.text(); return original(blob) } })
  const downloadPromise = page.waitForEvent('download')
  await modal.getByRole('button', { name: /JSON/i }).last().click()
  const download = await downloadPromise
  if (!download.suggestedFilename().endsWith('.json')) throw new Error('Unexpected report format')
  const exported = JSON.parse(await page.evaluate(() => window.__importReport))
  if (exported.rows.find(row => row.hostId === 101)?.name !== 'Servidor novo') throw new Error('Report lost the persisted host identifier')
  if (errors.length) throw new Error(`Erros no browser: ${errors.join(' | ')}`)
  console.log(JSON.stringify({ ok: true, outcome: OUTCOME, exportedHostId: true, serverPreviewAuthoritative: true, authoritativeDuplicateFilter: true, sshUserIsPartOfIdentity: true, jumpHostIsExplicitlyExcluded: true, duplicateIsNotBlocked: true, duplicateExcludedFromSessionsPreview: true, expiredPreviewPreservesEdits: true, keyboardConfirmation: true, stickyDecisionSummary: true, skippedIsNotFailure: true }, null, 2))
  await context.close()
  } finally { await browser.close() }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
