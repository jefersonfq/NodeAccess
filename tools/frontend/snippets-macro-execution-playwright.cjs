#!/usr/bin/env node
const fs = require('node:fs')
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5174').replace(/\/$/, '')
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser'
const TRIAL_REVIEW = process.env.TRIAL_REVIEW === '1'
let secretRequests = 0
const CDP_URL = process.env.CHROMIUM_CDP_URL || ''
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-terminal-split-layout.json'
const PERFORMANCE_BUDGETS = {
  // Covers the complete split journey, including mode and auxiliary-panel transitions.
  taskDurationMs: 2_000,
  scriptDurationMs: 1_000,
  layoutDurationMs: 500,
  longestTaskMs: 250,
  cumulativeLayoutShift: 0.1,
  liveDomNodes: 15_000,
}

const hosts = Array.from({ length: 6 }, (_, index) => ({
  id: 9601 + index,
  tenantId: 1,
  name: `split-host-${index + 1}`,
  description: null,
  ip: `10.96.0.${index + 1}`,
  port: 22,
  authType: 'password',
  accessProtocol: 'ssh',
  operatingSystem: 'linux',
  sshUser: 'root',
  connectionMode: 'direct',
  scope: 'global',
  groupId: null,
  folderId: null,
  inventoryNodeId: null,
  inventoryParentId: null,
  inventoryParentName: null,
  bastionId: null,
  pemKeyId: null,
  effectiveBastionId: null,
  effectiveBastionName: null,
  effectiveBastionSource: 'none',
  onePasswordRef: null,
  startupSnippetId: null,
  startupSnippetMode: 'disabled',
  trustedHostKeyFingerprint: null,
  trustedHostKeyVerifiedAt: null,
  tags: [],
  associatedLinks: [],
  accessPermissions: { view: true, connect: true, edit: true, admin: true },
  createdAt: '2026-08-18T00:00:00Z',
}))

function fakeJwt() {
  const now = Math.floor(Date.now() / 1000)
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode({ sub: '1', userId: 1, tenantId: 1, role: 'admin', email: 'admin@test', name: 'Admin', canManageHosts: true, stage: 'authenticated', iat: now, exp: now + 3600 })}.harness`
}


const send=(text,enter=true)=>({type:'send',text,enter})
const wait=(pattern,timeoutMs=3000,mode='literal')=>({type:'wait',pattern,timeoutMs,mode,caseSensitive:false})
const actions=[
 ['Macro fila',[{type:'pause',durationMs:2500},send('QUEUE_FIRST')]],
 ['Macro seguinte',[send('QUEUE_SECOND')]],
 ['Macro completa',[send('START'),wait('READY',3000,'regex'),{type:'pause',durationMs:25},send('DONE')]],
 ['Macro timeout',[wait('NEVER',150),send('BAD_TIMEOUT')]],
 ['Macro cancelar',[{type:'pause',durationMs:15000},send('BAD_CANCEL')]],
 ['Macro ocupada',[wait('HOLD',5000),send('BAD_BUSY')]],
 ['Macro regex limite',[send('EVIL'),wait('(a+)+$',10000,'regex'),send('BAD_REGEX')]],
 ['Macro teclas',[send('RAW',false),{type:'key',key:'TAB'},{type:'key',key:'ENTER'},{type:'key',key:'ESC'}]],
 ['Macro falha fila',[{type:'pause',durationMs:1500},wait('MISSING',200),send('BAD_QUEUE_FAILURE')]],
 ['Macro repeticao',[send('DUP_START'),wait('DUP_READY'),send('DUP_DONE')]],
 ['Macro desconectar',[wait('DISCONNECT',5000),send('BAD_DISCONNECT')]],
]
const macroFixtures=actions.map(([name,steps],index)=>({id:index+1,name,command:'#!nodeaccess:macro-v1\n'+JSON.stringify({version:1,steps}),scope:'PERSONAL',groupId:null,group:null,description:null,createdBy:{id:1,name:'Admin'}}))
macroFixtures.push({ ...macroFixtures[0],id:99,name:'Sequência legada',command:'#!nodeaccess:sequence\n{"steps":["LEGACY_ONE","LEGACY_TWO"]}' })
macroFixtures.push({...macroFixtures[0],id:100,name:'Macro corrompida',command:'#!nodeaccess:macro-v1\n{}'})
macroFixtures.push({...macroFixtures[0],id:101,name:'Macro esperar enviar',command:'#!nodeaccess:expect-send\n'+JSON.stringify({steps:[{expect:'$',send:'EXPECT_LEGACY'}]})})
let activeBrowser
async function main() {
  const browser = CDP_URL ? await chromium.connectOverCDP(CDP_URL) : await chromium.launch({ headless: true, executablePath: EXECUTABLE_PATH })
  activeBrowser = browser
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(({ token, pendingHost, allHosts }) => {
    localStorage.setItem('nodeaccess_locale','pt-BR')
    localStorage.setItem('na_access_token', token)
    localStorage.setItem('na_refresh_token', 'split-layout-refresh')
    localStorage.setItem('na_ui_terminal_display_mode', 'workspace')
    sessionStorage.setItem('na:pending-terminal-host', JSON.stringify(pendingHost))
    window.__splitHarness = { resizeMessages: [], errors: [], longTasks: [], layoutShifts: [] }
    try {
      new PerformanceObserver((list) => window.__splitHarness.longTasks.push(...list.getEntries().map((entry) => entry.duration))).observe({ type: 'longtask', buffered: true })
      new PerformanceObserver((list) => window.__splitHarness.layoutShifts.push(...list.getEntries().filter((entry) => !entry.hadRecentInput).map((entry) => entry.value))).observe({ type: 'layout-shift', buffered: true })
    } catch {}
    window.__macroSent = []
    window.__macroSockets = []
    const encoder = new TextEncoder()
    class FakeWebSocket extends EventTarget {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3
      constructor(url) {
        super(); window.__macroSockets.push(this); this.url = String(url); this.readyState = 0; this.binaryType = 'arraybuffer'
        setTimeout(() => {
          this.readyState = 1; this.onopen?.(new Event('open'))
          if (!this.url.includes('/ws/ssh/')) return
          const hostId = Number(this.url.match(/\/ws\/ssh\/(\d+)/)?.[1])
          const host = allHosts.find((item) => item.id === hostId) || pendingHost
          this.emit({ type: 'connected', sessionId: 99600 + hostId, hostName: host.name, connectionMethod: 'direct', agentName: null })
          this.onmessage?.(new MessageEvent('message', { data: encoder.encode(`${host.name} pronto\r\n$ `).buffer }))
        }, 20)
      }
      send(value) {
        try {
          const message = JSON.parse(typeof value === 'string' ? value : new TextDecoder().decode(value))
          if (message.type === 'snippet_input' || message.type === 'secret_input') {
            window.__macroSent.push(message)
            if(message.text==='START\n') {
              setTimeout(()=>this.onmessage?.(new MessageEvent('message',{data:encoder.encode('\x1b[3').buffer})),20)
              setTimeout(()=>this.onmessage?.(new MessageEvent('message',{data:encoder.encode('2mREA').buffer})),40)
              setTimeout(()=>this.onmessage?.(new MessageEvent('message',{data:encoder.encode('DY\x1b[0m').buffer})),60)
            }
            if(message.text==='DUP_START\n') {
              for(const delay of [20,40,80])setTimeout(()=>this.onmessage?.(new MessageEvent('message',{data:encoder.encode('DUP_READY').buffer})),delay)
            }
            if(message.text==='EVIL\n') setTimeout(()=>this.onmessage?.(new MessageEvent('message',{data:encoder.encode('a'.repeat(5000)+'!').buffer})),100)
          }
          if (message.type === 'resize') window.__splitHarness.resizeMessages.push(message)
          if (message.type === 'ping') this.emit({ type: 'pong' })
        } catch {}
      }
      close() { this.readyState = 3; this.onclose?.(new CloseEvent('close')) }
      emit(value) { this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(value) })) }
    }
    window.WebSocket = FakeWebSocket
    addEventListener('error', (event) => window.__splitHarness.errors.push(String(event.message)))
    addEventListener('unhandledrejection', (event) => window.__splitHarness.errors.push(String(event.reason)))
  }, { token: fakeJwt(), pendingHost: hosts[0], allHosts: hosts })

  await context.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path === '/api/v1/secrets') secretRequests++
    let body = null
    if(path.endsWith('/execution-status'))return route.fulfill({status:500,contentType:'application/json',body:'{"error":"simulated audit outage"}'})
    if (path === '/api/v1/features') body = { trial: TRIAL_REVIEW ? {resources:['ssh'],expiresAt:'2099-01-01T00:00:00Z'} : null, multiConnect: true, snippetsLicensed: true, portForwardingLicensed: true, feedbackLicensed: true, terminalAutocompleteLicensed: true, terminalAiLicensed: false, localAiLicensed: false, integrationsLicensed: false, integrationProviders: {}, sharedSessions: null }
    else if (path === '/api/v1/hosts') body = { data: hosts, total: hosts.length, page: 1, limit: 200 }
    else if (path === '/api/v1/hosts/by-ids') {
      const ids = new Set((url.searchParams.get('ids') || '').split(',').map(Number))
      body = hosts.filter((host) => ids.has(host.id))
    }
    else if (/^\/api\/v1\/hosts\/\d+$/.test(path)) body = hosts.find((host) => host.id === Number(path.split('/').at(-1))) || hosts[0]
    else if (path === '/api/v1/sessions/access-map') body = { generatedAt: new Date().toISOString(), refreshAfterSeconds: 30, totals: { activeSessions: 0, activeHosts: 0, uniqueUsers: 0, concurrentHosts: 0 }, hosts: [] }
    else if (path.includes('/preferences')) body = null
    else if (path === '/api/v1/snippets') body = macroFixtures
    else if ( path === '/api/v1/snippet-groups' || path === '/api/v1/secrets') body = []
    else if (path.includes('/forwardings') || path === '/api/v1/inventory') body = []
    else if (path === '/api/v1/hosts/sidebar-bootstrap') body = { summary: { all: hosts.length, global: hosts.length, unfiled: hosts.length, maxHosts: null, folders: {}, groups: {}, tags: {} }, folders: [], groups: [], tags: [] }
    else body = {}
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })

  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  await page.goto(`${FRONTEND}/terminal?splitLayoutHarness=${Date.now()}`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-terminal-container="true"]').first().waitFor()


  async function launch(name) {
    await page.keyboard.press('Control+Shift+S')
    const picker=page.locator('.n-modal').last()
    await picker.locator('input').fill(name)
    await picker.locator('input').press('Enter')
  }
  const progress=page.locator('[data-macro-progress]')
  const terminal=page.locator('[data-terminal-container="true"]').first()
  const initialGeometry=await terminal.boundingBox()
  async function unchangedGeometry(){
    const rect=await terminal.boundingBox()
    for(const key of ['x','y','width','height'])if(Math.abs(rect[key]-initialGeometry[key])>1)throw new Error('Macro changed terminal geometry: '+key)
  }
  await launch('Macro corrompida')
  await page.locator('.n-message').getByText(/passos|etapas/i).waitFor()
  if((await page.evaluate(()=>window.__macroSent)).length)throw new Error('Malformed macro sent shell text')
  await launch('Macro esperar enviar')
  await page.locator('.n-message').getByText(/Macro esperar enviar: Passos enviados/).waitFor()
  if(!(await page.evaluate(()=>window.__macroSent)).some(s=>s.text==='EXPECT_LEGACY\n'))throw new Error('Expect/send did not send')
  await launch('Macro completa')
  await page.locator('.n-message').getByText(/Macro completa: Passos enviados\/concluídos/).waitFor()
  await unchangedGeometry()
  await progress.waitFor({state:'hidden'})
  await page.locator('.n-message').getByText(/Macro completa: Passos enviados\/concluídos/).waitFor({state:'hidden',timeout:5000})
  if(await page.getByText('Passos da macro',{exact:true}).count())throw new Error('Persistent macro history')
  let sent=await page.evaluate(()=>window.__macroSent)
  if(sent.filter(s=>s.snippetId===3).map(s=>s.text).join('|')!=='START\n|DONE\n')throw new Error('Unexpected send order '+JSON.stringify(sent))
  if(sent.filter(s=>s.snippetId===3)[0].executionId!==sent.filter(s=>s.snippetId===3)[1].executionId)throw new Error('Execution id changed')
  await launch('Sequência legada')
  await page.locator('.n-message').getByText(/Sequência legada: Passos enviados\/concluídos/).waitFor()
  sent=await page.evaluate(()=>window.__macroSent)
  if(!sent.some(s=>s.text==='LEGACY_TWO\n'))throw new Error('Legacy sequence failed')

  await launch('Macro fila')
  await page.locator('[data-terminal-rail-action="snippets"]').click()
  const row=page.locator('.group').filter({has:page.getByText('Macro seguinte',{exact:true})}).last()
  await row.getByRole('button',{name:'Adicionar à fila desta sessão'}).click()
  await page.locator('[data-macro-queue]').waitFor()
  await page.locator('[data-terminal-rail-action="snippets"]').click()
  await page.waitForFunction(()=>window.__macroSent.some(s=>s.text==='QUEUE_SECOND\n'))
  const queued=await page.evaluate(()=>window.__macroSent.filter(s=>s.text.startsWith('QUEUE_')).map(s=>s.text))
  if(queued.join('|')!=='QUEUE_FIRST\n|QUEUE_SECOND\n')throw new Error('Queue order failed')
  await launch('Macro fila')
  await page.locator('[data-terminal-rail-action="snippets"]').click()
  await row.getByRole('button',{name:'Adicionar à fila desta sessão'}).click()
  await page.locator('[data-macro-queue]').waitFor()
  await progress.getByRole('button',{name:'Cancelar',exact:true}).click()
  await page.locator('[data-terminal-rail-action="snippets"]').click()
  await page.locator('.n-message').getByText(/Cancelada/).first().waitFor()
  if(await page.locator('[data-macro-queue]').count())throw new Error('Cancelled queue retained')
  await launch('Macro fila')
  await page.locator('[data-terminal-rail-action="snippets"]').click()
  await row.getByRole('button',{name:'Adicionar à fila desta sessão'}).click()
  await progress.getByRole('button',{name:'Limpar fila',exact:true}).click()
  await page.locator('[data-terminal-rail-action="snippets"]').click()
  const beforeClear=await page.evaluate(()=>window.__macroSent.filter(s=>s.text==='QUEUE_SECOND\n').length)
  await page.locator('.n-message').getByText(/Macro fila: Passos enviados/).waitFor()
  if(await page.evaluate(()=>window.__macroSent.filter(s=>s.text==='QUEUE_SECOND\n').length)!==beforeClear)throw new Error('Cleared queue ran')
  await launch('Macro teclas')
  await page.locator('.n-message').getByText(/Macro teclas: Passos enviados/).waitFor()
  const keys=await page.evaluate(()=>window.__macroSent.slice(-4).map(s=>s.text))
  if(JSON.stringify(keys)!==JSON.stringify(['RAW','\t','\r','\x1b']))throw new Error('Raw/key bytes changed')
  await launch('Macro timeout')
  await page.locator('.n-message').getByText(/Tempo de espera esgotado/).waitFor()
  await page.waitForTimeout(400)
  if(await page.locator('.n-message').count()>1)throw new Error('Macro notices stacked')
  await unchangedGeometry()
  await launch('Macro cancelar')
  await progress.getByRole('button',{name:'Cancelar',exact:true}).waitFor()
  const output=process.env.SCREENSHOT_DIR || '/tmp/nodeaccess-snippets-execution'
  fs.mkdirSync(output,{recursive:true})
  await page.locator('.n-modal').waitFor({state:'hidden'})
  await page.locator('.n-message').waitFor({state:'hidden',timeout:5000})
  await unchangedGeometry()
  await page.screenshot({path:output+'/running-desktop.png',fullPage:true})
  for(const width of [390,768]){
    await page.setViewportSize({width,height:844})
    const box=await progress.boundingBox()
    if(!box || box.x<0 || box.x+box.width>width+1)throw new Error('Macro controls overflow')
    await page.screenshot({path:output+'/running-'+width+'.png',fullPage:true})
  }
  await page.setViewportSize({width:1440,height:900})
  await progress.getByRole('button',{name:'Cancelar',exact:true}).click()
  await page.locator('.n-message').getByText(/Cancelada/).first().waitFor()
  await launch('Macro ocupada')
  await progress.getByRole('button',{name:'Cancelar',exact:true}).waitFor()
  await launch('Macro completa')
  await page.getByText(/Já existe uma execução/).waitFor()
  await progress.getByRole('button',{name:'Cancelar',exact:true}).click()
  await page.locator('.n-message').getByText(/Cancelada/).first().waitFor()
  await launch('Macro regex limite')
  // The UI must keep responding while the worker evaluates pathological input.
  await page.evaluate(()=>{window.__macroTicks=0;window.__macroInterval=setInterval(()=>window.__macroTicks++,20)})
  await page.locator('.n-message').getByText(/Regex excedeu o limite/).waitFor()
  if(await page.evaluate(()=>window.__macroTicks)<5)throw new Error('Regex blocked UI')
  await page.evaluate(()=>clearInterval(window.__macroInterval))
  await page.screenshot({path:output+'/regex-budget.png',fullPage:true})
  await launch('Macro repeticao')
  await page.locator('.n-message').getByText(/Macro repeticao: Passos enviados/).waitFor()
  await page.waitForTimeout(250)
  const duplicates=await page.evaluate(()=>window.__macroSent.filter(s=>s.text==='DUP_DONE\n').length)
  if(duplicates!==1)throw new Error('Repeated output duplicated a send')
  await launch('Macro falha fila')
  await page.locator('[data-terminal-rail-action="snippets"]').click()
  await row.getByRole('button',{name:'Adicionar à fila desta sessão'}).click()
  await page.locator('[data-terminal-rail-action="snippets"]').click()
  const queueBeforeFailure=await page.evaluate(()=>window.__macroSent.filter(s=>s.text==='QUEUE_SECOND\n').length)
  await page.locator('.n-message').getByText(/Tempo de espera esgotado/).waitFor()
  await page.evaluate(()=>{
    const socket=window.__macroSockets.find(s=>s.url.includes('/ws/ssh/'))
    socket.onmessage?.(new MessageEvent('message',{data:new TextEncoder().encode('MISSING').buffer}))
  })
  await page.waitForTimeout(300)
  if(await page.evaluate(()=>window.__macroSent.filter(s=>s.text==='QUEUE_SECOND\n').length)!==queueBeforeFailure)throw new Error('Queue advanced after failure')
  await progress.waitFor({state:'hidden'})
  await launch('Macro completa')
  await page.locator('.n-message').getByText(/Macro completa: Passos enviados/).waitFor()
  await launch('Macro desconectar')
  await progress.getByRole('button',{name:'Cancelar',exact:true}).waitFor()
  await page.evaluate(()=>window.__macroSockets.find(s=>s.url.includes('/ws/ssh/')).close())
  await page.locator('.n-message').getByText(/Cancelada/).first().waitFor()
  sent=await page.evaluate(()=>window.__macroSent)
  if(sent.filter(s=>s.text==='START\n').length!==2)throw new Error('Duplicate dispatch or audit failure resent a macro')
  if(sent.some(s=>s.text.startsWith('BAD_')))throw new Error('Sent after failure or cancellation')
  await page.locator('[data-terminal-rail-action="snippets"]').click()
  if (TRIAL_REVIEW) {
    if (await page.getByRole('button',{name:/^\+ Novo$/}).count() || await page.getByRole('button',{name:'Editar',exact:true}).count() || await page.getByRole('button',{name:'Excluir',exact:true}).count()) throw new Error('Trial exposed snippet mutations')
    if (secretRequests) throw new Error('Trial fetched forbidden vault')
  } else {
  await page.getByRole('button',{name:/^\+ Novo$/}).click()
  await page.getByRole('textbox',{name:'Nome do snippet',exact:true}).fill('Rascunho de painel')
  await page.locator('[data-terminal-rail-action="snippets"]').click()
  await page.locator('[data-terminal-rail-action="snippets"]').click()
  if(await page.getByRole('textbox',{name:'Nome do snippet',exact:true}).inputValue()!=='Rascunho de painel')throw new Error('Panel draft lost')
  page.once('dialog',dialog=>dialog.accept())
  await page.getByRole('button',{name:'Cancelar',exact:true}).click()
  await page.locator('[data-terminal-rail-action="snippets"]').click()
  }
  const errors=await page.evaluate(()=>window.__splitHarness.errors)
  if(errors.length)throw new Error(JSON.stringify(errors))
  const report={ok:true,panelDraftPreserved:!TRIAL_REVIEW,trialReadOnly:TRIAL_REVIEW,secretRequests,legacyExpectSendExecuted:true,malformedPayloadBlocked:true,duplicateDispatchBlocked:true,auditFailureDoesNotResend:true,duplicateOutputSingleSend:true,timeoutClearsQueue:true,lateOutputIgnored:true,manualRecovery:true,notificationsDoNotStack:true,rawAndKeys:true,clearQueuePreservesActive:true,terminalGeometryUnchanged:true,completionAutoDismiss:true,responsiveControls:true,fragmentedAnsi:true,realWorkerRegex:true,legacy:true,timeout:true,cancel:true,concurrencyBlocked:true,regexBudget:true,disconnect:true,queueOrder:true,queueCancellation:true,sent:sent.map(({snippetId,text})=>({snippetId,text})),errors}
  fs.writeFileSync(output+'/report.json',JSON.stringify(report,null,2))
  console.log(JSON.stringify(report))
  await browser.close()
}
main().catch(async error=>{console.error(error);await activeBrowser?.close();process.exitCode=1})
