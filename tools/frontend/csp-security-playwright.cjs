// Opt-in browser test against a local Nginx serving the actual frontend build.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

async function main() {
  const base = process.env.FRONTEND_BASE || 'http://127.0.0.1:18556'
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Only a disposable local frontend is allowed')
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser', headless: true })
  const probeFiles = []
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: process.env.CSP_SELF_SIGNED === '1' })
    const response = await context.request.get(`${base}/index.html`)
    assert.equal(response.status(), 200)
    const policy = response.headers()['content-security-policy']
    assert.ok(policy, 'Enforced policy must come from the real Nginx response')
    assert.ok(!policy.includes("'unsafe-eval'"))
    assert.match(policy, /form-action 'self'/)
    // Read the installed loader configuration; dependency updates must match CSP.
    const configPath = path.join(path.dirname(require.resolve('@monaco-editor/loader/package.json')), 'lib/cjs/config/index.js')
    const vs = require(configPath).default.paths.vs
    assert.ok(policy.includes(`${vs}/;`), 'CSP and actual Monaco loader version diverged')
    // Serve real Nginx bytes: route mocks trigger Local Network Access for WS.
    const root = path.resolve(__dirname, '../../apps/frontend/dist')
    for (const [name, body] of [
      ['csp-security-probe.html', `<!doctype html><div id="editor" style="height:300px"></div><script>window.inlineExecuted=true</script><script src="${vs}/loader.js"></script><script src="/csp-security-probe.js"></script>`],
      ['csp-security-probe.js', `window.probe={};try{eval('window.evalExecuted=true')}catch(e){window.probe.evalBlocked=e instanceof EvalError}require.config({paths:{vs:${JSON.stringify(vs)}}});require(['vs/editor/editor.main'],()=>{window.editor=monaco.editor.create(document.getElementById('editor'),{value:'const answer = 42',language:'javascript'});window.probe.editorReady=true;},error=>window.probe.error=String(error));`],
    ]) {
      const file = path.join(root, name)
      fs.writeFileSync(file, body, { flag: 'wx' })
      probeFiles.push(file)
    }
    const page = await context.newPage()
    await page.addInitScript(() => {
      window.cspViolations = []
      window.addEventListener('securitypolicyviolation', event => window.cspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI, disposition: event.disposition }))
    })
    await page.goto(`${base}/csp-security-probe.html`)
    await page.waitForFunction(() => window.probe?.editorReady || window.probe?.error, {}, { timeout: 45000 })
    await page.evaluate(() => window.editor.focus())
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('// CSP editor check')
    await page.waitForFunction(() => window.editor.getValue().includes('CSP editor check'))
    await page.evaluate(async () => {
      const factory = await monaco.languages.typescript.getJavaScriptWorker()
      const model = window.editor.getModel()
      const worker = await factory(model.uri)
      await worker.getSyntacticDiagnostics(model.uri.toString())
      window.probe.workerChecked = true
    })
    await page.evaluate(() => new Promise((resolve, reject) => {
      const url = new URL('/ws/csp-probe', location.href)
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(url)
      const finish = error => { clearTimeout(timeout); socket.close(); if (error) reject(error); else resolve() }
      const timeout = setTimeout(() => finish(new Error('Same-origin WebSocket deadline')), 8000)
      socket.onopen = () => socket.send('nodeaccess-csp-probe')
      socket.onmessage = event => {
        if (event.data !== 'nodeaccess-csp-probe') return finish(new Error('Unexpected echo'))
        window.probe.sameOriginWebSocket = true
        finish()
      }
      socket.onerror = () => finish(new Error('Same-origin WebSocket blocked or unavailable'))
    }))
    const result = await page.evaluate(() => ({ probe: window.probe, inlineExecuted: !!window.inlineExecuted, evalExecuted: !!window.evalExecuted, violations: window.cspViolations, editorText: window.editor.getValue() }))
    assert.equal(result.probe.editorReady, true)
    assert.equal(result.probe.workerChecked, true)
    assert.equal(result.probe.sameOriginWebSocket, true)
    assert.equal(result.probe.evalBlocked, true)
    assert.equal(result.inlineExecuted, false)
    assert.equal(result.evalExecuted, false)
    assert.match(result.editorText, /CSP editor check/)
    assert.ok(result.violations.some(item => item.blocked === 'inline' && item.disposition === 'enforce'))
    assert.ok(result.violations.some(item => item.blocked === 'eval' && item.disposition === 'enforce'))
    assert.deepEqual(result.violations.filter(item => !['inline', 'eval'].includes(item.blocked)), [])
    const report = { passed: true, policy, ...result }
    fs.writeFileSync(process.env.REPORT_PATH || '/tmp/nodeaccess-csp-security.json', JSON.stringify(report, null, 2))
    console.log('CSP: inline/eval blocked; actual Monaco worker/editing and same-origin WebSocket passed')
  } finally { await browser.close(); for (const file of probeFiles) fs.unlinkSync(file) }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
