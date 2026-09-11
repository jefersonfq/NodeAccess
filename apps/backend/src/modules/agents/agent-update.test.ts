import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { readWindowsAgentUpdate } from './agent-update.js'
const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))
function fixture(change: (manifest: any) => void = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'agent-update-')); roots.push(root)
  const file = Buffer.from('installer fixture')
  const manifest = { product: 'NodeAccess Agent', version: '1.4.0', platform: 'windows', architecture: 'x64', artifacts: [{ file: 'nodeaccess-agent-windows-x64.msi', size: file.length, sha256: createHash('sha256').update(file).digest('hex') }] }
  change(manifest)
  writeFileSync(join(root, 'nodeaccess-agent-windows-x64.json'), JSON.stringify(manifest))
  writeFileSync(join(root, 'nodeaccess-agent-windows-x64.msi'), file)
  return root
}
describe('agent update metadata', () => {
  it('publishes only fixed-origin installer metadata', () => {
    expect(readWindowsAgentUpdate(fixture())).toEqual({ schemaVersion: 1, version: '1.4.0', platform: 'windows', architecture: 'x64', downloadPath: '/api/v1/agents/download/windows_msi', size: 17, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
  })
  it.each([
    (m: any) => { m.version = 'latest' },
    (m: any) => { m.platform = 'linux' },
    (m: any) => { m.artifacts[0].sha256 = 'invalid' },
    (m: any) => { m.artifacts[0].size++ },
    (m: any) => { m.artifacts.push(m.artifacts[0]) },
    (m: any) => { m.artifacts[0].file = '../other.msi' },
  ])('rejects inconsistent releases', change => expect(() => readWindowsAgentUpdate(fixture(change))).toThrow())
  it('does not invent a release when the installer is missing', () => {
    const root = fixture(); rmSync(join(root, 'nodeaccess-agent-windows-x64.msi'))
    expect(() => readWindowsAgentUpdate(root)).toThrow()
  })
})
