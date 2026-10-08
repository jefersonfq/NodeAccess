const fs=require('node:fs')
const {chromium}=require('playwright')
const {installRoutes,authenticate,SESSION_ID}=require('./session-playback-playwright.cjs')
const base=process.env.FRONTEND_BASE||'http://127.0.0.1:5182'
const artifacts='/tmp/nodeaccess-audit-reconstruction-ui'
const metadata={id:'a'.repeat(64),sourceFingerprint:'b'.repeat(64),processorVersion:'ssh-readline-2026-09-29.1',createdAt:'2026-09-29T12:00:00Z',state:'complete',eventCount:20,commandCount:3,persisted:true,issues:[]}
async function scenario(browser,width,mode){
 const context=await browser.newContext({viewport:{width,height:900},acceptDownloads:true})
 await installRoutes(context)
 let current=structuredClone(metadata),gets=0,posts=0,downloads=0
 if(mode==='partial'){current.state='partial';current.issues=[{code:'EVENT_GAP',message:'Há eventos ausentes, repetidos ou fora de ordem.',fromSeq:3,toSeq:5}]}
 if(mode==='unavailable'){current.state='unavailable';current.issues=[{code:'CHUNK_UNAVAILABLE',message:'Uma parte da gravação está indisponível ou vazia.',chunkSeq:2}]}
 await context.route('**/api/v1/session-audit/**',async route=>{
  const pathname=new URL(route.request().url()).pathname
  const fulfill=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)})
  if(pathname.endsWith('/reconstruction')){
   if(route.request().method()==='POST'){
    posts++
    if(mode==='post-error')return fulfill({message:'database unavailable'},503)
    current={...metadata,id:'c'.repeat(64),commandCount:3}
   }else{gets++;if(mode==='load-error'&&gets===1)return fulfill({message:'unavailable'},503)}
   return fulfill(current)
  }
  if(pathname.endsWith('/reconstructions'))return mode==='history-error'?fulfill({message:'unavailable'},503):fulfill([{...metadata,id:'d'.repeat(64)},current])
  if(pathname.endsWith('/compare'))return fulfill({added:0,removed:0,modified:1,truncated:false,changes:[{index:1,before:'echo old',after:'echo corrected',beforeChars:8,afterChars:14,outputChanged:true,actorChanged:false}]})
  if(pathname.endsWith('/transcript')){
   downloads++
   if(mode==='download-error')return fulfill({message:'unavailable'},503)
   if(mode==='download-limit')return fulfill({message:'too large'},413)
   if(mode==='download-purged')return fulfill({message:'purged'},410)
   const format=new URL(route.request().url()).searchParams.get('format')
   const body=format==='technical'?'Processador: teste\n[stdin] echo ação\n[stdout] ação':format==='commands'?'Comandos reconstruídos\necho ação':'NodeAccess — Sessão\nlab$ echo ação\nação\nlab$'
   return route.fulfill({contentType:'text/plain; charset=utf-8',body:`${body}\n${current.issues.map(i=>i.message).join('\n')}\n`})
  }
  return route.fallback()
 })
 const page=await context.newPage();page.setDefaultTimeout(30000)
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await authenticate(page)
 await page.goto(`${base}/admin/session-audit/${SESSION_ID}?tab=commands`,{waitUntil:'domcontentloaded'})
 const panel=page.getByTestId('audit-reconstruction');await panel.waitFor()
 if(mode==='load-error'){
  await panel.getByText(/Não foi possível consultar a reconstrução/).waitFor()
  await panel.getByRole('button',{name:'Tentar novamente'}).click()
 }
 await panel.getByText(metadata.processorVersion,{exact:false}).first().waitFor()
 if(mode==='partial')await panel.getByTestId('audit-integrity-warning').waitFor()
 if(mode==='unavailable'){
  if(!await panel.getByTestId('audit-download-txt').isDisabled())throw Error('TXT should be disabled for unavailable capture')
 }else if(['download-error','download-limit','download-purged'].includes(mode)){
  await panel.getByTestId('audit-download-txt').click()
  await page.getByText(mode==='download-limit'?'Esta sessão excede o limite do TXT. Use o download JSONL original.':mode==='download-purged'?'A gravação foi removida pela política de retenção.':'Não foi possível gerar a transcrição TXT. Tente novamente.').waitFor()
 }else{
  const downloadEvent=page.waitForEvent('download');await panel.getByTestId('audit-download-txt').click();const download=await downloadEvent
  const text=fs.readFileSync(await download.path(),'utf8')
  if(download.suggestedFilename()!==`session-audit-${SESSION_ID}.txt`||!text.includes('lab$')||text.includes('stdin')||text.includes('\x1b'))throw Error('Invalid TXT export')
  if(mode==='partial'&&!text.includes('eventos ausentes'))throw Error('TXT lost integrity warning')
  if(mode==='complete')for(const [label,format,expected]of [['Somente comandos','commands','Comandos reconstruídos'],['Relatório técnico','technical','Processador:']]){
   await panel.getByTestId('audit-export-format').click();await page.getByText(label,{exact:true}).last().click()
   const event=page.waitForEvent('download');await panel.getByTestId('audit-download-txt').click();const item=await event
   if(item.suggestedFilename()!==`session-audit-${SESSION_ID}-${format}.txt`||!fs.readFileSync(await item.path(),'utf8').includes(expected))throw Error(`Invalid ${format} export`)
  }
 }
 await panel.getByText('Rastreabilidade e versões preservadas',{exact:true}).click()
 if(mode==='history-error')await panel.getByText('Não foi possível consultar o histórico de versões.').waitFor()
 else{
  const versionSelect=panel.locator('.n-select').filter({hasText:'Selecione uma versão'}).locator('.n-base-selection-label')
  await versionSelect.press('ArrowDown');await versionSelect.press('Enter')
  await panel.getByRole('button',{name:'Comparar versões'}).click()
  await panel.getByTestId('audit-version-comparison').getByText(/1 alterados/).waitFor()
 }
 if(mode==='post-error'){
  await panel.getByTestId('audit-reprocess').click();await panel.getByText(/Não foi possível consultar a reconstrução/).waitFor()
 }else if(mode==='complete'){
  await panel.getByTestId('audit-reprocess').click();await page.getByText('Gravação reprocessada. O original foi preservado.').waitFor()
 }
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2)
 if(overflow)throw Error(`Horizontal overflow ${mode}/${width}`)
 await panel.scrollIntoViewIfNeeded();await page.screenshot({path:`${artifacts}/${mode}-${width}.png`})
 if(errors.length)throw Error(errors.join('\n'))
 await context.close();return {width,mode,gets,posts,downloads,errors}
}
async function main(){fs.mkdirSync(artifacts,{recursive:true});const browser=await chromium.launch({headless:true});const results=[]
 try {for(const [width,mode]of [[1440,'complete'],[390,'complete'],[1440,'partial'],[390,'unavailable'],[1440,'load-error'],[1440,'post-error'],[1440,'download-error'],[1440,'history-error'],[1440,'download-limit'],[390,'download-purged']]){results.push(await scenario(browser,width,mode));console.log(JSON.stringify(results.at(-1)))}
 fs.writeFileSync(`${artifacts}/report.json`,JSON.stringify({ok:true,results},null,2))}finally{await browser.close()}}
main().catch(e=>{console.error(e.stack);process.exitCode=1})
