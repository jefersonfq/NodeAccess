#!/usr/bin/env node
/**
 * NA-0194 — the packaged release in a real Chromium: build a release with a disposable key, extract the ZIP, load it
 * and check that Chromium assigns the id from release.json, with icons and update_url. Local validation (opt-in).
 */
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { chromium } from 'playwright'
import { buildRelease } from './package.mjs'

const work = mkdtempSync(join(tmpdir(), 'vna-pkg-')), result = { checks: {} }
const check = (name, ok, detail) => { result.checks[name] = ok ? 'PASS' : `FAIL ${detail ?? ''}`; if (!ok) throw new Error(`${name} ${detail ?? ''}`) }
let context
try {
  const keyFile = join(work, 'key.pem')
  writeFileSync(keyFile, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  const release = buildRelease({ portalOrigin: 'https://vault.example.test', version: '0.9.0', keyFile, releaseDir: join(work, 'release') })
  const archive = readFileSync(join(work, 'release', release.zip.file)), dir = join(work, 'unpacked')
  let at = 0
  while (archive.readUInt32LE(at) === 0x04034b50) {
    const size = archive.readUInt32LE(at + 18), nameLength = archive.readUInt16LE(at + 26), extra = archive.readUInt16LE(at + 28)
    const name = archive.subarray(at + 30, at + 30 + nameLength).toString('utf8')
    const data = inflateRawSync(archive.subarray(at + 30 + nameLength + extra, at + 30 + nameLength + extra + size))
    mkdirSync(dirname(join(dir, name)), { recursive: true }); writeFileSync(join(dir, name), data)
    at += 30 + nameLength + extra + size
  }
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  check('manifest-icons', manifest.icons?.['128'] === 'icons/vaultnaccess-128.png' && manifest.action?.default_icon?.['16'] === 'icons/vaultnaccess-16.png')
  check('manifest-update-url', manifest.update_url === 'https://vault.example.test/api/v1/vault-security/extension/update.xml')
  check('no-private-key', !readFileSync(join(work, 'release', release.zip.file)).toString('latin1').includes('PRIVATE KEY'))
  context = await chromium.launchPersistentContext(join(work, 'profile'), { channel: 'chromium', headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`] })
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15_000 })
  const id = new URL(worker.url()).host
  check('chromium-id-matches-release', id === release.extensionId, `${id} vs ${release.extensionId}`)
  const page = await context.newPage()
  const icon = await page.goto(`chrome-extension://${id}/icons/vaultnaccess-48.png`)
  check('icon-served', icon?.status() === 200)
  result.status = 'passed'
} catch (error) {
  result.status = 'failed'; result.error = String(error?.message ?? error).slice(0, 300)
} finally {
  await context?.close().catch(() => {})
  rmSync(work, { recursive: true, force: true })
  console.log(JSON.stringify(result))
  process.exitCode = result.status === 'passed' ? 0 : 1
}
