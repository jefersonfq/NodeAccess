import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { signBytes, verifyBytes, signFile } from './release-signing.mjs'
const keys = () => generateKeyPairSync('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
test('release signature rejects altered manifest, altered signature and unknown signer', () => {
  const trusted = keys(), foreign = keys(), payload = Buffer.from('{"version":"2.0.0","sha256":"test"}')
  const signature = signBytes(payload, trusted.privateKey)
  verifyBytes(payload, signature, trusted.publicKey)
  assert.throws(() => verifyBytes(Buffer.from('{"version":"1.0.0"}'), signature, trusted.publicKey))
  assert.throws(() => verifyBytes(payload, signature, foreign.publicKey))
  assert.throws(() => verifyBytes(payload, Buffer.alloc(384).toString('base64'), trusted.publicKey))
})
test('production packaging fails without a signing identity', () => {
  const original = process.env.NODEACCESS_RELEASE_SIGNING_KEY, unsigned = process.env.NODEACCESS_DEVELOPMENT_UNSIGNED
  delete process.env.NODEACCESS_RELEASE_SIGNING_KEY; delete process.env.NODEACCESS_DEVELOPMENT_UNSIGNED
  try { assert.throws(() => signFile('/not-read-without-signing-key'), /unsigned production releases/) }
  finally { if (original) process.env.NODEACCESS_RELEASE_SIGNING_KEY = original; if (unsigned) process.env.NODEACCESS_DEVELOPMENT_UNSIGNED = unsigned }
})
