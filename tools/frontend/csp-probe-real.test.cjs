const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { probeScript, waitForEditor } = require('./csp-probe.cjs')

test('real Chromium rejects an unavailable CDN loader under actual Nginx CSP', { skip: process.env.RUN_CSP_PROBE_REAL !== 'true' }, async () => {
  const base = process.env.FRONTEND_BASE || 'http://127.0.0.1:18556'
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Disposable local frontend required')
  const { chromium } = require('playwright')
  const config = require(path.join(path.dirname(require.resolve('@monaco-editor/loader/package.json')), 'lib/cjs/config/index.js'))
  const vs = config.default.paths.vs
  const root = path.resolve(__dirname, '../../apps/frontend/dist')
  const files = []
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH })
  try {
    for (const [name, content] of [
      ['csp-negative-loader.html', `<div id="editor"></div><div id="csp-editor-mount"></div><script src="${vs}/loader.js"></script><script src="/csp-negative-loader.js"></script>`],
      ['csp-negative-loader.js', probeScript(vs)],
    ]) {
      const file = path.join(root, name)
      fs.writeFileSync(file, content, { flag: 'wx' }); files.push(file)
    }
    const page = await browser.newPage({ ignoreHTTPSErrors: process.env.CSP_SELF_SIGNED === '1' })
    let failures = 0
    // Negative fault injection only; successful Monaco/worker tests use the real CDN unchanged.
    await page.route(`${vs}/**`, route => { failures++; return route.abort('namenotresolved') })
    const response = await page.goto(`${base}/csp-negative-loader.html`)
    assert.equal(response.status(), 200)
    assert.ok(response.headers()['content-security-policy'])
    await assert.rejects(waitForEditor(page), error => error.code === 'LOADER_UNAVAILABLE')
    assert.equal(failures, 1)
    assert.equal(await page.evaluate(() => window.editor instanceof HTMLElement), true)
    assert.equal(await page.evaluate(() => window.__nodeaccessCspProbe.editor), null)
  } finally {
    await browser.close()
    for (const file of files) fs.unlinkSync(file)
  }
})
