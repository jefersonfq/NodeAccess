import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { collectSource, collectImages, finalize, verify } from '../../scripts/release/release-provenance.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'release provenance '))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'apps/backend/prisma/migrations/001_initial'), { recursive: true })
  writeFileSync(join(root, 'package.json'), '{}\n')
  writeFileSync(join(root, 'package-lock.json'), '{}\n')
  writeFileSync(join(root, 'apps/backend/prisma/schema.prisma'), '// schema\n')
  writeFileSync(join(root, 'apps/backend/prisma/migrations/001_initial/migration.sql'), 'SELECT 1;\n')
  const git = (...args) => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  git('init', '-q')
  git('config', 'user.email', 'fixture@example.invalid')
  git('config', 'user.name', 'Release fixture')
  git('add', '.')
  git('commit', '-qm', 'fixture')
  return { root, git, release: join(root, 'output with spaces/nodeaccess-release-test') }
}
test('clean Git source records exact commit/tree and migration checksums', t => {
  const { root, git, release } = fixture(t)
  const source = collectSource(root, release)
  assert.equal(source.commit, git('rev-parse', 'HEAD'))
  assert.equal(source.tree, git('rev-parse', 'HEAD^{tree}'))
  assert.equal(source.verified, true)
  assert.equal(source.dirty, false)
  assert.match(source.filesSha256['apps/backend/prisma/migrations/001_initial/migration.sql'], /^[a-f0-9]{64}$/)
  mkdirSync(release, { recursive: true })
  writeFileSync(join(release, 'generated.json'), '{}')
  writeFileSync(release + '.tar.gz', 'test')
  assert.deepEqual(collectSource(root, release), source, 'only this reserved output is excluded')
  writeFileSync(join(root, 'untracked-source.js'), 'export {}')
  assert.throws(() => collectSource(root, release), /clean Git checkout/)
})
test('dirty sources fail closed or carry explicit unverified metadata without diff content', t => {
  const { root, release } = fixture(t)
  writeFileSync(join(root, 'package.json'), '{"changed":true}\n')
  assert.throws(() => collectSource(root, release), /clean Git checkout/)
  const source = collectSource(root, release, true)
  assert.equal(source.kind, 'git')
  assert.equal(source.verified, false)
  assert.equal(source.dirty, true)
  assert(!JSON.stringify(source).includes('changed'))
})
test('packaging rejects a source change after the initial snapshot', t => {
  const { root, release } = fixture(t)
  const initial = collectSource(root, release, true)
  const snapshot = join(root, 'snapshot.json')
  writeFileSync(snapshot, JSON.stringify(initial))
  mkdirSync(release, { recursive: true })
  writeFileSync(join(release, 'manifest.json'), '{"artifacts":[]}')
  writeFileSync(join(root, 'apps/backend/prisma/schema.prisma'), '// modified schema')
  assert.throws(() => finalize(root, release, snapshot, false, [], true), /Source changed/)
})
test('image provenance records immutable IDs without publishing container config', () => {
  const id = 'sha256:' + 'a'.repeat(64)
  const records = collectImages(['image:1'], true, (command, args) => {
    assert.equal(command, 'docker')
    assert.deepEqual(args, ['image', 'inspect', 'image:1'])
    return { status: 0, stdout: JSON.stringify([{ Id: id, RepoDigests: ['image@' + id], Config: { Env: ['SECRET=never-publish'] } }]) }
  })
  assert.equal(records[0].id, id)
  assert(!JSON.stringify(records).includes('SECRET'))
  assert.throws(() => collectImages(['missing:1'], true, () => ({ status: 1 })), /Cannot record image/)
  assert.throws(() => collectImages(['invalid:1'], true, () => ({ status: 0, stdout: '[{"Id":"bad"}]' })), /Invalid image ID/)
  assert.equal(collectImages(['metadata-only:1'], false)[0].inspected, false)
  assert.equal(collectImages(['online-not-pulled:1'], 'available', () => ({ status: 1 }))[0].inspected, false)
})

test('finalized clean provenance survives generated artifacts and rejects source drift', t => {
  const { root, release } = fixture(t)
  const source = collectSource(root, release)
  mkdirSync(release, { recursive: true })
  const snapshot = join(release, 'snapshot.json')
  writeFileSync(snapshot, JSON.stringify(source))
  writeFileSync(join(release, 'manifest.json'), '{"artifacts":[]}')
  finalize(root, release, snapshot, false, ['not-bundled:1'])
  verify(root, release, false, ['not-bundled:1'])
  assert.throws(() => verify(root, release, false, ['different:1']), /image IDs changed/)
  writeFileSync(join(root, 'apps/backend/prisma/schema.prisma'), '// drift')
  assert.throws(() => verify(root, release, false, ['not-bundled:1']), /clean Git checkout/)
})
