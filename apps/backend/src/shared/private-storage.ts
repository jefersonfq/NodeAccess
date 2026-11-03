import { chmod, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

async function privateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory
    || (process.getuid && info.uid !== process.getuid()) || (info.mode & 0o022) !== 0) {
    throw new Error('Storage directory must be owned by the service and not writable by other users')
  }
  // Existing service-owned 0755 storage is tightened without moving its data.
  if ((info.mode & 0o077) !== 0) await chmod(directory, 0o700)
}

/** Keep configured storage paths; atomically replace only a regular, service-owned file. */
export async function writePrivateStorageFile(root: string, filename: string, content: Uint8Array): Promise<void> {
  const base = resolve(root)
  if (base === parse(base).root || base === resolve(tmpdir())) throw new Error('A dedicated storage directory is required')
  const destination = resolve(base, filename)
  const inside = relative(base, destination)
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error('File must remain inside storage')
  await privateDirectory(base)
  let directory = base
  for (const part of relative(base, dirname(destination)).split(sep).filter(Boolean)) {
    directory = join(directory, part)
    await privateDirectory(directory)
  }
  const existing = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return undefined
  })
  if (existing && (!existing.isFile() || existing.isSymbolicLink()
    || (process.getuid && existing.uid !== process.getuid()))) throw new Error('Refusing unsafe storage destination')
  const temporary = join(directory, `.nodeaccess-${randomUUID()}.tmp`)
  const file = await open(temporary, 'wx', 0o600)
  try {
    await file.writeFile(content)
    await file.close()
    await rename(temporary, destination)
  } finally {
    await file.close().catch(() => undefined)
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
  }
}
