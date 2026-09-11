// Opt-in local browser review. All network-module writes are intercepted and simulated.
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require('playwright'),jwt=require('jsonwebtoken')
const frontend=process.env.FRONTEND_BASE||'http://127.0.0.1:5187'
if(process.env.RUN_NETWORK_UX!=='true')throw Error('Set RUN_NETWORK_UX=true against an isolated local frontend')
;(async()=>{
 const browser=await chromium.connectOverCDP(process.env.CDP_BASE||'http://127.0.0.1:9360')
 const context=await browser.newContext({viewport:{width:1440,height:1000}})
 const token=jwt.sign({sub:'1',email:'admin@nodeaccess.local',role:'admin',tenantId:1,stage:'authenticated',sessionVersion:0,canManageHosts:true,canViewLiveSessions:true,isPlatformAdmin:false,forcePasswordChange:false},process.env.JWT_SECRET,{expiresIn:'15m'})
 await context.addInitScript(token=>{localStorage.setItem('na_access_token',token);localStorage.setItem('nodeaccess_locale','pt-BR');localStorage.setItem('na_refresh_token','network-ux-no-refresh')},token)
 let failLoad=true,failSave=false,writes=[]
 let healthResponse={status:'disabled',instances:[]},healthHttpFailure=false
 const overview={settings:{defaultProfile:'server_ssh',tacacsEnabled:false},devices:[],credentials:[],grants:[],events:[]}
 await context.route('**/api/v1/network-access**',async route=>{
  const request=route.request(),url=new URL(request.url())
  if(request.method()==='GET'&&url.pathname.endsWith('/health'))return route.fulfill({status:healthHttpFailure?503:200,contentType:'application/json',body:JSON.stringify(healthHttpFailure?{message:'simulated diagnostic failure'}:healthResponse)})
  if(request.method()==='GET'&&url.pathname.endsWith('/profiles'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({defaultProfile:overview.settings.defaultProfile})})
  if(request.method()==='GET')return route.fulfill({status:failLoad?503:200,contentType:'application/json',body:JSON.stringify(failLoad?{message:'simulated unavailable'}:overview)})
  writes.push({path:url.pathname,data:request.postDataJSON()})
  if(failSave)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Falha simulada ao salvar'})})
  if(url.pathname.endsWith('/settings'))overview.settings=request.postDataJSON()
  if(url.pathname.endsWith('/grants'))overview.grants=[request.postDataJSON()]
  return route.fulfill({status:204,body:''})
 })
 // Prevent accidental writes outside the simulated module.
 await context.route('**/api/v1/**',async route=>{if(!['GET','HEAD'].includes(route.request().method())&&!route.request().url().includes('/network-access'))return route.fulfill({status:403,body:'Blocked by UX harness'});return route.fallback()})
 const page=await context.newPage(),errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 try{
  await page.goto(frontend+'/admin/settings?section=network-access')
  await page.getByText('Não foi possível carregar a configuração de rede.',{exact:true}).waitFor({timeout:120000})
  failLoad=false;await page.getByRole('button',{name:'Tentar novamente',exact:true}).click()
  const card=page.getByTestId('network-access-settings');await card.waitFor()
  await card.getByText('Nenhum equipamento autorizado a consultar o serviço.',{exact:true}).waitFor()
  const healthCard=card.getByTestId('tacacs-health')
  await healthCard.getByText('TACACS+ desabilitado neste cliente',{exact:true}).waitFor()
  await card.getByLabel('Login AAA',{exact:true}).fill('unsaved-login')
  for(const [status,label] of [['unobserved','Nenhuma instância observada'],['degraded','Serviço requer atenção'],['unavailable','Diagnóstico indisponível'],['ready','Serviço observado como disponível']]){
    healthResponse={status,instances:status==='ready'?[{id:'lab-instance',observedAt:Date.now(),state:'ready',database:true,activity:{requests:12,errors:1,timeouts:2,pendingOperations:0,p95Ms:15}}]:[]}
    await healthCard.getByRole('button',{name:'Atualizar diagnóstico',exact:true}).click()
    await healthCard.getByText(label,{exact:true}).waitFor()
    assert.equal(await card.getByLabel('Login AAA',{exact:true}).inputValue(),'unsaved-login')
  }
  await healthCard.getByText('15 ms',{exact:true}).waitFor()
  healthHttpFailure=true
  await healthCard.getByRole('button',{name:'Atualizar diagnóstico',exact:true}).click()
  await healthCard.getByText('Não foi possível atualizar o diagnóstico',{exact:true}).waitFor()
  assert.equal(await healthCard.getByText('Serviço observado como disponível',{exact:true}).count(),0)
  assert.equal(await card.getByLabel('Login AAA',{exact:true}).inputValue(),'unsaved-login')
  healthHttpFailure=false
  await healthCard.getByRole('button',{name:'Atualizar diagnóstico',exact:true}).click()
  await healthCard.getByText('Serviço observado como disponível',{exact:true}).waitFor()

  assert.equal(await card.getByRole('button',{name:'Salvar equipamento / rotacionar segredo'}).isDisabled(),true)
  assert.equal(await card.getByRole('button',{name:'Salvar / rotacionar credencial'}).isDisabled(),true)
  assert.equal(await card.getByRole('button',{name:'Salvar permissões de comandos'}).isDisabled(),true)
  assert.equal(await card.getByLabel('Segredo compartilhado',{exact:true}).getAttribute('type'),'password')
  await card.getByLabel('Ativar TACACS+ do cliente',{exact:true}).click()
  await card.getByRole('button',{name:'Salvar configuração',exact:true}).click()
  await page.getByText('Ativar TACACS+ deste cliente?',{exact:true}).waitFor()
  assert.equal(writes.length,0,'activation requires explicit confirmation')
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();assert.equal(writes.length,0)
  await card.getByRole('button',{name:'Salvar configuração',exact:true}).click()
  overview.devices=[{id:8,hostId:9402,name:'Switch de laboratório',sourceIp:'10.0.0.2',enabled:true}]
  overview.credentials=[{userId:1,username:'alice',name:'Alice',enabled:true}]
  overview.grants=[{userId:1,hostId:9402,commands:[['show','version']]}]
  overview.events=[{id:'1',deviceId:99,username:'alice',kind:'authorization',outcome:'deny',command:JSON.stringify({hostId:9401,arguments:['service=shell','cmd=configure','cmd-arg=terminal']}),createdAt:new Date().toISOString()}]
  await page.getByRole('button',{name:'Confirmar e salvar',exact:true}).click()
  await card.getByText('Habilitado na política do cliente. Isto não confirma que o listener está online.',{exact:true}).waitFor()
  assert.equal(writes.length,1)
  await card.getByRole('cell',{name:'Negado',exact:true}).waitFor()
  await card.getByRole('cell',{name:'Host #9401',exact:true}).waitFor()
  const policyCard=card.locator('.n-card').filter({hasText:'3. Comandos permitidos por usuário e equipamento'})
  await policyCard.getByRole('button',{name:'Editar',exact:true}).click()
  await card.getByLabel('Comandos completos permitidos',{exact:true}).fill('show version\nconfigure terminal')
  await card.getByRole('button',{name:'Salvar permissões de comandos',exact:true}).click()
  await page.getByText('Confirmar permissões de comandos?',{exact:true}).waitFor()
  assert.equal(writes.length,1)
  await page.getByRole('button',{name:'Cancelar',exact:true}).click()
  await card.getByRole('button',{name:'Salvar permissões de comandos',exact:true}).click()
  await page.getByRole('button',{name:'Confirmar permissões',exact:true}).click()
  await page.waitForFunction(()=>document.body.textContent.includes('2 comandos'))
  assert.deepEqual(writes[1].data,{userId:1,hostId:9402,commands:[['show','version'],['configure','terminal']]})
  failSave=true;await card.getByRole('button',{name:'Salvar configuração',exact:true}).click()
  await page.getByText('Falha simulada ao salvar',{exact:true}).waitFor()
  await card.getByLabel('Comandos completos permitidos',{exact:true}).fill('show version\nconfigure terminal\nunknown-command')
  await card.getByText('Consulta (indicativo):',{exact:false}).waitFor()
  await card.getByText('Alteração de configuração:',{exact:false}).waitFor()
  await page.screenshot({path:'/tmp/nodeaccess-network-ux-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:844})
  await page.waitForTimeout(300)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'page must not overflow horizontally on mobile')
  await card.getByLabel('Login AAA',{exact:true}).focus();await page.keyboard.press('Tab')
  assert.ok(await page.evaluate(()=>document.activeElement!==document.body),'keyboard retains an interactive focus target')
  await page.screenshot({path:'/tmp/nodeaccess-network-ux-mobile.png',fullPage:true})
  overview.settings.defaultProfile='cisco_ios'
  await page.setViewportSize({width:1440,height:1000})
  await page.goto(frontend+'/hosts?cdp_perf=network-profile')
  await page.waitForFunction(()=>typeof window.__nodeAccessHostsPerf?.openCreateHostForm==='function')
  await page.evaluate(()=>window.__nodeAccessHostsPerf.openCreateHostForm())
  await page.waitForFunction(()=>document.body.textContent.includes('Padrão do cliente: Cisco'))
  assert.equal(await page.evaluate(()=>window.__nodeAccessHostsPerf.startupSnippetFormState().startupSnippetAvailable),false)
  const profileSelect=page.locator('.n-select').filter({has:page.locator('input[aria-label="Perfil do equipamento"]')})
  await profileSelect.click()
  await page.getByText('Servidor SSH',{exact:true}).click()
  assert.equal(await page.evaluate(()=>window.__nodeAccessHostsPerf.startupSnippetFormState().startupSnippetAvailable),true)
  await profileSelect.click()
  await page.getByText('Equipamento de rede (genérico)',{exact:true}).click()
  assert.equal(await page.evaluate(()=>window.__nodeAccessHostsPerf.startupSnippetFormState().startupSnippetAvailable),false)
  assert.deepEqual(errors,[])
  fs.writeFileSync('/tmp/nodeaccess-network-ux.json',JSON.stringify({ok:true,healthStatesAndRetry:true,healthFailurePreservesForm:true,healthFailureClearsReadyState:true,loadFailureRetry:true,emptyStates:true,invalidFormActionsDisabled:true,explicitActivationConfirmation:true,saveFailureFeedback:true,commandClassification:true,mobileNoOverflow:true,keyboardFocus:true,auditOutcomeAndTargetReadable:true,grantEditConfirmationAndSave:true,tenantDefaultAndHostProfileCapabilities:true,errors},null,2))
  console.log('Network UX simulation passed')
 }finally{await context.close();await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
