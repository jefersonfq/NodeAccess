const { artifactPath } = require('../shared/private-artifacts.cjs')
// Opt-in browser test against a local Nginx serving the actual frontend build.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')
const { probeScript, waitForEditor, resourceCategory, networkFailure, safeErrorCode } = require('./csp-probe.cjs')

async function main() {
  const base = process.env.FRONTEND_BASE || 'http://127.0.0.1:18556'
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Only a disposable local frontend is allowed')
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser', headless: true })
  const probeFiles = []
  const diagnostics = []
  const record = event => { if (diagnostics.length < 32) diagnostics.push(event) }
  let phase = 'policy'
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
      ['csp-security-probe.html', `<!doctype html><div id="csp-editor-mount" style="height:300px"></div><script>window.inlineExecuted=true</script><script src="${vs}/loader.js"></script><script src="/csp-security-probe.js"></script>`],
      ['csp-security-probe.js', probeScript(vs)],
    ]) {
      const file = path.join(root, name)
      fs.writeFileSync(file, body, { flag: 'wx' })
      probeFiles.push(file)
    }
    const page = await context.newPage()
    page.on('pageerror', () => record({ kind: 'page-error' }))
    page.on('requestfailed', request => record({ kind: 'request-failed', resource: resourceCategory(request.url(), base, vs), code: networkFailure(request.failure()?.errorText) }))
    page.on('response', response => { if (response.status() >= 400) record({ kind: 'http-error', resource: resourceCategory(response.url(), base, vs), status: response.status() }) })
    phase = 'editor-load'
    await page.addInitScript(() => {
      window.cspViolations = []
      window.addEventListener('securitypolicyviolation', event => window.cspViolations.push({ directive: event.effectiveDirective, blocked: ['inline', 'eval'].includes(event.blockedURI) ? event.blockedURI : 'other', disposition: event.disposition }))
    })
    await page.goto(`${base}/csp-security-probe.html`)
    await waitForEditor(page)
    phase = 'editor-input'
    await page.evaluate(() => window.__nodeaccessCspProbe.editor.focus())
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('// CSP editor check')
    await page.waitForFunction(() => window.__nodeaccessCspProbe.editor.getValue().includes('CSP editor check'))
    phase = 'editor-worker'
    await page.evaluate(async () => {
      const factory = await monaco.languages.typescript.getJavaScriptWorker()
      const model = window.__nodeaccessCspProbe.editor.getModel()
      const worker = await factory(model.uri)
      await worker.getSyntacticDiagnostics(model.uri.toString())
      window.__nodeaccessCspProbe.workerChecked = true
    })
    phase = 'websocket'
    await page.evaluate(() => new Promise((resolve, reject) => {
      const url = new URL('/ws/csp-probe', location.href)
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(url)
      const finish = error => { clearTimeout(timeout); socket.close(); if (error) reject(error); else resolve() }
      const timeout = setTimeout(() => finish(new Error('Same-origin WebSocket deadline')), 8000)
      socket.onopen = () => socket.send('nodeaccess-csp-probe')
      socket.onmessage = event => {
        if (event.data !== 'nodeaccess-csp-probe') return finish(new Error('Unexpected echo'))
        window.__nodeaccessCspProbe.sameOriginWebSocket = true
        finish()
      }
      socket.onerror = () => finish(new Error('Same-origin WebSocket blocked or unavailable'))
    }))
    const result = await page.evaluate(() => ({ probe: { editorReady: window.__nodeaccessCspProbe.state === 'ready', workerChecked: window.__nodeaccessCspProbe.workerChecked, sameOriginWebSocket: window.__nodeaccessCspProbe.sameOriginWebSocket, evalBlocked: window.__nodeaccessCspProbe.evalBlocked }, inlineExecuted: !!window.inlineExecuted, evalExecuted: !!window.evalExecuted, violations: window.cspViolations, editorText: window.__nodeaccessCspProbe.editor.getValue() }))
    phase = 'assertions'
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
    const report = { passed: true, policy, diagnostics, ...result }
    fs.writeFileSync(process.env.REPORT_PATH || artifactPath('nodeaccess-csp-security.json'), JSON.stringify(report, null, 2))
    console.log('CSP: inline/eval blocked; actual Monaco worker/editing and same-origin WebSocket passed')
  } catch (error) {
    const category = ['AssertionError', 'TimeoutError'].includes(error?.name) ? error.name : 'ERROR'
    fs.writeFileSync(process.env.REPORT_PATH || artifactPath('nodeaccess-csp-security.json'), JSON.stringify({ passed: false, phase, category, probeError: safeErrorCode(error?.code), diagnostics }, null, 2))
    throw new Error(`CSP probe failed: ${phase} (${category}); see sanitized report`)
  } finally { await browser.close(); for (const file of probeFiles) fs.unlinkSync(file) }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
