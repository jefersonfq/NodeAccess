import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reviewedSqliteImageFinding } from './sqlite-image-policy.mjs'
const policy = JSON.parse(readFileSync(new URL('../../security/sqlite-image-triage.json', import.meta.url)))
const now = new Date('2026-11-05T00:00:00Z')
const tlsImage = 'nodeaccess-tls-agent:security-local'
const guacdImage = 'nodeaccess-guacd:1.6.0-1'
const tlsDistro = { name: 'alpine', version: '3.24.4' }
function fixture() {
  return { artifact: { type: 'apk', name: 'sqlite-libs', version: policy.version },
    vulnerability: { id: policy.id, severity: 'High', namespace: policy.namespace, dataSource: policy.source, fix: { state: '', versions: [] } },
    matchDetails: [{ type: 'cpe-match', matcher: 'apk-matcher', searchedBy: { namespace: policy.namespace,
      package: { name: 'sqlite', version: policy.version }, cpes: [policy.searchedCpe] },
    found: { vulnerabilityID: policy.id, versionConstraint: '<= 3.54.1 (unknown)', cpes: [policy.foundCpe] } }] }
}
for (const [ref, distro] of Object.entries(policy.images)) test(`only exact library match is reviewed for ${ref}`, () => {
  assert.equal(reviewedSqliteImageFinding(ref, distro, fixture(), policy, now)?.reason, policy.reason)
})
const changes = [
  ['CLI package', m => { m.artifact.name = 'sqlite' }],
  ['vulnerable prior library', m => { m.artifact.version = '3.53.4-r0' }],
  ['unreviewed newer library', m => { m.artifact.version = '3.54.2-r0' }],
  ['non APK', m => { m.artifact.type = 'binary' }],
  ...['CVE-2026-119374', 'CVE-2026-119379', 'CVE-2026-119373'].map(id => [id, m => { m.vulnerability.id = id }]),
  ['changed severity', m => { m.vulnerability.severity = 'Critical' }],
  ['changed namespace', m => { m.vulnerability.namespace = 'alpine' }],
  ['changed source', m => { m.vulnerability.dataSource = 'https://example.invalid/' }],
  ['available fix', m => { m.vulnerability.fix.versions = ['3.54.2'] }],
  ['unknown fix state', m => { m.vulnerability.fix.state = 'unknown' }],
  ['missing fix', m => { delete m.vulnerability.fix }],
  ['missing artifact', m => { delete m.artifact }],
  ['missing vulnerability', m => { delete m.vulnerability }],
  ['missing details', m => { delete m.matchDetails }],
  ['ambiguous details', m => { m.matchDetails.push(m.matchDetails[0]) }],
  ['different matcher', m => { m.matchDetails[0].matcher = 'binary-matcher' }],
  ['different match type', m => { m.matchDetails[0].type = 'exact-direct-match' }],
  ['different searched namespace', m => { m.matchDetails[0].searchedBy.namespace = 'alpine' }],
  ['different searched name', m => { m.matchDetails[0].searchedBy.package.name = 'sqlite-tools' }],
  ['different searched version', m => { m.matchDetails[0].searchedBy.package.version = '3.53.4-r0' }],
  ['different found CVE', m => { m.matchDetails[0].found.vulnerabilityID = 'other' }],
  ['changed vulnerability range', m => { m.matchDetails[0].found.versionConstraint = 'none (unknown)' }],
  ['changed searched CPE', m => { m.matchDetails[0].searchedBy.cpes = ['other'] }],
  ['ambiguous searched CPE', m => { m.matchDetails[0].searchedBy.cpes.push('other') }],
  ['changed found CPE', m => { m.matchDetails[0].found.cpes = ['other'] }],
  ['ambiguous found CPE', m => { m.matchDetails[0].found.cpes.push('other') }],
]
for (const [name, mutate] of changes) test(`${name} remains blocked`, () => {
  const match = fixture(); mutate(match)
  assert.equal(reviewedSqliteImageFinding(tlsImage, tlsDistro, match, policy, now), null)
})
for (const [name, ref, distro, selected, date] of [
  ['other image', 'other:latest', tlsDistro, policy, now],
  ['other distro', tlsImage, { name: 'debian', version: '3.24.3' }, policy, now],
  ['future TLS distro version', tlsImage, { name: 'alpine', version: '3.24.5' }, policy, now],
  ['old TLS/crossed guacd distro', tlsImage, { name: 'alpine', version: '3.24.3' }, policy, now],
  ['crossed TLS distro for guacd', guacdImage, tlsDistro, policy, now],
  ['future guacd distro version', guacdImage, { name: 'alpine', version: '3.24.5' }, policy, now],
  ['missing distro', tlsImage, undefined, policy, now],
  ['prototype property image', 'toString', tlsDistro, policy, now],
  ['expired', tlsImage, tlsDistro, policy, new Date('2026-11-18T00:00:00Z')],
  ['invalid expiry', tlsImage, tlsDistro, { ...policy, expiresAt: 'invalid' }, now],
  ['invalid clock', tlsImage, tlsDistro, policy, new Date('invalid')],
]) test(`${name} is not reviewed`, () => {
  assert.equal(reviewedSqliteImageFinding(ref, distro, fixture(), selected, date), null)
})

test('review pins exact image identities and original expiry', () => {
  assert.deepEqual(policy.images, {
    [tlsImage]: { name: 'alpine', version: '3.24.4' },
    [guacdImage]: { name: 'alpine', version: '3.24.3' },
  })
  assert.equal(policy.expiresAt, '2026-11-18')
})
