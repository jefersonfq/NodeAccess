const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const root = process.argv[2], mode = process.argv[3], out = process.env.NA0152_OUTPUT || `/tmp/NA0152-${mode}`
const req = require('node:module').createRequire(path.join(root,'package.json'))
const {createServer}=req('vite'), vue=req('@vitejs/plugin-vue').default, {chromium}=req('playwright')
;(async()=>{
 fs.mkdirSync(out,{recursive:true});let browser,server
 try{
 server=await createServer({configFile:false,root:path.join(root,'apps/frontend'),cacheDir:path.join(root,'.sonar-reports','vite-'+mode),plugins:[vue()],resolve:{alias:{'@':path.join(root,'apps/frontend/src')}},optimizeDeps:{include:['vue','naive-ui']},server:{host:'127.0.0.1',port:0,fs:{allow:[root,'/tmp/nodeaccess-NA-0093']}}});await server.listen()
 const base=server.resolvedUrls.local[0];browser=await chromium.launch({headless:true,executablePath:'/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'})
 const page=await browser.newPage({viewport:{width:1365,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.route('**/*',route=>{const u=new URL(route.request().url()); if(u.origin!==new URL(base).origin)return route.abort();if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<html><body><div id="app"></div></body></html>'});if(u.pathname.startsWith('/api/'))return route.abort();return route.continue()})
 await page.goto(base);await page.evaluate(async(cache)=>{const {createApp,h}=await import(`${cache}/vue.js`);const {NMessageProvider}=await import(`${cache}/naive-ui.js`);const {default:Setup}=await import('/src/components/mcp/McpAgentSetup.vue');window.copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async s=>window.copied.push(s)}});createApp({render:()=>h(NMessageProvider,null,{default:()=>h(Setup,{show:true,baseUrl:'https://nodeaccess.example.test/api/v1'})})}).mount('#app')},`/@fs${root}/.sonar-reports/vite-${mode}/deps`)
 const copy=page.getByRole('button',{name:'Copiar comando de cadastro',exact:true});await copy.waitFor({state:'visible'});await copy.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>window.copied.length===1)
 const summary=page.locator('[data-testid="mcp-config-alternative"] summary');await summary.focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Copiar configuração',exact:true}).waitFor({state:'visible'})
 const results=[]
 for(const viewport of [{width:1365,height:1000},{width:390,height:844}]){
 await page.setViewportSize(viewport);await page.locator('[data-testid="mcp-register"]').scrollIntoViewIfNeeded();
 await page.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))))
 const pres=await page.locator('.mcp-setup pre').evaluateAll(els=>els.map(e=>({name:e.getAttribute('aria-label'),tabIndex:e.tabIndex,rect:{width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height},text:e.textContent})))
 assert.equal(pres.length,3);assert(pres.every(p=>p.tabIndex===(mode==='before'?0:-1)))
 await page.screenshot({path:`${out}/${viewport.width}.png`,fullPage:true});results.push({viewport,pres})
 }
 await page.setViewportSize({width:1365,height:1000});await summary.focus();await page.keyboard.press('Tab');const target=await page.evaluate(()=>({tag:document.activeElement.tagName,text:document.activeElement.textContent,tabIndex:document.activeElement.tabIndex}));assert.equal(target.tag,mode==='before'?'PRE':'BUTTON');if(mode==='after'){assert.match(target.text,/Copiar configuração/);await page.keyboard.press('Enter');await page.waitForFunction(()=>window.copied.length===2);await page.keyboard.press('Shift+Tab');assert(await summary.evaluate(e=>e===document.activeElement))}
 await page.getByTestId('mcp-agent-select').click();await page.getByText('Claude Code',{exact:true}).last().click();await page.getByRole('button',{name:'Copiar configuração',exact:true}).waitFor({state:'visible'});assert.equal(await page.locator('.mcp-setup pre').count(),2);assert(await page.locator('.mcp-setup pre').evaluateAll((es,expected)=>es.every(e=>e.tabIndex===expected),mode==='before'?0:-1));
 assert.deepEqual(errors,[]);fs.writeFileSync(`${out}/report.json`,JSON.stringify({mode,results,target,errors,clipboardCount:await page.evaluate(()=>window.copied.length)},null,2));console.log('PASS',mode,out)
 }finally{await browser?.close();await server?.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
