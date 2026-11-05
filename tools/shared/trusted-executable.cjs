const fs = require('node:fs')
const path = require('node:path')

function failure(code) { return Object.assign(new Error(code), { code }) }
function within(base, target, paths = path) {
  const relative = paths.relative(base, target)
  return relative === '' || (!relative.startsWith(`..${paths.sep}`) && relative !== '..' && !paths.isAbsolute(relative))
}
function inWorkspace(cwd, candidate, paths = path) {
  const directory = paths.resolve(cwd)
  if (directory === paths.parse(directory).root) return paths.dirname(candidate) === directory
  return within(directory, candidate, paths)
}
function windowsCandidates(name, directory, extensions) {
  if (!/^[a-zA-Z]:[\\\/]/.test(directory)) return []
  const suffix = path.win32.extname(name).toLowerCase()
  const allowed = extensions.split(';').map(value => value.toLowerCase()).filter(value => ['.exe', '.com'].includes(value))
  if (suffix) return allowed.includes(suffix) ? [path.win32.join(directory, name)] : []
  return [...new Set(allowed)].map(extension => path.win32.join(directory, name + extension))
}
function checkPosixEntry(info, uid, stickyParent, final) {
  if (info.uid !== 0 && info.uid !== uid) throw failure('EXECUTABLE_FOREIGN_OWNER')
  if (stickyParent && info.uid !== uid) throw failure('EXECUTABLE_UNSAFE_STICKY_CHILD')
  if (info.isSymbolicLink()) return false
  if (stickyParent && (info.mode & 0o022)) throw failure('EXECUTABLE_UNSAFE_STICKY_CHILD')
  const sticky = !final && info.isDirectory() && info.uid === 0 && (info.mode & 0o1000) !== 0
  if ((info.mode & 0o022) && !sticky) throw failure('EXECUTABLE_WRITABLE_BY_OTHERS')
  if (final ? !info.isFile() : !info.isDirectory()) throw failure('EXECUTABLE_WRONG_TYPE')
  return sticky
}
function validatePosix(candidate, { uid = process.getuid?.(), cwd = process.cwd() } = {}, seen = new Set()) {
  if (seen.has(candidate) || seen.size > 40) throw failure('EXECUTABLE_SYMLINK_LOOP')
  seen.add(candidate)
  if (inWorkspace(cwd, candidate)) throw failure('EXECUTABLE_IN_WORKSPACE')
  const parts = candidate.split(path.sep).filter(Boolean)
  let current = path.parse(candidate).root
  let stickyParent = false
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index])
    const info = fs.lstatSync(current)
    stickyParent = checkPosixEntry(info, uid, stickyParent, index === parts.length - 1)
    if (info.isSymbolicLink()) {
      const resolved = path.resolve(path.dirname(current), fs.readlinkSync(current))
      return validatePosix(path.join(resolved, ...parts.slice(index + 1)), { uid, cwd }, seen)
    }
  }
  fs.accessSync(candidate, fs.constants.X_OK)
  return candidate
}
function validateWindows(candidate, roots, cwd) {
  if (candidate.startsWith('\\\\') || candidate.startsWith('//')) throw failure('EXECUTABLE_UNC_REJECTED')
  const resolved = fs.realpathSync(candidate)
  const trusted = roots.filter(root => /^[a-zA-Z]:[\\\/]/.test(root) && path.win32.resolve(root) !== path.win32.parse(root).root)
  if (!trusted.some(root => within(root, candidate, path.win32) && within(root, resolved, path.win32))) throw failure('EXECUTABLE_WINDOWS_TRUST_REQUIRED')
  if (inWorkspace(cwd, candidate, path.win32) || inWorkspace(cwd, resolved, path.win32)) throw failure('EXECUTABLE_IN_WORKSPACE')
  if (!fs.statSync(resolved).isFile() || !['.exe', '.com'].includes(path.win32.extname(resolved).toLowerCase())) throw failure('EXECUTABLE_WRONG_TYPE')
  // These roots are an administrator assertion, not an NTFS ACL verification.
  return resolved
}
function resolveExecutable(name, options = {}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) throw failure('EXECUTABLE_INVALID_NAME')
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const paths = platform === 'win32' ? path.win32 : path
  const cwd = options.cwd ?? process.cwd()
  const override = options.executable ?? env[`NODEACCESS_EXECUTABLE_${name.toUpperCase().replaceAll('-', '_')}`]
  if (override && !paths.isAbsolute(override)) throw failure('EXECUTABLE_OVERRIDE_NOT_ABSOLUTE')
  const roots = options.trustedRoots ?? (env.NODEACCESS_EXECUTABLE_TRUSTED_ROOTS ?? '').split(';').filter(Boolean)
  const candidates = override ? [override] : (env.PATH ?? '').split(platform === 'win32' ? ';' : path.delimiter).flatMap(directory => {
    if (!directory || !paths.isAbsolute(directory)) return []
    return platform === 'win32' ? windowsCandidates(name, directory, env.PATHEXT ?? '.EXE;.COM') : [path.join(directory, name)]
  })
  for (const candidate of candidates) {
    if (platform === 'win32' && !/^[a-zA-Z]:[\\\/]/.test(candidate)) throw failure('EXECUTABLE_UNC_REJECTED')
    try { fs.lstatSync(candidate) } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue; throw error }
    if (platform === 'win32') return validateWindows(candidate, roots, cwd)
    return validatePosix(candidate, { cwd })
  }
  throw failure('EXECUTABLE_NOT_FOUND')
}
module.exports = { resolveExecutable, windowsCandidates, within }
