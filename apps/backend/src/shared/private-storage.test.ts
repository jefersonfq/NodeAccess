import { afterEach, describe, expect, it } from 'vitest'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writePrivateStorageFile } from './private-storage.js'

const roots: string[] = []
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'nodeaccess-storage-test-')); roots.push(root); return root }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
describe('private service storage', () => {
  it('keeps existing paths and makes new and replaced content private atomically', async () => {
    const parent = await fixture(), root = join(parent, 'store')
    await mkdir(root, { mode: 0o755 })
    await writePrivateStorageFile(root, 'tenant/1.avatar', Buffer.from('first'))
    await writePrivateStorageFile(root, 'tenant/1.avatar', Buffer.from('second'))
    expect(await readFile(join(root, 'tenant/1.avatar'), 'utf8')).toBe('second')
    expect((await lstat(root)).mode & 0o777).toBe(0o700)
    expect((await lstat(join(root, 'tenant'))).mode & 0o777).toBe(0o700)
    expect((await lstat(join(root, 'tenant/1.avatar'))).mode & 0o777).toBe(0o600)
    expect(await readdir(join(root, 'tenant'))).toEqual(['1.avatar'])
  })
  it('publishes whole file versions during concurrent writes and reads', async () => {
    const parent = await fixture(), root = join(parent, 'store'), name = 'tenant/data'
    const versions = ['A'.repeat(20000), 'B'.repeat(20000), 'C'.repeat(20000)]
    await writePrivateStorageFile(root, name, Buffer.from(versions[0]!))
    const reads = Array.from({ length: 20 }, async () => expect(versions).toContain(await readFile(join(root, name), 'utf8')))
    await Promise.all([...reads, ...versions.map(value => writePrivateStorageFile(root, name, Buffer.from(value)))])
    expect(versions).toContain(await readFile(join(root, name), 'utf8'))
  })
  it('rejects root, child and target symlinks without touching the external target', async () => {
    const parent = await fixture(), root = join(parent, 'store'), external = join(parent, 'external')
    await mkdir(external); await writeFile(join(external, 'target'), 'preserve')
    await symlink(external, root)
    await expect(writePrivateStorageFile(root, 'target', Buffer.from('bad'))).rejects.toThrow()
    await rm(root); await mkdir(root, { mode: 0o700 }); await symlink(external, join(root, 'child'))
    await expect(writePrivateStorageFile(root, 'child/target', Buffer.from('bad'))).rejects.toThrow()
    await symlink(join(external, 'target'), join(root, 'target'))
    await expect(writePrivateStorageFile(root, 'target', Buffer.from('bad'))).rejects.toThrow()
    expect(await readFile(join(external, 'target'), 'utf8')).toBe('preserve')
  })
  it('rejects traversal, shared temporary roots and writable storage directories', async () => {
    const parent = await fixture(), root = join(parent, 'store')
    await expect(writePrivateStorageFile(root, '../outside', Buffer.from('bad'))).rejects.toThrow()
    await expect(writePrivateStorageFile(tmpdir(), 'target', Buffer.from('bad'))).rejects.toThrow()
    await mkdir(root); await chmod(root, 0o777)
    await expect(writePrivateStorageFile(root, 'target', Buffer.from('bad'))).rejects.toThrow()
  })
})
