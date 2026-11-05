import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const allowed = new Set(['sonar.projectKey', 'sonar.projectName', 'sonar.sourceEncoding', 'sonar.sources', 'sonar.tests',
  'sonar.test.inclusions', 'sonar.exclusions', 'sonar.javascript.lcov.reportPaths', 'sonar.python.coverage.reportPaths'])
const unsupportedScope = new Set(['sonar.inclusions', 'sonar.test.exclusions', 'sonar.coverage.exclusions',
  'sonar.cpd.exclusions', 'sonar.global.exclusions', 'sonar.global.test.exclusions'])
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

// A deliberately bounded repository configuration contract, not a second general
// Java properties parser. Reject unsupported syntax rather than certify defaults.
export function readConfiguration(file) {
  if (!lstatSync(file).isFile()) throw new Error('CI_SETTINGS_REGULAR_FILE_REQUIRED')
  const bytes = readFileSync(file), properties = {}
  for (const raw of bytes.toString('utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const at = line.indexOf('='), key = line.slice(0, at).trim(), value = line.slice(at + 1).trim()
    if (at < 1 || !allowed.has(key) || !value || value.includes('\\') || value.includes('${') || Object.hasOwn(properties, key)) {
      throw new Error('CI_UNSUPPORTED_SETTINGS')
    }
    properties[key] = value
  }
  if (properties['sonar.projectKey'] !== 'nodeaccess' || !properties['sonar.sources']) throw new Error('CI_REQUIRED_SETTINGS_MISSING')
  return { bytes, sha256: sha256(bytes), properties }
}

export function materializeBaseConfiguration(root, baseRoot) {
  if (resolve(root) === resolve(baseRoot)) throw new Error('CI_DISTINCT_BASE_REQUIRED')
  const settings = join(root, 'sonar-project.properties'), baseSettings = join(baseRoot, 'sonar-project.properties')
  const candidate = readConfiguration(settings)
  // Unlink a possible tracked symlink before writing: never follow it outside the disposable worktree.
  rmSync(baseSettings, { force: true })
  writeFileSync(baseSettings, candidate.bytes, { flag: 'wx', mode: 0o600 })
  assertConfiguration(baseRoot, baseSettings, candidate.sha256)
  return { settings, baseSettings, sha256: candidate.sha256, properties: candidate.properties }
}

export function assertConfiguration(root, settings, expectedHash) {
  if (resolve(settings) !== resolve(root, 'sonar-project.properties')) throw new Error('CI_SETTINGS_LOCATION_MISMATCH')
  const configuration = readConfiguration(settings)
  if (expectedHash && configuration.sha256 !== expectedHash) throw new Error('CI_SETTINGS_CHANGED')
  return configuration
}

export function verifyScannerContext(context, configuration, { root, revision }) {
  if (typeof context !== 'string' || !context.trim()) throw new Error('CI_SCANNER_CONTEXT_MISSING')
  const expected = { ...configuration.properties, 'sonar.projectBaseDir': root, 'sonar.projectVersion': revision,
    'sonar.scm.disabled': 'true', 'sonar.scm.revision': revision, 'sonar.qualitygate.wait': 'false' }
  const effective = {}
  for (const raw of context.split('\n')) {
    const line = raw.trim().replace(/^-\s+/, ''), at = line.indexOf('=')
    if (at < 1) continue
    const key = line.slice(0, at).trim()
    const value = line.slice(at + 1).trim()
    if (unsupportedScope.has(key) && value) throw new Error('CI_SCANNER_SCOPE_OVERRIDE')
    if (!Object.hasOwn(expected, key)) continue
    if (Object.hasOwn(effective, key) && effective[key] !== value) throw new Error('CI_SCANNER_CONTEXT_AMBIGUOUS')
    effective[key] = value
  }
  if (Object.entries(expected).some(([key, value]) => effective[key] !== value)) throw new Error('CI_SCANNER_CONTEXT_MISMATCH')
  // Never return the raw context: it can contain credentials and environment data.
  return { sha256: configuration.sha256, effectiveProperties: { ...configuration.properties }, contextVerified: true }
}
