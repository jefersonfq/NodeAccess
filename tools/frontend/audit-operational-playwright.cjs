const fs=require('node:fs')
const assert=require('node:assert/strict')
const {chromium}=require('playwright')
const {installRoutes,authenticate}=require('./session-playback-playwright.cjs')
const config=JSON.parse(fs.readFileSync('/tmp/nodeaccess-operational-api.json','utf8'))
const base=process.env.FRONTEND_BASE||'http://127.0.0.1:5182'
const artifacts='/tmp/nodeaccess-operational-ui'
async function run(browser,scenario,width){
 const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true})
 await installRoutes(context) // Only surrounding application services are stubbed.
 const failures=[],apiCalls=[]
 let interruptExport=false,communicationFailures=0
 await context.route('**/api/v1/session-audit/**',async route=>{
  const url=new URL(route.request().url())
  if(interruptExport&&url.pathname.endsWith('/transcript')){interruptExport=false;communicationFailures++;return route.abort('connectionreset')}
  const response=await route.fetch({url:config.base+url.pathname+url.search,headers:{authorization:`Bearer ${config.token}`}})
  apiCalls.push({path:url.pathname,status:response.status()})
  if(response.status()>=400)failures.push(`${url.pathname}: ${response.status()}`)
  await route.fulfill({response})
 })
 const page=await context.newPage();page.setDefaultTimeout(30000)
 page.on('pageerror',error=>failures.push(error.message))
 page.on('dialog',async dialog=>{failures.push('Unexpected script dialog');await dialog.dismiss()})
 await authenticate(page)
 const started=Date.now()
 await page.goto(`${base}/admin/session-audit/${scenario.id}?tab=commands`,{waitUntil:'domcontentloaded'})
 const rows=page.locator('[data-audit-command-row="true"]')
 await rows.first().waitFor()
 const initialMs=Date.now()-started
 const search=page.getByPlaceholder(/Filtrar por comando ou saída|Filter by command or output/)
 const expected=scenario.expected
 let checked=0
 if(expected.length>100){
  assert.equal(await rows.count(),100)
  for(let p=1;p<6;p++)await page.getByRole('button',{name:/Próxima|Next/}).click()
  assert.equal(await rows.last().getAttribute('data-command-index'),'600')
 }
 for(const [index,item]of expected.entries()){
  if(expected.length>100&&index>=40)break
  // Search the first line; compare the complete multiline command in the actual DOM.
  const query=item.command.split('\n')[0]
  await search.fill(query)
  const target=page.locator(`[data-audit-command-row="true"][data-command-index="${index+1}"] [data-audit-command-text]`)
  await target.waitFor()
  assert.equal(await target.textContent(),item.command)
  if(item.command.includes('\n')){
   await target.scrollIntoViewIfNeeded()
   await page.screenshot({path:`${artifacts}/${scenario.id}-${width}-multiline.png`})
  }
  checked++
 }
 let outputSearches=0
 for(const needle of ['Permission denied','timed out','Unknown column','Query execution was interrupted','backup validation complete','São Paulo']){
  if(!expected.some(c=>c.output.includes(needle)))continue
  await search.fill(needle)
  const index=expected.findIndex(c=>c.output.includes(needle))+1
  const result=page.locator(`[data-audit-command-row="true"][data-command-index="${index}"]`)
  await result.waitFor()
  if(!await result.locator('[data-audit-command-output]').isVisible())await result.locator('.n-collapse-item__header').click()
  await result.locator('[data-audit-command-output]').waitFor()
  assert.ok((await result.textContent()).toLowerCase().includes(needle.toLowerCase()),`Output search: ${needle}`)
  outputSearches++
 }
 await search.fill('NA_SENTINEL_NO_RESULT_7290')
 await page.waitForFunction(()=>document.querySelectorAll('[data-audit-command-row="true"]').length===0)
 await search.fill('');await rows.first().waitFor()
 if(scenario.id===4178){
  await search.fill('<img')
  const output=rows.first().locator('[data-audit-command-output]')
  await rows.first().locator('.n-collapse-item__header').click();await output.waitFor()
  assert.ok((await output.textContent()).includes('<img src=x'))
  assert.equal(await output.locator('img').count(),0)
  await search.fill('')
 }
 const panel=page.getByTestId('audit-reconstruction')
 if(scenario.id===4177&&width===1440){
  interruptExport=true
  await panel.getByTestId('audit-download-txt').click()
  await page.getByText('Não foi possível gerar a transcrição TXT. Tente novamente.').waitFor()
  assert.equal(await rows.count(),expected.length)
 }
 const downloads=[]
 for(const [format,label]of [['terminal',null],['commands','Somente comandos'],['technical','Relatório técnico']]){
  if(label){await panel.getByTestId('audit-export-format').click();await page.getByText(label,{exact:true}).last().click()}
  const event=page.waitForEvent('download');await panel.getByTestId('audit-download-txt').click();const download=await event
  const text=fs.readFileSync(await download.path(),'utf8')
  assert.equal(download.suggestedFilename(),`session-audit-${scenario.id}${format==='terminal'?'':`-${format}`}.txt`)
  for(const item of expected)assert.ok(text.includes(item.command),`Missing ${format} command: ${item.command}`)
  if(format==='terminal'){assert.ok(!text.includes('\x1b'));assert.ok(!text.includes('�'));assert.ok(!text.includes('EVENTOS VÁLIDOS'))}
  if(format==='technical')assert.ok(text.includes('EVENTOS VÁLIDOS'))
  downloads.push({format,bytes:Buffer.byteLength(text)})
 }
 await page.locator('.n-tabs-tab').filter({hasText:/Playback/}).click()
 await page.getByTestId('session-playback-panel').waitFor()
 await page.locator('[data-playback-action="load-end"]').click()
 await page.getByTestId('playback-progress').filter({hasText:'100%'}).waitFor()
 const terminal=page.locator('[data-playback-terminal="true"]')
 assert.ok((await terminal.textContent()).includes(expected.at(-1).command.split('\n')[0]))
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false)
 await page.screenshot({path:`${artifacts}/${scenario.id}-${width}.png`})
 assert.deepEqual(failures,[])
 await context.close()
 return {sessionId:scenario.id,name:scenario.name,width,expectedCommands:expected.length,checkedCommands:checked,outputSearches,emptySearch:true,communicationFailures,downloads,initialMs,apiCalls:apiCalls.length,failures}
}
async function main(){
 fs.mkdirSync(artifacts,{recursive:true})
 const browser=await chromium.launch({headless:true}),results=[]
 try {
  const selected=config.scenarios.filter(s=>!process.env.AUDIT_SCENARIO_ID||s.id===Number(process.env.AUDIT_SCENARIO_ID))
  for(const scenario of selected)for(const width of scenario.id===4181?[1440]:[1440,390]){
   const result=await run(browser,scenario,width);results.push(result);console.log(JSON.stringify(result))
  }
  fs.writeFileSync(process.env.REPORT_PATH||`${artifacts}/report.json`,JSON.stringify({ok:true,backend:'real audit routes/services with synthetic in-memory storage',results},null,2))
 }finally{await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
