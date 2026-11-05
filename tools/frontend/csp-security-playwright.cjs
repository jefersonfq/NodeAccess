const { artifactPath } = require('../shared/private-artifacts.cjs')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

async function main() {
  const base = process.env.FRONTEND_BASE || 'http://127.0.0.1:18556'
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname))
  const root = path.resolve(__dirname, '../../apps/frontend/dist')
  const assets = fs.readdirSync(path.join(root, 'assets'))
  // Discover the actual build's worker bootstrap and module exports; no mock editor or CDN.
  const bootstrap = assets.find(name => name.endsWith('.js') && fs.readFileSync(path.join(root, 'assets', name), 'utf8').includes('self.MonacoEnvironment='))
  const editor = assets.find(name => /^vendor-monaco-.*\.js$/.test(name))
  const stylesheet = assets.find(name => /^vendor-monaco-.*\.css$/.test(name))
  assert.ok(bootstrap && editor && stylesheet, 'Build must contain local Monaco assets')
  const editorSource = fs.readFileSync(path.join(root, 'assets', editor), 'utf8')
  assert.ok(editorSource.includes('3.4.17'), 'Build must contain the fixed DOMPurify runtime')
  assert.ok(!editorSource.includes('3.2.7'), 'Vulnerable vendored DOMPurify must not remain in the build')
  const probeScript = `
    import * as runtimeExports from '/assets/${bootstrap}';
    import * as exports from '/assets/${editor}';
    const monaco = Object.values({ ...exports, ...runtimeExports }).find(value => value?.editor?.create && value?.languages);
    const container = document.createElement('div');
    container.id = 'csp-editor-mount';
    Object.assign(container.style, { position: 'fixed', inset: '20px', zIndex: '99999', height: '400px' });
    document.body.append(container);
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/assets/${stylesheet}'; document.head.append(link);
    const probe = window.__nodeaccessCspProbe = { monaco, container };
    probe.create = () => monaco.editor.create(container, { value: 'const answer = 42', language: 'javascript', theme: 'vs-dark', automaticLayout: true });
    probe.editor = probe.create();
    try { window.eval('window.cspEvalExecuted = true'); probe.evalBlocked = false } catch { probe.evalBlocked = true }
    probe.ready = true;
  `
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser', headless: true })
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: process.env.CSP_SELF_SIGNED === '1' })
    const page = await context.newPage()
    // Only the explicit test script is supplied; document CSP and all product assets stay real.
    await page.route(`${base}/csp-security-probe.js`, route => route.fulfill({ contentType: 'application/javascript', body: probeScript }))
    await page.addInitScript(() => {
      window.cspViolations = []
      document.addEventListener('securitypolicyviolation', e => window.cspViolations.push({ directive: e.effectiveDirective, blocked: e.blockedURI, source: new URL(e.sourceFile || location.href).pathname }))
    })
    const initialEditorRequests = []
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname
      if (pathname === `/assets/${bootstrap}` || pathname === `/assets/${editor}` || pathname === `/assets/${stylesheet}` || /\.worker-[^/]+\.js$/.test(pathname)) initialEditorRequests.push(pathname)
    })
    await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
    await page.locator('input').first().waitFor()
    assert.deepEqual(initialEditorRequests, [], 'Login must not download Monaco or its workers')
    await page.addScriptTag({ url: `${base}/csp-security-probe.js`, type: 'module' })
    await page.waitForFunction(() => window.__nodeaccessCspProbe?.ready)
    await page.evaluate(() => window.__nodeaccessCspProbe.editor.focus())
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('// CSP editor check')
    await page.waitForFunction(() => window.__nodeaccessCspProbe.editor.getValue().includes('CSP editor check'))
    await page.keyboard.press('Control+f')
    await page.locator('.find-widget.visible').waitFor()
    await page.keyboard.press('Escape')
    await page.evaluate(async () => {
      const p = window.__nodeaccessCspProbe
      const factory = await p.monaco.languages.typescript.getJavaScriptWorker()
      const model = p.editor.getModel()
      const worker = await factory(model.uri)
      await worker.getSyntacticDiagnostics(model.uri.toString())
      p.workerChecked = true
      p.monaco.editor.setTheme('vs')
    })
    await page.locator('.monaco-editor.vs').waitFor()
    await page.screenshot({ path: artifactPath('nodeaccess-csp-editor-light.png') })
    await page.evaluate(() => {
      const p = window.__nodeaccessCspProbe
      p.editor.dispose()
      p.editor = p.create()
    })
    await page.locator('.monaco-editor.vs-dark').waitFor()
    await page.screenshot({ path: artifactPath('nodeaccess-csp-editor-dark-reopened.png') })
    // Real same-origin socket through nginx, backed by csp-ws-fixture.cjs.
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
      socket.onerror = () => finish(new Error('Same-origin WebSocket unavailable'))
    }))
    const proof = await page.evaluate(() => ({ sameOriginWebSocket: window.__nodeaccessCspProbe.sameOriginWebSocket, workerChecked: window.__nodeaccessCspProbe.workerChecked, evalBlocked: window.__nodeaccessCspProbe.evalBlocked, reopenedText: window.__nodeaccessCspProbe.editor.getValue(), violations: window.cspViolations }))
    assert.equal(proof.sameOriginWebSocket, true)
    assert.equal(proof.workerChecked, true)
    assert.equal(proof.evalBlocked, true)
    assert.equal(proof.reopenedText, 'const answer = 42')
    const unexpected = proof.violations.filter(v => !(v.directive === 'script-src' && v.blocked === 'eval' && (/^\/assets\/vendor-validation-/.test(v.source) || v.source === '/csp-security-probe.js')))
    assert.deepEqual(unexpected, [], 'Real editor must not violate the enforced policy')
    fs.writeFileSync(process.env.REPORT_PATH || artifactPath('nodeaccess-csp-security.json'), JSON.stringify({ passed: true, initialEditorRequests: 0, ...proof }, null, 2))
    console.log('CSP: actual local Monaco editing, search, worker, themes and reopening passed')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
