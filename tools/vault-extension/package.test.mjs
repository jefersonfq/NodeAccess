import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRelease, releaseInput } from './package.mjs'
import { extensionId, publicKeyDer } from './package-format.mjs'

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../apps/extension/dist-release')

test('NA-0194: release input requires an https origin, x.y.z and a signing key file', () => {
  const ok = { VAULTNACCESS_PORTAL_ORIGIN: 'https://portal.test', VAULTNACCESS_VERSION: '1.2.3', VAULTNACCESS_SIGNING_KEY: '/keys/k.pem' }
  assert.equal(releaseInput(ok).portalOrigin, 'https://portal.test')
  assert.match(releaseInput(ok).releaseDir, /release[\\/]vaultnaccess$/)
  for (const [patch, message] of [[{ VAULTNACCESS_PORTAL_ORIGIN: 'http://portal.test' }, /https origin/], [{ VAULTNACCESS_PORTAL_ORIGIN: 'https://portal.test/x' }, /https origin/],
    [{ VAULTNACCESS_PORTAL_ORIGIN: 'nope' }, /https origin/], [{ VAULTNACCESS_VERSION: '1.2' }, /x\.y\.z/], [{ VAULTNACCESS_SIGNING_KEY: '' }, /private key/]]) {
    assert.throws(() => releaseInput({ ...ok, ...patch }), message)
  }
})

test('NA-0194: builds ZIP, CRX, update.xml and release.json, and refuses inconsistent or leaky builds', t => {
  const work = mkdtempSync(join(tmpdir(), 'vna-rel-')); t.after(() => { rmSync(work, { recursive: true, force: true }); rmSync(DIST, { recursive: true, force: true }) })
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const keyFile = join(work, 'k.pem'); writeFileSync(keyFile, privateKey.export({ type: 'pkcs1', format: 'pem' }))
  const input = { portalOrigin: 'https://portal.test', version: '1.2.3', keyFile, releaseDir: join(work, 'out') }
  const fakeBuild = (extra = {}) => env => {
    rmSync(DIST, { recursive: true, force: true }); mkdirSync(DIST, { recursive: true })
    writeFileSync(join(DIST, 'manifest.json'), JSON.stringify({ key: env.VAULTNACCESS_MANIFEST_KEY, version: env.VAULTNACCESS_VERSION, update_url: env.VAULTNACCESS_UPDATE_URL, ...extra }))
    writeFileSync(join(DIST, 'popup.js'), 'console.log(1)')
  }
  const release = buildRelease(input, fakeBuild())
  assert.equal(release.extensionId, extensionId(publicKeyDer(privateKey)))
  assert.equal(release.zip.file, 'vaultnaccess-1.2.3.zip'); assert.match(release.zip.sha256, /^[a-f0-9]{64}$/)
  const written = JSON.parse(readFileSync(join(work, 'out', 'release.json'), 'utf8'))
  assert.deepEqual({ ...written, sourceCommit: null }, { ...release, sourceCommit: null })
  assert.match(readFileSync(join(work, 'out', 'update.xml'), 'utf8'), new RegExp(`appid='${release.extensionId}'`))
  assert.equal(readFileSync(join(work, 'out', release.crx.file)).subarray(0, 4).toString('binary'), 'Cr24')
  assert.throws(() => buildRelease(input, fakeBuild({ version: '9.9.9' })), /does not match/)
  assert.throws(() => buildRelease(input, env => { fakeBuild()(env); writeFileSync(join(DIST, 'leak.txt'), '-----BEGIN PRIVATE KEY-----') }), /Private key material/)
})
