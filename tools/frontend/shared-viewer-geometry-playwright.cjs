const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { chromium } = require('playwright')
const { fakeJwt, mockApi } = require('./observability-cdp-harness.cjs')
const frontend = process.env.FRONTEND_BASE || 'http://127.0.0.1:5178'
const dir = '/tmp/nodeaccess-shared-viewer-review'
async function main() {
 await fs.mkdir(dir,{recursive:true})
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser',headless:true})
 const report=[]
 try {
  for(const theme of ['dark','light']) {
   const context=await browser.newContext({viewport:{width:1908,height:916}})
   await context.addInitScript(({token,theme})=>{
    localStorage.setItem('na_access_token',token);localStorage.setItem('na_refresh_token','mock')
    localStorage.setItem('nodeaccess_locale','pt-BR');localStorage.setItem('na_ui_theme_mode',theme)
   },{token:fakeJwt(),theme})
   const now=new Date().toISOString(),expires=new Date(Date.now()+3600000).toISOString()
   const participants=[{userId:2,name:'Dono',role:'owner',joinedAt:now,lastSeenAt:now,leftAt:null},{userId:1,name:'Viewer teste',role:'viewer',joinedAt:now,lastSeenAt:now,leftAt:null}]
   let lease=null,pending=[],socket,connections=0,sharedStatus='active'
   const input=[]
   const snapshot=()=>({type:'shared_session_snapshot',participants,status:sharedStatus,role:'viewer',expiresAt:expires,activeControlLease:lease,pendingControlRequestUserIds:pending})
   const emit=m=>socket.send(JSON.stringify(m))
   await context.route('**/api/v1/**',route=>{
    const p=new URL(route.request().url()).pathname.replace('/api/v1','')
    if(p==='/settings/manual')return route.fulfill({json:{enabled:process.env.MANUAL_CAPTURE==='1'}})
    if(p==='/shared-sessions/701')return route.fulfill({json:{id:701,tenantId:1,hostId:9401,hostName:'Shared geometry test',owner:{userId:2,name:'Dono'},status:sharedStatus,expiresAt:expires,createdAt:now,participants,activeControlLease:lease,pendingControlRequestUserIds:pending}})
    if(p.endsWith('/control/request')){pending=[1];emit({type:'shared_session_control_requested',userId:1});return route.fulfill({json:{ok:true}})}
    const mock=mockApi(route.request().method(),p);return route.fulfill({status:mock.status,json:mock.body})
   })
   await context.routeWebSocket('**/ws/events*',()=>{})
   await context.routeWebSocket('**/ws/shared-sessions/*',ws=>{
    socket=ws;connections++
    ws.onMessage(m=>{if(typeof m!=='string')input.push(Buffer.from(m).toString())})
    setTimeout(()=>{emit(snapshot());ws.send(Buffer.from('viewer ready\r\n'))},40)
   })
   const page=await context.newPage(),errors=[]
   page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000)
   await page.goto(frontend+'/terminal/shared/701',{waitUntil:'domcontentloaded',timeout:60000})
   await page.getByText('Conectado',{exact:true}).waitFor().catch(async error => {
    await fs.writeFile(`${dir}/${theme}-startup-failure.json`, JSON.stringify({ url: page.url(), errors, body: (await page.locator('body').innerText()).slice(0, 3000), connections }, null, 2))
    await page.screenshot({ path: `${dir}/${theme}-startup-failure.png` })
    throw error
   })
   const geometry=async (label,sendOutput=true)=>{
    if(sendOutput) socket.send(Buffer.from('\x1b[999;1HLAST_LINE_VISIBLE'))
    await page.waitForFunction(()=>{
     const screen=document.querySelector('.xterm-screen'),root=screen?.closest('.xterm')?.parentElement
     if(!screen||!root)return false
     const s=screen.getBoundingClientRect(),r=root.getBoundingClientRect()
     return s.height>=90&&s.top>=r.top-1&&s.left>=r.left-1&&s.bottom<=r.bottom+1&&s.bottom<=innerHeight+1&&s.right<=r.right+1
    },{},{timeout:5000}).catch(async e=>{
      await page.screenshot({path:`${dir}/${theme}-failure.png`})
      console.log(label,await page.evaluate(()=>[...document.querySelectorAll('.xterm-screen,.xterm')].map(el=>({class:el.className,height:el.getBoundingClientRect().height,bottom:el.getBoundingClientRect().bottom,viewport:innerHeight}))))
      throw e
    })
    report.push({theme,state:label,dimensions:await page.locator('.xterm-screen').evaluate(el=>({height:el.getBoundingClientRect().height,bottom:el.getBoundingClientRect().bottom,viewport:innerHeight}))})
   }
   await geometry('viewer-initial')
   await page.locator('.xterm-helper-textarea').focus();await page.keyboard.type('blocked')
   assert.equal(input.length,0,'Read-only viewer must not send input')
   await page.setViewportSize({width:1280,height:640});await geometry('viewer-resized')
   await page.getByRole('button',{name:'Solicitar controle',exact:true}).click()
   await page.getByRole('button',{name:'Controle solicitado',exact:true}).waitFor();await geometry('control-requested')
   await page.locator('.xterm-helper-textarea').focus();await page.keyboard.type('pending-blocked')
   assert.equal(input.length,0,'Pending request is not permission')
   pending=[];emit({type:'shared_session_control_denied',userId:1,reason:'Tente depois'})
   await page.getByRole('button',{name:'Solicitar controle',exact:true}).waitFor();await geometry('request-denied')
   await page.getByRole('button',{name:'Solicitar controle',exact:true}).click()
   await page.getByRole('button',{name:'Controle solicitado',exact:true}).waitFor()
   lease={id:1,controllerUserId:1,grantedByUserId:2,grantedAt:now,expiresAt:expires};pending=[]
   emit({type:'shared_session_control_granted',lease})
   await page.getByText('Viewer teste está controlando',{exact:true}).waitFor()
   await geometry('control-granted')
   await page.locator('.xterm-helper-textarea').focus();await page.keyboard.type('allowed')
   await page.waitForTimeout(100);assert.match(input.join(''),/allowed/)
   for(const size of [{width:1908,height:916},{width:1024,height:600},{width:1280,height:720}]){await page.setViewportSize(size);await geometry(`controller-${size.width}x${size.height}`)}
   await page.getByRole('button',{name:'Mostrar detalhes',exact:true}).click();await geometry('details-open')
   await page.getByRole('button',{name:'Ocultar detalhes',exact:true}).click();await geometry('details-closed')
   await page.screenshot({path:`${dir}/${theme}-controller.png`})
   lease=null;emit({type:'shared_session_control_revoked',userId:1})
   await page.getByRole('button',{name:'Solicitar controle',exact:true}).waitFor()
   const before=input.length;await page.locator('.xterm-helper-textarea').focus();await page.keyboard.type('denied-again')
   assert.equal(input.length,before)
   await page.setViewportSize({width:1100,height:650});await geometry('revoked-resized')
   socket.send('{malformed');emit({type:'future_optional_event'})
   await geometry('malformed-message-ignored')
   for(let i=0;i<5;i++) {
    await page.getByRole('button',{name:'Mostrar detalhes',exact:true}).click()
    await geometry(`details-repeat-open-${i}`)
    if(i===0) {
     await page.screenshot({path:`${dir}/${theme}-compact-details.png`})
     await page.locator('.n-card').hover();await page.mouse.wheel(0,800)
     await page.waitForFunction(()=>document.querySelector('.n-card')?.scrollTop>0)
     const card=await page.locator('.n-card').boundingBox()
     const participant=await page.getByText('Viewer teste',{exact:true}).boundingBox()
     assert.ok(participant&&participant.y>=card.y&&participant.y+participant.height<=card.y+card.height,'Participant names must remain accessible by scrolling details')
    }
    await page.getByRole('button',{name:'Ocultar detalhes',exact:true}).click()
    await geometry(`details-repeat-close-${i}`)
   }
   socket.send(Buffer.from('\x1b[?1049h\x1b[2J\x1b[HINTERACTIVE TEST\x1b[999;1HFOOTER'))
   await geometry('alternate-buffer')
   socket.send(Buffer.from('\x1b[?1049l\r\nAcentuação: ação, conexão. 日本語\r\n'))
   await geometry('normal-buffer-unicode')
   lease={id:2,controllerUserId:1,grantedByUserId:2,grantedAt:now,expiresAt:expires}
   emit({type:'shared_session_control_granted',lease})
   await page.getByText('Viewer teste está controlando',{exact:true}).waitFor()
   lease=null;emit({type:'shared_session_control_expired',userId:1})
   await page.getByRole('button',{name:'Solicitar controle',exact:true}).waitFor()
   const beforeExpired=input.length
   await page.locator('.xterm-helper-textarea').focus();await page.keyboard.type('expired-blocked')
   assert.equal(input.length,beforeExpired)
   await geometry('control-expired')
   sharedStatus='ended';emit({type:'shared_session_ended'})
   await page.getByRole('button',{name:'Solicitar controle',exact:true}).waitFor({state:'hidden'})
   await page.locator('.xterm-helper-textarea').focus();await page.keyboard.type('ended-blocked')
   assert.equal(input.length,beforeExpired)
   await geometry('session-ended')
   emit({type:'shared_session_error',message:'Falha de comunicação simulada'})
   await page.getByText('Falha de comunicação simulada',{exact:true}).waitFor()
   await geometry('error-banner-visible')
   await page.setViewportSize({width:1024,height:600});await geometry('error-resized');await page.screenshot({path:`${dir}/${theme}-error.png`})
   socket.close({code:1011,reason:'simulated interruption'})
   await page.waitForTimeout(100)
   await page.setViewportSize({width:1280,height:700});await geometry('network-closed-resized',false)
   assert.equal(connections,1,'Resizing or failure must not automatically reopen the shared connection')
   sharedStatus='active';pending=[]
   await page.reload({waitUntil:'domcontentloaded'})
   await page.getByText('Conectado',{exact:true}).waitFor().catch(async error => {
    await fs.writeFile(`${dir}/${theme}-startup-failure.json`, JSON.stringify({ url: page.url(), errors, body: (await page.locator('body').innerText()).slice(0, 3000), connections }, null, 2))
    await page.screenshot({ path: `${dir}/${theme}-startup-failure.png` })
    throw error
   })
   assert.equal(connections,2,'User reload creates exactly one new connection')
   assert.equal(await page.getByText('Falha de comunicação simulada',{exact:true}).count(),0)
   await geometry('manual-reload-recovery')
   assert.deepEqual(errors,[])
   await context.close()
  }
  await fs.writeFile(`${dir}/report.json`,JSON.stringify(report,null,2));console.log(`PASS: ${report.length} geometry states; control permissions, failures, scrollable details and manual recovery in both themes`)
 }finally{await browser.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
