const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')

const workspace = path.resolve(__dirname, '../..')
const workspaceId = createHash('sha256').update(workspace).digest('hex').slice(0, 12)
const uid = process.getuid?.()
const root = path.join(os.tmpdir(), `nodeaccess-harness-${uid ?? 'user'}-${workspaceId}`)

function ensurePrivateRoot(directory) {
  try { fs.mkdirSync(directory, { mode: 0o700 }) } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  const stat = fs.lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink() || (uid !== undefined && stat.uid !== uid)
      || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) {
    throw new Error('Harness artifact root must be an owned private directory, not a symlink')
  }
}

function artifactPath(name, directory = root) {
  if (typeof name !== 'string' || !name || name.includes('\0') || path.isAbsolute(name)
      || name.split(/[\\/]/).some(segment => segment === '..')) {
    throw new Error('Harness artifact name must be a relative path without traversal')
  }
  ensurePrivateRoot(directory)
  const destination = path.join(directory, name)
  const relative = path.relative(directory, destination)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid artifact destination')
  const segments = relative.split(path.sep)
  let current = directory
  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index])
    const isParent = index < segments.length - 1
    if (isParent) {
      try { fs.mkdirSync(current, { mode: 0o700 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
    }
    let stat
    try { stat = fs.lstatSync(current) } catch (error) { if (error.code === 'ENOENT' && !isParent) continue; throw error }
    if (stat.isSymbolicLink() || (uid !== undefined && stat.uid !== uid) || (isParent && !stat.isDirectory())) {
      throw new Error('Harness artifact path cannot traverse symlinks or foreign-owned entries')
    }
  }
  return destination
}

module.exports = { artifactPath }
