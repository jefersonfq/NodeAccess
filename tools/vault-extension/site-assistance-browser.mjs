#!/usr/bin/env node
/** Real Chromium isolated-world + runtime transport; synthetic worker records intentions, never calls APIs. */
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { transform } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '../..'), base = join(root, '.tmp/NA-0203/site-assistance')
mkdirSync(base, { recursive: true })
const out = mkdtempSync(join(base, 'run-')), extension = join(out, 'extension')
mkdirSync(extension)
const sourceFiles = ['apps/extension/src/adapters/site-assistance.ts', 'apps/extension/src/adapters/site-assistance.test.ts', 'tools/vault-extension/site-assistance-browser.mjs']
const fingerprint = () => Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(readFileSync(join(root, file))).digest('hex')]))
const report = { status: 'failed', startedAt: new Date().toISOString(), sourceFiles, before: fingerprint(), checks: [], boundary: 'Synthetic HTTPS page and metadata; real MV3 isolated-world injection/runtime sender. Fixture worker does not authorize grants or write APIs. Popup consent and production worker integration tested separately.' }
const check = (name, value) => { assert.ok(value, name); report.checks.push(name) }
const origin = 'https://login.example.test', password = randomBytes(18).toString('hex')
const html = '<form><input id="user" autocomplete="username"><input id="pass" type="password" autocomplete="current-password"><button>Submit</button></form><script>document.addEventListener("submit",e=>e.preventDefault())</script>'
let context
try {
  const compiled = await transform(readFileSync(join(root, sourceFiles[0]), 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' })
  writeFileSync(join(extension, 'helper.js'), compiled.code)
  writeFileSync(join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Disposable assistance transport fixture', version: '1.0.0', permissions: ['scripting', 'tabs'], host_permissions: [`${origin}/*`], background: { service_worker: 'worker.js', type: 'module' } }))
  writeFileSync(join(extension, 'worker.js'), `import {injectSiteAssistance} from './helper.js';
globalThis.received=[];
chrome.runtime.onMessage.addListener((message,sender)=>{globalThis.received.push({message,sender:{id:sender.id,tabId:sender.tab?.id,frameId:sender.frameId,documentId:sender.documentId,url:sender.url}})});
globalThis.install=async(config)=>{const tabs=await chrome.tabs.query({});const tab=tabs.find(t=>t.url?.startsWith(${JSON.stringify(origin)}));return chrome.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},world:'ISOLATED',func:injectSiteAssistance,args:[config]})};`)
  context = await chromium.launchPersistentContext(join(out, 'profile'), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] })
  await context.route('https://**/*', route => route.fulfill({ contentType: 'text/html', body: html }))
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
  const page = await context.newPage(); await page.goto(origin)
  const config = () => ({ origin, capability: randomBytes(32).toString('base64url'), expiresAt: Date.now() + 30000, items: [{ id: 7, version: 1, label: 'Synthetic login', username: 'synthetic-user' }], captureOptIn: false, locale: 'en' })
  const install = args => worker.evaluate(args => globalThis.install(args), args)
  const messages = () => worker.evaluate(() => globalThis.received)
  const waitMessage = async count => {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) { if ((await messages()).length >= count) return; await page.waitForTimeout(30) }
    throw Error('No runtime intention received')
  }
  const first = config(), installed = await install(first)
  check('isolated-injection-frame-zero-document-id', installed.length === 1 && installed[0].frameId === 0 && typeof installed[0].documentId === 'string' && installed[0].result === true)
  check('page-cannot-access-isolated-state', await page.evaluate(() => typeof globalThis.__vaultSiteAssistanceStop === 'undefined'))
  check('nonce-not-in-dom', !(await page.content()).includes(first.capability))
  await page.locator('#user').click(); await page.screenshot({ path: join(out, 'metadata-suggestions.png') })
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await waitMessage(1)
  const selected = (await messages())[0]
  check('runtime-sender-bound-to-document', selected.sender.id === new URL(worker.url()).host && selected.sender.frameId === 0 && selected.sender.documentId === installed[0].documentId && new URL(selected.sender.url).origin === origin)
  check('selection-is-metadata-intention-only', selected.message.intent.kind === 'fill' && selected.message.intent.id === 7 && !('password' in selected.message.intent) && await page.locator('#pass').inputValue() === '')
  await page.reload()
  await install({ ...config(), captureOptIn: true })
  await page.locator('#user').fill('synthetic-user'); await page.locator('#pass').fill(password); await page.keyboard.press('Escape')
  await page.evaluate(() => document.querySelector('form').requestSubmit()); await page.waitForTimeout(100)
  check('programmatic-submit-no-capture', (await messages()).length === 1)
  await page.getByRole('button', { name: 'Submit' }).click(); await waitMessage(2)
  const proposal = (await messages())[1]
  check('trusted-submit-review-proposal', proposal.message.intent.kind === 'review-capture' && proposal.message.intent.password === password && proposal.message.intent.mode === 'login')
  check('new-document-has-new-sender-identity', proposal.sender.documentId !== selected.sender.documentId)
  await page.getByRole('button', { name: 'Submit' }).click(); await page.waitForTimeout(100)
  check('single-intention-no-repeat', (await messages()).length === 2)
  await page.reload(); await install({ ...config(), captureOptIn: true, expiresAt: Date.now() + 100 })
  await page.waitForTimeout(150); await page.locator('#pass').fill(password); await page.getByRole('button').click(); await page.waitForTimeout(100)
  check('ttl-disposes-capture', (await messages()).length === 2)
  report.status = 'passed'
} catch (error) { report.error = String(error.stack ?? error).replaceAll(password, '[synthetic-redacted]'); process.exitCode = 1 }
finally {
  try { await context?.close(); report.cleanup = true } catch { report.cleanup = false; report.status = 'failed'; process.exitCode = 1 }
  report.after = fingerprint(); report.sourceChanged = JSON.stringify(report.before) !== JSON.stringify(report.after)
  if (report.sourceChanged) { report.status = 'failed'; process.exitCode = 1 }
  report.finishedAt = new Date().toISOString()
  writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, artifacts: out }, null, 2))
}
