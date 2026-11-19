import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reviewedOpensslImageFinding } from './openssl-image-policy.mjs'
const policy = JSON.parse(readFileSync(new URL('../../security/openssl-image-triage.json', import.meta.url)))
const now = new Date('2026-11-19T12:00:00Z')
const backend = 'nodeaccess-backend:security-local'
const backendDistro = { name: 'alpine', version: '3.24.4' }
function fixture(id = 'CVE-2026-95692', name = 'libssl3') {
  const finding = policy.findings.find(f => f.id === id)
  return { artifact: { type: 'apk', name, version: policy.version },
    vulnerability: { id, severity: 'High', namespace: policy.namespace, dataSource: `https://nvd.nist.gov/vuln/detail/${id}`, fix: { state: 'unknown', versions: [] } },
    matchDetails: [{ type: 'cpe-match', matcher: 'apk-matcher', searchedBy: { namespace: policy.namespace,
      package: { name: 'openssl', version: policy.version }, cpes: [policy.searchedCpe] },
    found: { vulnerabilityID: id, versionConstraint: finding.versionConstraint, cpes: [policy.foundCpe] } }] }
}
for (const [ref, distro] of Object.entries(policy.images)) {
  for (const { id } of policy.findings) {
    for (const name of policy.packages) test(`exact ${name} ${id} is reviewed for ${ref}`, () => {
      assert.equal(reviewedOpensslImageFinding(ref, distro, fixture(id, name), policy, now)?.reason, policy.reason)
    })
  }
}
const changes = [
  ['unreviewed package', m => { m.artifact.name = 'openssl-dev' }],
  ['patched version', m => { m.artifact.version = '3.5.10-r0' }],
  ['older version', m => { m.artifact.version = '3.5.8-r0' }],
  ['non APK', m => { m.artifact.type = 'binary' }],
  ['unreviewed CVE', m => { m.vulnerability.id = 'CVE-2026-99999'; m.vulnerability.dataSource = 'https://nvd.nist.gov/vuln/detail/CVE-2026-99999'; m.matchDetails[0].found.vulnerabilityID = 'CVE-2026-99999' }],
  ['changed severity', m => { m.vulnerability.severity = 'Critical' }],
  ['changed namespace', m => { m.vulnerability.namespace = 'alpine:distro:alpine:3.24' }],
  ['changed source', m => { m.vulnerability.dataSource = 'https://example.invalid/' }],
  ['available fix', m => { m.vulnerability.fix = { state: 'fixed', versions: ['3.5.10-r0'] } }],
  ['missing fix', m => { delete m.vulnerability.fix }],
  ['missing artifact', m => { delete m.artifact }],
  ['missing vulnerability', m => { delete m.vulnerability }],
  ['missing details', m => { delete m.matchDetails }],
  ['ambiguous details', m => { m.matchDetails.push(m.matchDetails[0]) }],
  ['different matcher', m => { m.matchDetails[0].matcher = 'binary-matcher' }],
  ['different match type', m => { m.matchDetails[0].type = 'exact-direct-match' }],
  ['different searched namespace', m => { m.matchDetails[0].searchedBy.namespace = 'alpine' }],
  ['different searched name', m => { m.matchDetails[0].searchedBy.package.name = 'libressl' }],
  ['different searched version', m => { m.matchDetails[0].searchedBy.package.version = '3.5.8-r0' }],
  ['different found CVE', m => { m.matchDetails[0].found.vulnerabilityID = 'CVE-2026-88823' }],
  ['changed vulnerability range', m => { m.matchDetails[0].found.versionConstraint = '< 9.9.9 (unknown)' }],
  ['changed searched CPE', m => { m.matchDetails[0].searchedBy.cpes = ['other'] }],
  ['ambiguous searched CPE', m => { m.matchDetails[0].searchedBy.cpes.push('other') }],
  ['changed found CPE', m => { m.matchDetails[0].found.cpes = ['other'] }],
  ['ambiguous found CPE', m => { m.matchDetails[0].found.cpes.push('other') }],
]
for (const [name, mutate] of changes) test(`${name} remains blocked`, () => {
  const match = fixture(); mutate(match)
  assert.equal(reviewedOpensslImageFinding(backend, backendDistro, match, policy, now), null)
})
for (const [name, ref, distro, selected, date] of [
  ['other image', 'other:latest', backendDistro, policy, now],
  ['MySQL image', 'nodeaccess-mysql:8.4.12-1', backendDistro, policy, now],
  ['other distro', backend, { name: 'debian', version: '3.24.4' }, policy, now],
  ['future distro version', backend, { name: 'alpine', version: '3.24.5' }, policy, now],
  ['crossed redis distro', backend, { name: 'alpine', version: '3.22.8' }, policy, now],
  ['missing distro', backend, undefined, policy, now],
  ['prototype property image', 'toString', backendDistro, policy, now],
  ['expired', backend, backendDistro, policy, new Date(`${policy.expiresAt}T00:00:00Z`)],
  ['invalid expiry', backend, backendDistro, { ...policy, expiresAt: 'invalid' }, now],
  ['invalid clock', backend, backendDistro, policy, new Date('invalid')],
]) test(`${name} is not reviewed`, () => {
  assert.equal(reviewedOpensslImageFinding(ref, distro, fixture(), selected, date), null)
})
test('still reviewed one millisecond before expiry', () => {
  assert.ok(reviewedOpensslImageFinding(backend, backendDistro, fixture(), policy, new Date(Date.parse(`${policy.expiresAt}T00:00:00Z`) - 1)))
})
test('review pins the 30-day owner acceptance window', () => {
  assert.equal(policy.reviewedAt, '2026-11-19')
  assert.equal(policy.expiresAt, '2026-12-19')
  assert.deepEqual(policy.findings.map(f => f.id).sort(), ['CVE-2026-107496', 'CVE-2026-88823', 'CVE-2026-95691', 'CVE-2026-95692'])
})
