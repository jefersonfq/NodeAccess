#!/usr/bin/env node
/**
 * NA-0194 — official VaultNAccess package for one NodeAccess deployment (run by the installation operator).
 *   VAULTNACCESS_PORTAL_ORIGIN=https://portal VAULTNACCESS_VERSION=x.y.z VAULTNACCESS_SIGNING_KEY=/secure/vaultnaccess.pem \
 *   [VAULTNACCESS_RELEASE_DIR=release/vaultnaccess] npm run package:extension
 * The signing key (RSA ≥ 2048, PEM) stays outside the repository and the application server; its public half becomes the
 * manifest `key`, so the extension id is stable. Output: reproducible ZIP (manual install), signed CRX3 and update.xml
 * (policy install/update), release.json (version, id, SHA-256). The backend publishes that directory
 * (VAULT_EXTENSION_PACKAGE_DIR) only when it matches its configuration.
 */
import { execFileSync } from 'node:child_process'
import { createHash, createPrivateKey } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveExecutable } from '../shared/trusted-executable.cjs'
import { crx3, extensionId, publicKeyDer, updateManifest, zip } from './package-format.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const DIST = join(ROOT, 'apps/extension/dist-release')
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')

function filesOf(directory) {
  const out = []
  const walk = current => {
    // Order is irrelevant here: zip() writes entries in byte order.
    for (const name of readdirSync(current)) {
      const path = join(current, name)
      if (statSync(path).isDirectory()) walk(path)
      else out.push({ name: relative(directory, path).split('\\').join('/'), data: readFileSync(path) })
    }
  }
  walk(directory)
  return out
}

/** Validated inputs; throws with the variable to fix. */
export function releaseInput(env = process.env) {
  const portalOrigin = env.VAULTNACCESS_PORTAL_ORIGIN ?? ''
  let parsed
  try { parsed = new URL(portalOrigin) } catch { parsed = null }
  if (!parsed || parsed.protocol !== 'https:' || parsed.origin !== portalOrigin) throw new Error('VAULTNACCESS_PORTAL_ORIGIN must be the https origin of the portal')
  const version = env.VAULTNACCESS_VERSION ?? ''
  if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version)) throw new Error('VAULTNACCESS_VERSION must be x.y.z')
  if (!env.VAULTNACCESS_SIGNING_KEY) throw new Error('VAULTNACCESS_SIGNING_KEY must point to the RSA private key (PEM) kept outside the repository')
  const releaseDir = resolve(ROOT, env.VAULTNACCESS_RELEASE_DIR ?? 'release/vaultnaccess')
  return { portalOrigin, version, keyFile: resolve(env.VAULTNACCESS_SIGNING_KEY), releaseDir }
}

export function buildRelease(input, build = defaultBuild) {
  const privateKey = createPrivateKey(readFileSync(input.keyFile))
  const spki = publicKeyDer(privateKey), id = extensionId(spki), manifestKey = spki.toString('base64')
  const updateUrl = `${input.portalOrigin}/api/v1/vault-security/extension/update.xml`
  build({ VAULTNACCESS_PORTAL_ORIGIN: input.portalOrigin, VAULTNACCESS_VERSION: input.version, VAULTNACCESS_MANIFEST_KEY: manifestKey,
    VAULTNACCESS_UPDATE_URL: updateUrl, VAULTNACCESS_OUT_DIR: 'dist-release' })
  const files = filesOf(DIST)
  const manifest = JSON.parse(files.find(f => f.name === 'manifest.json')?.data.toString('utf8') ?? '{}')
  if (manifest.key !== manifestKey || manifest.version !== input.version || manifest.update_url !== updateUrl) throw new Error('Built manifest does not match the release input')
  // Nothing private may travel in the package.
  if (files.some(f => /PRIVATE KEY/.test(f.data.toString('latin1')))) throw new Error('Private key material found in the package')
  const archive = zip(files), signed = crx3(archive, privateKey)
  mkdirSync(input.releaseDir, { recursive: true, mode: 0o755 })
  const zipFile = `vaultnaccess-${input.version}.zip`, crxFile = `vaultnaccess-${input.version}.crx`
  writeFileSync(join(input.releaseDir, zipFile), archive)
  writeFileSync(join(input.releaseDir, crxFile), signed)
  writeFileSync(join(input.releaseDir, 'update.xml'), updateManifest(id, input.version, `${input.portalOrigin}/api/v1/vault-security/extension/package.crx`))
  let sourceCommit = null
  try { sourceCommit = execFileSync(resolveExecutable('git'), ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim() } catch { sourceCommit = null }
  const release = { schemaVersion: 1, version: input.version, extensionId: id, portalOrigin: input.portalOrigin, sourceCommit,
    zip: { file: zipFile, sha256: sha256(archive), size: archive.length }, crx: { file: crxFile, sha256: sha256(signed), size: signed.length } }
  writeFileSync(join(input.releaseDir, 'release.json'), `${JSON.stringify(release, null, 2)}\n`)
  return release
}
function defaultBuild(env) {
  rmSync(DIST, { recursive: true, force: true })
  execFileSync(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'apps/extension/vite.config.ts', '--logLevel', 'error'],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const input = releaseInput()
    const release = buildRelease(input)
    console.log(`[vaultnaccess] pacote ${release.version} da extensão ${release.extensionId}: ${input.releaseDir}`)
    console.log(`[vaultnaccess] ZIP sha256 ${release.zip.sha256}`)
    console.log(`[vaultnaccess] política ExtensionInstallForcelist: ${release.extensionId};${input.portalOrigin}/api/v1/vault-security/extension/update.xml`)
    console.log('[vaultnaccess] publique a pasta com VAULT_EXTENSION_PACKAGE_DIR e inclua o id em VAULT_EXTENSION_IDS')
  } catch (error) {
    console.error(`[vaultnaccess] falha ao empacotar: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
