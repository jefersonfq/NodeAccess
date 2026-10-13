import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const GITLEAKS_IMAGE = 'ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f'

// Never print command output: even a scanner error may contain sensitive history.
export function auditHistorySecrets({ cwd = process.cwd(), output, run = spawnSync } = {}) {
  const destination = resolve(output || join(cwd, 'artifacts/security/history'))
  mkdirSync(destination, { recursive: true, mode: 0o700 })
  chmodSync(destination, 0o700)
  const temporary = mkdtempSync(join(tmpdir(), 'nodeaccess-history-'))
  const snapshot = join(temporary, 'repository.git')
  const rawPath = join(destination, 'gitleaks-history-redacted.json')
  const summaryPath = join(destination, 'history-summary.json')
  // A failed run must never leave a previous success/report looking current.
  rmSync(rawPath, { force: true })
  rmSync(summaryPath, { force: true })
  const invoke = (command, args) => run(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const summary = { at: new Date().toISOString(), scope: 'all locally available refs; no external credential validation', status: 'inconclusive', passed: false }
  try {
    const shallow = invoke('git', ['rev-parse', '--is-shallow-repository'])
    if (shallow.status !== 0 || shallow.stdout.trim() !== 'false') throw new Error('Complete local history required')
    const clone = invoke('git', ['clone', '--mirror', '--no-local', '--', cwd, snapshot])
    if (clone.status !== 0) throw new Error('History snapshot failed')
    const head = invoke('git', ['--git-dir', snapshot, 'rev-parse', 'HEAD'])
    const count = invoke('git', ['--git-dir', snapshot, 'rev-list', '--all', '--count'])
    if (head.status !== 0 || count.status !== 0 || !/^[0-9a-f]{40,64}$/.test(head.stdout.trim()) || !/^\d+$/.test(count.stdout.trim())) throw new Error('Snapshot metadata unavailable')
    summary.head = head.stdout.trim()
    summary.commits = Number(count.stdout.trim())
    const scan = invoke('docker', ['run', '--rm', '--network', 'none',
      '--user', `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
      '-v', `${snapshot}:/src:ro`, '-v', `${destination}:/out`, GITLEAKS_IMAGE,
      'git', '/src', '--log-opts=--all', '--redact=100', '--no-banner',
      '--report-format', 'json', '--report-path', '/out/gitleaks-history-redacted.json'])
    writeFileSync(join(destination, 'scanner-private.log'), `${scan.stdout || ''}\n${scan.stderr || ''}`, { mode: 0o600 })
    chmodSync(join(destination, 'scanner-private.log'), 0o600)
    if (![0, 1].includes(scan.status) || !existsSync(rawPath)) throw new Error('Scanner failed')
    chmodSync(rawPath, 0o600)
    const findings = JSON.parse(readFileSync(rawPath, 'utf8'))
    if (!Array.isArray(findings) || findings.some(item => !item || typeof item.RuleID !== 'string' || item.Secret !== 'REDACTED')) throw new Error('Invalid redacted report')
    if ((scan.status === 0) !== (findings.length === 0)) throw new Error('Inconsistent scanner result')
    summary.findings = findings.length
    summary.rules = Object.fromEntries([...new Set(findings.map(item => item.RuleID))].map(rule => [rule, findings.filter(item => item.RuleID === rule).length]))
    summary.status = findings.length ? 'review-required' : 'passed'
    summary.passed = findings.length === 0
  } catch {
    summary.status = 'inconclusive'
    // No raw errors, matches, paths, author emails or credentials in public output.
  } finally {
    rmSync(temporary, { recursive: true, force: true })
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 })
    chmodSync(summaryPath, 0o600)
  }
  return { summary, exitCode: summary.passed ? 0 : summary.status === 'review-required' ? 1 : 2 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = auditHistorySecrets({ output: process.env.SECURITY_HISTORY_OUTPUT_DIR })
  console.log(JSON.stringify(result.summary, null, 2))
  process.exitCode = result.exitCode
}
