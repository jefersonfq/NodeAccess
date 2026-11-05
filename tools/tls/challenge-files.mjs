import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

async function checkedDirectory(directory, allowSticky = false) {
  const info = await fs.lstat(directory)
  const uid = process.getuid?.()
  const sticky = allowSticky && info.uid === 0 && (info.mode & 0o1000) !== 0
  if (!info.isDirectory() || info.isSymbolicLink() || await fs.realpath(directory) !== directory
      || (uid !== undefined && info.uid !== uid && info.uid !== 0) || ((info.mode & 0o022) && !sticky)) throw new Error('ACME_UNSAFE_WEBROOT')
  return sticky
}
export async function createChallengeFile(webroot) {
  const root = path.resolve(webroot)
  let current = path.parse(root).root
  let sticky = false
  for (const part of root.split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    const wasSticky = sticky; sticky = await checkedDirectory(current, current !== root)
    if (wasSticky && (await fs.lstat(current)).uid !== process.getuid?.()) throw new Error('ACME_UNSAFE_WEBROOT')
  }
  for (const part of ['.well-known', 'acme-challenge']) {
    current = path.join(current, part)
    let created = false
    try { await fs.mkdir(current, { mode: 0o755 }); created = true } catch (error) { if (error.code !== 'EEXIST') throw error }
    await checkedDirectory(current)
    if (created) await fs.chmod(current, 0o755)
  }
  const name = `nodeaccess-${randomUUID()}`
  const file = path.join(current, name)
  const handle = await fs.open(file, 'wx', 0o644)
  try { await handle.chmod(0o644); await handle.writeFile(name) } catch (error) { await handle.close(); await fs.unlink(file).catch(() => {}); throw error }
  await handle.close()
  return { name, file, remove: () => fs.unlink(file).catch(() => {}) }
}
