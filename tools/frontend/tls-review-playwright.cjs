const assert=require('node:assert/strict'),fs=require('node:fs')
module.exports=async({page,context})=>{
 const initial={domain:'CN=nodeaccess.example.test',issuer:'CN=Example CA',validFrom:'2026-01-01',validTo:'2027-01-01',fingerprint:'AA:11',daysRemaining:90}
 const state={available:true,domain:'nodeaccess.example.test',mode:'provided',externalOnly:false,email:'',active:initial,observed:null,job:null,candidate:null,nextCheck:null,history:[],recoveryRequired:false}
 const calls=[],errors=[],jobs=new Map();let notConfigured=true,outage=false,rejectSubmit=false,loseAck=false,jobFailure=false,auditOutage=false,serial=0
 page.on('pageerror',e=>errors.push(e.message))
 await context.route('**/api/v1/platform/tls/**',async route=>{
   const url=new URL(route.request().url())
   if(route.request().method()==='GET'){
    if(url.pathname.endsWith('/alerts'))return route.fulfill({json:{enabled:true,alerts:state.alerts||[]}})
    if(url.pathname.endsWith('/audit'))return route.fulfill(auditOutage?{status:503,json:{message:'Audit unavailable'}}:{json:[]})
    if(url.pathname.includes('/operations/')){const job=jobs.get(url.pathname.split('/').pop());return route.fulfill(job?{json:job}:{status:404,json:{message:'Operação não encontrada'}})}
    if(notConfigured)return route.fulfill({status:503,json:{code:'TLS_NOT_CONFIGURED',message:'Gestão de certificados não instalada neste servidor. Consulte o guia de HTTPS.'}})
    return route.fulfill(outage?{status:503,json:{message:'Serviço de certificados indisponível.'}}:{json:state})
   }
   const body=route.request().postDataJSON();calls.push(body.action);assert.match(body.requestId,/^[a-f0-9-]{36}$/)
   if(rejectSubmit)return route.fulfill({status:503,json:{message:'Não foi possível confirmar a operação. Atualize o estado.'}})
   const job={id:String(++serial),requestId:body.requestId,action:body.action,status:'running',steps:[{name:body.action==='simulate'?'acme':'https',status:'running',startedAt:new Date().toISOString()}],startedAt:new Date().toISOString(),actor:'user:1'};state.job=job;jobs.set(body.requestId,job)
   const failure=jobFailure
   setTimeout(()=>{
    job.status=failure?'failed':'succeeded';job.steps[0].status=job.status;job.error=failure?{message:'A aplicação falhou. O certificado anterior foi restaurado e verificado.'}:undefined;job.result=failure?undefined:{message:'Operação concluída.'}
    if(!failure){
     if(body.action==='validate')state.candidate={...initial,id:'00000000-0000-4000-8000-000000000001',fingerprint:'BB:22',expiresAt:'2027-01-01',baseFingerprint:state.active.fingerprint}
     if(body.action==='apply'){state.active={...initial,fingerprint:'BB:22'};state.candidate=null;state.mode='provided'}
     if(body.action==='automatic'){state.mode='automatic';state.nextCheck='2026-10-01'}
     if(body.action==='pause')state.mode='provided'
    }
    state.history.unshift({...job})
   },150)
   if(loseAck)return route.abort('failed')
   return route.fulfill({status:202,json:job})
 })
 const navigate=path=>page.evaluate(async path=>document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(path),path)
 const sockets=()=>page.evaluate(()=>window.__terminalExperience.sockets.filter(s=>s.url.includes('/ws/ssh/')).length)
 const before=await sockets();await navigate('/admin/tls');await page.getByRole('heading',{name:'HTTPS e certificados',exact:true}).waitFor()
 await page.getByText('Gestão HTTPS não configurada',{exact:true}).waitFor()
 assert.equal(await page.getByText('Não foi possível consultar o serviço',{exact:true}).count(),0)
 assert.equal(await page.getByRole('button',{name:'Validar arquivos',exact:true}).count(),0)
 await page.getByText(/No desenvolvimento local, npm run dev/).waitFor()
 notConfigured=false;await page.getByRole('button',{name:'Atualizar estado',exact:true}).click()
 await page.getByText('Nenhuma operação registrada.',{exact:true}).first().waitFor()
 const localizedDate=await page.evaluate(value=>new Date(value).toLocaleString('pt-BR'),state.active.validTo)
 await page.getByText(localizedDate,{exact:true}).waitFor()
 const input=()=>page.locator('input[type=file]')
 await input().nth(0).setInputFiles({name:'fullchain.pem',mimeType:'text/plain',buffer:Buffer.from('DEMO CERT')});await input().nth(1).setInputFiles({name:'privkey.pem',mimeType:'text/plain',buffer:Buffer.from('DEMO PRIVATE')})
 await page.getByRole('button',{name:'Validar arquivos',exact:true}).click();await page.getByRole('button',{name:'Aplicar certificado validado',exact:true}).waitFor()
 await page.getByRole('button',{name:'Aplicar certificado validado',exact:true}).click();await page.getByRole('button',{name:'Cancelar',exact:true}).click();assert.ok(!calls.includes('apply'))
 await page.getByRole('button',{name:'Aplicar certificado validado',exact:true}).click();await page.getByRole('button',{name:'Confirmar',exact:true}).click();await page.waitForFunction(()=>!document.body.innerText.includes('Em andamento'))
 assert.ok(calls.includes('apply'))
 await page.getByRole('radio',{name:/Automático/}).check();await page.getByLabel('E-mail de contato',{exact:true}).fill('ops@example.test')
 assert.equal(await page.getByRole('button',{name:'Ativar e emitir certificado',exact:true}).isDisabled(),true)
 await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Ativar e emitir certificado',exact:true}).click();await page.getByRole('button',{name:'Confirmar',exact:true}).click();await page.getByRole('button',{name:'Verificar renovação',exact:true}).waitFor()
 await page.waitForFunction(()=>!document.body.innerText.includes('Em andamento'));jobFailure=true
 await page.getByRole('button',{name:'Verificar renovação',exact:true}).click();await page.getByText('A aplicação falhou. O certificado anterior foi restaurado e verificado.',{exact:true}).first().waitFor()
 jobFailure=false
 await page.getByRole('button',{name:'Simular renovação ACME',exact:true}).click();await page.waitForFunction(()=>!document.body.innerText.includes('Em andamento'));assert.ok(calls.includes('simulate'))
 loseAck=true;const previousCount=calls.length
 await page.getByRole('button',{name:'Verificar HTTPS',exact:true}).click()
 await page.getByText('Resultado da operação recuperado, sem repetir a solicitação.',{exact:true}).waitFor()
 assert.equal(calls.length,previousCount+1);loseAck=false
 assert.equal(await page.evaluate(()=>Object.entries(sessionStorage).some(([key,value])=>key.startsWith('nodeaccess:tls:pending:')&&!!value)),false)
 rejectSubmit=true;await page.getByRole('button',{name:'Verificar HTTPS',exact:true}).click();await page.getByText('Não foi possível confirmar a operação. Atualize o estado.',{exact:false}).first().waitFor()
 await page.getByText('A solicitação não foi encontrada. Confira o estado antes de enviar novamente.',{exact:true}).waitFor();assert.equal(await sockets(),before);rejectSubmit=false;await page.getByRole('button',{name:'Atualizar estado',exact:true}).click();await page.waitForFunction(()=>!document.body.innerText.includes('Não foi possível consultar o serviço'))
 state.alerts=[{code:'CERTIFICATE_EXPIRING',severity:'warning',message:'O certificado vence em 14 dias.'}]
 await navigate('/hosts');await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')))
 await page.getByRole('button',{name:'HTTPS: 1 alerta(s). Abrir certificados.',exact:true}).waitFor()
 await page.getByRole('button',{name:'HTTPS: 1 alerta(s). Abrir certificados.',exact:true}).click()
 await page.getByText('O certificado vence em 14 dias.',{exact:true}).waitFor()
 auditOutage=true;await page.getByRole('button',{name:'Atualizar estado',exact:true}).click();await page.getByText('Auditoria central indisponível.',{exact:false}).waitFor();auditOutage=false
 fs.mkdirSync('/tmp/nodeaccess-tls-review',{recursive:true});await page.screenshot({path:`/tmp/nodeaccess-tls-review/desktop-${process.env.UI_THEME||'dark'}.png`,fullPage:true})
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:`/tmp/nodeaccess-tls-review/mobile-${process.env.UI_THEME||'dark'}.png`,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
 assert.ok(await page.locator('[data-tls-alert]').evaluate(button=>{const own=button.getBoundingClientRect(),container=button.closest('.sidebar-footer').getBoundingClientRect();return own.left>=container.left-1&&own.right<=container.right+1}), 'HTTPS indicator must fit inside collapsed sidebar')
 outage=true;await page.getByRole('button',{name:'Atualizar estado',exact:true}).click();await page.getByText('Serviço de certificados indisponível.',{exact:false}).first().waitFor();assert.equal(await page.getByRole('button',{name:'Verificar HTTPS',exact:true}).isDisabled(),true)
 outage=false;state.externalOnly=true;state.mode='external';await page.getByRole('button',{name:'Atualizar estado',exact:true}).click();await page.getByRole('radio',{name:/Proxy externo/}).check();assert.equal(await page.getByRole('radio',{name:/Automático/}).isDisabled(),true)
 assert.equal(await sockets(),before);assert.deepEqual(errors,[])
 return {passed:true,unconfiguredStateAndRecovery:true,previewAndConfirmation:true,automaticConsent:true,rollbackMessage:true,communicationFailure:true,lostAcknowledgementRecovered:true,globalExpiryAlert:true,auditOutage:true,splitDiagnostics:true,mobile:true,externalTopology:true,terminalPreserved:true,operations:calls}
}
