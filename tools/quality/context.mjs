import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const { resolveExecutable } = createRequire(import.meta.url)('../shared/trusted-executable.cjs')

export function summarizeQuality({ head, dirty, validation, coverage, catalog }) {
  const verified = validation?.schemaVersion === 1 && typeof validation?.analysisId === 'string'
    && validation.analysisId.trim().length > 0 && Number.isFinite(Date.parse(validation.finishedAt))
    && validation?.head === head && dirty === false && validation?.passed === true
    && validation?.analysisVerified === true && validation?.reviewsVerified === true
    && validation?.toolingExit === 0 && validation?.coverageExit === 0 && validation?.scannerExit === 0
    && validation?.gate?.status === 'OK'
  const coverageCurrent = coverage?.head === head && dirty === false && coverage?.status === 'passed'
  const counts = {}
  for (const row of catalog?.findings ?? []) {
    const state = ['OPEN', 'FIXED', 'FALSE_POSITIVE', 'ACCEPTED', 'CONFIRMED', 'IN_SANDBOX'].includes(row.sonarState) ? row.sonarState : 'UNKNOWN'
    counts[state] = (counts[state] ?? 0) + 1
  }
  return {
    kind: 'local context only; not a replacement for CI, review or human homologation', head, dirty,
    sonar: { evidence: validation ? (verified ? 'passed_for_clean_head' : 'stale_or_failed') : 'missing',
      gate: verified ? 'OK' : 'unverified', analysisId: verified ? validation.analysisId : null },
    coverage: { evidence: coverageCurrent ? 'current' : 'stale_or_missing',
      diffPercent: coverageCurrent && Number.isFinite(coverage.newCoverage?.percent) ? coverage.newCoverage.percent : null },
    catalog: { evidence: catalog?.latestAnalysis?.revision === head && !dirty ? 'same_revision_snapshot' : 'historical_or_missing', counts },
    next: ['Inspect only the affected files and the current change journal.', 'Use targeted checks while editing; run required final gates on the final SHA.', 'Query current CI before merge; this command makes no remote request.'],
  }
}
function readOptional(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('QUALITY_CONTEXT_INVALID_REPORT') }
}
export function latestValidation(root) {
  let directories
  try { directories = readdirSync(join(root, '.sonar-reports')) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
  const candidates = directories.filter(name => /^validation-\d+-[a-f0-9-]+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  // A newer incomplete run must not fall back to a previous green report.
  return candidates.length ? readOptional(join(root, '.sonar-reports', candidates[0], 'validation.json')) : null
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const git = args => execFileSync(resolveExecutable('git'), args, { cwd: root, encoding: 'utf8' }).trim()
  const result = summarizeQuality({ head: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain']) !== '',
    validation: latestValidation(root), coverage: readOptional(join(root, 'coverage/summary.json')),
    catalog: readOptional(join(root, 'docs/sonarqube/findings.json')) })
  console.log(JSON.stringify(result, null, 2))
}
