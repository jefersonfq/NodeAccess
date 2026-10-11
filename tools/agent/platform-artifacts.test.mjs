import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordPlatform, validatePlatform } from '../../apps/agent/installer/platform-artifacts.mjs'
import { generateKeyPairSync } from 'node:crypto'
import { platforms } from '../../apps/agent/installer/platforms.mjs'
for (const platform of ['linux', 'macos']) {
  test(`${platform}: provenance rejects source, version, identity and artifact drift`, t => {
    const root = mkdtempSync(join(tmpdir(), 'agent-platform-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const variables = ['NODEACCESS_RELEASE_SIGNING_KEY', 'NODEACCESS_RELEASE_PUBLIC_KEY', 'NODEACCESS_DEVELOPMENT_UNSIGNED']
    const previous = Object.fromEntries(variables.map(key => [key, process.env[key]]))
    t.after(() => {
      for (const key of variables) {
        if (previous[key] === undefined) delete process.env[key]
        else process.env[key] = previous[key]
      }
    })
    const keys = generateKeyPairSync('rsa', { modulusLength: 3072,
      publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
    process.env.NODEACCESS_RELEASE_SIGNING_KEY = join(root, 'test-private.pem')
    process.env.NODEACCESS_RELEASE_PUBLIC_KEY = join(root, 'test-public.pem')
    delete process.env.NODEACCESS_DEVELOPMENT_UNSIGNED
    writeFileSync(process.env.NODEACCESS_RELEASE_SIGNING_KEY, keys.privateKey, { mode: 0o600 })
    writeFileSync(process.env.NODEACCESS_RELEASE_PUBLIC_KEY, keys.publicKey, { mode: 0o600 })

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
    const signature = readFileSync(binary + '.sig')
    writeFileSync(binary + '.sig', Buffer.alloc(signature.length))
    assert.throws(() => validatePlatform(platform, root), /Untrusted release signature/)
    writeFileSync(binary + '.sig', signature)
    assert.equal(validatePlatform(platform, root).version, '1.2.1')
    writeFileSync(binary, 'wrong platform')
    assert.throws(() => validatePlatform(platform, root), /Invalid/)
  })
}
