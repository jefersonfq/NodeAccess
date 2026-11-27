/** NA-0206: include an intact pre-generated package; this is NOT a CRX signature verifier. */
import { createHash } from 'node:crypto'
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const maxPackageBytes = 20 * 1024 * 1024
const containerDirectory = '/opt/nodeaccess/vaultnaccess'
const checksumName = 'VAULTNACCESS-CHECKSUMS.txt'
const fail = message => { throw new Error(`Extension package: ${message}`) }

function readRegular(directory, name, limit) {
  const path = join(directory, name)
  if (!lstatSync(path).isFile()) fail(`${name} must be a regular file, not a symlink`)
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size < 1 || stat.size > limit) fail(`${name} has an invalid size`)
    const bytes = readFileSync(fd)
    if (bytes.length !== stat.size) fail(`${name} changed while reading`)
    if (bytes.includes(Buffer.from('PRIVATE KEY'))) fail('private key material is forbidden')
    return bytes
  } finally { closeSync(fd) }
}

const xml = value => value.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c])
function expectedUpdate(id, version, origin) {
  return `<?xml version='1.0' encoding='UTF-8'?>\n<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>\n  <app appid='${id}'>\n    <updatecheck codebase='${xml(origin)}/api/v1/vault-security/extension/package.crx' version='${version}' />\n  </app>\n</gupdate>\n`
}

/** All three inputs are explicit. Absence of all three leaves the release untouched. */
export function validateExtension(env = process.env) {
  const directoryInput = env.NODEACCESS_EXTENSION_PACKAGE_DIR
  const origin = env.NODEACCESS_EXTENSION_EXPECTED_ORIGIN
  const id = env.NODEACCESS_EXTENSION_EXPECTED_ID
  if (!directoryInput && !origin && !id) return null
  if (!directoryInput || !origin || !id) fail('PACKAGE_DIR, EXPECTED_ORIGIN and EXPECTED_ID must all be supplied')
  let url
  try { url = new URL(origin) } catch { fail('EXPECTED_ORIGIN must be an HTTPS origin') }
  if (url.protocol !== 'https:' || url.origin !== origin) fail('EXPECTED_ORIGIN must be an HTTPS origin')
  if (!/^[a-p]{32}$/.test(id)) fail('EXPECTED_ID must be a Chromium extension ID')
  const directory = resolve(directoryInput)
  if (!lstatSync(directory).isDirectory() || realpathSync(directory) !== directory) fail('package directory must not use symlinks')
  const metadata = readRegular(directory, 'release.json', 65_536)
  const release = JSON.parse(metadata.toString('utf8'))
  if (!release || release.schemaVersion !== 1 || typeof release.version !== 'string'
    || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(release.version)) fail('invalid release schema/version')
  if (release.portalOrigin !== origin || release.extensionId !== id) fail('origin or extension ID does not match the expected deployment')
  const files = new Map([['release.json', metadata]])
  for (const kind of ['zip', 'crx']) {
    const entry = release[kind]
    const name = `vaultnaccess-${release.version}.${kind}`
    if (!entry || entry.file !== name || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > maxPackageBytes) fail(`invalid ${kind} metadata`)
    const bytes = readRegular(directory, name, maxPackageBytes)
    if (bytes.length !== entry.size || hash(bytes) !== entry.sha256) fail(`${kind} size/hash mismatch`)
    files.set(name, bytes)
  }
  const update = readRegular(directory, 'update.xml', 65_536)
  if (update.toString('utf8') !== expectedUpdate(id, release.version, origin)) fail('update.xml does not match the expected deployment')
  files.set('update.xml', update)
  if (readdirSync(directory).some(name => !files.has(name))) fail('only the four public package files are allowed')
  return { files, origin, id, version: release.version }
}

/** Only the known API block of the generated PROD compose may change; unfamiliar layouts fail closed. */
export function extensionCompose(source) {
  const lines = source.split('\n')
  const start = lines.indexOf('  api:')
  if (start < 0 || lines.lastIndexOf('  api:') !== start) fail('expected one api service in generated compose')
  let end = start + 1
  while (end < lines.length && !/^  [\w-]+:$/.test(lines[end]) && !/^\S/.test(lines[end])) end++
  const block = lines.slice(start, end)
  const environment = block.indexOf('    environment:')
  const volumes = block.indexOf('    volumes:')
  if (environment < 0 || block.lastIndexOf('    environment:') !== environment || block[environment + 1] !== '      APP_MODE: api'
    || volumes < environment || block.lastIndexOf('    volumes:') !== volumes
    || block.some(line => line.includes('VAULT_EXTENSION_PACKAGE_DIR') || line.includes(containerDirectory))) fail('unsupported api compose layout')
  block.splice(volumes + 1, 0, `      - ./vaultnaccess:${containerDirectory}:ro`)
  block.splice(environment + 1, 0, `      VAULT_EXTENSION_PACKAGE_DIR: ${containerDirectory}`)
  lines.splice(start, end - start, ...block)
  return lines.join('\n')
}

export function includeExtension(releaseDirectory, env = process.env) {
  const input = validateExtension(env)
  if (!input) return false
  const composePath = join(releaseDirectory, 'docker-compose.prod.yml')
  const compose = extensionCompose(readFileSync(composePath, 'utf8'))
  const manifestPath = join(releaseDirectory, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (!Array.isArray(manifest.artifacts) || manifest.extensionPackage) fail('unsupported release manifest')
  const directory = join(releaseDirectory, 'vaultnaccess')
  mkdirSync(directory, { mode: 0o755 }) // Never overwrite an existing package.
  const checksums = []
  for (const [name, bytes] of input.files) {
    writeFileSync(join(directory, name), bytes, { flag: 'wx', mode: 0o644 })
    manifest.artifacts.push(`vaultnaccess/${name}`)
    checksums.push(`${hash(bytes)}  vaultnaccess/${name}\n`)
  }
  writeFileSync(join(releaseDirectory, checksumName), checksums.join(''), { flag: 'wx', mode: 0o644 })
  manifest.artifacts.push(checksumName)
  manifest.extensionPackage = { version: input.version, extensionId: input.id, portalOrigin: input.origin,
    directory: 'vaultnaccess', checksums: checksumName, validation: 'integrity-only' }
  writeFileSync(composePath, compose)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  return true
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'validate') validateExtension()
    else if (process.argv[2] === 'apply' && process.argv[3]) includeExtension(process.argv[3])
    else fail('expected validate or apply <release-directory>')
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Extension package validation failed')
    process.exitCode = 1
  }
}
