import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { ExtensionPackage, updateManifestFor, type ExtensionPackageConfig } from './vault-extension-package.js'

const ID = 'abcdefghijklmnopabcdefghijklmnop'
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
function release(overrides: Record<string, unknown> = {}) {
  const zip = Buffer.from('zip-bytes'), crx = Buffer.from('crx-bytes')
  const meta = { schemaVersion: 1, version: '0.2.0', extensionId: ID, zip: { file: 'vaultnaccess-0.2.0.zip', sha256: sha(zip), size: zip.length },
    crx: { file: 'vaultnaccess-0.2.0.crx', sha256: sha(crx), size: crx.length }, ...overrides }
  const files = new Map<string, Buffer>([['/r/release.json', Buffer.from(JSON.stringify(meta))], ['/r/vaultnaccess-0.2.0.zip', zip], ['/r/vaultnaccess-0.2.0.crx', crx],
    ['/r/update.xml', Buffer.from(`<gupdate><app appid='${ID}'><updatecheck codebase='https://p/x' version='0.2.0' /></app></gupdate>`)]])
  return { files, read: (path: string) => (files.has(path) ? Promise.resolve(files.get(path)!) : Promise.reject(new Error('ENOENT'))),
    size: (path: string) => (files.has(path) ? Promise.resolve(files.get(path)!.length) : Promise.reject(new Error('ENOENT'))) }
}
const config = (patch: Partial<ExtensionPackageConfig> = {}): ExtensionPackageConfig => ({ enabled: true, directory: '/r', extensionIds: [ID], minVersion: '0.1.0', ...patch })

describe('NA-0194 extension release publication', () => {
  it('publishes a release that matches the configuration, with verified files', async () => {
    const r = release(), pkg = new ExtensionPackage(config(), r.read, r.size)
    expect(await pkg.release()).toMatchObject({ version: '0.2.0', extensionId: ID })
    expect((await pkg.file('zip'))?.contentType).toBe('application/zip')
    expect((await pkg.file('crx'))?.contentType).toBe('application/x-chrome-extension')
    expect(await pkg.verified()).toMatchObject({ version: '0.2.0' })
    const xml = updateManifestFor((await pkg.release())!, "https://p.test/x?a=1&b='2'")
    expect(xml).toContain(`appid='${ID}'`); expect(xml).toContain("version='0.2.0'"); expect(xml).toContain('a=1&amp;b=&apos;2&apos;')
  })
  it.each([
    ['disabled extension', config({ enabled: false }), {}],
    ['no directory', config({ directory: undefined }), {}],
    ['id not allowed', config({ extensionIds: ['p'.repeat(32)] }), {}],
    ['version below the minimum', config({ minVersion: '0.3.0' }), {}],
    ['wrong schema', config(), { schemaVersion: 2 }],
    ['bad version', config(), { version: '1.2' }],
    ['file name of another version', config(), { zip: { file: 'vaultnaccess-9.9.9.zip', sha256: 'a'.repeat(64), size: 1 } }],
  ] as const)('publishes nothing with %s', async (_name, cfg, patch) => {
    const r = release(patch), pkg = new ExtensionPackage(cfg, r.read, r.size)
    expect(await pkg.release()).toBeNull(); expect(await pkg.file('zip')).toBeNull(); expect(await pkg.verified()).toBeNull()
  })
  it('refuses changed, resized or unreadable files and an oversized release.json', async () => {
    const r = release(), pkg = new ExtensionPackage(config(), r.read, r.size)
    r.files.set('/r/vaultnaccess-0.2.0.crx', Buffer.from('crx-bytez'))
    expect(await pkg.file('crx')).toBeNull(); expect(await pkg.verified()).toBeNull()
    r.files.set('/r/vaultnaccess-0.2.0.crx', Buffer.from('a much longer file'))
    expect(await pkg.file('crx')).toBeNull()
    r.files.set('/r/release.json', Buffer.alloc(70_000, 32)); expect(await pkg.release()).toBeNull()
    r.files.set('/r/release.json', Buffer.from('{}'))
    r.files.delete('/r/vaultnaccess-0.2.0.zip'); expect(await pkg.file('zip')).toBeNull()
    r.files.set('/r/release.json', Buffer.from('not json')); expect(await pkg.release()).toBeNull()
    r.files.delete('/r/release.json'); expect(await pkg.release()).toBeNull()
  })
})
