import { signFile, verifyFile } from './release-signing.mjs'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sourceDigest } from './windows/artifacts.mjs'
import { platforms } from './platforms.mjs'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
export function inspectPlatform(platform, root, directory = resolve(root, 'apps/agent/dist')) {
  const spec = platforms[platform]
  const version = JSON.parse(readFileSync(resolve(root, 'apps/agent/package.json'))).version
  const artifact = readFileSync(resolve(directory, spec.binary))
  const magic = artifact.subarray(0, 4).toString('hex')
  if ((platform === 'linux' && magic !== '7f454c46') || (platform === 'macos' && !['cffaedfe', 'feedfacf', 'cafebabe'].includes(magic))) throw Error(`Invalid ${platform} executable`)
  return { product: 'NodeAccess Agent', platform, architecture: spec.architecture, version, sourceSha256: sourceDigest(root), file: spec.binary, size: artifact.length, sha256: sha(artifact) }
}
export function recordPlatform(platform, root) {
  const current = inspectPlatform(platform, root)
  writeFileSync(resolve(root, 'apps/agent/dist', platforms[platform].manifest), JSON.stringify(current, null, 2) + '\n')
  writeFileSync(resolve(root, 'apps/agent/dist', current.file + '.sha256'), `${current.sha256}  ${current.file}\n`)
  signFile(resolve(root, 'apps/agent/dist', current.file))
  signFile(resolve(root, 'apps/agent/dist', platforms[platform].manifest))
  return current
}
export function validatePlatform(platform, root, directory = resolve(root, 'apps/agent/dist')) {
  const actual = inspectPlatform(platform, root, directory)
  const saved = JSON.parse(readFileSync(resolve(directory, platforms[platform].manifest)))
  for (const key of Object.keys(actual)) if (saved[key] !== actual[key]) throw Error(`Stale ${platform} artifact: ${key}`)
  verifyFile(resolve(directory, specName(platform)))
  verifyFile(resolve(directory, platforms[platform].binary))
  return saved
}

function specName(platform) { return platforms[platform].manifest }
