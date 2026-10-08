const fs = require('node:fs')
const assert = require('node:assert/strict')
module.exports = async ({ page, context }) => {
  const checks = []
  await page.evaluate(() => { window.__terminalExperience.reviewFiles = true })
  await page.locator('[data-terminal-rail-action="files"]').click()
  await page.getByText('review.conf', { exact: true }).waitFor()
  const connections = await page.evaluate(() => window.__terminalExperience.sockets.length)
  await page.locator('.xterm-helper-textarea').first().focus()
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea')), true, 'Terminal focused before injecting failure')
  await page.evaluate(() => {
    const root = document.querySelector('#app').__vue_app__._instance
    function find(node) {
      if (!node) return null
      if (node.component?.type?.__name === 'FileManager') return node.component
      if (node.component) { const found = find(node.component.subTree); if (found) return found }
      for (const child of Array.isArray(node.children) ? node.children : []) { const found = find(child); if (found) return found }
      return find(node.ssContent)
    }
    const panel = find(root.subTree)
    if (!panel) throw new Error('FileManager instance not found')
    panel.render = () => { throw new Error('fixture-sensitive-exception') }
    panel.update()
  })
  await page.getByText('Não foi possível carregar este painel. A sessão de terminal continua aberta.', { exact: true }).waitFor()
  assert.equal(await page.getByText('fixture-sensitive-exception').count(), 0)
  const focusAfterError = await page.evaluate(() => ({ tag: document.activeElement?.tagName, classes: document.activeElement?.className, html: document.activeElement?.outerHTML?.slice(0, 500), textareas: document.querySelectorAll('.xterm-helper-textarea').length }))
  console.log('Focus after panel error:', JSON.stringify(focusAfterError))
  assert.equal(focusAfterError.classes?.includes('xterm-helper-textarea'), true, 'Background panel error must not steal terminal focus')
  const retry = page.getByRole('button', { name: 'Tentar novamente', exact: true })
  await retry.focus(); await retry.press('Enter')
  await page.getByText('review.conf', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.__terminalExperience.sockets.length), connections)
  checks.push('Real FileManager render exception is contained; keyboard retry recovers without reconnecting SSH')
  await page.locator('.xterm-helper-textarea').first().focus()
  await page.keyboard.type('echo boundary-recovered\n')
  assert.match(await page.evaluate(() => window.__terminalExperience.inputSent.join('')), /boundary-recovered/)
  checks.push('Terminal input remains operational after panel recovery')
  await context.route('**/api/v1/hardening-slow', () => {})
  const timeout = await page.evaluate(async () => {
    const { default: api } = await import('/src/services/api.ts')
    const start = performance.now()
    try { await api.get('/hardening-slow', { timeout: 50 }); return { failed: false } }
    catch (error) { return { failed: true, code: error.code, duration: performance.now() - start } }
  })
  assert.equal(timeout.failed, true); assert.equal(timeout.code, 'ECONNABORTED'); assert(timeout.duration < 2000)
  checks.push('HTTP request aborts at explicit deadline without reloading the page')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'docs/reviews/evidence/2026-10-05-engineering-hardening/panel-recovered-mobile.png' })
  fs.writeFileSync('docs/reviews/evidence/2026-10-05-engineering-hardening/ui-hardening.json', JSON.stringify({ success: true, checks, timeout }, null, 2))
  return { success: true, checks, timeout }
}
