import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, cpSync, copyFileSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { generateKeyPairSync, createHash } from 'node:crypto'
import { sourceDigest, artifactNames, manifestName } from '../../apps/agent/installer/windows/artifacts.mjs'
import { recordPlatform } from '../../apps/agent/installer/platform-artifacts.mjs'
import { platforms } from '../../apps/agent/installer/platforms.mjs'
import { signWindowsManifest } from '../../apps/agent/installer/release-signing.mjs'

const project = resolve(import.meta.dirname, '../..')
function command(bin, args, options) {
  const result = spawnSync(bin, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024, ...options })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout
}

test('release packaging from another cwd preserves signed fixtures, WSL paths and image overrides', t => {
  // Non-executable, signed test fixtures only. Never a distributable release.
  const temporary = mkdtempSync(join(tmpdir(), 'nodeaccess release WSL '))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const root = join(temporary, 'workspace com espaços')
  mkdirSync(root)
  for (const dir of ['scripts', 'docker', 'systemd', 'tools/deploy', 'tools/ha-witness', 'apps/backend/scripts', 'apps/backend/prisma', 'apps/agent/src', 'apps/agent/installer', 'packages/shared/src/data']) {
    cpSync(join(project, dir), join(root, dir), { recursive: true, filter: source => !source.includes('/reports/') })
  }
  for (const file of ['package.json', 'package-lock.json', '.env.example.prod', 'apps/agent/package.json', ...readdirSync(project).filter(name => /^docker-compose.*\.yml$/.test(name))]) {
    copyFileSync(join(project, file), join(root, file))
  }
  mkdirSync(join(root, 'docs'))
  cpSync(join(project, 'docs/manual'), join(root, 'docs/manual'), { recursive: true })
  cpSync(join(project, 'docs/certificates'), join(root, 'docs/certificates'), { recursive: true })
  cpSync(join(project, 'docs/trial-site'), join(root, 'docs/trial-site'), { recursive: true })
  for (const name of readdirSync(join(project, 'docs')).filter(name => name.startsWith('OPERATIONS-') && name.endsWith('.md'))) {
    copyFileSync(join(project, 'docs', name), join(root, 'docs', name))
  }
  const variables = ['NODEACCESS_RELEASE_SIGNING_KEY', 'NODEACCESS_RELEASE_PUBLIC_KEY', 'NODEACCESS_DEVELOPMENT_UNSIGNED']
  const original = Object.fromEntries(variables.map(key => [key, process.env[key]]))
  t.after(() => {
    for (const key of variables) {
      if (original[key] === undefined) delete process.env[key]
      else process.env[key] = original[key]
    }
  })
  const keys = generateKeyPairSync('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  process.env.NODEACCESS_RELEASE_SIGNING_KEY = join(temporary, 'private.pem')
  process.env.NODEACCESS_RELEASE_PUBLIC_KEY = join(temporary, 'public.pem')
  delete process.env.NODEACCESS_DEVELOPMENT_UNSIGNED
  writeFileSync(process.env.NODEACCESS_RELEASE_SIGNING_KEY, keys.privateKey, { mode: 0o600 })
  writeFileSync(process.env.NODEACCESS_RELEASE_PUBLIC_KEY, keys.publicKey)
  const dist = join(root, 'apps/agent/dist'); mkdirSync(dist)
  const version = JSON.parse(readFileSync(join(root, 'apps/agent/package.json'))).version
  const artifacts = artifactNames.map(file => {
    const bytes = Buffer.from(`TEST ONLY, NOT EXECUTABLE: ${file}`)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    writeFileSync(join(dist, file), bytes)
    writeFileSync(join(dist, file + '.sha256'), `${sha256}  ${file}
`)
    return { file, size: bytes.length, sha256 }
  })
  writeFileSync(join(dist, manifestName), JSON.stringify({ product: 'NodeAccess Agent', version, platform: 'windows', architecture: 'x64', sourceSha256: sourceDigest(root), artifacts }))
  signWindowsManifest(join(dist, manifestName))
  for (const platform of ['linux', 'macos']) {
    writeFileSync(join(dist, platforms[platform].binary), Buffer.from(platform === 'linux' ? '7f454c460001' : 'cffaedfe0001', 'hex'))
    recordPlatform(platform, root)
  }
  const releaseVersion = '0.0.0-wsl-test'
  const env = { ...process.env, NODEACCESS_RELEASE_ALLOW_UNVERIFIED_SOURCE: 'true', INCLUDE_OFFLINE_IMAGES: 'false', BUILD_RELEASE_IMAGES: 'false',
    BACKEND_IMAGE: 'registry.example.invalid/nodeaccess-api', FRONTEND_IMAGE: 'registry.example.invalid/nodeaccess-web',
    MYSQL_IMAGE: 'registry.example.invalid/mysql:8.4.12-1', REDIS_IMAGE: 'registry.example.invalid/redis:8.2.10-1', GUACD_IMAGE: 'registry.example.invalid/guacd:1.6.0-1' }
  delete env.AGENT_WINDOWS_ARTIFACTS_DIR; delete env.AGENT_WINDOWS_RELEASE_REPO
  command('bash', [join(root, 'scripts/release/build-release.sh'), releaseVersion, 'dist/releases com espaços'], { cwd: tmpdir(), env })
  const output = join(root, 'dist/releases com espaços'), release = join(output, `nodeaccess-release-${releaseVersion}`)
  for (const file of ['docker-compose.nonroot.yml', 'scripts/deploy/runtime-permissions.mjs', 'docs/OPERATIONS-compose-nonroot.md', 'scripts/deploy/configure-trial.mjs', 'scripts/backup/backup-release-state.sh', 'docs/OPERATIONS-trial-environments.md', 'scripts/trial-lab/provider.mjs', 'scripts/trial-lab/Dockerfile', 'scripts/trial-lab/entrypoint.sh', 'scripts/trial-lab/README.md']) {
    assert.equal(readFileSync(join(release, file), 'utf8'), readFileSync(join(root, file), 'utf8'), 'Nonroot support file included without mutation')
  }
  for (const file of ['nodeaccess-code-signing-root.cer', 'nodeaccess-publisher.cer', 'README.md']) {
    assert.deepEqual(readFileSync(join(release, 'docs/certificates', file)), readFileSync(join(project, 'docs/certificates', file)))
  }
  for (const file of ['privacidade-degustacao.html', 'termos-degustacao.html', 'README.md']) {
    assert.deepEqual(readFileSync(join(release, 'docs/trial-site', file)), readFileSync(join(project, 'docs/trial-site', file)))
  }
  command('sha256sum', ['-c', `nodeaccess-release-${releaseVersion}.checksums.txt`], { cwd: output })
  const listed = command('tar', ['-tzf', join(output, `nodeaccess-release-${releaseVersion}.tar.gz`)])
  for (const file of ['docker/mysql/include.cnf', 'docker/mysql/conf.d/nodeaccess.cnf', 'docker/stack-images.json', 'scripts/lib/stateful-upgrade-guard.sh', 'scripts/deploy/configure-mysql-auth.sh', 'apps/agent/dist/' + manifestName + '.sig']) assert(listed.includes(file), file)
  for (const name of ['docker-compose.prod.yml', 'docker-compose.ha-state.yml']) {
    const compose = readFileSync(join(release, name), 'utf8')
    assert(compose.includes('image: ' + env.MYSQL_IMAGE)); assert(compose.includes('image: ' + env.REDIS_IMAGE))
  }
  const prod = readFileSync(join(release, 'docker-compose.prod.yml'), 'utf8')
  assert(prod.includes(`image: ${env.BACKEND_IMAGE}:${releaseVersion}`))
  assert(prod.includes(`image: ${env.FRONTEND_IMAGE}:${releaseVersion}`))
  assert(prod.includes('image: ' + env.GUACD_IMAGE))
  assert(readFileSync(join(release, 'docker-compose.ha.yml'), 'utf8').includes('image: ' + env.GUACD_IMAGE))
  assert.equal(JSON.parse(readFileSync(join(release, 'docker/stack-images.json'), 'utf8')).guacd, 'nodeaccess-guacd:1.6.0-1')
  command(process.execPath, [join(root, 'scripts/release/validate-agents.mjs'), join(release, 'apps/agent/dist')], { env })
  const provenance = JSON.parse(readFileSync(join(release, 'release-provenance.json'), 'utf8'))
  assert.equal(provenance.source.kind, 'source-export')
  assert.equal(provenance.source.verified, false)
  assert.equal(provenance.source.commit, null)
  assert.equal(provenance.source.filesSha256['package-lock.json'], createHash('sha256').update(readFileSync(join(root, 'package-lock.json'))).digest('hex'))
  assert(provenance.source.filesSha256['apps/backend/prisma/schema.prisma'])
  assert.equal(provenance.images.length, 6)
  assert(provenance.images.every(image => image.id === null && image.inspected === false))
  assert(provenance.images.some(image => image.reference === env.MYSQL_IMAGE))
  const releaseManifest = JSON.parse(readFileSync(join(release, 'manifest.json'), 'utf8'))
  assert.equal(releaseManifest.provenance, 'release-provenance.json')
  const archive = join(output, `nodeaccess-release-${releaseVersion}.tar.gz`)
  const originalArchive = readFileSync(archive)
  const collision = spawnSync('bash', [join(root, 'scripts/release/build-release.sh'), releaseVersion, output], { env, encoding: 'utf8' })
  assert.notEqual(collision.status, 0)
  assert.match(collision.stderr, /sobrescrita bloqueada/)
  assert.deepEqual(readFileSync(archive), originalArchive)
  for (const suffix of ['.tar.gz', '.checksums.txt']) {
    const collisionOutput = join(temporary, `existing${suffix}`)
    mkdirSync(collisionOutput)
    const existing = join(collisionOutput, `nodeaccess-release-${releaseVersion}${suffix}`)
    writeFileSync(existing, 'preserve-existing-artifact')
    const rejectedExisting = spawnSync('bash', [join(root, 'scripts/release/build-release.sh'), releaseVersion, collisionOutput], { env, encoding: 'utf8' })
    assert.notEqual(rejectedExisting.status, 0)
    assert.match(rejectedExisting.stderr, /sobrescrita bloqueada/)
    assert.equal(readFileSync(existing, 'utf8'), 'preserve-existing-artifact')
    assert.deepEqual(readdirSync(collisionOutput), [`nodeaccess-release-${releaseVersion}${suffix}`])
  }
  for (const version of ['../escape', 'bad/version', 'bad&version', 'bad"version', 'x'.repeat(129)]) {
    const invalid = spawnSync('bash', [join(root, 'scripts/release/build-release.sh'), version, 'invalid-output'], { env, encoding: 'utf8' })
    assert.notEqual(invalid.status, 0)
    assert.match(invalid.stderr, /Versao de release invalida/)
  }
  assert(!readdirSync(root).includes('invalid-output'))
  const cleanRequired = spawnSync('bash', [join(root, 'scripts/release/build-release.sh'), releaseVersion, 'unverified'], {
    env: { ...env, NODEACCESS_RELEASE_ALLOW_UNVERIFIED_SOURCE: 'false' }, encoding: 'utf8',
  })
  assert.notEqual(cleanRequired.status, 0)
  assert.match(cleanRequired.stderr, /clean Git checkout/)
  assert(!readdirSync(root).includes('unverified'))
  // A tampered manifest must stop packaging before an output directory is created.
  writeFileSync(join(dist, manifestName + '.sig'), Buffer.alloc(384))
  const rejected = spawnSync('bash', [join(root, 'scripts/release/build-release.sh'), releaseVersion, 'rejected'], { cwd: tmpdir(), env, encoding: 'utf8', timeout: 30_000 })
  assert.notEqual(rejected.status, 0)
  assert.match(rejected.stderr, /Untrusted release signature|Artefatos Windows/)
  assert(!readdirSync(root).includes('rejected'))
})
