import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { reviewedImageFinding } from './image-policy.mjs'
import { reviewedGuacdImageFinding } from './guacd-image-policy.mjs'

const images = process.argv.slice(2)
if (!images.length || images.some(image => image.startsWith('-'))) {
  console.error('Usage: npm run security:images -- <local-image> [local-image...]')
  process.exit(2)
}
const scanner = 'anchore/grype@sha256:e4a44ef45d285b829ce6efe2642980329661bd2d18eab5fc539138d4adaebbbe'
const output = resolve('artifacts/security/images')
const cache = resolve(process.env.GRYPE_LOCAL_CACHE || join(tmpdir(), 'nodeaccess-grype-cache'))
mkdirSync(output, { recursive: true }); mkdirSync(cache, { recursive: true })
const triage = JSON.parse(readFileSync(new URL('../../security/image-triage.json', import.meta.url)))
const guacdTriage = JSON.parse(readFileSync(new URL('../../security/guacd-image-triage.json', import.meta.url)))
const summary = { scanner, at: new Date().toISOString(), policy: 'Block unreviewed High/Critical/Unknown. Exact, expiring component and FIPS-channel false positives remain in the raw report.', images: [], passed: true }
function docker(args) {
  return execFileSync('docker', args, { encoding: 'utf8', timeout: 300_000, maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
}
for (const ref of images) {
  try {
    const id = docker(['image', 'inspect', '--format', '{{.Id}}', ref]).trim()
    // Scan the immutable local image ID. Never pull a different tag implicitly.
    const report = JSON.parse(docker(['run', '--rm', '--cpus', '1', '--memory', '2g',
      '-v', '/var/run/docker.sock:/var/run/docker.sock:ro', '-v', `${cache}:/cache`,
      '-e', 'GRYPE_DB_CACHE_DIR=/cache', '-e', 'GRYPE_DB_MAX_ALLOWED_BUILT_AGE=168h',
      '-e', 'GRYPE_CHECK_FOR_APP_UPDATE=false', scanner, `docker:${id}`, '-o', 'json']))
    if (!Array.isArray(report.matches) || !report.descriptor?.db) throw Error('Incomplete Grype report')
    writeFileSync(join(output, `${ref.replace(/[^a-zA-Z0-9.-]/g, '_')}.json`), JSON.stringify(report, null, 2) + '\n')
    const counts = {}, findings = report.matches.map(match => {
      const { vulnerability: v, artifact: a } = match
      counts[v.severity] = (counts[v.severity] || 0) + 1
      let selectedPolicy = triage
      let reviewed = reviewedImageFinding(ref, report.distro, match, triage)
      if (!reviewed) {
        selectedPolicy = guacdTriage
        reviewed = reviewedGuacdImageFinding(ref, report.distro, match, guacdTriage)
      }
      return { package: a.name, version: a.version, id: v.id, severity: v.severity, fix: v.fix, source: v.dataSource,
        ...(reviewed && { triage: { reason: reviewed.reason, expiresAt: selectedPolicy.expiresAt, evidence: selectedPolicy.evidence } }) }
    })
    const passed = findings.every(finding => !['High', 'Critical', 'Unknown'].includes(finding.severity) || finding.triage)
    summary.images.push({ ref, id, counts, findings, database: report.descriptor.db, passed })
    if (!passed) summary.passed = false
    console.log(JSON.stringify({ image: ref, counts, passed }))
  } catch (error) {
    summary.images.push({ ref, error: String(error.message).slice(0, 2000), passed: false })
    summary.passed = false
    process.exitCode = 2
  }
}
writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
if (!summary.passed && !process.exitCode) process.exitCode = 1
