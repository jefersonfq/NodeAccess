import { createHash } from 'node:crypto'
import { readFileSync, lstatSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { sourceInventory, sourceFingerprint } from '../coverage/inventory.mjs'

export const cspHarnesses = Object.freeze([
  ['styles', 'tools/frontend/csp-styles-playwright.cjs'],
  ['editor', 'tools/frontend/csp-security-playwright.cjs'],
  ['lifecycle', 'tools/frontend/terminal-experience-playwright.cjs'],
  ['supervision', 'tools/frontend/lucien-feedback-ux-playwright.cjs'],
  ['sanitizer', 'tools/frontend/monaco-sanitizer-real.test.cjs'],
])
export const cspConfigFiles = Object.freeze(['docker/nginx.http.conf', 'apps/frontend/vite.config.ts', 'apps/frontend/index.html', 'package.json', 'package-lock.json', 'scripts/dependency-patches/csp-styles.json', ...cspHarnesses.map(([, file]) => file), 'tools/frontend/terminal-lifecycle-review-playwright.cjs'])
export const lifecycleScenarios = [
  "SFTP conflict 409, connection loss, delayed save and edits in flight preserve draft and SSH",
  "SFTP editor read 503/502/403; save failure/retry retain draft, optimistic concurrency, SSH and document",
  "manager color remains stable on hover/focus/click; viewer names/emails update after leaving and rejoining",
  "share reuse, current link, connected participants, polling failure, cancel, failed revoke and retry preserve SSH",
  "expiry clears manager and active indicator even while polling fails",
  "SPA navigation to hosts and back preserves terminal DOM, document and SSH connection",
  "menu and drag reorder preserve terminal nodes, active tab and connections",
  "blocked popup preserves source; copy waits for Jira grant, connects independently and retains original",
  "move closes source only after connected; insert returns to main window",
  "remote close reason, R reconnect, modifiers safe, another letter returns to Home",
  "log event filter works by keyboard, resets pagination and clears its request parameter",
  "log filters describe their purpose and have accessible names"
]
export const supervisionScenarios = [
  "page purpose, scope and empty state",
  "reason validation and keyboard activation",
  "observer output, no input and explicit end state",
  "mobile layout keeps actions and terminal inside page",
  "permission failure cannot leave stale actionable sessions"
]
export const cspBudgetMs = 20 * 60_000
export const sha256 = value => createHash('sha256').update(value).digest('hex')
export function cspConfigFingerprint(root) {
  const hash = createHash('sha256')
  for (const file of cspConfigFiles) hash.update(file).update('\0').update(readFileSync(join(root, file))).update('\0')
  return hash.digest('hex')
}
export function validCspHarnessReport(name, report) {
  if (name === 'styles') return report?.status === 'passed' && typeof report.proof?.before === 'string' && report.proof.inlineExecuted === false && report.proof.evalBlocked === true
    && report.proof.noNonce === report.proof.before && report.proof.wrongNonce === report.proof.before && report.proof.authorized === 'rgb(7, 8, 9)'
  if (name === 'editor') return report?.passed === true && report.workerChecked === true && report.sameOriginWebSocket === true && report.evalBlocked === true && report.initialEditorRequests === 0
  if (name === 'lifecycle') return Array.isArray(report?.scenarios) && report.scenarios.length === lifecycleScenarios.length && lifecycleScenarios.every(name => report.scenarios.filter(value => value === name).length === 1) && Array.isArray(report.runtimeErrors) && report.runtimeErrors.length === 0
  if (name === 'supervision') return Array.isArray(report) && report.length === 10 && ['dark', 'light'].every(theme => supervisionScenarios.every(name => report.filter(item => item?.theme === theme && item.name === name && item.passed === true).length === 1))
  if (name === 'sanitizer') return report?.tests === 1 && report.pass === 1 && report.fail === 0 && report.skipped === 0
  return false
}
function readEvidence(file) {
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(file) !== resolve(file) || stat.size > 2 * 1024 * 1024) throw new Error('Unsafe CSP proof')
  return readFileSync(file)
}
export function verifiedCspCoverage(root, { runId, head, startedAt, fingerprint }) {
  try {
    const directory = join(root, 'coverage/csp'), proof = JSON.parse(readEvidence(join(directory, 'summary.json')))
    const origin = new URL(proof.origin)
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port) return false
    if (proof.schemaVersion !== 1 || proof.runId !== runId || proof.head !== head || proof.passed !== true || proof.cleanupVerified !== true) return false
    if (proof.sourceFingerprint !== fingerprint || sourceFingerprint(root, sourceInventory(root)) !== fingerprint || proof.configFingerprint !== cspConfigFingerprint(root)) return false
    if (!(Date.parse(proof.startedAt) >= Date.parse(startedAt) && Date.parse(proof.finishedAt) >= Date.parse(proof.startedAt) && Date.parse(proof.finishedAt) <= Date.now())) return false
    if (!Array.isArray(proof.harnesses) || proof.harnesses.length !== cspHarnesses.length) return false
    return cspHarnesses.every(([name]) => {
      const matches = proof.harnesses.filter(item => item.name === name)
      if (matches.length !== 1 || matches[0].exitCode !== 0 || matches[0].timedOut !== false || matches[0].orphaned !== false) return false
      const bytes = readEvidence(join(directory, `${name}.json`))
      return sha256(bytes) === matches[0].reportSha256 && validCspHarnessReport(name, JSON.parse(bytes))
    })
  } catch { return false }
}
