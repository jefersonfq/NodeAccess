import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const output = resolve(process.env.SECURITY_OUTPUT_DIR || 'artifacts/security')
const snapshot = mkdtempSync(join(tmpdir(), 'nodeaccess-scan-'))
mkdirSync(output, { recursive: true })
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.error) throw result.error
  return result
}
try {
  const files = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  if (files.status !== 0) throw new Error('Não foi possível enumerar arquivos do repositório')
  for (const name of new Set(files.stdout.split('\0').filter(Boolean))) {
    if (!existsSync(name) || !lstatSync(name).isFile()) continue
    const target = join(snapshot, name)
    mkdirSync(dirname(target), { recursive: true }); copyFileSync(name, target)
  }
  const leakScan = run('docker', ['run', '--rm', '-v', `${snapshot}:/src:ro`, '-v', `${output}:/out`,
    'ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f',
    'dir', '/src', '--redact=100', '--no-banner', '--report-format', 'json', '--report-path', '/out/gitleaks.json'])
  if (![0, 1].includes(leakScan.status)) throw new Error('Gitleaks inconclusivo')
  const leaks = JSON.parse(readFileSync(join(output, 'gitleaks.json'), 'utf8'))
  const fixtures = JSON.parse(readFileSync('security/gitleaks-fixtures.json', 'utf8')).findings
  const unreviewed = leaks.filter(item => {
    const path = item.File.replace(/^\/src\//, '')
    const hash = createHash('sha256').update(readFileSync(path)).digest('hex')
    return !fixtures.some(f => f.path === path && f.rule === item.RuleID && f.line === item.StartLine && f.fileSha256 === hash)
  }).map(item => ({ path: item.File.replace(/^\/src\//, ''), rule: item.RuleID, line: item.StartLine }))
  const sast = run('docker', ['run', '--rm', '-v', `${snapshot}:/src:ro`,
    'semgrep/semgrep@sha256:93963d9295a366f59e4850127b1550400ee7b388f04fe144e4a1f6325d96e01b',
    'semgrep', 'scan', '--config', 'p/typescript', '--config', 'p/javascript',
    '--exclude', '**/*.test.*', '--exclude', '**/*-NOTE-JEFF.*',
    '--exclude-rule', 'javascript.express.security.audit.xss.direct-response-write.direct-response-write',
    '--timeout', '30', '--jobs', '4', '--metrics', 'off', '--disable-version-check', '--json', '/src'])
  if (sast.status !== 0) throw new Error('Semgrep inconclusivo; verifique acesso ao registro de regras e logs locais')
  const report = JSON.parse(sast.stdout)
  writeFileSync(join(output, 'semgrep.json'), JSON.stringify(report, null, 2))
  const findings = report.results.map(item => ({ path: item.path.replace(/^\/src\//, ''), rule: item.check_id, line: item.start.line }))
  const summary = { at: new Date().toISOString(), gitleaks: { total: leaks.length, reviewedFixtures: leaks.length - unreviewed.length, unreviewed },
    semgrep: { findings, errors: report.errors, targets: report.paths?.scanned?.length },
    passed: unreviewed.length === 0 && findings.length === 0 && report.errors.length === 0 }
  writeFileSync(join(output, 'scan-summary.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
  if (!summary.passed) process.exitCode = 1
} catch (error) { console.error(error.message); process.exitCode = 2 }
finally { rmSync(snapshot, { recursive: true, force: true }) }
