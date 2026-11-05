const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('real Chromium reports an unavailable local editor module under enforced Nginx CSP', { skip: process.env.RUN_CSP_PROBE_REAL !== 'true' }, async () => {
  const base = process.env.FRONTEND_BASE || 'http://127.0.0.1:18556'
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname))
  const { chromium } = require('playwright')
  const asset = fs.readdirSync(path.resolve(__dirname, '../../apps/frontend/dist/assets')).find(name => /^vendor-monaco-.*\.js$/.test(name))
  assert.ok(asset)
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser' })
  try {
    const page = await browser.newPage({ ignoreHTTPSErrors: process.env.CSP_SELF_SIGNED === '1' })
    let failures = 0
    await page.route(`${base}/assets/${asset}`, route => { failures++; return route.abort('namenotresolved') })
    const response = await page.goto(`${base}/login`)
    assert.equal(response.status(), 200)
    assert.ok(response.headers()['content-security-policy'])
    const rejected = await page.evaluate(async url => {
      try { await import(url); return false } catch { return true }
    }, `/assets/${asset}`)
    assert.equal(rejected, true)
    assert.ok(failures >= 1, 'The local editor request must actually be aborted (preload/import may retry)')
    assert.equal(await page.locator('.monaco-editor').count(), 0)
  } finally { await browser.close() }
})
