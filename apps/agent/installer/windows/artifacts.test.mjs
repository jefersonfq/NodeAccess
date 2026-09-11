process.env.NODEACCESS_DEVELOPMENT_UNSIGNED = 'true' // fixture artifacts only; signature tests exercise production separately
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { artifactNames, distributionNames, importArtifacts, manifestName, projectRoot, sourceDigest, validateArtifacts } from './artifacts.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agent-artifacts-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  function write(path, content) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  write('package-lock.json', '{"lockfileVersion":3}\n')
  write('apps/agent/package.json', '{"version":"1.2.3"}\n')
  write('apps/agent/src/index.js', 'console.log("agent")\n')
  write('apps/agent/installer/windows/NodeAccessAgent.wxs', '<Wix />\n')
  const dist = join(root, 'incoming')
  mkdirSync(dist)
  const manifest = { product: 'NodeAccess Agent', platform: 'windows', architecture: 'x64', version: '1.2.3', sourceSha256: sourceDigest(root), artifacts: [] }
  for (const name of artifactNames) {
    const bytes = Buffer.from(`fixture for ${name}`)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    writeFileSync(join(dist, name), bytes)
    writeFileSync(join(dist, `${name}.sha256`), `${sha256}  ${name}\n`)
    manifest.artifacts.push({ file: name, size: bytes.length, sha256 })
  }
  const save = () => writeFileSync(join(dist, manifestName), JSON.stringify(manifest))
  save()
  writeFileSync(join(dist, manifestName + '.sig'), 'fixture')
  return { root, dist, manifest, save, write }
}

test('imports the complete verified distribution and preserves other platforms', t => {
  const f = fixture(t)
  const dest = join(f.root, 'apps/agent/dist')
  f.write('apps/agent/dist/nodeaccess-agent-linux', 'linux')
  importArtifacts(f.dist, dest, f.root)
  for (const name of distributionNames.filter(name => !name.endsWith('.sig'))) assert.deepEqual(readFileSync(join(dest, name)), readFileSync(join(f.dist, name)))
  assert.equal(readFileSync(join(dest, 'nodeaccess-agent-linux'), 'utf8'), 'linux')
})

for (const [name, mutate, pattern] of [
  ['same-version runtime change', f => f.write('apps/agent/src/index.js', 'changed'), /desatualizados/],
  ['new runtime dependency file', f => f.write('apps/agent/src/new.js', 'new'), /desatualizados/],
  ['dependency lock change', f => f.write('package-lock.json', 'changed'), /desatualizados/],
  ['installer change', f => f.write('apps/agent/installer/windows/NodeAccessAgent.wxs', 'changed'), /desatualizados/],
  ['old manifest without provenance', f => { delete f.manifest.sourceSha256; f.save() }, /desatualizados/],
  ['wrong version', f => { f.manifest.version = '1.2.2'; f.save() }, /Versao/],
  ['wrong architecture', f => { f.manifest.architecture = 'arm64'; f.save() }, /Identidade/],
  ['corrupted EXE', f => writeFileSync(join(f.dist, artifactNames[0]), 'broken'), /Integridade/],
  ['missing MSI', f => rmSync(join(f.dist, artifactNames[1])), /ENOENT/],
  ['incorrect checksum', f => writeFileSync(join(f.dist, `${artifactNames[1]}.sha256`), 'incorrect'), /Checksum/],
  ['duplicate manifest entry', f => { f.manifest.artifacts[1] = f.manifest.artifacts[0]; f.save() }, /duplicado/],
]) {
  test(`rejects ${name} before modifying the destination`, t => {
    const f = fixture(t)
    mutate(f)
    const destination = join(f.root, 'output')
    assert.throws(() => importArtifacts(f.dist, destination, f.root), pattern)
    assert.equal(existsSync(destination), false)
  })
}

test('source identity is stable across Windows and Linux checkout line endings', t => {
  const f = fixture(t)
  f.write('apps/agent/src/index.js', 'console.log("agent")\r\n')
  assert.equal(validateArtifacts(f.dist, f.root).version, '1.2.3')
})

test('release preparation CLI imports and rejects stale packages', t => {
  const f = fixture(t)
  for (const path of ['apps/agent/installer/release-signing.mjs', 'apps/agent/installer/windows/artifacts.mjs', 'scripts/release/prepare-agent-windows.mjs']) {
    mkdirSync(dirname(join(f.root, path)), { recursive: true })
    copyFileSync(join(projectRoot, path), join(f.root, path))
  }
  f.manifest.sourceSha256 = sourceDigest(f.root)
  f.save()
  const run = () => spawnSync(process.execPath, [join(f.root, 'scripts/release/prepare-agent-windows.mjs')], {
    env: { ...process.env, AGENT_WINDOWS_RELEASE_REPO: '', AGENT_WINDOWS_ARTIFACTS_DIR: f.dist }, encoding: 'utf8',
  })
  assert.equal(run().status, 0)
  f.write('apps/agent/src/index.js', 'new version of code')
  const result = run()
  assert.equal(result.status, 1)
  assert.match(result.stderr, /desatualizados/)
})

test('release script fails before creating an output directory for stale Windows artifacts', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t)
  for (const path of ['apps/agent/installer/release-signing.mjs', 'apps/agent/installer/windows/artifacts.mjs', 'scripts/release/prepare-agent-windows.mjs', 'scripts/release/build-release.sh', 'scripts/release/prepare-agents.mjs', 'apps/agent/installer/platforms.mjs', 'apps/agent/installer/platform-artifacts.mjs']) {
    mkdirSync(dirname(join(f.root, path)), { recursive: true })
    copyFileSync(join(projectRoot, path), join(f.root, path))
  }
  const output = join(f.root, 'release-output')
  const result = spawnSync('bash', [join(f.root, 'scripts/release/build-release.sh'), '1.0.0', output], {
    env: { ...process.env, AGENT_WINDOWS_RELEASE_REPO: '', AGENT_WINDOWS_ARTIFACTS_DIR: f.dist, INCLUDE_OFFLINE_IMAGES: 'false', BUILD_RELEASE_IMAGES: 'false' }, encoding: 'utf8',
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /desatualizados/)
  assert.equal(existsSync(output), false)
})
