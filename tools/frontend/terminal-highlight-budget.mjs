import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { manualPlugin } = require('../manual/build.cjs')
const { artifactPath } = require('../shared/private-artifacts.cjs')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath('nodeaccess-highlight-budget', process.env.HIGHLIGHT_BUDGET_OUTPUT)
await mkdir(output, { recursive: true, mode: 0o700 })
const fixture = `import '/src/assets/main.css';
import { createApp, h, ref } from 'vue';
import { NConfigProvider, darkTheme } from 'naive-ui';
import Editor from '/src/components/TerminalHighlightRuleEditor.vue';
const rules = ref([{ id: '00000000-0000-4000-8000-000000000001', name: 'Avisos', pattern: 'WARN(?:ING)?', mode: 'regex', caseSensitive: false, wholeWord: true, foreground: 'amber', background: null, bold: true, enabled: true, priority: 50 }]);
createApp({ setup: () => () => h(NConfigProvider, { theme: darkTheme }, { default: () => h(Editor, { modelValue: rules.value, 'onUpdate:modelValue': value => { rules.value = value } }) }) }).mount('#app');`
const server = await createServer({ configFile: false, cacheDir: path.join(output, 'vite-cache'), root: path.join(root, 'apps/frontend'), logLevel: 'error',
  plugins: [vue(), manualPlugin(), { name: 'isolated-highlight-budget',
    resolveId(id) { if (id === '\0highlight-budget-fixture') return id },
    load(id) { if (id === '\0highlight-budget-fixture') return fixture },
    configureServer(vite) { vite.middlewares.use((req, res, next) => {
      if (req.url !== '/') return next()
      res.setHeader('Content-Type', 'text/html')
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self'; connect-src 'self'; img-src 'self' data:")
      res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="background:#111827;color:#e5e7eb;padding:16px"><h1>Destaques do terminal</h1><input id="responsive" aria-label="Entrada permanece disponível"><div id="app"></div></body></html>')
    }) },
  }], resolve: { alias: { '@': path.join(root, 'apps/frontend/src') } }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } }, optimizeDeps: { include: ['vue', 'naive-ui'] } })
let browser, page
const report = { passed: false, reports: [], limitations: 'Real Chromium workers and Vue editor with synthetic data; no SSH/VPS. Watchdog requests termination at50ms; physical cancellation is browser-controlled, not a50msCPU guarantee.' }
async function waitForWorkers(expected) {
  // Separate diagnostic window: Chromium has a documented 2s forcible-termination grace period.
  const deadline = Date.now() + 5000
  while (page.workers().length !== expected && Date.now() < deadline) await page.waitForTimeout(10)
  assert.equal(page.workers().length, expected)
}
async function mountEditor() {
  await page.evaluate(() => import('/@id/__x00__highlight-budget-fixture'))
  await page.getByText('1 correspondência(s) nesta linha.', { exact: true }).waitFor()
}
try {
  await server.listen()
  const address = server.httpServer.address()
  assert(address && typeof address !== 'string' && address.address === '127.0.0.1')
  const base = `http://127.0.0.1:${address.port}`
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || chromium.executablePath(), args: ['--no-sandbox'] })
  report.browser = await browser.version()
  for (const rate of [1, 4]) {
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    let workerCount = 0
    page.on('worker', () => { workerCount++ })
    await page.addInitScript(() => {
      const terminate = Worker.prototype.terminate
      globalThis.highlightTerminationTimes = []
      Worker.prototype.terminate = function () { globalThis.highlightTerminationTimes.push(Date.now()); return terminate.call(this) }
    })
    await page.goto(base)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate })
    const result = await page.evaluate(async () => {
      const { createHighlightClient } = await import('/src/terminal/terminal-highlight-client.ts')
      const rule = { id: 'fixture', name: 'Aviso', pattern: 'WARN(?:ING)?', mode: 'regex', caseSensitive: false, wholeWord: true, foreground: 'amber', background: null, bold: true, enabled: true, priority: 50 }
      const input = (text, patch = {}) => ({ rows: [{ key: '0', text, rules: [{ ...rule, ...patch }] }] })
      const a = createHighlightClient(), b = createHighlightClient()
      try {
        const valid = await a.run(input('WARNING WARN '.repeat(500)))
        const healthy = await b.run(input('warning WARN'))
        const literal = await a.run(input('[error].*+$', { mode: 'literal', pattern: '[error].*+$', wholeWord: false }))
        const wildcard = await a.run(input('WARNING', { mode: 'wildcard', pattern: 'WARN*' }))
        const unicode = await a.run(input('😀😀', { pattern: '(?=😀)', wholeWord: false }))
        let ticks = 0
        const timer = setInterval(() => { ticks++ }, 2)
        const start = performance.now()
        let failure
        try { await a.run(input('a'.repeat(60) + '!', { pattern: '(a|aa)+$', wholeWord: false })) } catch (error) { failure = error.code }
        clearInterval(timer)
        const elapsedMs = performance.now() - start
        const rejectedReconfigs = []
        for (let index = 0; index < 10; index++) {
          try { await b.run(input('WARNING'), `new-config-${index}`) } catch (error) { rejectedReconfigs.push(error.code) }
        }
        a.dispose(); b.dispose()
        const freshOwner = createHighlightClient()
        let freshOwnerFailure
        try { await freshOwner.run(input('WARNING')) } catch (error) { freshOwnerFailure = error.code } finally { freshOwner.dispose() }
        return { validMatches: valid.rows[0].ranges.length, validWorkerMs: valid.durationMs, failure, elapsedMs, ticks, healthy: healthy.rows[0].ranges.length, literal: literal.rows[0].ranges.length, wildcard: wildcard.rows[0].ranges.length, unicode: unicode.rows[0].ranges.length, rejectedReconfigs, freshOwnerFailure, terminatedAt: globalThis.highlightTerminationTimes.at(-1) }
      } finally { a.dispose(); b.dispose() }
    })
    assert.equal(result.failure, 'timeout'); assert(result.ticks > 0); assert(result.elapsedMs < 1500)
    assert.equal(result.validMatches, 120); assert.equal(result.healthy, 2); assert.equal(result.literal, 1); assert.equal(result.wildcard, 1); assert.equal(result.unicode, 0)
    assert.deepEqual(result.rejectedReconfigs, Array(10).fill('timeout')); assert.equal(result.freshOwnerFailure, 'timeout')
    await waitForWorkers(0)
    assert.equal(workerCount, 1)
    report.reports.push({ rate, ...result, workerCount, zeroWorkersObservedAfterTerminateMs: Date.now() - result.terminatedAt })
    await page.close()
  }
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(base); await mountEditor()
  assert.equal(await page.getByRole('status').count(), 0)
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true })
  await page.getByPlaceholder('\\bERROR\\b', { exact: true }).fill('(a|aa)+$')
  await page.getByRole('textbox', { name: 'Linha de teste para Avisos', exact: true }).fill('a'.repeat(60) + '!')
  await page.getByRole('status').getByText(/Destaques pausados nesta página/).waitFor()
  await page.locator('#responsive').fill('continua respondendo após timeout')
  await page.screenshot({ path: path.join(output, 'mobile-paused.png'), fullPage: true })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.screenshot({ path: path.join(output, 'desktop-paused.png'), fullPage: true })
  await page.getByPlaceholder('\\bERROR\\b', { exact: true }).fill('WARN')
  await page.getByRole('textbox', { name: 'Linha de teste para Avisos', exact: true }).fill('WARN')
  await page.getByRole('status').getByText(/recarregue a página/).waitFor()
  await waitForWorkers(0)
  await page.reload(); await mountEditor(); assert.equal(await page.getByRole('status').count(), 0)
  await waitForWorkers(1)
  report.editorTimeoutRequiresReload = true
  report.passed = true
  console.log(JSON.stringify(report))
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
  throw error
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  await browser?.close(); await server.close()
}
