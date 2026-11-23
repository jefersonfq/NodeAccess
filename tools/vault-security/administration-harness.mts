/**
 * NA-0188 — opt-in HTTPS browser run of the vault administration (managers, proposal validity, pending notices).
 * `RUN_VAULT_ADMINISTRATION=true node --import tsx tools/vault-security/administration-harness.mts`
 * No application database, Redis or external endpoint is used; screenshots stay in a private .tmp directory.
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'
const require = createRequire(import.meta.url)
const { manualPlugin } = require('../manual/build.cjs')
const { securityCenterPlugin } = require('../security-center/build.cjs')
const { runVaultAdministrationFlow } = require('./administration-flow.cjs')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export async function executeAdministrationHarness(): Promise<{ report: Record<string, unknown>; evidence: string }> {
  const outputRoot = join(root, '.tmp/NA-0188'); mkdirSync(outputRoot, { recursive: true, mode: 0o700 })
  const output = mkdtempSync(join(outputRoot, 'administration-'))
  const runtime = mkdtempSync(join(root, '.tmp/va-'))
  // Overwrite deployment credentials before importing backend modules; never open a real database or Redis.
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: `mysql://fixture:${randomBytes(24).toString('hex')}@127.0.0.1:1/unused`, REDIS_URL: 'redis://127.0.0.1:1',
    JWT_SECRET: randomBytes(32).toString('hex'), PEM_ENCRYPTION_KEY: randomBytes(32).toString('hex'), PEM_ENCRYPTION_PREVIOUS_KEYS: '' })
  const { createAdministrationFixture } = await import('./administration-fixture.mts')
  const report: Record<string, unknown> = { change: 'NA-0188', startedAt: new Date().toISOString(),
    head: execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    scope: 'HTTPS Chromium + real Fastify vault routes/VaultService/VaultAdministrationService/bcrypt/TOTP/JWT; in-memory administration rules; portal API mocked' }
  let fixture: Awaited<ReturnType<typeof createAdministrationFixture>> | undefined
  let server: Awaited<ReturnType<typeof createServer>> | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  const certificate = join(output, 'certificate.pem'), privateKey = join(output, 'private-key.pem')
  try {
    execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', privateKey, '-out', certificate, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' })
    fixture = await createAdministrationFixture()
    const api = await fixture.app.listen({ host: '127.0.0.1', port: 0 })
    server = await createServer({ configFile: false, root: join(root, 'apps/frontend'), logLevel: 'error', cacheDir: join(output, 'vite'),
      plugins: [vue(), manualPlugin(), securityCenterPlugin(root)], resolve: { alias: { '@': join(root, 'apps/frontend/src') } },
      optimizeDeps: { include: ['vue', 'naive-ui', 'jose'], entries: ['index.html'] },
      server: { host: '127.0.0.1', port: 0, strictPort: false, https: { key: readFileSync(privateKey), cert: readFileSync(certificate) }, fs: { allow: [root] },
        proxy: { '/api/v1/vault-security': { target: api, headers: { 'x-forwarded-proto': 'https' } } } } })
    await server.listen(); await server.environments?.client?.depsOptimizer?.scanProcessing
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('HTTPS address unavailable')
    const base = `https://127.0.0.1:${address.port}`; fixture.state.policy.origin = base
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || chromium.executablePath(),
      env: { ...process.env, TMPDIR: runtime }, args: ['--no-sandbox'] })
    report.browser = browser.version()
    report.flow = await runVaultAdministrationFlow(browser, base, fixture, output)
    report.status = 'passed'
  } catch (error) {
    report.status = 'failed'
    let message = error instanceof Error ? error.message : 'Unknown harness error'
    for (const user of fixture?.users.values() ?? []) message = message.split(user.password).join('[REDACTED]')
    report.error = message
  } finally {
    const cleanup = await Promise.allSettled([browser?.close(), server?.close(), fixture?.close()])
    rmSync(privateKey, { force: true }); rmSync(certificate, { force: true })
    try { rmSync(runtime, { recursive: true, force: true }) } catch { /* reported below */ }
    report.cleanup = cleanup.every(result => result.status === 'fulfilled')
    if (!report.cleanup) report.status = 'failed'
    report.finishedAt = new Date().toISOString()
    writeFileSync(join(output, 'execution.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  }
  return { report, evidence: join(output, 'execution.json') }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.RUN_VAULT_ADMINISTRATION !== 'true') throw new Error('Opt in with RUN_VAULT_ADMINISTRATION=true')
  const { report, evidence } = await executeAdministrationHarness()
  console.log(JSON.stringify({ status: report.status, error: report.error, flow: report.flow, evidence }))
  if (report.status !== 'passed') process.exitCode = 1
}
