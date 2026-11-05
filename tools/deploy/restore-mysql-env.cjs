'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { randomBytes } = require('node:crypto')

function validateAncestors(root) {
  const uid = process.getuid?.()
  let current = path.parse(root).root
  let previousSticky = false
  for (const part of root.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    const info = fs.lstatSync(current)
    const sticky = info.uid === 0 && (info.mode & 0o1000) !== 0
    if (!info.isDirectory() || info.isSymbolicLink()
        || (uid !== undefined && info.uid !== uid && info.uid !== 0)
        || ((info.mode & 0o022) !== 0 && !sticky)
        || (previousSticky && uid !== undefined && info.uid !== uid)) throw new Error('RESTORE_WORKSPACE_UNSAFE')
    previousSticky = sticky
  }
}

function createRestoreEnvironment(directory) {
  const root = path.resolve(directory)
  const stat = fs.lstatSync(root)
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(root) !== root
      || (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o077) !== 0
      || fs.readdirSync(root).length !== 0) throw new Error('RESTORE_WORKSPACE_UNSAFE')
  validateAncestors(root)
  const rootPassword = randomBytes(32).toString('hex')
  const userPassword = randomBytes(32).toString('hex')
  const content = [
    `DB_ROOT_PASSWORD=${rootPassword}`, 'DB_NAME=nodeaccess_restore', 'DB_USER=nodeaccess_restore',
    `DB_PASSWORD=${userPassword}`, `PEM_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`,
    `MYSQL_ROOT_PASSWORD=${rootPassword}`, 'MYSQL_DATABASE=nodeaccess_restore', 'MYSQL_USER=nodeaccess_restore',
    `MYSQL_PASSWORD=${userPassword}`, '',
  ].join('\n')
  const file = path.join(root, '.env')
  const fd = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600)
  try { fs.fchmodSync(fd, 0o600); fs.writeFileSync(fd, content); fs.fsyncSync(fd) } catch (error) {
    fs.closeSync(fd)
    fs.unlinkSync(file)
    throw error
  }
  fs.closeSync(fd)
}

module.exports = { createRestoreEnvironment }
if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('RESTORE_WORKSPACE_REQUIRED')
    createRestoreEnvironment(process.argv[2])
  } catch {
    console.error('RESTORE_ENV_CREATION_FAILED')
    process.exitCode = 1
  }
}
