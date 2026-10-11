// Invoked by terminal-experience-playwright with TERMINAL_LIFECYCLE_REVIEW=1.
const assert = require('node:assert/strict')
module.exports = async function review({ page, context, frontend, host }) {
  page.setDefaultTimeout(15000)
  page.setDefaultNavigationTimeout(15000)
  const report = { scenarios: [] }
  const record = scenario => { report.scenarios.push(scenario); console.log(`PASS: ${scenario}`) }
  const sshCount = p => p.evaluate(() => window.__terminalExperience.sockets.filter(s => s.url.includes('/ws/ssh/')).length)
  const tab = () => page.locator('.terminal-tab').first()
  const menu = async (label, target = tab()) => {
    await target.click({ button: 'right' })
    await page.getByText(label, { exact: true }).last().click()
  }
  await page.waitForFunction(() => window.__terminalExperience.sockets.some(s => s.url.includes('/ws/ssh/') && s.readyState === 1))
  // Editing a file in an open SSH session must keep failures local to SFTP.
  await page.evaluate(() => { window.__terminalExperience.reviewFiles = true; window.__reviewDocumentId = 'same-document' })
  let readCount = 0
  const failures = [503, 502, 403]
  await context.route('**/api/v1/sftp/*/read**', route => {
    const status = readCount === 4 ? (readCount++, 503) : failures[readCount++]
    if (!status) return route.fulfill({ json: { content: 'mode=original', hash: 'original-hash', modifiedAt: '2026-09-23T00:00:00Z', size: 13, truncated: false } })
    return route.fulfill({ status, json: { message: `Falha SFTP simulada ${status}`, code: status === 403 ? 'SFTP_PERMISSION_DENIED' : 'SFTP_UNAVAILABLE' } })
  })
  await page.locator('[data-terminal-rail-action="files"]').click()
  await page.getByText('review.conf', { exact: true }).click({ button: 'right' }).catch(async error => { console.log(await page.evaluate(() => ({ body: document.body.innerText.slice(-2200), paths: window.__terminalExperience.sftpMessages }))); throw error })
  await page.getByRole('button', { name: 'Editar', exact: true }).click()
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).waitFor()
  const fileSockets = await sshCount(page)
  for (let i = 0; i < 2; i++) {
    const response = page.waitForResponse(r => r.url().includes('/sftp/') && r.url().includes('/read'))
    await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click()
    await response
    await page.getByRole('button', { name: 'Tentar novamente', exact: true }).waitFor()
  }
  assert.equal(readCount, 3)
  assert.equal(await sshCount(page), fileSockets)
  assert.equal(await page.evaluate(() => window.__reviewDocumentId), 'same-document')
  // Stub only Monaco rendering; exercise the real modal, requests and draft state.
  await page.evaluate(() => {
    window.monaco = { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 2 }, editor: { create(el, options) {
      const input = document.createElement('textarea'); input.dataset.testid = 'review-file-editor'; input.value = options.value; el.appendChild(input)
      return { getValue: () => input.value, onDidChangeModelContent: fn => input.addEventListener('input', fn), addCommand() {}, dispose() { input.remove() } }
    } } }
  })
  const writes = []
  await context.route('**/api/v1/sftp/*/write', route => {
    writes.push(route.request().postDataJSON())
    return route.fulfill(writes.length === 1 ? { status: 503, json: { message: 'Falha temporária ao salvar' } } : { json: { ok: true, hash: 'saved-hash', size: 12, modifiedAt: '2026-09-23T00:01:00Z' } })
  })
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click()
  const editor = page.getByTestId('review-file-editor')
  await editor.fill('mode=changed')
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).waitFor()
  assert.equal(await editor.inputValue(), 'mode=changed')
  assert.equal(await editor.isVisible(), true)
  assert.equal(readCount, 4, 'Failed save must not re-read the file and discard the draft')
  const metadataFailure = page.waitForResponse(r => r.url().includes('/read') && r.status() === 503)
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click(); await metadataFailure
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).waitFor()
  assert.equal(await editor.inputValue(), 'mode=changed')
  const saved = page.waitForResponse(r => r.url().includes('/read') && r.status() === 200)
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click(); await saved
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Salvar' && b.disabled))
  assert.equal(readCount, 6, 'Retry after committed write refreshes only concurrency metadata')
  assert.equal(writes.length, 2)
  assert.equal(writes[1].content, 'mode=changed')
  assert.equal(writes[1].expectedHash, 'original-hash')
  assert.equal(await sshCount(page), fileSockets)
  // Conflict and transport loss must preserve the user's draft and concurrency guard.
  let writeMode = 'conflict', releaseWrite
  await context.route('**/api/v1/sftp/*/write', async route => {
    writes.push(route.request().postDataJSON())
    if (writeMode === 'conflict') return route.fulfill({ status: 409, json: { message: 'Arquivo alterado por outro usuário', code: 'SFTP_FILE_CONFLICT' } })
    if (writeMode === 'offline') return route.abort('connectionfailed')
    await new Promise(resolve => { releaseWrite = resolve })
    return route.fulfill({ json: { ok: true } })
  })
  await editor.fill('mode=conflicting-draft')
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).waitFor()
  assert.equal(await editor.inputValue(), 'mode=conflicting-draft')
  assert.equal(writes.at(-1).expectedHash, 'original-hash')
  writeMode = 'offline'
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click()
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).waitFor()
  assert.equal(await editor.inputValue(), 'mode=conflicting-draft')
  writeMode = 'delayed'
  const pendingWrite = page.waitForRequest(r => r.url().includes('/sftp/') && r.url().endsWith('/write'))
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click(); await pendingWrite
  await editor.fill('mode=typed-while-saving')
  while (!releaseWrite) await page.waitForTimeout(10)
  const metadata = page.waitForResponse(r => r.url().includes('/sftp/') && r.url().includes('/read'))
  releaseWrite(); await metadata
  assert.equal(await editor.inputValue(), 'mode=typed-while-saving')
  assert.equal(await page.getByRole('button', { name: 'Salvar', exact: true }).isEnabled(), true)
  assert.equal(await sshCount(page), fileSockets)
  assert.equal(await page.evaluate(() => window.__reviewDocumentId), 'same-document')
  record('SFTP conflict 409, connection loss, delayed save and edits in flight preserve draft and SSH')
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  assert.equal(await editor.isVisible(), true, 'Declining discard must keep the unsaved editor open')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  await page.locator('[data-terminal-rail-action="files"]').click()
  record('SFTP editor read 503/502/403; save failure/retry retain draft, optimistic concurrency, SSH and document')

  let shareExpiresAt = Date.now() + 600000
  let viewerLeft = false
  let shareStatus = 'active', creates = 0, revokes = 0, pollFault = false, revokeFault = false
  const share = () => ({ id: 201, tenantId: 1, hostId: host.id, hostName: host.name, sessionId: 99101, status: shareStatus,
    expiresAt: new Date(shareExpiresAt).toISOString(), createdAt: new Date().toISOString(), owner: { userId: 1, name: 'Admin', email: null },
    participants: [
      { userId: 2, name: 'Viewer conectado', email: 'viewer@test', role: 'viewer', joinedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), leftAt: viewerLeft ? new Date().toISOString() : null },
      { userId: 3, name: 'Viewer que saiu', email: null, role: 'viewer', joinedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), leftAt: new Date().toISOString() },
      { userId: 4, name: 'Viewer sem heartbeat', email: null, role: 'viewer', joinedAt: new Date().toISOString(), lastSeenAt: new Date(Date.now() - 90000).toISOString(), leftAt: null },
    ], pendingControlRequestUserIds: [], activeControlLease: null, joinUrl: `${frontend}/shared/retained-token` })
  await context.route('**/api/v1/shared-sessions**', async route => {
    const method = route.request().method()
    if (method === 'POST') { creates++; shareStatus = 'active' }
    if (method === 'DELETE') {
      revokes++
      if (revokeFault) return route.fulfill({ status: 503, json: { message: 'temporary failure' } })
      shareStatus = 'revoked'; return route.fulfill({ status: 204, body: '' })
    }
    if (method === 'GET' && pollFault) return route.fulfill({ status: 503, json: { message: 'temporary failure' } })
    return route.fulfill({ json: share() })
  })
  const shareMenu = page.getByTestId('terminal-share-menu')
  await shareMenu.click()
  await page.getByText('Compartilhar sessão ao vivo', { exact: true }).last().click()
  await page.getByTestId('share-result-dialog').waitFor()
  await page.keyboard.press('Escape')
  await shareMenu.click()
  await page.getByText('Gerenciar ao vivo', { exact: true }).last().click()
  const viewers = page.getByTestId('shared-session-viewers')
  await viewers.getByText('Viewer conectado', { exact: false }).waitFor()
  await viewers.getByText('viewer@test', { exact: true }).waitFor()
  viewerLeft = true
  await viewers.getByText('Viewer conectado', { exact: false }).waitFor({ state: 'hidden' })
  viewerLeft = false
  await viewers.getByText('Viewer conectado', { exact: false }).waitFor()
  await page.keyboard.press('Escape')
  const manage = page.getByTestId('shared-session-manage')
  const color = await manage.evaluate(el => getComputedStyle(el).color)
  await manage.hover()
  assert.equal(await manage.evaluate(el => getComputedStyle(el).color), color)
  await manage.focus()
  assert.equal(await manage.evaluate(el => getComputedStyle(el).color), color)
  await manage.click()
  await viewers.waitFor()
  assert.equal(await manage.evaluate(el => getComputedStyle(el).color), color)
  record('manager color remains stable on hover/focus/click; viewer names/emails update after leaving and rejoining')
  assert.equal(creates, 1)
  assert.equal(await viewers.getByText('Viewer que saiu').count(), 0)
  assert.equal(await viewers.getByText('Viewer sem heartbeat').count(), 0)
  await page.getByRole('button', { name: 'Ver link atual', exact: true }).click()
  assert.equal(await page.locator('#terminal-share-link input').inputValue(), `${frontend}/shared/retained-token`)
  await page.getByTestId('share-result-dialog').getByRole('button', { name: 'Fechar', exact: true }).click()
  const beforeShareStop = await sshCount(page)
  await page.getByRole('button', { name: 'Encerrar compartilhamento', exact: true }).click()
  await page.getByRole('button', { name: 'Cancelar', exact: true }).last().click()
  assert.equal(revokes, 0)
  pollFault = true
  await page.waitForTimeout(3200)
  assert.equal(await viewers.isVisible(), true)
  pollFault = false
  revokeFault = true
  await page.getByRole('button', { name: 'Encerrar compartilhamento', exact: true }).click()
  await page.getByRole('button', { name: 'Encerrar compartilhamento', exact: true }).last().click()
  await page.getByText('Não foi possível encerrar o compartilhamento. Tente novamente.', { exact: true }).waitFor()
  revokeFault = false
  await page.getByRole('button', { name: 'Encerrar compartilhamento', exact: true }).last().click()
  await viewers.waitFor({ state: 'hidden' })
  assert.equal(await sshCount(page), beforeShareStop)
  assert.equal(await shareMenu.locator('.bg-amber-300').count(), 0)
  record('share reuse, current link, connected participants, polling failure, cancel, failed revoke and retry preserve SSH')
  shareExpiresAt = Date.now() + 2000
  await shareMenu.click()
  await page.getByText('Compartilhar sessão ao vivo', { exact: true }).last().click()
  await page.getByTestId('share-result-dialog').waitFor()
  await page.keyboard.press('Escape')
  pollFault = true
  shareStatus = 'ended'
  await page.getByRole('button', { name: 'Gerenciar ao vivo', exact: true }).waitFor({ state: 'hidden', timeout: 7000 })
  pollFault = false
  shareExpiresAt = Date.now() + 600000
  record('expiry clears manager and active indicator even while polling fails')

  const beforeNavigation = await sshCount(page)
  const terminalNode = await page.locator('[data-terminal-container="true"]').first().elementHandle()
  await page.locator('[data-terminal-display-mode="true"]').click()
  await page.locator('.n-dropdown-menu').last().getByText(/Padrão/, { exact: false }).click()
  await page.locator('.sidebar-menu-option-label').filter({ hasText: /^Hosts$/ }).click()
  await page.waitForURL(url => url.pathname === '/hosts')
  await page.locator('[data-open-sessions-sidebar="true"]').waitFor()
  assert.equal(await sshCount(page), beforeNavigation)
  await page.goBack()
  await page.waitForURL(url => url.pathname === '/terminal')
  await page.waitForFunction(node => node.isConnected, terminalNode)
  assert.equal(await terminalNode.evaluate(node => node.isConnected), true)
  assert.equal(await sshCount(page), beforeNavigation)
  assert.equal(await page.evaluate(() => window.__reviewDocumentId), 'same-document')
  record('SPA navigation to hosts and back preserves terminal DOM, document and SSH connection')

  await menu('Duplicar aba')
  await page.waitForFunction(() => document.querySelectorAll('.terminal-tab').length === 2)
  const beforeReorder = await sshCount(page)
  const nodes = await page.locator('.terminal-tab').elementHandles()
  await nodes[0].evaluate(el => { el.dataset.reviewIdentity = 'first' })
  await menu('Mover aba para a direita')
  assert.equal(await page.locator('.terminal-tab').last().getAttribute('data-review-identity'), 'first')
  await page.locator('.terminal-tab').last().dragTo(page.locator('.terminal-tab').first())
  assert.equal(await page.locator('.terminal-tab').first().getAttribute('data-review-identity'), 'first')
  assert.equal(await sshCount(page), beforeReorder)
  assert.equal(await page.locator('.terminal-tab-active').count(), 1)
  record('menu and drag reorder preserve terminal nodes, active tab and connections')

  await page.evaluate(() => { window.__reviewOpen = window.open; window.open = () => null })
  await menu('Abrir em janela separada')
  await page.getByText('O navegador bloqueou a nova janela.', { exact: true }).waitFor()
  assert.equal(await page.locator('.terminal-tab').count(), 2)
  await page.evaluate(() => { window.open = window.__reviewOpen })
  let requireJira = true
  await context.route('**/api/v1/integrations/jira/session-policy**', route => route.fulfill({ json: { enabled: requireJira, required: requireJira, breakGlassEnabled: false } }))
  let denyJira = true
  await context.route('**/api/v1/integrations/jira/session-authorizations', route => route.fulfill(denyJira ? { status: 403, json: { message: 'Ticket sem autorização' } } : { json: { sessionGrant: 'review-jira-grant', interactionId: 'review-interaction', ticketKey: 'OPS-123' } }))
  const popupPromise = page.waitForEvent('popup')
  await menu('Abrir em janela separada')
  const popup = await popupPromise
  await popup.getByPlaceholder('OPS-123', { exact: true }).fill('OPS-123')
  assert.equal(await sshCount(popup), 0, 'Popout must wait for Jira authorization')
  await popup.getByPlaceholder('OPS-123', { exact: true }).press('Enter')
  await popup.getByRole('alert').filter({ hasText: 'Ticket sem autorização' }).waitFor()
  assert.equal(await sshCount(popup), 0, 'Denied authorization must never open SSH')
  assert.equal(await page.locator('.terminal-tab').count(), 2)
  denyJira = false
  await popup.getByPlaceholder('OPS-123', { exact: true }).press('Enter')
  await popup.waitForFunction(() => window.__terminalExperience?.sockets.some(s => s.url.includes('/ws/ssh/') && s.readyState === 1))
  assert.equal(await page.locator('.terminal-tab').count(), 2)
  assert.equal(await popup.evaluate(() => window.__terminalExperience.sockets.some(s => s.url.includes('review-jira-grant'))), true)
  await popup.close()
  requireJira = false
  record('blocked popup preserves source; copy waits for Jira grant, connects independently and retains original')
  const movePromise = page.waitForEvent('popup')
  await menu('Mover para janela separada')
  const moved = await movePromise
  await moved.waitForFunction(() => window.__terminalExperience?.sockets.some(s => s.url.includes('/ws/ssh/') && s.readyState === 1))
  await page.waitForFunction(() => document.querySelectorAll('.terminal-tab').length === 1)
  const movedClosed = moved.waitForEvent('close')
  await moved.getByRole('button', { name: 'Inserir na janela principal', exact: true }).click()
  await movedClosed
  await page.waitForURL(url => url.pathname === '/terminal' && !url.search)
  record('move closes source only after connected; insert returns to main window')

  await tab().click()
  const beforeClose = await sshCount(page)
  await page.waitForFunction(() => window.__terminalExperience.sockets.filter(s => s.url.includes('/ws/ssh/')).at(-1)?.readyState === 1)
  await page.evaluate(() => window.__closeLatestSshRemote())
  await page.waitForFunction(() => document.body.textContent.includes('Pressione R para reconectar'))
  let input = page.locator('[data-terminal-container="true"]:visible .xterm-helper-textarea').first()
  await input.focus()
  for (const key of ['Control+c', 'Control+r', 'Alt+r', 'ArrowLeft', 'Escape', '1']) await input.press(key)
  assert.equal(await sshCount(page), beforeClose)
  await input.press('Shift+r')
  await page.waitForFunction(count => window.__terminalExperience.sockets.filter(s => s.url.includes('/ws/ssh/')).length === count + 1, beforeClose)
  await page.waitForFunction(() => window.__terminalExperience.sockets.filter(s => s.url.includes('/ws/ssh/')).at(-1)?.readyState === 1)
  await page.evaluate(() => window.__closeLatestSshRemote())
  await page.waitForFunction(() => document.body.textContent.includes('Pressione R para reconectar'))
  await input.focus(); await input.press('x')
  await page.waitForURL('**/dashboard**')
  record('remote close reason, R reconnect, modifiers safe, another letter returns to Home')
  assert.deepEqual(await page.evaluate(() => window.__terminalExperience.errors), [])
  const logRequests = []
  await context.route('**/api/v1/logs/**', route => { logRequests.push(new URL(route.request().url())); return route.fulfill({ json: { data: [], total: 0, page: 1, limit: 30 } }) })
  await page.goto(`${frontend}/admin/logs`)
  await page.locator('[aria-label="Tipo de evento"]').waitFor()
  await page.locator('[aria-label="Resultado"]').waitFor()
  assert.equal(await page.getByText('Por favor selecione', { exact: true }).count(), 0)
  const loginFilter = page.waitForResponse(r => r.url().includes('/logs/') && new URL(r.url()).searchParams.get('eventType') === 'LOGIN')
  await page.locator('[aria-label="Tipo de evento"]').click()
  await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
  await loginFilter
  assert.equal(logRequests.at(-1).searchParams.get('page'), '1')
  const clearFilter = page.waitForResponse(r => r.url().includes('/logs/') && !new URL(r.url()).searchParams.has('eventType'))
  await page.locator('[aria-label="Tipo de evento"]').click()
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter')
  await clearFilter
  record('log event filter works by keyboard, resets pagination and clears its request parameter')
  await page.getByText('Ações administrativas', { exact: true }).click()
  await page.locator('[aria-label="Filtro predefinido"]').waitFor()
  await page.locator('[aria-label="Tipo de recurso"]').waitFor()
  assert.equal(await page.getByText('Por favor selecione', { exact: true }).count(), 0)
  record('log filters describe their purpose and have accessible names')
  const errors = await page.evaluate(() => window.__terminalExperience.errors)
  assert.deepEqual(errors, [])
  report.runtimeErrors = errors
  return report
}
