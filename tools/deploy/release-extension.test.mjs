import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, unlinkSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { validateExtension, includeExtension, extensionCompose } from '../../scripts/release/prepare-extension.mjs'
import { crx3, zip, extensionId, publicKeyDer, updateManifest } from '../vault-extension/package-format.mjs'

const project = resolve(import.meta.dirname, '../..')
const origin = 'https://extension-fixture.example.invalid'
const version = '0.0.1'
// Disposable signing identity used only for test fixtures, never a real release.
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const id = extensionId(publicKeyDer(privateKey))
const archive = zip([{ name: 'manifest.json', data: Buffer.from(JSON.stringify({ manifest_version: 3, name: 'TEST ONLY', version, key: publicKeyDer(privateKey).toString('base64'), host_permissions: [`${origin}/*`] })) }])
const signed = crx3(archive, privateKey)
const entry = (bytes, ext) => ({ file: `vaultnaccess-${version}.${ext}`, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
const metadata = { schemaVersion: 1, version, extensionId: id, portalOrigin: origin, zip: entry(archive, 'zip'), crx: entry(signed, 'crx') }
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'extension release '))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const input = join(root, 'input'), output = join(root, 'output')
  mkdirSync(input); mkdirSync(output)
  writeFileSync(join(input, 'release.json'), JSON.stringify(metadata))
  writeFileSync(join(input, metadata.zip.file), archive)
  writeFileSync(join(input, metadata.crx.file), signed)
  writeFileSync(join(input, 'update.xml'), updateManifest(id, version, `${origin}/api/v1/vault-security/extension/package.crx`))
  const compose = readFileSync(join(project, 'docker-compose.prod.yml'), 'utf8')
  writeFileSync(join(output, 'docker-compose.prod.yml'), compose)
  writeFileSync(join(output, 'manifest.json'), JSON.stringify({ artifacts: ['docker-compose.prod.yml'] }))
  return { root, input, output, compose, env: { NODEACCESS_EXTENSION_PACKAGE_DIR: input, NODEACCESS_EXTENSION_EXPECTED_ORIGIN: origin, NODEACCESS_EXTENSION_EXPECTED_ID: id } }
}

test('opt-out leaves every release byte unchanged and does not require a release directory', t => {
  const f = fixture(t)
  assert.equal(validateExtension({}), null)
  assert.equal(includeExtension(join(f.root, 'absent'), {}), false)
  const before = readdirSync(f.output).map(name => [name, readFileSync(join(f.output, name))])
  assert.equal(includeExtension(f.output, {}), false)
  assert.deepEqual(readdirSync(f.output).map(name => [name, readFileSync(join(f.output, name))]), before)
})

test('includes only public fixture bytes, inventory and independent checksums; changes only API mount/path', t => {
  const f = fixture(t)
  assert.equal(includeExtension(f.output, f.env), true)
  for (const file of readdirSync(f.input)) assert.deepEqual(readFileSync(join(f.output, 'vaultnaccess', file)), readFileSync(join(f.input, file)))
  const manifest = JSON.parse(readFileSync(join(f.output, 'manifest.json')))
  assert.equal(manifest.extensionPackage.validation, 'integrity-only')
  assert.equal(manifest.extensionPackage.extensionId, id)
  assert.equal(manifest.artifacts.length, 6)
  for (const line of readFileSync(join(f.output, 'VAULTNACCESS-CHECKSUMS.txt'), 'utf8').trim().split('\n')) {
    const [hash, file] = line.split('  ')
    assert.equal(createHash('sha256').update(readFileSync(join(f.output, file))).digest('hex'), hash)
    assert(manifest.artifacts.includes(file))
  }
  const composed = readFileSync(join(f.output, 'docker-compose.prod.yml'), 'utf8')
  assert.equal(composed.replace('      VAULT_EXTENSION_PACKAGE_DIR: /opt/nodeaccess/vaultnaccess\n', '')
    .replace('      - ./vaultnaccess:/opt/nodeaccess/vaultnaccess:ro\n', ''), f.compose)
  const api = composed.slice(composed.indexOf('  api:'), composed.indexOf('  ssh-gateway:'))
  assert(api.includes('VAULT_EXTENSION_PACKAGE_DIR: /opt/nodeaccess/vaultnaccess'))
  assert(api.includes('./vaultnaccess:/opt/nodeaccess/vaultnaccess:ro'))
  assert(!composed.includes('VAULT_EXTENSION_ENABLED'))
  assert(!composed.includes('VAULT_EXTENSION_IDS'))
  assert(!composed.slice(composed.indexOf('  ssh-gateway:')).includes('vaultnaccess'))
  assert.throws(() => includeExtension(f.output, f.env), /unsupported api compose layout/)
})

for (const [name, change] of [
  ['missing expected ID', f => { delete f.env.NODEACCESS_EXTENSION_EXPECTED_ID }],
  ['missing directory', f => { delete f.env.NODEACCESS_EXTENSION_PACKAGE_DIR }],
  ['HTTP origin', f => { f.env.NODEACCESS_EXTENSION_EXPECTED_ORIGIN = 'http://extension-fixture.example.invalid' }],
  ['origin with path', f => { f.env.NODEACCESS_EXTENSION_EXPECTED_ORIGIN += '/path' }],
  ['different origin', f => { f.env.NODEACCESS_EXTENSION_EXPECTED_ORIGIN = 'https://another.example.invalid' }],
  ['invalid ID', f => { f.env.NODEACCESS_EXTENSION_EXPECTED_ID = 'invalid' }],
  ['different ID', f => { f.env.NODEACCESS_EXTENSION_EXPECTED_ID = id === 'a'.repeat(32) ? 'b'.repeat(32) : 'a'.repeat(32) }],
  ['corrupt zip', f => writeFileSync(join(f.input, metadata.zip.file), Buffer.alloc(archive.length))],
  ['missing crx', f => unlinkSync(join(f.input, metadata.crx.file))],
  ['incorrect update origin', f => writeFileSync(join(f.input, 'update.xml'), updateManifest(id, version, 'https://another.example.invalid/package.crx'))],
  ['additional private file', f => writeFileSync(join(f.input, 'private.pem'), 'TEST ONLY')],
  ['private marker in public file', f => writeFileSync(join(f.input, 'update.xml'), '-----BEGIN PRIVATE KEY-----')],
  ['symlink file', f => { unlinkSync(join(f.input, metadata.zip.file)); writeFileSync(join(f.root, 'archive'), archive); symlinkSync(join(f.root, 'archive'), join(f.input, metadata.zip.file)) }],
  ['symlink directory', f => { symlinkSync(f.input, join(f.root, 'linked')); f.env.NODEACCESS_EXTENSION_PACKAGE_DIR = join(f.root, 'linked') }],
]) {
  test(`rejects ${name} before changing output`, t => {
    const f = fixture(t)
    const before = readFileSync(join(f.output, 'manifest.json'))
    change(f)
    assert.throws(() => includeExtension(f.output, f.env))
    assert.deepEqual(readFileSync(join(f.output, 'manifest.json')), before)
    assert.equal(readFileSync(join(f.output, 'docker-compose.prod.yml'), 'utf8'), f.compose)
    assert.deepEqual(readdirSync(f.output).sort(), ['docker-compose.prod.yml', 'manifest.json'])
  })
}
for (const [name, mutate] of [
  ['schema', r => { r.schemaVersion = 2 }],
  ['version', r => { r.version = '../escape' }],
  ['path traversal', r => { r.zip.file = '../outside.zip' }],
  ['hash', r => { r.crx.sha256 = '0'.repeat(64) }],
  ['size', r => { r.zip.size++ }],
  ['oversize', r => { r.zip.size = 20 * 1024 * 1024 + 1 }],
]) {
  test(`rejects invalid metadata ${name}`, t => {
    const f = fixture(t), record = structuredClone(metadata)
    mutate(record)
    writeFileSync(join(f.input, 'release.json'), JSON.stringify(record))
    assert.throws(() => includeExtension(f.output, f.env))
    assert.deepEqual(readdirSync(f.output).sort(), ['docker-compose.prod.yml', 'manifest.json'])
  })
}

test('unknown compose layouts and duplicate API fail closed', t => {
  const f = fixture(t)
  for (const source of [f.compose.replace('  api:', '  other:'), f.compose + '\n  api:\n', f.compose.replace('      APP_MODE: api', '      APP_MODE: gateway'), f.compose.replace('    environment:\n      APP_MODE: api', '    changed:\n      APP_MODE: api')]) {
    assert.throws(() => extensionCompose(source))
  }
})
