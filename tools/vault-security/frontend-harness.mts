/** Opt-in HTTPS browser integration. No application database or external endpoint is used. */
import { randomBytes, createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'
import type { createFrontendFixture } from './frontend-fixture.mts'
const require = createRequire(import.meta.url)
const { manualPlugin } = require('../manual/build.cjs')
const { securityCenterPlugin } = require('../security-center/build.cjs')
const { runVaultFrontendFlow, runVaultHttpBoundary } = require('./frontend-flow.cjs')
const { runVaultFlow } = require('../frontend/vault-catalog-flow.cjs')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
function fingerprint() {
  const tracked = execFileSync('/usr/bin/git', ['ls-files', '--cached', '--others', '--exclude-standard', 'apps/frontend/src', 'apps/backend/src/modules/vault-security', 'apps/backend/src/modules/pem-keys', 'packages/shared/src', 'tools/vault-security', 'tools/frontend', 'apps/backend/src/shared', 'apps/backend/src/modules/auth/current-session.ts', 'apps/backend/src/modules/auth/totp.service.ts', 'tools/manual', 'tools/security-center', 'tools/coverage', 'tools/shared', 'docs/manual', 'docs/security/controls-catalog.json', 'apps/frontend/public/manual-assets', 'apps/frontend/postcss.config.js', 'apps/frontend/tailwind.config.js', 'package.json', 'apps/frontend/package.json', 'package-lock.json'], { cwd: root, encoding: 'utf8' }).trim().split('\n').sort((left, right) => left.localeCompare(right, 'en'))
  const manual = JSON.parse(readFileSync(join(root, 'docs/manual/manifest.json'), 'utf8'))
  const controls = JSON.parse(readFileSync(join(root, 'docs/security/controls-catalog.json'), 'utf8'))
  const mapped = [...manual.flatMap((entry: { sourceFiles: string[] }) => entry.sourceFiles), ...controls.controls.flatMap((entry: { review?: { sourceFiles: string[] } }) => entry.review?.sourceFiles ?? [])]
  const files = [...new Set<string>([...tracked, ...mapped])].sort((left, right) => left.localeCompare(right, 'en'))
  const digest = createHash('sha256')
  for (const file of files) { if (!resolve(root, file).startsWith(root + '/')) throw new Error('Fingerprint path outside workspace'); digest.update(file); digest.update(readFileSync(join(root, file))) }
  return digest.digest('hex')
}
const environmentKeys = ['BROWSER_COVERAGE_DIR', 'BROWSER_COVERAGE_RUN_ID', 'TMPDIR', 'NODE_ENV', 'DATABASE_URL', 'REDIS_URL',
  'JWT_SECRET', 'PEM_ENCRYPTION_KEY', 'PEM_ENCRYPTION_PREVIOUS_KEYS', 'VAULT_REVIEW_OUTPUT'] as const
export interface FrontendHarnessResult { report: Record<string, unknown>; evidence: string }

/** Runs in the caller's isolated process; Vitest owns TS coverage transformation. */
export async function executeFrontendHarness(): Promise<FrontendHarnessResult> {
  const savedEnvironment = new Map(environmentKeys.map(key => [key, process.env[key]] as const))
  const previousUmask = process.umask()
  try {
    process.umask(0o077)
    // No browser-page HTTPS coverage is claimed; Vitest collects the executing harness/fixture.
    delete process.env.BROWSER_COVERAGE_DIR
    delete process.env.BROWSER_COVERAGE_RUN_ID
    return await executeIsolatedRun()
  } finally {
    for (const [key, value] of savedEnvironment) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    process.umask(previousUmask)
  }
}

async function executeIsolatedRun(): Promise<FrontendHarnessResult> {
  const outputRoot = join(root, '.tmp/NA-0179'); mkdirSync(outputRoot, { recursive: true, mode: 0o700 })
  const output = mkdtempSync(join(outputRoot, 'frontend-'))
  const runtimeDirectory = join(output, 'runtime')
  mkdirSync(runtimeDirectory, { mode: 0o700 }); process.env.TMPDIR = runtimeDirectory
  // Overwrite deployment credentials before importing backend modules, never open a real database.
  const disposableDatabaseCredential = randomBytes(24).toString('hex')
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: `mysql://fixture:${disposableDatabaseCredential}@127.0.0.1:1/unused`, REDIS_URL: 'redis://127.0.0.1:1',
    JWT_SECRET: randomBytes(32).toString('hex'), PEM_ENCRYPTION_KEY: randomBytes(32).toString('hex'), PEM_ENCRYPTION_PREVIOUS_KEYS: '' })
  const { createFrontendFixture: makeFixture } = await import('./frontend-fixture.mts')
  const { executeBrowserHarness } = await import('../coverage/browser.mjs')
  const report: Record<string, unknown> = { startedAt: new Date().toISOString(), head: execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), fingerprintBefore: fingerprint(),
    scope: 'HTTPS Chromium + real Fastify guards/Vault service/bcrypt/TOTP/JWE; synthetic transactional authority and Redis reference; terminal transport simulated', cleanup: false }
  let fixture: Awaited<ReturnType<typeof createFrontendFixture>> | undefined
  let httpsServer: Awaited<ReturnType<typeof createServer>> | undefined
  let httpServer: Awaited<ReturnType<typeof createServer>> | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  let watchdog: ReturnType<typeof setTimeout> | undefined
  const certificate = join(output, 'certificate.pem'), privateKey = join(output, 'private-key.pem')
  try {
    execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', privateKey, '-out', certificate, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' })
    fixture = await makeFixture()
    const api = await fixture.app.listen({ host: '127.0.0.1', port: 0 })
    const options = { configFile: false as const, root: join(root, 'apps/frontend'), logLevel: 'error' as const,
      plugins: [vue(), manualPlugin(), securityCenterPlugin(root)], resolve: { alias: { '@': join(root, 'apps/frontend/src') } },
      optimizeDeps: { include: ['vue', 'naive-ui', 'jose'], entries: ['index.html'] } }
    httpsServer = await createServer({ ...options, cacheDir: join(output, 'vite-https'), server: { host: '127.0.0.1', port: 0, strictPort: false,
      https: { key: readFileSync(privateKey), cert: readFileSync(certificate) }, fs: { allow: [root] },
      proxy: { '/api/v1/vault-security': { target: api, headers: { 'x-forwarded-proto': 'https' } } } } })
    await httpsServer.listen(); await httpsServer.environments?.client?.depsOptimizer?.scanProcessing
    const address = httpsServer.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('HTTPS address unavailable')
    const base = `https://127.0.0.1:${address.port}`; fixture.authority.policy.origin = base
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser', args: ['--no-sandbox'] })
    watchdog = setTimeout(() => { report.timedOut = true; void browser?.close() }, 360000)
    report.browser = await browser.version()
    report.flow = await runVaultFrontendFlow(browser, base, fixture, output)
    // Existing regressions use HTTP fixtures and do not exercise secret delivery.
    httpServer = await createServer({ ...options, cacheDir: join(output, 'vite-http'), server: { host: '127.0.0.1', port: 0, strictPort: false, proxy: {}, fs: { allow: [root] } } })
    await httpServer.listen(); await httpServer.environments?.client?.depsOptimizer?.scanProcessing
    const httpAddress = httpServer.httpServer!.address()
    if (!httpAddress || typeof httpAddress === 'string') throw new Error('HTTP fixture address unavailable')
    const httpBase = `http://127.0.0.1:${httpAddress.port}`
    process.env.VAULT_REVIEW_OUTPUT = output
    report.httpBoundary = await runVaultHttpBoundary(browser, httpBase, fixture, output)
    report.catalogue = await runVaultFlow(browser, httpBase)
    const childEnv = { ...process.env, FRONTEND_BASE: httpBase, REPORT_PATH: join(output, 'terminal.json'), SCREENSHOT_PATH: join(output, 'terminal.png'),
      AUTOCOMPLETE_SCREENSHOT_PATH: join(output, 'autocomplete.png'), AUTOCOMPLETE_MOBILE_SCREENSHOT_PATH: join(output, 'autocomplete-mobile.png'),
      THEME_SCREENSHOT_PATH: join(output, 'theme.png'), HIGHLIGHT_SCREENSHOT_PATH: join(output, 'highlight.png') }
    delete childEnv.CHROMIUM_CDP_URL; delete childEnv.SONAR_TOKEN; delete childEnv.SONAR_REVIEW_TOKEN
    const terminal = await executeBrowserHarness(root, 'tools/frontend/terminal-experience-playwright.cjs', childEnv, join(output, 'terminal.log'), 120000)
    report.terminal = terminal
    if (terminal.exitCode !== 0 || terminal.timedOut) throw new Error('Existing terminal regression failed; inspect private terminal log')
    const terminalReport = JSON.parse(readFileSync(join(output, 'terminal.json'), 'utf8'))
    if (terminalReport.result !== 'passed' || !terminalReport.snippets?.refreshedOnOpen || !terminalReport.snippets?.transientFailureRecovered || !terminalReport.resilience) throw new Error('Terminal report does not prove the full regression suite')
    report.terminalSnippets = terminalReport.snippets
    report.status = 'passed'
  } catch (error) {
    report.status = 'failed'
    let message = error instanceof Error ? error.message : 'Unknown harness error'
    for (const sensitive of [fixture?.value, fixture?.password, fixture?.accessToken, fixture?.refreshToken]) if (sensitive) message = message.split(sensitive).join('[REDACTED]')
    report.error = message
  } finally {
    clearTimeout(watchdog)
    const cleanup = await Promise.allSettled([browser?.close(), httpsServer?.close(), httpServer?.close(), fixture?.close()])
    rmSync(privateKey, { force: true }); rmSync(certificate, { force: true })
    report.cleanup = cleanup.every(result => result.status === 'fulfilled')
    report.fingerprintAfter = fingerprint(); report.sourcesUnchanged = report.fingerprintBefore === report.fingerprintAfter
    if (!report.cleanup || !report.sourcesUnchanged || report.timedOut) { report.status = 'failed' }
    report.finishedAt = new Date().toISOString()
    writeFileSync(join(output, 'execution.json'), JSON.stringify(report, null, 2), { mode: 0o600 })

  }
  return { report, evidence: join(output, 'execution.json') }
}

// Importing this module never starts a browser or changes the caller's exit code.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.RUN_VAULT_FRONTEND !== 'true') throw new Error('Opt in with RUN_VAULT_FRONTEND=true')
  const { report, evidence } = await executeFrontendHarness()
  console.log(JSON.stringify({ status: report.status, cleanup: report.cleanup, sourcesUnchanged: report.sourcesUnchanged, evidence }))
  if (report.status !== 'passed') process.exitCode = 1
}
