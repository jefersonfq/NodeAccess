import { closeSync, constants, fchownSync, fsyncSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

function saveManifest(manifest, snapshot, exclusive = false) {
  const destination = exclusive ? manifest : `${manifest}.pending-${randomUUID()}`
  let descriptor
  try {
    descriptor = openSync(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
    writeFileSync(descriptor, JSON.stringify(snapshot, null, 2) + '\n')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    if (!exclusive) renameSync(destination, manifest)
    const directory = openSync(dirname(manifest), constants.O_RDONLY | constants.O_DIRECTORY)
    try { fsyncSync(directory) } finally { closeSync(directory) }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    if (!exclusive) rmSync(destination, { force: true })
  }
}

function inspectTree(root) {
  const entries = []
  function visit(path) {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error('Unsupported entry: symlink or special file')
    if (stat.isFile() && stat.nlink !== 1) throw new Error('Hard-linked files require manual review')
    if (stat.mode & 0o7000) throw new Error('Special permission bits require manual review')
    entries.push({ path: relative(root, path), uid: stat.uid, gid: stat.gid, mode: stat.mode & 0o777, ino: stat.ino, dev: stat.dev })
    if (stat.isDirectory()) for (const child of readdirSync(path).sort()) visit(join(path, child))
  }
  visit(root)
  return entries
}

function applyOwner(root, entry, uid, gid) {
  const path = join(root, entry.path)
  // No-follow + identity check prevents replacing a checked entry with a symlink.
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(descriptor)
    if (stat.ino !== entry.ino || stat.dev !== entry.dev) throw new Error('Entry changed during migration')
    if (stat.isFile() && stat.nlink !== 1) throw new Error('Entry became hard-linked during migration')
    // chown through a descriptor keeps the validated object even if it is renamed.
    fchownSync(descriptor, uid, gid)
  } finally { closeSync(descriptor) }
}

export function migratePermissions({ root, manifest, mode }) {
  root = resolve(root)
  manifest = resolve(manifest)
  if (root === sep || manifest === root || manifest.startsWith(root + sep)) throw new Error('Manifest must be outside the migrated directory')
  if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) throw new Error('Root must be a real directory')
  const current = inspectTree(root)
  if (mode === 'prepare') {
    const snapshot = { version: 1, targetUid: 1000, targetGid: 1000, createdAt: new Date().toISOString(), state: 'prepared', entries: current }
    saveManifest(manifest, snapshot, true)
    for (const entry of current) applyOwner(root, entry, 1000, 1000)
    snapshot.state = 'applied'
    saveManifest(manifest, snapshot)
    return { action: mode, entries: current.length, uid: 1000, gid: 1000 }
  }
  if (mode !== 'restore') throw new Error('Use prepare or restore')
  const manifestStat = lstatSync(manifest)
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error('Manifest must be a regular file, not a symlink')
  const snapshot = JSON.parse(readFileSync(manifest, 'utf8'))
  if (snapshot.version !== 1 || snapshot.targetUid !== 1000 || snapshot.targetGid !== 1000 || !Array.isArray(snapshot.entries) || !['prepared', 'applied'].includes(snapshot.state)) throw new Error('Invalid or already restored manifest')
  const paths = new Set()
  const currentByPath = new Map(current.map(entry => [entry.path, entry]))
  for (const entry of snapshot.entries) {
    if (typeof entry.path !== 'string' || isAbsolute(entry.path) || entry.path.split(/[\\/]/).some(part => part === '..') || paths.has(entry.path)) throw new Error('Unsafe or duplicate manifest entry')
    paths.add(entry.path)
    const found = currentByPath.get(entry.path)
    if (!found || found.ino !== entry.ino || found.dev !== entry.dev) throw new Error('Recorded entry was removed or replaced; manual restore required')
    if (![entry.uid, entry.gid, entry.mode].every(Number.isSafeInteger) || entry.uid < 0 || entry.uid > 0xfffffffe || entry.gid < 0 || entry.gid > 0xfffffffe || entry.mode < 0 || entry.mode > 0o777) throw new Error('Invalid ownership metadata')
    if (found.mode !== entry.mode) throw new Error('Permission modes changed; manual review required')
  }
  if (!paths.has('')) throw new Error('Manifest does not include the root')
  const originalByPath = new Map(snapshot.entries.map(entry => [entry.path, entry]))
  const newEntries = current.filter(entry => !paths.has(entry.path)).map(entry => {
    if (entry.uid !== snapshot.targetUid || entry.gid !== snapshot.targetGid) throw new Error('New entry has unexpected ownership; manual review required')
    let parent = dirname(entry.path)
    while (parent !== '.' && !originalByPath.has(parent)) parent = dirname(parent)
    const previousParent = originalByPath.get(parent === '.' ? '' : parent)
    return { ...entry, restoreUid: previousParent.uid, restoreGid: previousParent.gid }
  })
  // Preserve metadata before changing any new files; root with cap_drop=ALL
  // cannot read UID1000-owned mode0600 files after reverting the override.
  snapshot.newEntries = newEntries
  saveManifest(manifest, snapshot)
  for (const entry of snapshot.entries) applyOwner(root, entry, entry.uid, entry.gid)
  for (const entry of newEntries) applyOwner(root, entry, entry.restoreUid, entry.restoreGid)
  snapshot.state = 'restored'
  saveManifest(manifest, snapshot)
  return { action: mode, entries: snapshot.entries.length, newEntriesPreserved: newEntries.length }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    // Fixed mount points limit the maintenance command; never infer production volumes.
    if (process.getuid?.() !== 0 || process.argv.length !== 3) throw new Error('Run as root in the isolated maintenance container with prepare or restore')
    console.log(JSON.stringify(migratePermissions({ root: '/migration', manifest: '/state/permissions.json', mode: process.argv[2] })))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
