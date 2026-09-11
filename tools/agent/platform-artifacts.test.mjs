import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordPlatform, validatePlatform } from '../../apps/agent/installer/platform-artifacts.mjs'
import { platforms } from '../../apps/agent/installer/platforms.mjs'
for (const platform of ['linux', 'macos']) {
  test(`${platform}: provenance rejects source, version, identity and artifact drift`, t => {
    const root = mkdtempSync(join(tmpdir(), 'agent-platform-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    for (const dir of ['apps/agent/src', 'apps/agent/installer', 'apps/agent/dist']) mkdirSync(join(root, dir), { recursive: true })
    writeFileSync(join(root, 'package-lock.json'), '{}')
    writeFileSync(join(root, 'apps/agent/package.json'), '{"version":"1.2.0"}')
    const binary = join(root, 'apps/agent/dist', platforms[platform].binary)
    writeFileSync(binary, Buffer.from(platform === 'linux' ? '7f454c460001' : 'cffaedfe0001', 'hex'))
    assert.throws(() => validatePlatform(platform, root), /ENOENT/)
    recordPlatform(platform, root)
    assert.equal(validatePlatform(platform, root).version, '1.2.0')
    writeFileSync(join(root, 'apps/agent/src/new.js'), 'changed')
    assert.throws(() => validatePlatform(platform, root), /sourceSha256/)
    recordPlatform(platform, root)
    writeFileSync(join(root, 'apps/agent/package.json'), '{"version":"1.2.1"}')
    assert.throws(() => validatePlatform(platform, root), /version/)
    recordPlatform(platform, root)
    const manifest = join(root, 'apps/agent/dist', platforms[platform].manifest)
    const data = JSON.parse(readFileSync(manifest)); data.architecture = 'arm64'; writeFileSync(manifest, JSON.stringify(data))
    assert.throws(() => validatePlatform(platform, root), /architecture/)
    recordPlatform(platform, root)
    writeFileSync(binary, 'wrong platform')
    assert.throws(() => validatePlatform(platform, root), /Invalid/)
  })
}
