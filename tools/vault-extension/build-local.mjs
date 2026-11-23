#!/usr/bin/env node
/**
 * NA-0190 — local (homologation) build of the VaultNAccess extension, run when the NodeAccess dev environment starts.
 * Output: apps/extension/dist-local (load it unpacked once; later builds are offered by the popup's "Update" button).
 * Config: VAULTNACCESS_PORTAL_ORIGIN / VAULTNACCESS_MANIFEST_KEY / VAULTNACCESS_VERSION, or apps/extension/local.json
 * ({ "portalOrigin", "manifestKey", "version" }; git-ignored, public values only). Without an origin it does nothing.
 * The build id is derived from the extension sources and this config: unchanged sources keep the same id (no prompt).
 * `--soft` (dev startup) reports problems without failing the environment.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = join(ROOT, 'apps/extension/dist-local')
const ANNOUNCEMENT = join(ROOT, 'apps/frontend/public/vaultnaccess-build.json')

/** Environment first, then the local file; values are validated again by the extension's Vite config. */
export function loadConfig(env = process.env, file = env.VAULTNACCESS_LOCAL_CONFIG || join(ROOT, 'apps/extension/local.json')) {
  let local = {}
  if (existsSync(file)) {
    local = JSON.parse(readFileSync(file, 'utf8'))
    if (!local || typeof local !== 'object' || Array.isArray(local)) throw new Error('apps/extension/local.json must be a JSON object')
  }
  const pick = (name, key) => (typeof env[name] === 'string' && env[name] !== '' ? env[name] : typeof local[key] === 'string' ? local[key] : undefined)
  return { portalOrigin: pick('VAULTNACCESS_PORTAL_ORIGIN', 'portalOrigin'), manifestKey: pick('VAULTNACCESS_MANIFEST_KEY', 'manifestKey'), version: pick('VAULTNACCESS_VERSION', 'version') ?? '0.1.0' }
}
/** Content-derived id: same sources and config => same id. */
export function buildIdFor(files, read, config) {
  const digest = createHash('sha256')
  digest.update(JSON.stringify([config.portalOrigin, config.manifestKey ?? '', config.version]))
  for (const file of [...files].sort((a, b) => a.localeCompare(b, 'en'))) { digest.update(file); digest.update('\0'); digest.update(read(file)) }
  return digest.digest('hex').slice(0, 12)
}
export function sourceFiles(root = ROOT) {
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'apps/extension', 'packages/shared/src'], { cwd: root, encoding: 'utf8' })
  return listed.split('\n').filter(file => file && !/\.test\.ts$/.test(file) && existsSync(join(root, file)))
}

function main() {
  const soft = process.argv.includes('--soft')
  try {
    const config = loadConfig()
    if (!config.portalOrigin) {
      console.log('[vaultnaccess] extensão local não compilada: defina VAULTNACCESS_PORTAL_ORIGIN ou apps/extension/local.json')
      return
    }
    const buildId = buildIdFor(sourceFiles(), file => readFileSync(join(ROOT, file)), config)
    const marker = join(OUT, 'build.json')
    const current = existsSync(marker) ? JSON.parse(readFileSync(marker, 'utf8')).buildId : undefined
    if (current !== buildId) {
      execFileSync(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'apps/extension/vite.config.ts', '--logLevel', 'error'], {
        cwd: ROOT, stdio: 'inherit',
        env: { ...process.env, VAULTNACCESS_PORTAL_ORIGIN: config.portalOrigin, VAULTNACCESS_VERSION: config.version, VAULTNACCESS_BUILD_ID: buildId, VAULTNACCESS_OUT_DIR: 'dist-local',
          ...(config.manifestKey ? { VAULTNACCESS_MANIFEST_KEY: config.manifestKey } : {}) },
      })
      writeFileSync(marker, `${JSON.stringify({ buildId, version: config.version })}\n`)
    }
    // Announced by the portal dev server; the popup compares it with its own id.
    mkdirSync(dirname(ANNOUNCEMENT), { recursive: true })
    writeFileSync(ANNOUNCEMENT, `${JSON.stringify({ buildId })}\n`)
    const distro = process.env.WSL_DISTRO_NAME
    console.log(`[vaultnaccess] extensão ${current === buildId ? 'já atualizada' : 'compilada'} (${config.version}, build ${buildId}): ${OUT}`
      + (distro ? `\n[vaultnaccess] no Windows: \\\\wsl.localhost\\${distro}${OUT.replaceAll('/', '\\')}` : ''))
  } catch (error) {
    console.error(`[vaultnaccess] falha ao compilar a extensão local: ${error instanceof Error ? error.message : String(error)}`)
    if (!soft) process.exitCode = 1
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
