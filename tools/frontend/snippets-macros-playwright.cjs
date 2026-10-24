#!/usr/bin/env node
const fs = require('node:fs')
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5174').replace(/\/$/, '')
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser'
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-snippets-page.json'
const BUDGETS = { taskDurationMs: 2500, scriptDurationMs: 700, layoutDurationMs: 350, longestTaskMs: 200, cumulativeLayoutShift: 0.1, liveDomNodes: 12000 }

const groups = [{ id: 10, name: 'Operação', description: null, scope: 'TEAM', createdById: 1, createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z' }]
const snippets = [
  { id: 1, name: 'Status nginx', command: 'systemctl status nginx', description: null, scope: 'TEAM', groupId: 10, group: { id: 10, name: 'Operação', scope: 'TEAM' }, createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z', createdBy: { id: 1, name: 'Admin' } },
  { id: 2, name: 'Grupo legado visível', command: 'uptime', description: null, scope: 'TEAM', groupId: 99, group: null, createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z', createdBy: { id: 1, name: 'Admin' } },
  { id: 3, name: 'Sem agrupamento', command: 'hostname', description: null, scope: 'PERSONAL', groupId: null, group: null, createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z', createdBy: { id: 1, name: 'Admin' } },
]

function fakeJwt() {
  const now = Math.floor(Date.now() / 1000)
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode({ sub: '1', userId: 1, tenantId: 1, role: 'admin', email: 'admin@test', name: 'Admin', stage: 'authenticated', iat: now, exp: now + 3600 })}.harness`
}

let activeBrowser
async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: EXECUTABLE_PATH })
  activeBrowser = browser
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(({token, theme}) => {
    localStorage.setItem('na_ui_theme_mode',theme)
    localStorage.setItem('nodeaccess_locale','pt-BR')
    localStorage.setItem('na_access_token', token)
    localStorage.setItem('na_refresh_token', 'snippets-harness-refresh')
    localStorage.removeItem('nodeaccess:snippets-view-mode')
    window.__snippetsHarness = { errors: [], longTasks: [], layoutShifts: [] }
    addEventListener('error', (event) => window.__snippetsHarness.errors.push(String(event.message)))
    addEventListener('unhandledrejection', (event) => window.__snippetsHarness.errors.push(String(event.reason)))
    try {
      new PerformanceObserver((list) => window.__snippetsHarness.longTasks.push(...list.getEntries().map((entry) => entry.duration))).observe({ type: 'longtask', buffered: true })
      new PerformanceObserver((list) => window.__snippetsHarness.layoutShifts.push(...list.getEntries().filter((entry) => !entry.hadRecentInput).map((entry) => entry.value))).observe({ type: 'layout-shift', buffered: true })
    } catch {}
  }, {token:fakeJwt(),theme:process.env.UI_THEME || 'dark'})

  await context.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let body = {}
    if (path === '/api/v1/features') body = { snippetsLicensed: true }
    else if (path === '/api/v1/snippets') {
      if(route.request().method()==='POST'){
        const created={...snippets[0],...route.request().postDataJSON(),group:null,id:snippets.length+1,createdBy:{id:1,name:'Admin'}}
        snippets.push(created);body=created
      } else body=snippets
    }
    else if (/^\/api\/v1\/snippets\/\d+$/.test(path)) {
      const item=snippets.find(row=>row.id===Number(path.split('/').at(-1)))
      if(route.request().method()==='PUT'){Object.assign(item,route.request().postDataJSON());body=item}
      else if(route.request().method()==='DELETE'){snippets.splice(snippets.indexOf(item),1);body={}}
      else body=item
    }
    else if (path === '/api/v1/snippet-groups') body = groups
    else if (path === '/api/v1/secrets') body = []
    else if (path.includes('/preferences')) body = null
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })

  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  await page.goto(`${FRONTEND}/snippets?snippetsHarness=${Date.now()}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: /Snippets/ }).waitFor()
  await page.getByText('Status nginx', { exact: true }).waitFor()


  await page.getByRole('button',{name:/^\+ (Novo|New)$/}).click()
  const modal=page.locator('.n-modal').last()
  if(process.env.SNIPPET_CAPTURE_ONLY){
    await modal.waitFor()
    await page.waitForTimeout(300)
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:900})
      await page.waitForTimeout(200)
      await page.screenshot({path:process.env.SNIPPET_CAPTURE_ONLY+'-'+width+'.png',fullPage:true})
    }
    await browser.close()
    return
  }

  await modal.getByRole('button',{name:/^(Salvar|Save)$/}).click()
  await modal.getByText(/Informe o nome|Enter a name/).waitFor()
  await modal.getByPlaceholder(/Nome do snippet|Snippet name/).fill('Macro E2E')
  await modal.locator('.n-select').first().click()
  await page.locator('.n-base-select-option').filter({hasText:/^Esperar e enviar$/}).click()
  const legacyEditor=modal.getByRole('textbox',{name:'Esperar e enviar',exact:true})
  await legacyEditor.waitFor()
  if(!(await legacyEditor.getAttribute('placeholder')).includes('{{secret:'))throw new Error('Vault placeholder missing')
  await legacyEditor.fill('READY => echo ok')
  await modal.locator('.n-select').first().click()
  await page.locator('.n-base-select-option').filter({hasText:/^Macro$/}).click()
  const editor=modal.locator('[data-macro-editor]')
  await editor.getByRole('button',{name:/^\+ (Enviar comando|Send command)$/}).click()
  await editor.getByRole('textbox',{name:/^(Enviar comando|Send command)$/}).fill('echo START')
  await editor.getByRole('button',{name:/^\+ (Aguardar resposta|Wait for output)$/}).click()
  const wait=editor.locator('[data-macro-step="1"]')
  await wait.getByRole('textbox',{name:/Texto ou padrão esperado|Expected text or pattern/}).fill('READY')
  await wait.locator('.n-select').click()
  await page.locator('.n-base-select-option').filter({hasText:/Regex avançado|Advanced regex/}).click()
  await editor.locator('summary').click()
  await editor.getByRole('textbox',{name:/Exemplo de saída|Sample output/}).fill('READY')
  await wait.getByRole('button',{name:/Testar com exemplo|Test with sample/}).click()
  await editor.getByText(/Correspondência encontrada|Match found/).first().waitFor()
  await wait.getByRole('textbox',{name:/Texto ou padrão esperado|Expected text or pattern/}).fill('[')
  await modal.getByRole('button',{name:/^(Salvar|Save)$/}).click()
  await modal.getByRole('alert').filter({hasText:/Regex inválida|Invalid, empty/}).waitFor()
  await wait.getByRole('textbox',{name:/Texto ou padrão esperado|Expected text or pattern/}).fill('READY')
  await editor.getByRole('button',{name:/^\+ (Pausa|Pause)$/}).click()
  await editor.locator('[data-macro-step="2"]').getByRole('button',{name:/Mover passo para cima|Move step up/}).click()
  const output=process.env.SCREENSHOT_DIR || '/tmp/nodeaccess-snippets-implemented'
  fs.mkdirSync(output,{recursive:true})
  for(const width of [1440,768,390]){
    await page.setViewportSize({width,height:1000})
    await page.waitForTimeout(250)
    const bounds=await modal.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,right:r.right,width:innerWidth}})
    if(bounds.x<0 || bounds.right>bounds.width+1) throw new Error('Modal overflow '+JSON.stringify(bounds))
    await page.screenshot({path:output+'/editor-'+width+'.png',fullPage:true})
  }
  await modal.getByRole('button',{name:/^(Salvar|Save)$/}).click()
  await page.getByText('Macro E2E',{exact:true}).waitFor()
  const saved=snippets.find(s=>s.name==='Macro E2E')
  const macro=JSON.parse(saved.command.split('\n').slice(1).join('\n'))
  if(macro.version!==1 || macro.steps.map(s=>s.type).join(',')!=='send,pause,wait' || macro.steps[0].enter!==true) throw new Error('Serialization/reordering failed')
  await page.reload({waitUntil:'domcontentloaded'})
  await page.getByText('Macro E2E',{exact:true}).waitFor()
  await page.getByText('Macro E2E',{exact:true}).locator('xpath=ancestor::article').getByRole('button',{name:'Mais ações de Macro E2E',exact:true}).click()
  await page.locator('.n-dropdown-option').filter({hasText:/^Editar$/}).click()
  await page.locator('[data-macro-step]').last().waitFor()
  if(await page.locator('[data-macro-step]').count()!==3)throw new Error('Round-trip lost steps')

  await page.locator('[data-macro-editor]').getByRole('textbox',{name:/^(Enviar comando|Send command)$/}).fill('echo EDITED')
  await page.locator('.n-modal').last().getByRole('button',{name:/^(Salvar|Save)$/}).click()
  await page.getByText('Macro E2E',{exact:true}).waitFor()
  await page.locator('.n-modal').waitFor({state:'hidden'})
  if(!snippets.find(s=>s.name==='Macro E2E').command.includes('EDITED'))throw new Error('Edit failed')
  const card=page.getByText('Macro E2E',{exact:true}).locator('xpath=ancestor::article')
  await card.getByRole('button',{name:'Favorito',exact:true}).click()
  await page.reload({waitUntil:'domcontentloaded'})
  await page.getByText('Macro E2E',{exact:true}).waitFor()
  if(await card.getByRole('button',{name:'Favorito',exact:true}).getAttribute('aria-pressed')!=='true')throw new Error('Favorite not persisted')
  await page.evaluate(()=>{
    const create=URL.createObjectURL.bind(URL)
    URL.createObjectURL=blob=>{window.__exportedSnippetBlob=blob;return create(blob)}
  })
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Exportar',exact:true}).click()])
  if(download.suggestedFilename()!=='nodeaccess-snippets.json')throw new Error('Unexpected download filename')
  const exported=JSON.parse(await page.evaluate(()=>window.__exportedSnippetBlob.text()))
  if(exported.format!=='nodeaccess-snippets' || !exported.snippets.some(s=>s.name==='Macro E2E'))throw new Error('Export failed')
  await page.locator('[data-snippet-import]').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{}')})
  await page.getByText('Arquivo de snippets inválido',{exact:true}).waitFor()
  await page.locator('[data-snippet-import]').setInputFiles({name:'test.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'nodeaccess-snippets',version:1,snippets:[{name:'Importada E2E',command:'echo import',description:null,scope:'TEAM'}]}))})
  await page.locator('.n-modal').last().getByRole('button',{name:'Importar',exact:true}).click()
  await page.getByText('Importada E2E',{exact:true}).waitFor()
  if(snippets.find(s=>s.name==='Importada E2E').scope!=='PERSONAL')throw new Error('Import did not force personal scope')

  await page.getByRole('button',{name:/^\+ (Novo|New)$/}).click()
  const expectModal=page.locator('.n-modal').last()
  await expectModal.getByPlaceholder(/Nome do snippet|Snippet name/).fill('Esperar E2E')
  await expectModal.locator('.n-select').first().click()
  await page.locator('.n-base-select-option').filter({hasText:/^Esperar e enviar$/}).click()
  await expectModal.getByRole('textbox',{name:'Esperar e enviar',exact:true}).fill('READY => echo legacy')
  await expectModal.getByRole('button',{name:'Salvar',exact:true}).click()
  await expectModal.waitFor({state:'hidden'})
  if(!snippets.find(s=>s.name==='Esperar E2E').command.startsWith('#!nodeaccess:expect-send'))throw new Error('Legacy format lost')
  await page.reload({waitUntil:'domcontentloaded'})
  await page.getByText('Esperar E2E',{exact:true}).locator('xpath=ancestor::article').getByRole('button',{name:'Mais ações de Esperar E2E',exact:true}).click()
  await page.locator('.n-dropdown-option').filter({hasText:/^Editar$/}).click()
  if(await page.getByRole('textbox',{name:'Esperar e enviar',exact:true}).inputValue()!=='READY => echo legacy')throw new Error('Expect/send round trip failed')
  await page.locator('.n-modal').last().getByRole('button',{name:'Cancelar',exact:true}).click()

  await page.setViewportSize({width:390,height:844})
  await page.waitForTimeout(400)
  await page.screenshot({path:output+'/library-mobile.png',fullPage:true})
  const overflow=await page.locator('.snippet-filter-panel').evaluate(el=>el.scrollWidth>el.clientWidth+1)
  if(overflow)throw new Error('Mobile filters overflow')
  await page.route('**/api/v1/snippets',route=>route.fulfill({status:500,contentType:'application/json',body:'{}'}))
  await page.reload({waitUntil:'domcontentloaded'})
  await page.getByText(/Não foi possível carregar os snippets|Could not load snippets/).waitFor()
  await page.screenshot({path:output+'/load-error.png',fullPage:true})
  await page.unroute('**/api/v1/snippets')
  await page.getByRole('button',{name:/Tentar novamente|Try again/}).last().click()
  await page.getByText('Macro E2E',{exact:true}).waitFor()
  await page.getByRole('button',{name:/^\+ (Novo|New)$/}).click()
  const modelModal=page.locator('.n-modal').last()
  await modelModal.locator('.n-select').first().click()
  await page.locator('.n-base-select-option').filter({hasText:/^Macro$/}).click()
  await modelModal.getByRole('button',{name:'Modelo: diagnóstico Linux',exact:true}).click()
  if(await modelModal.locator('[data-macro-step]').count()!==5)throw new Error('Macro template missing')
  const firstStep=modelModal.locator('[data-macro-step="0"]')
  await firstStep.getByRole('button',{name:'Recolher',exact:true}).click()
  if(await firstStep.getByRole('textbox').isVisible())throw new Error('Collapse failed')
  if(!(await firstStep.locator('[data-macro-summary]').innerText()).includes('hostname'))throw new Error('Missing summary')
  await firstStep.getByRole('button',{name:'Expandir',exact:true}).click()
  const firstWait=modelModal.locator('[data-macro-step="1"]')
  const lastWait=modelModal.locator('[data-macro-step="4"]')
  for(const [step,sample] of [[firstWait,'NA_READY'],[lastWait,'WRONG']]){
    await step.locator('summary').click()
    await step.getByRole('textbox',{name:'Exemplo de saída (sem dados sensíveis)',exact:true}).fill(sample)
    await step.getByRole('button',{name:'Testar com exemplo',exact:true}).click()
  }
  await firstWait.getByText('Correspondência encontrada',{exact:false}).waitFor()
  await lastWait.getByText('Nenhuma correspondência',{exact:false}).waitFor()
  await firstWait.getByRole('textbox',{name:'Texto ou padrão esperado',exact:true}).fill('CHANGED')
  if(await firstWait.locator('[role="status"]').count())throw new Error('Stale sample result')
  const beforeUnload=await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented})
  if(!beforeUnload)throw new Error('Dirty reload not protected')
  page.once('dialog',dialog=>dialog.dismiss())
  await modelModal.getByRole('button',{name:'Cancelar',exact:true}).click()
  await modelModal.waitFor()
  page.once('dialog',dialog=>dialog.accept())
  await modelModal.getByRole('button',{name:'Cancelar',exact:true}).click()
  await modelModal.waitFor({state:'hidden'})
  if(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented}))throw new Error('Clean page blocks reload')

  const report={ok:true,models:true,collapsedSteps:true,independentWaitSamples:true,invalidatedSample:true,dirtyReloadProtected:true,discardConfirmation:true,moreActions:true,viewports:[1440,768,390],expectSendSelectedSavedReopened:true,createdReloaded:true,edited:true,favorites:true,importExport:true,invalidRegexBlocked:true,reordered:true,enterDefault:true,retryRecovered:true,errors:await page.evaluate(()=>window.__snippetsHarness.errors)}
  if(report.errors.length)throw new Error(JSON.stringify(report.errors))
  fs.writeFileSync(output+'/report.json',JSON.stringify(report,null,2))
  console.log(JSON.stringify(report))
  await browser.close()
}
main().catch(async error=>{console.error(error);await activeBrowser?.close();process.exitCode=1})
