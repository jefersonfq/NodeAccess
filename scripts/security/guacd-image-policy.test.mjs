import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reviewedGuacdImageFinding } from './guacd-image-policy.mjs'

const policy = JSON.parse(readFileSync(new URL('../../security/guacd-image-triage.json', import.meta.url)))
const now = new Date('2026-10-24T00:00:00Z')
function fixture(f) {
  return {
    artifact: { name: f.package, version: f.version },
    vulnerability: { id: f.id, severity: f.severity, namespace: 'nvd:cpe', dataSource: f.source, fix: { versions: [], state: '' } },
    matchDetails: [{ type: 'cpe-match', matcher: 'apk-matcher', searchedBy: {
      namespace: 'nvd:cpe', cpes: [f.searchedCpe], package: { name: f.searchedPackage, version: f.version },
    }, found: { vulnerabilityID: f.id, versionConstraint: 'none (unknown)', cpes: [f.foundCpe] } }],
  }
}
for (const f of policy.findings) {
  test(`guacd review accepts only the exact component mismatch: ${f.id}`, () => {
    const original = fixture(f)
    const check = match => reviewedGuacdImageFinding(policy.image, policy.distro, match, policy, now)
    assert.equal(check(original), f)
    const mutations = [
      m => { m.artifact.name = 'libssh' },
      m => { m.artifact.version += '-new' },
      m => { m.vulnerability.id = 'CVE-2026-56109' },
      m => { m.vulnerability.severity = 'Critical' },
      m => { m.vulnerability.namespace = 'alpine:distro:alpine:3.24' },
      m => { m.vulnerability.dataSource = 'https://unreviewed.invalid' },
      m => { m.vulnerability.fix.versions = ['new-fix'] },
      m => { m.vulnerability.fix.state = 'unknown' },
      m => { delete m.vulnerability.fix },
      m => { m.matchDetails = [] },
      m => { m.matchDetails.push(structuredClone(m.matchDetails[0])) },
      m => { m.matchDetails[0].matcher = 'stock-matcher' },
      m => { m.matchDetails[0].type = 'exact-direct-match' },
      m => { m.matchDetails[0].searchedBy.namespace = 'other' },
      m => { m.matchDetails[0].searchedBy.package.name = 'other' },
      m => { m.matchDetails[0].searchedBy.package.version = 'older' },
      m => { m.matchDetails[0].searchedBy.cpes = ['cpe:2.3:a:libssh2:libssh2:1.11.1:*:*:*:*:*:*:*'] },
      m => { m.matchDetails[0].searchedBy.cpes.push('another') },
      m => { m.matchDetails[0].found.cpes = ['cpe:2.3:a:libssh2:libssh2:*:*:*:*:*:*:*:*'] },
      m => { m.matchDetails[0].found.cpes.push('another') },
      m => { m.matchDetails[0].found.vulnerabilityID = 'NEW-CVE' },
      m => { m.matchDetails[0].found.versionConstraint = '< 99' },
      m => { delete m.matchDetails[0].found },
    ]
    for (const [index, mutate] of mutations.entries()) {
      const changed = structuredClone(original); mutate(changed)
      assert.equal(check(changed), null, `mutation ${index} must fail closed`)
    }
    for (const ref of ['nodeaccess-guacd:candidate-1.6.0', 'nodeaccess-guacd:latest', 'other:1.6.0-1']) {
      assert.equal(reviewedGuacdImageFinding(ref, policy.distro, original, policy, now), null)
    }
    for (const distro of [{ name: 'ubuntu', version: '3.24.3' }, { name: 'alpine', version: '3.24.4' }, null]) {
      assert.equal(reviewedGuacdImageFinding(policy.image, distro, original, policy, now), null)
    }
    assert.equal(reviewedGuacdImageFinding(policy.image, policy.distro, original, policy, new Date('2026-11-08T00:00:00Z')), null)
    assert.equal(reviewedGuacdImageFinding(policy.image, policy.distro, original, policy, new Date('invalid')), null)
    assert.equal(reviewedGuacdImageFinding(policy.image, policy.distro, original, { ...policy, expiresAt: 'invalid' }, now), null)
    assert.equal(check(null), null)
  })
}
test('real ALSA finding is not a reviewed component mismatch', () => {
  const match = fixture(policy.findings[0])
  match.artifact = { name: 'alsa-lib', version: '1.2.15.3-r0' }
  Object.assign(match.vulnerability, { id: 'CVE-2026-56109', dataSource: 'https://nvd.nist.gov/vuln/detail/CVE-2026-56109', fix: { versions: [], state: 'unknown' } })
  assert.equal(reviewedGuacdImageFinding(policy.image, policy.distro, match, policy, now), null)
})
