import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
export function signBytes(bytes, privatePem) {
  const key = createPrivateKey(privatePem)
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 3072) throw Error('Release signing requires RSA >= 3072 bits')
  return sign('sha256', bytes, key).toString('base64')
}
export function verifyBytes(bytes, signature, publicPem) {
  const key = createPublicKey(publicPem)
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 3072 || !verify('sha256', bytes, key, Buffer.from(signature, 'base64'))) throw Error('Untrusted release signature')
}
export function signFile(file) {
  if (process.env.NODEACCESS_DEVELOPMENT_UNSIGNED === 'true') return
  if (!process.env.NODEACCESS_RELEASE_SIGNING_KEY) throw Error('NODEACCESS_RELEASE_SIGNING_KEY is required; unsigned production releases are forbidden')
  const signature = signBytes(readFileSync(file), readFileSync(process.env.NODEACCESS_RELEASE_SIGNING_KEY))
  writeFileSync(file + '.sig', Buffer.from(signature, 'base64'))
}
export function verifyFile(file) {
  if (process.env.NODEACCESS_DEVELOPMENT_UNSIGNED === 'true') return
  if (!process.env.NODEACCESS_RELEASE_PUBLIC_KEY) throw Error('NODEACCESS_RELEASE_PUBLIC_KEY is required to validate releases')
  verifyBytes(readFileSync(file), readFileSync(file + '.sig').toString('base64'), readFileSync(process.env.NODEACCESS_RELEASE_PUBLIC_KEY))
}
export function signWindowsManifest(file) {
  if (process.env.NODEACCESS_DEVELOPMENT_UNSIGNED === 'true') return
  const manifest = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  const entry = manifest.artifacts.find(a => a.file === 'nodeaccess-agent-windows-x64.msi')
  const payload = Buffer.from(JSON.stringify({ schemaVersion: 1, version: manifest.version, platform: 'windows', architecture: 'x64', downloadPath: '/api/v1/agents/download/windows_msi', size: entry.size, sha256: entry.sha256 }))
  manifest.releaseProof = { payload: payload.toString('base64'), signature: signBytes(payload, readFileSync(process.env.NODEACCESS_RELEASE_SIGNING_KEY)) }
  writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n')
  signFile(file)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [operation, file] = process.argv.slice(2)
    if (operation === 'sign-windows') signWindowsManifest(file)
    else if (operation === 'sign') signFile(file)
    else if (operation === 'trust') {
      if (process.env.NODEACCESS_DEVELOPMENT_UNSIGNED === 'true') writeFileSync(file, '{"keys":[],"publisherThumbprint":""}\n')
      else {
        const jwk = createPublicKey(readFileSync(process.env.NODEACCESS_RELEASE_PUBLIC_KEY)).export({ format: 'jwk' })
        const publisherThumbprint = process.env.NODEACCESS_CODE_SIGN_THUMBPRINT
        if (!/^[a-fA-F0-9]{40}$/.test(publisherThumbprint || '')) throw Error('Expected Authenticode publisher thumbprint is required')
        writeFileSync(file, JSON.stringify({ keys: [jwk], publisherThumbprint }))
      }
    } else throw Error('Unknown release operation')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
