const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve, join } = require('node:path')
const { randomUUID, createHash } = require('node:crypto')
const { pathToFileURL } = require('node:url')

/** Opt-in only: stop CDP before page/context/browser close, including multi-page harnesses. */
async function attachBrowserCoverage(page, browser, env = process.env) {
  if (!env.BROWSER_COVERAGE_DIR) return
  const origin = new URL(env.FRONTEND_BASE)
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port) throw new Error('Coverage requires an explicit loopback origin')
  if (!/^[a-f0-9-]{36}$/.test(env.BROWSER_COVERAGE_RUN_ID ?? '')) throw new Error('Browser capture run identity missing')
  const root = resolve(__dirname, '../..')
  const { sourceInventory, sourceFingerprint } = await import(pathToFileURL(join(root, 'tools/coverage/inventory.mjs')).href)
  const fingerprint = sourceFingerprint(root, sourceInventory(root))
  const output = resolve(env.BROWSER_COVERAGE_DIR)
  mkdirSync(output, { recursive: true, mode: 0o700 })
  await page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: false })
  let stopping
  function stop() {
    if (stopping) return stopping
    stopping = (async () => {
    const entries = await page.coverage.stopJSCoverage()
    if (sourceFingerprint(root, sourceInventory(root)) !== fingerprint) throw new Error('Source changed during browser coverage')
    const excluded = { external: 0, dependenciesOrGenerated: 0 }
    const scripts = entries.filter(entry => {
      let url
      try { url = new URL(entry.url) } catch { excluded.external++; return false }
      if (url.origin !== origin.origin) { excluded.external++; return false }
      if (!url.pathname.startsWith('/src/') || !/\.(?:[cm]?[jt]sx?|vue)$/.test(url.pathname) || url.searchParams.get('type') === 'style') { excluded.dependenciesOrGenerated++; return false }
      return true
    }).map(entry => ({ ...entry, codeSha256: createHash('sha256').update(entry.source ?? '').digest('hex') }))
    writeFileSync(join(output, `chromium-${randomUUID()}.json`), JSON.stringify({ schemaVersion: 1, origin: origin.origin,
      root, fingerprint, captureRunId: env.BROWSER_COVERAGE_RUN_ID, capturedAt: new Date().toISOString(), scripts, excluded }), { mode: 0o600, flag: 'wx' })
    })()
    return stopping
  }
  for (const owner of [page, page.context(), browser]) {
    const close = owner.close.bind(owner)
    owner.close = async (...args) => { try { await stop() } finally { await close(...args) } }
  }
  return stop
}
module.exports = { attachBrowserCoverage }
