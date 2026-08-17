#!/usr/bin/env node
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
function token(forcePasswordChange) {
  const now = Math.floor(Date.now() / 1000)
  const payload = { sub:'1',tenantId:1,name:'Admin',role:'admin',email:'admin@example.test',isPlatformAdmin:false,forcePasswordChange,stage:'authenticated',iat:now,exp:now+3600 }
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.harness`
}
async function context(browser, viewport, forced = false) {
  const ctx = await browser.newContext({ viewport })
  await ctx.addInitScript(({ access }) => { localStorage.setItem('na_access_token', access); localStorage.setItem('na_refresh_token','harness') }, { access: token(forced) })
  await ctx.route('**/api/v1/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname
    let body = []
    if (path === '/api/v1/features') body = { mcpLicensed:true,mcpEnvironmentEnabled:true,mcpOperational:true }
    else if (path === '/api/v1/mcp/jsonrpc') body = { jsonrpc:'2.0',id:'status',result:{ protocolVersion:'2025-06-18',serverInfo:{name:'nodeaccess-mcp',version:'test'} } }
    else if (path === '/api/v1/mcp/admin/capabilities') body = [{key:'search_hosts',kind:'tool',title:'Buscar hosts',description:'Busca hosts',module:'hosts',scope:'tenant',risk:'low',accessMode:'read_only'}]
    else if (path === '/api/v1/mcp/admin/tokens' && req.method() === 'POST') body = { token:'na_mcp_secret_once',record:{id:44,name:'Codex UX',allowedCapabilities:['search_hosts'],allowedActionModes:['read_only'],allowedHostIds:[],createdById:1,createdByName:'Admin',revokedAt:null,expiresAt:null,lastUsedAt:null,createdAt:new Date().toISOString()} }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)})
  })
  return ctx
}
async function passwordFlow(browser, viewport) {
  const ctx = await context(browser, viewport, true), page = await ctx.newPage(); page.setDefaultTimeout(10000)
  await page.goto(`${FRONTEND}/profile`, {waitUntil:'domcontentloaded'})
  const section = page.getByTestId('password-change-section'), input = page.getByTestId('new-password-input').locator('input')
  await input.waitFor(); await page.waitForTimeout(500)
  if (!await input.evaluate(el => el === document.activeElement)) throw new Error('Nova senha não recebeu foco após reset')
  const box = await section.boundingBox()
  if (!box || box.y < 0 || box.y >= viewport.height) throw new Error('Formulário obrigatório permaneceu fora da viewport')
  await ctx.close(); return {viewport,expanded:true,focused:true,visible:true}
}
async function tokenFlow(browser, viewport) {
  const ctx = await context(browser, viewport), page = await ctx.newPage(); page.setDefaultTimeout(10000)
  await page.goto(`${FRONTEND}/admin/mcp-tokens`, {waitUntil:'domcontentloaded'})
  await page.getByRole('button',{name:'Novo token'}).click()
  const modal=page.locator('.n-modal').filter({hasText:'Novo token MCP'})
  await modal.getByPlaceholder('Ex.: Claude - Operação').fill('Codex UX')
  await modal.getByRole('button',{name:'Criar token'}).click()
  const result=modal.getByTestId('created-token-result'); await result.waitFor()
  const copy=modal.getByRole('button',{name:'Copiar token'}), box=await result.boundingBox()
  if (!await copy.evaluate(el=>el===document.activeElement)) throw new Error('CTA de copiar token não recebeu foco')
  if (!box || box.y < 0 || box.y >= viewport.height) throw new Error('Token criado permaneceu fora da viewport')
  if (await modal.getByRole('button',{name:'Criar token'}).count()) throw new Error('CTA permitiu criação duplicada após sucesso')
  await modal.getByRole('button',{name:'Concluir'}).waitFor()
  await ctx.close(); return {viewport,resultNearAction:true,copyFocused:true,duplicateBlocked:true}
}
async function main(){const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||chromium.executablePath(),args:['--no-sandbox','--disable-gpu']});try{const results=[];for(const viewport of [{width:1440,height:960},{width:390,height:844}]){results.push({password:await passwordFlow(browser,viewport),token:await tokenFlow(browser,viewport)})}console.log(JSON.stringify({ok:true,results},null,2))}finally{await browser.close()}}
main().catch(error=>{console.error(error);process.exitCode=1})
