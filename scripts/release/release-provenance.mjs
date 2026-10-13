import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { relative, resolve, join, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) throw new Error('Git source provenance unavailable')
  return result.stdout.trim()
}
function sourceHashes(root) {
  const paths = ['package.json', 'package-lock.json', 'apps/backend/prisma/schema.prisma']
  const migrations = 'apps/backend/prisma/migrations'
  if (existsSync(join(root, migrations))) {
    for (const entry of readdirSync(join(root, migrations), { withFileTypes: true })) {
      const file = `${migrations}/${entry.name}/migration.sql`
      if (entry.isDirectory() && existsSync(join(root, file))) paths.push(file)
    }
    if (existsSync(join(root, migrations, 'migration_lock.toml'))) paths.push(`${migrations}/migration_lock.toml`)
  }
  return Object.fromEntries(paths.sort().map(file => [file, sha256(readFileSync(join(root, file)))]))
}
export function collectSource(root, releaseDir, allowUnverified = false) {
  root = resolve(root)
  let source
  const excluded = [releaseDir, `${releaseDir}.tar.gz`, `${releaseDir}.checksums.txt`]
    .map(file => relative(root, resolve(file)))
    .filter(file => file && file !== '..' && !file.startsWith(`..${sep}`))
    .map(file => `:(exclude,literal)${file.split(sep).join('/')}`)
  try {
    if (resolve(git(root, ['rev-parse', '--show-toplevel'])) !== root) throw new Error('Not the repository root')
    const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all', '--', '.', ...excluded])
    source = {
      kind: 'git', commit: git(root, ['rev-parse', 'HEAD']), tree: git(root, ['rev-parse', 'HEAD^{tree}']),
      dirty: status.length > 0, verified: status.length === 0,
      // Hashes preserve evidence without publishing diff content or untracked names.
      workingStateSha256: sha256(status + '\n' + git(root, ['diff', 'HEAD', '--binary', '--', '.', ...excluded])),
    }
  } catch {
    source = { kind: 'source-export', commit: null, tree: null, dirty: null, verified: false }
  }
  if (!source.verified && !allowUnverified) {
    throw new Error('Release source must be a clean Git checkout. For an explicitly unverified development/export package use NODEACCESS_RELEASE_ALLOW_UNVERIFIED_SOURCE=true; this does not certify a release.')
  }
  return { ...source, filesSha256: sourceHashes(root) }
}
export function collectImages(refs, inspect = true, run = spawnSync) {
  return refs.map(reference => {
    if (!inspect) return { reference, id: null, repoDigests: [], inspected: false }
    const result = run('docker', ['image', 'inspect', reference], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
    if (result.status !== 0) {
      if (inspect === 'available') return { reference, id: null, repoDigests: [], inspected: false }
      throw new Error(`Cannot record image provenance: ${reference}`)
    }
    const [record] = JSON.parse(result.stdout)
    if (!/^sha256:[a-f0-9]{64}$/.test(record?.Id)) throw new Error(`Invalid image ID: ${reference}`)
    return { reference, id: record.Id, repoDigests: [...(record.RepoDigests ?? [])].sort(), inspected: true }
  })
}
export function finalize(root, releaseDir, snapshotFile, inspect, refs, allowUnverified = false) {
  const source = JSON.parse(readFileSync(snapshotFile, 'utf8'))
  if (JSON.stringify(source) !== JSON.stringify(collectSource(root, releaseDir, allowUnverified))) {
    throw new Error('Source changed during packaging; use a fresh version/destination and rebuild.')
  }
  const provenance = {
    formatVersion: 1, source, images: collectImages(refs, inspect),
    recoveryScope: 'Code and packaged images only; database, configuration, encryption keys and compatible backups require separate preservation.',
  }
  writeFileSync(join(releaseDir, 'release-provenance.json'), JSON.stringify(provenance, null, 2) + '\n', { flag: 'wx' })
  const manifestPath = join(releaseDir, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.provenance = 'release-provenance.json'
  manifest.artifacts.push('release-provenance.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}
// docker save uses tags: detect a concurrent retag or source edit before publishing.
export function verify(root, releaseDir, inspect, refs, allowUnverified = false) {
  const provenance = JSON.parse(readFileSync(join(releaseDir, 'release-provenance.json'), 'utf8'))
  if (JSON.stringify(provenance.source) !== JSON.stringify(collectSource(root, releaseDir, allowUnverified))
    || JSON.stringify(provenance.images) !== JSON.stringify(collectImages(refs, inspect))) {
    throw new Error('Source or image IDs changed during packaging; rebuild in a fresh destination.')
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, root, releaseDir, snapshotFile, inspect, ...refs] = process.argv.slice(2)
    const allow = process.env.NODEACCESS_RELEASE_ALLOW_UNVERIFIED_SOURCE === 'true'
    const imageMode = inspect === 'true' ? true : inspect === 'available' ? 'available' : false
    if (mode === 'snapshot') process.stdout.write(JSON.stringify(collectSource(root, releaseDir, allow)) + '\n')
    else if (mode === 'finalize') finalize(root, releaseDir, snapshotFile, imageMode, refs, allow)
    else if (mode === 'verify') verify(root, releaseDir, imageMode, refs, allow)
    else throw new Error('Expected snapshot, finalize or verify')
  } catch (error) {
    process.stderr.write(`[release] ${error.message}\n`)
    process.exitCode = 1
  }
}
