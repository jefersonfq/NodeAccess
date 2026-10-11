const { createRequire } = require('node:module')
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), zlib = require('node:zlib')
const root = path.resolve(__dirname, '../..')
const { chromium } = createRequire(root + '/package.json')('playwright')
const reportPath = process.env.FRONTEND_ENTRY_REPORT || '/tmp/nodeaccess-frontend-entry.json'
const baseline = process.argv[2] ? path.resolve(process.argv[2]) : null
async function main() {
 const browser = await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser'})
 const reports = []
 try {
  for (const profile of (baseline ? ['before','after'] : ['after'])) {
   const dir = profile === 'before' ? baseline : root+'/apps/frontend/dist'
   const server = http.createServer((req,res) => {
    let pathname = new URL(req.url,'http://localhost').pathname
    if (pathname.includes('..')) { res.writeHead(400).end(); return }
    let target = path.join(dir,pathname)
    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) target=path.join(dir,'index.html')
    const ext=path.extname(target)
    res.setHeader('Content-Type', ({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[ext]||'application/octet-stream')
    res.end(fs.readFileSync(target))
   })
   await new Promise(r=>server.listen(0,'127.0.0.1',r))
   const origin='http://127.0.0.1:'+server.address().port
   const context=await browser.newContext()
   try {
    const page=await context.newPage(), scripts=new Set(), errors=[]
    page.on('pageerror',e=>errors.push(e.message))
    page.on('request',req=>{ if(new URL(req.url()).pathname.endsWith('.js'))scripts.add(new URL(req.url()).pathname) })
    await page.route('**/*',route=>{
      const url=new URL(route.request().url())
      if(url.origin!==origin) return route.abort()
      if(url.pathname.startsWith('/api/')) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,data:{providers:[],enabled:false}})})
      return route.continue()
    })
    await page.goto(origin+'/auth/login')
    await page.locator('input[autocomplete=email]').waitFor({state:'visible',timeout:30000})
    await page.waitForLoadState('networkidle')
    const bytes=[...scripts].map(p=>fs.readFileSync(path.join(dir,p)))
    reports.push({profile, scripts:[...scripts], jsBytes:bytes.reduce((n,b)=>n+b.length,0), gzipBytes:bytes.reduce((n,b)=>n+zlib.gzipSync(b).length,0),errors,loginVisible:true})
   } finally {await context.close(); await new Promise(r=>server.close(r))}
  }
 } finally {await browser.close()}
 fs.writeFileSync(reportPath,JSON.stringify(reports,null,2))
 console.log(JSON.stringify(reports.map(({scripts,...r})=>({...r,terminalDownloaded:scripts.some(p=>p.includes('vendor-terminal'))}))))
 if (reports.some(r=>r.errors.length) || reports.at(-1).scripts.some(p=>p.includes('vendor-terminal'))) process.exitCode=1
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
