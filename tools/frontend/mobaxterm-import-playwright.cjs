#!/usr/bin/env node
const fs = require('node:fs')
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5174').replace(/\/$/, '')
const UI_THEME = process.env.UI_THEME === 'light' ? 'light' : 'dark'
const SCREENSHOT_PATH = process.env.SCREENSHOT_PATH || `/tmp/nodeaccess-mobaxterm-import-${UI_THEME}.png`
const FIXTURE_PATH = process.env.MOBAXTERM_FIXTURE || 'imgs_debug/MobaXterm Sessions_personal_folders.mxtsessions'

function token() {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: '9', userId: 9, tenantId: 7, name: 'Administrador', role: 'admin', email: 'admin@example.test',
    stage: 'authenticated', canManageHosts: true, iat: now, exp: now + 3600,
  }
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.harness`
}

function sshRecord(host, port, user, jumpHost = '') {
  const fields = Array.from({ length: 66 }, () => '')
  fields[0] = '#109#0'; fields[1] = host; fields[2] = port; fields[3] = user
  if (jumpHost) { fields[8] = jumpHost; fields[9] = '22'; fields[10] = 'jump' }
  return fields.join('%')
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  let failPreview = false
  let previewCalls = 0
  let connectivityCalls = 0
  let bastionConnectivityCalls = 0
  let agentConnectivityCalls = 0
  let revertCalls = 0
  let lastPreviewPayload = null
  const browserErrors = []

  await context.addInitScript(({ authToken, theme }) => {
    localStorage.setItem('na_access_token', authToken)
    localStorage.setItem('na_refresh_token', 'mobaxterm-import-harness')
    localStorage.setItem('na_ui_theme_mode', theme)
  }, { authToken: token(), theme: UI_THEME })
  await context.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    let status = 200
    let body = []
    if (path === '/api/v1/hosts/sidebar-bootstrap') {
      body = { summary: { all: 0, global: 0, unfiled: 0, maxHosts: 100, folders: {}, groups: {}, tags: {} }, folders: [], groups: [], tags: [] }
    } else if (path === '/api/v1/hosts') {
      body = { data: [], total: 0, page: 1, limit: 20, totalPages: 0 }
    } else if (path === '/api/v1/inventory') {
      body = [{ id: 1, parentId: null, type: 'ROOT', hostId: null, name: 'Inventário', path: '/', depth: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]
    } else if (path === '/api/v1/inventory/nodes/1/acl') {
      body = [{ id: 1, inventoryNodeId: 1, inventoryNodeName: 'Inventário', principalType: 'GROUP', principalId: 1, principalName: 'Operações', permissions: { view: true, connect: true, edit: true, admin: false }, inheritToChildren: true, local: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]
    } else if (path === '/api/v1/settings') {
      body = { tenant: { id: 7, name: 'Acme', slug: 'acme' }, license: { maxUsers: 20, maxHosts: 100, activeUsers: 2, registeredHosts: 0, hasKey: true, featureEntitlements: {}, integrationEntitlements: {} } }
    } else if (path === '/api/v1/pem-keys') {
      body = [{ id: 31, name: 'sippulse', createdById: 9, createdAt: new Date().toISOString(), hasPassphrase: false }]
    } else if (path === '/api/v1/bastions') {
      body = [{ id: 8, sourceHostId: null, sourceType: 'legacy', sourceHost: null, name: 'Jump Pulse', ip: '192.168.1.27', port: 22, sshUser: 'jump', authType: 'pem', pemKeyId: null, systemPemKeyId: 31, pemKeySource: 'registered', createdAt: new Date().toISOString() }]
    } else if (path === '/api/v1/groups' || path === '/api/v1/folders') {
      body = []
    } else if (path === '/api/v1/features') {
      body = {}
    } else if (path === '/api/v1/sessions/access-map') {
      body = { generatedAt: new Date().toISOString(), refreshAfterSeconds: 30, totals: { activeSessions: 0, activeHosts: 0, uniqueUsers: 0, concurrentHosts: 0 }, hosts: [] }
    } else if (path === '/api/v1/host-imports/preview' && request.method() === 'POST') {
      previewCalls++
      if (failPreview) {
        failPreview = false; status = 500; body = { message: 'Falha simulada ao validar importação' }
      } else {
        const payload = request.postDataJSON()
        lastPreviewPayload = payload
        body = {
          previewId: '11111111-1111-4111-8111-111111111111', expiresAt: new Date(Date.now() + 900000).toISOString(),
          summary: { detected: payload.hosts.length, ready: payload.hosts.length, blocked: 0, foldersToCreate: 2, aclMappings: 0, warnings: 0, credentialsDetected: 0, credentialsToImport: 0, duplicates: 0, hostsToCreate: payload.hosts.length, hostsToUpdate: 0, hostsToSkip: 0, privateHostsViaAgent: payload.hosts.filter(host => host.connectionMode === 'agent_tenant_fallback').length, unresolvedBastions: payload.hosts.filter(host => host.requiresBastion && !host.bastionId).length, reversible: true },
          report: payload.hosts.map((host) => ({ sourceId: host.sourceId, name: host.name, status: 'ready', destinationPath: ['Inventário', ...host.folderPath].join(' / '), warnings: host.warnings })),
        }
      }
    } else if (path === '/api/v1/hosts/test-connection' && request.method() === 'POST') {
      connectivityCalls++
      if (request.postDataJSON().bastionId === 8) bastionConnectivityCalls++
      if (request.postDataJSON().connectionMode === 'agent_tenant_fallback') agentConnectivityCalls++
      body = { success: true, latencyMs: 12, message: 'Conectividade simulada', route: request.postDataJSON().bastionId ? 'bastion' : 'direct', failureStep: null }
    } else if (path === '/api/v1/host-imports/commit' && request.method() === 'POST') {
      body = { status: 'committed', createdHosts: 4, createdFolders: 2, createdSecrets: 0, appliedAclMappings: 0, rolledBackHosts: 0, rolledBackFolders: 0, rolledBackSecrets: 0, importId: 44, rows: lastPreviewPayload.hosts.map(host => ({ sourceId: host.sourceId, name: host.name, status: 'created', message: 'Importado', hostId: 100 })) }
    } else if (path === '/api/v1/host-imports/44/revert' && request.method() === 'POST') {
      revertCalls++; body = { status: 'reverted', revertedHosts: 4, revertedFolders: 2, failures: [] }
    } else if (path === '/api/v1/host-imports/history') {
      body = { items: [{ id: 44, source: 'mobaxterm', actorName: 'Administrador', timestamp: new Date().toISOString(), status: revertCalls ? 'reverted' : 'committed', createdHosts: 4, updatedHosts: 0, createdFolders: 2, canRevert: !revertCalls }], total: 1 }
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })

  const page = await context.newPage()
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.setDefaultTimeout(20_000)
  await page.goto(`${FRONTEND}/hosts?mobaxtermImportHarness=${Date.now()}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /Importar Hosts|Import Hosts/ }).click()
  const modal = page.locator('.n-modal:visible').last()
  await modal.waitFor()
  await modal.getByText('MobaXterm', { exact: true }).click()

  // Usuário real corrige uma sessão incompleta sem voltar ao arquivo de origem.
  const incomplete = `[Bookmarks]\nSubRep=Produção\nSem usuário=${sshRecord('missing-user.example.test', '22', '', 'jump.unknown.test')}`
  await modal.getByLabel(/Selecionar arquivo de sessões MobaXterm|Select a MobaXterm sessions file/).setInputFiles({
    name: 'incomplete.mxtsessions', mimeType: 'text/plain', buffer: Buffer.from(incomplete),
  })
  await modal.getByText(/1 bloqueado|1 blocked/).waitFor()
  await modal.locator('[data-import-edit-host]').click()
  await modal.locator('[data-import-user-input]').fill('deploy')
  await modal.getByRole('button', { name: /Concluir|Done/ }).click()
  await page.waitForTimeout(300)
  await modal.getByText(/jump.unknown.test/).first().waitFor()
  const unresolvedPolicy = modal.locator('[data-import-bastion-policy="true"]')
  await unresolvedPolicy.click()
  await page.getByText(/Importar sem bastion|Import without bastion/, { exact: false }).last().click()
  await modal.locator('.na-status-success', { hasText: /1 pronto|1 ready/ }).waitFor()

  // Recarrega o arquivo real e verifica preview, falha de rede recuperável e geometria do modal.
  await modal.locator('[data-import-universal-drop="true"] input[type="file"]').setInputFiles(FIXTURE_PATH)
  await modal.getByText(/4 sess(?:ão|ões) SSH|4 SSH session/).waitFor()
  await modal.locator('[data-import-sessions-preview="true"]').waitFor()
  const dependencies = modal.locator('[data-import-dependencies="true"]')
  await dependencies.waitFor()
  await dependencies.getByLabel(/Chave NodeAccess para ccs|NodeAccess key for ccs/).click()
  await page.getByText('sippulse', { exact: true }).last().click()
  await dependencies.getByText('jump@192.168.1.27', { exact: true }).waitFor()
  const routingPolicy = modal.locator('[data-import-routing-policy="true"]')
  await routingPolicy.waitFor()
  await routingPolicy.getByLabel(/Rota para hosts de IP privado|Route for private-IP hosts/).click()
  await page.getByText(/Via agente do tenant|Through tenant agent/, { exact: false }).last().click()

  // Revisa um lote, filtra a grade e executa o preflight sem bloquear a importação.
  await modal.getByLabel(/Filtrar hosts do preview|Filter preview hosts/).click()
  await page.getByText(/Com avisos|Warnings/, { exact: true }).last().click()
  if (await modal.locator('tbody tr').count() < 1) throw new Error('Filtro de avisos escondeu todas as linhas esperadas')
  await modal.getByLabel(/Filtrar hosts do preview|Filter preview hosts/).click()
  await page.getByText(/Todos|All/, { exact: true }).last().click()
  await modal.getByPlaceholder(/Usuário SSH em lote|Bulk SSH user/).fill('migration-user')
  await modal.getByRole('button', { name: /Aplicar aos selecionados|Apply to selected/ }).click()
  await modal.getByRole('button', { name: /Testar conexão dos prontos|Test ready connections/ }).click()
  await modal.getByText(/TCP acessível \(12 ms\)|TCP reachable \(12 ms\)/).first().waitFor()
  if (connectivityCalls !== 5) throw new Error(`Preflight esperava 4 TCPs e 1 autenticação PEM, recebeu ${connectivityCalls}`)
  if (bastionConnectivityCalls !== 2) throw new Error(`Preflight não testou TCP e autenticação pelo jumpserver detectado: ${bastionConnectivityCalls}`)
  if (agentConnectivityCalls !== 1) throw new Error(`Host privado sem bastion não foi testado pelo agente: ${agentConnectivityCalls}`)
  failPreview = true
  await modal.getByRole('button', { name: /Validar importação|Validate import/ }).click()
  await page.waitForTimeout(500)
  const failureText = await modal.innerText()
  if (previewCalls !== 1 || !/0 importados|0 imported/.test(failureText)) {
    throw new Error(`A falha do servidor não produziu feedback recuperável (chamadas=${previewCalls}):\n${failureText}`)
  }
  await modal.getByRole('button', { name: /Validar importação|Validate import/ }).click()
  await modal.getByText(/Preview validado pelo servidor|Server-validated preview/).waitFor()
  const impactPreview = modal.locator('[data-import-impact-preview="true"]')
  await impactPreview.locator('strong').first().getByText('4', { exact: true }).waitFor()
  await impactPreview.getByText(/hosts novos|new hosts/i).waitFor()
  await modal.getByText(/Reversão disponível|Revert available/i).waitFor()
  if (lastPreviewPayload?.duplicateStrategy !== 'skip' || lastPreviewPayload.hosts.some(host => host.sshUser !== 'migration-user')) {
    throw new Error(`Payload não refletiu estratégia/correção em lote: ${JSON.stringify(lastPreviewPayload)}`)
  }
  const kindlePayload = lastPreviewPayload.hosts.find(host => host.name === 'kindle 192.168.196.174')
  if (kindlePayload?.bastionId !== 8 || !lastPreviewPayload.hosts.some(host => host.pemKeyId === 31)) {
    throw new Error(`Dependências não chegaram ao preview: ${JSON.stringify(lastPreviewPayload.hosts)}`)
  }
  const termuxPayload = lastPreviewPayload.hosts.find(host => host.name.startsWith('Termux'))
  if (termuxPayload?.connectionMode !== 'agent_tenant_fallback' || lastPreviewPayload.hosts.filter(host => host.connectionMode === 'direct').length !== 3) {
    throw new Error(`Política de rede privada foi aplicada fora do escopo esperado: ${JSON.stringify(lastPreviewPayload.hosts)}`)
  }
  const persistedMappings = await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes('import-dependency-mappings')))
  if (persistedMappings.length) throw new Error(`Traduções do lote foram persistidas como aliases: ${persistedMappings.join(', ')}`)
  const downloadPromise = page.waitForEvent('download')
  await modal.getByRole('button', { name: /Baixar relatório JSON|Download JSON report/ }).click()
  const download = await downloadPromise
  if (!download.suggestedFilename().endsWith('.json')) throw new Error(`Relatório inválido: ${download.suggestedFilename()}`)
  await modal.getByText(/4 criados|4 created/).waitFor()
  await modal.getByRole('button', { name: /Confirmar e importar|Confirm and import/ }).click()
  const undo = modal.locator('[data-import-undo="true"]')
  await undo.waitFor()
  page.once('dialog', dialog => dialog.accept())
  await undo.click()
  await modal.locator('[data-import-revert-feedback="true"]').waitFor()
  if (revertCalls !== 1) throw new Error('Ação pós-sucesso não reverteu a importação')
  const recoveredText = await modal.innerText()
  if (recoveredText.includes('Falha simulada ao validar importação')) {
    throw new Error(`O erro da tentativa anterior permaneceu visível apó a recuperação:\n${recoveredText}`)
  }

  const visual = await modal.evaluate((element) => {
    const content = element.querySelector('.n-card__content')
    const box = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const contentStyle = content ? getComputedStyle(content) : null
    return {
      backgroundColor: style.backgroundColor,
      modalBottom: box.bottom,
      viewportHeight: innerHeight,
      overflowY: contentStyle?.overflowY,
      modalOverflowY: style.overflowY,
      contentClientHeight: content?.clientHeight,
      contentScrollHeight: content?.scrollHeight,
    }
  })
  if (/rgba\([^)]*,\s*0\)|transparent/.test(visual.backgroundColor)) throw new Error(`Modal transparente: ${JSON.stringify(visual)}`)
  if (visual.modalBottom > visual.viewportHeight + 1) throw new Error(`Modal ultrapassa viewport: ${JSON.stringify(visual)}`)
  if (![visual.overflowY, visual.modalOverflowY].some(value => ['auto', 'scroll'].includes(value))) {
    throw new Error(`Conteúdo sem scroll interno: ${JSON.stringify(visual)}`)
  }

  let lightTheme = null
  if (UI_THEME === 'light') {
    lightTheme = await modal.evaluate((element) => {
      const parseRgb = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
      const luminance = (rgb) => {
        const values = rgb.map(value => {
          const normalized = value / 255
          return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2]
      }
      const contrastOnWhite = (selector) => {
        const target = element.querySelector(selector)
        if (!target) return null
        const foreground = luminance(parseRgb(getComputedStyle(target).color))
        return (1.05 / (foreground + 0.05))
      }
      const pendingStep = element.querySelector('.na-flow-step--pending')
      const pendingBackground = pendingStep ? luminance(parseRgb(getComputedStyle(pendingStep).backgroundColor)) : null
      return {
        bodyTheme: document.body.dataset.theme,
        successContrast: contrastOnWhite('.na-status-success'),
        warningContrast: contrastOnWhite('.na-status-warning'),
        infoContrast: contrastOnWhite('.na-status-info'),
        pendingBackground,
      }
    })
    if (lightTheme.bodyTheme !== 'light') throw new Error(`Tema claro não foi aplicado: ${JSON.stringify(lightTheme)}`)
    for (const [name, ratio] of Object.entries(lightTheme).filter(([name]) => name.endsWith('Contrast'))) {
      if (ratio !== null && ratio < 4.5) throw new Error(`Contraste insuficiente em ${name}: ${ratio.toFixed(2)}:1`)
    }
    if (lightTheme.pendingBackground !== null && lightTheme.pendingBackground < 0.75) {
      throw new Error(`Etapa pendente permanece escura no tema claro: ${JSON.stringify(lightTheme)}`)
    }
  }

  await modal.screenshot({ path: SCREENSHOT_PATH })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(200)
  const mobile = await modal.boundingBox()
  if (!mobile || mobile.x < 0 || mobile.width > 390 || mobile.y < 0 || mobile.height > 844) {
    throw new Error(`Modal inválido no mobile: ${JSON.stringify(mobile)}`)
  }
  if (browserErrors.length) throw new Error(`Erros no browser: ${browserErrors.join(' | ')}`)

  console.log(JSON.stringify({ ok: true, theme: UI_THEME, previewCalls, connectivityCalls, bastionConnectivityCalls, agentConnectivityCalls, revertCalls, visual, lightTheme, mobile, screenshot: SCREENSHOT_PATH }, null, 2))
  await browser.close()
}

main().catch((error) => { console.error(error); process.exit(1) })
