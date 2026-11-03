import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { resolve, dirname, isAbsolute, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

export const scannerVersion = '5.0.2'
export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export function localUrl(value = 'http://127.0.0.1:9000') {
  let url
  try { url = new URL(value) } catch { throw new Error('Invalid SonarQube URL') }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Only local HTTP SonarQube roots without credentials are supported')
  }
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1'
  return url.origin
}

export function preflight({ root = projectRoot, env = process.env, version = process.versions.node } = {}) {
  const [major, minor] = version.split('.').map(Number)
  if (major !== 24 || minor < 21) throw new Error('Use the existing Node.js 24.21+ runtime required by NodeAccess')
  const overrides = ['SONAR_SCANNER_JSON_PARAMS', 'SONARQUBE_SCANNER_PARAMS', 'SONAR_SCANNER_OPTS', 'SONAR_SCANNER_JAVA_OPTS', 'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS']
  if (overrides.some(key => env[key]?.trim())) throw new Error('Scanner parameter overrides are not allowed; use reviewed project properties')
  const host = localUrl(env.SONAR_HOST_URL)
  if (!env.SONAR_TOKEN?.trim()) throw new Error('SONAR_TOKEN must be supplied through the environment')
  const config = readFileSync(resolve(root, 'sonar-project.properties'), 'utf8')
  if (/^sonar\.(token|login|password|host\.url)\s*=/m.test(config)) throw new Error('Credentials and server URL must not be stored in project properties')
  const sources = config.match(/^sonar.sources=(.+)$/m)?.[1].split(',')
  if (!sources?.length || sources.some(path => !existsSync(resolve(root, path)))) throw new Error('A configured source path does not exist')
  const coverage = resolve(root, 'coverage/lcov.info')
  if (!existsSync(coverage) || !/^SF:.+/m.test(readFileSync(coverage, 'utf8'))) throw new Error('Generate real coverage/lcov.info before analyzing; never fabricate coverage')
  return { host, scannerVersion, sources, coverage: 'coverage/lcov.info' }
}

export function npmCliPath(env = process.env, executable = process.execPath) {
  const candidate = env.npm_execpath || resolve(executable, '..', '..', 'lib/node_modules/npm/bin/npm-cli.js')
  if (!isAbsolute(candidate)) throw new Error('npm CLI must be absolute; run through npm run sonar:analyze')
  let file
  try { file = realpathSync(candidate) } catch { throw new Error('npm CLI unavailable; run through npm run sonar:analyze') }
  if (basename(file) !== 'npm-cli.js' || !statSync(file).isFile()) throw new Error('npm CLI must resolve to a regular npm-cli.js file')
  return file
}

export function main(argv = process.argv.slice(2), { root = projectRoot, env = process.env } = {}) {
  try {
    if (argv.some(arg => arg !== '--check')) throw new Error('Only --check is accepted; analysis options are reviewed in project properties')
    const checked = preflight({ root, env })
    if (argv.includes('--check')) {
      console.log(JSON.stringify({ status: 'ready', ...checked }, null, 2))
      return 0
    }
    // Token is inherited through env, never placed in argv or shell history.
    // Run an exact external tool version; do not modify project dependencies.
    const result = spawnSync(process.execPath, [npmCliPath(env), 'exec', '--yes', `--package=@sonar/scan@${scannerVersion}`, '--', 'sonar-scanner-npm', '-Dsonar.qualitygate.wait=true', '-Dsonar.qualitygate.timeout=600'], {
      cwd: root,
      env: { ...env, SONAR_HOST_URL: checked.host },
      stdio: 'inherit',
      shell: false,
    })
    if (result.error) throw new Error('Could not start pinned scanner')
    return result.status ?? 1
  } catch (error) {
    console.error(`SonarQube preflight failed: ${error.message}`)
    return 1
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main()
