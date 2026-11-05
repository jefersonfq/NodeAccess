// Negative security proof against the real nginx document and real application CSS.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium } = require('playwright')
const { artifactPath } = require('../shared/private-artifacts.cjs')
async function main() {
  const base = process.env.FRONTEND_BASE || 'http://127.0.0.1:18556'
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname))
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser', headless: true })
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: process.env.CSP_SELF_SIGNED === '1' })
    const first = await context.request.get(`${base}/index.html`)
    const second = await context.request.get(`${base}/hosts`, { headers: { 'If-Modified-Since': new Date().toUTCString() } })
    assert.equal(first.status(), 200)
    assert.equal(second.status(), 200)
    const nonce = response => response.headers()['content-security-policy'].match(/'nonce-([^']+)'/)[1]
    assert.notEqual(nonce(first), nonce(second))
    assert.equal(Buffer.from(nonce(first), 'base64').length, 32)
    assert.ok((await first.text()).includes(`nonce="${nonce(first)}"`))
    assert.ok(!(await first.text()).includes('__NODEACCESS_CSP_NONCE__'))
    assert.match(first.headers()['cache-control'], /no-store/)
    const asset = await context.request.get(`${base}/favicon.svg`)
    assert.ok(!asset.headers()['content-security-policy'].includes('nonce-'))
    const page = await context.newPage()
    await page.addInitScript(() => {
      window.cspViolations = []
      document.addEventListener('securitypolicyviolation', e => window.cspViolations.push({ directive: e.effectiveDirective, blocked: e.blockedURI, source: new URL(e.sourceFile || location.href).pathname }))
    })
    await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
    await page.locator('input').first().waitFor()
    const initial = await page.evaluate(() => ({ violations: window.cspViolations, styles: [...document.querySelectorAll('style')].map(s => ({ nonced: !!s.nonce, rules: s.sheet?.cssRules.length || 0 })) }))
    assert.ok(initial.styles.some(s => s.nonced && s.rules > 0), 'Actual NaiveUI CSS must load')
    // Zod capability-detects Function and falls back when the strict script policy blocks it.
    const unexpected = initial.violations.filter(v => !(v.directive === 'script-src' && v.blocked === 'eval' && /^\/assets\/vendor-validation-/.test(v.source)))
    assert.deepEqual(unexpected, [], 'Application CSS must have no unexpected CSP violations')
    // Supply only the external test script; the real document/header still
    // governs browser eval. This also works with an immutable packaged image.
    await page.route(`${base}/csp-eval-probe.js`, route => route.fulfill({
      contentType: 'application/javascript',
      body: "try { window.eval('window.cspEvalExecuted = true'); window.cspEvalBlocked = false } catch { window.cspEvalBlocked = true }",
    }))
    await page.addScriptTag({ url: `${base}/csp-eval-probe.js` })
    const proof = await page.evaluate(() => {
      const target = document.createElement('div')
      target.id = 'csp-proof'
      document.body.append(target)
      const apply = (color, nonce) => {
        const style = document.createElement('style')
        if (nonce) style.nonce = nonce
        style.textContent = `#csp-proof { color: ${color} !important; }`
        document.head.append(style)
        return getComputedStyle(target).color
      }
      const before = getComputedStyle(target).color
      const noNonce = apply('rgb(1, 2, 3)')
      const wrongNonce = apply('rgb(4, 5, 6)', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')
      const authorized = apply('rgb(7, 8, 9)', document.querySelector('meta[property="csp-nonce"]').nonce)
      const script = document.createElement('script')
      script.textContent = 'window.cspInlineExecuted = true'
      document.head.append(script)
      const evalBlocked = window.cspEvalBlocked
      target.remove()
      return { before, noNonce, wrongNonce, authorized, inlineExecuted: !!window.cspInlineExecuted, evalBlocked }
    })
    assert.equal(proof.noNonce, proof.before)
    assert.equal(proof.wrongNonce, proof.before)
    assert.equal(proof.authorized, 'rgb(7, 8, 9)')
    assert.equal(proof.inlineExecuted, false)
    assert.equal(proof.evalBlocked, true)
    await page.screenshot({ path: artifactPath('nodeaccess-csp-login.png'), fullPage: true })
    fs.writeFileSync(artifactPath('nodeaccess-csp-styles.json'), JSON.stringify({ status: 'passed', initial, proof }, null, 2))
    console.log('CSP styles: real UI, nonce uniqueness, negative styles/scripts, cache and assets passed')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
