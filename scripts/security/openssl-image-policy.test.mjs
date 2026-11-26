import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reviewedOpensslImageFinding } from './openssl-image-policy.mjs'
const policy = JSON.parse(readFileSync(new URL('../../security/openssl-image-triage.json', import.meta.url)))
const now = new Date('2026-11-22T12:00:00Z')
const backend = 'nodeaccess-backend:security-local'
const backendDistro = { name: 'alpine', version: '3.24.4' }
const redis = 'nodeaccess-redis:8.2.10-1'
const versionOf = ref => policy.images[ref].packageVersion ?? policy.version
const packagesOf = ref => policy.images[ref].packages ?? policy.packages
function fixture(id = 'CVE-2026-84786', name = 'libssl3', version = '3.5.9-r1') {
  const finding = policy.findings.find(f => f.id === id)
  return { artifact: { type: 'apk', name, version },
    vulnerability: { id, severity: 'High', namespace: policy.namespace, dataSource: `https://nvd.nist.gov/vuln/detail/${id}`, fix: { state: 'unknown', versions: [] } },
    matchDetails: [{ type: 'cpe-match', matcher: 'apk-matcher', searchedBy: { namespace: policy.namespace,
      package: { name: 'openssl', version }, cpes: [policy.searchedCpe] },
    found: { vulnerabilityID: id, versionConstraint: finding.versionConstraint, cpes: [policy.foundCpe] } }] }
}
for (const [ref, distro] of Object.entries(policy.images)) {
  for (const { id, packageVersions } of policy.findings) {
    const version = versionOf(ref)
    for (const name of policy.packages) {
      const expected = packageVersions.includes(version) && packagesOf(ref).includes(name)
      test(`${name} ${version} ${id} is ${expected ? '' : 'not '}reviewed for ${ref}`, () => {
        const reviewed = reviewedOpensslImageFinding(ref, distro, fixture(id, name, version), policy, now)
        assert.equal(reviewed?.reason ?? null, expected ? policy.reason : null)
      })
    }
  }
}
test('only Redis uses 3.5.9-r2; other images retain r1 and the openssl CLI only where installed', () => {
  for (const [ref, image] of Object.entries(policy.images)) {
    assert.equal(image.packageVersion, ref === redis ? '3.5.9-r2' : '3.5.9-r1')
    assert.deepEqual(packagesOf(ref), [backend, 'nodeaccess-tls-agent:security-local', 'nodeaccess-backend:2.2.0-na0206.1', 'nodeaccess-tls-agent:2.2.0-na0206.1'].includes(ref) ? policy.packages : ['libssl3', 'libcrypto3'])
  }
})
test('NA-0197: the four CVEs Alpine fixed by backport in 3.5.9-r1 are reviewed for r1, with the reason saying so', () => {
  for (const id of ['CVE-2026-88823', 'CVE-2026-95691', 'CVE-2026-95692', 'CVE-2026-107496']) {
    assert.deepEqual(policy.findings.find(f => f.id === id).packageVersions, ['3.5.9-r0', '3.5.9-r1'])
    assert.ok(policy.reason.includes(id))
  }
  assert.equal(policy.expiresAt, '2026-12-19')
})
test('a CVE reviewed only for another package revision remains blocked', () => {
  const findings = policy.findings.map(f => f.id === 'CVE-2026-88823' ? { ...f, packageVersions: ['3.5.9-r0'] } : f)
  assert.equal(reviewedOpensslImageFinding(backend, backendDistro, fixture('CVE-2026-88823'), { ...policy, findings }, now), null)
  assert.equal(reviewedOpensslImageFinding(backend, backendDistro, fixture('CVE-2026-88823'), policy, now)?.reason, policy.reason)
})
test('non-array image package list remains blocked', () => {
  const images = { ...policy.images, [backend]: { ...policy.images[backend], packages: 'libssl3' } }
  assert.equal(reviewedOpensslImageFinding(backend, backendDistro, fixture(), { ...policy, images }, now), null)
})
for (const [name, ref, version, id] of [
  ['r0 package in an r1 image', backend, '3.5.9-r0', 'CVE-2026-84786'],
  ['r0 package in the redis image', redis, '3.5.9-r0', 'CVE-2026-84786'],
  ['backported CVE is not reviewed at r2 in the redis image', redis, '3.5.9-r2', 'CVE-2026-88823'],
]) test(`${name} remains blocked`, () => {
  assert.equal(reviewedOpensslImageFinding(ref, policy.images[ref], fixture(id, 'libssl3', version), policy, now), null)
})
test('finding without reviewed package versions remains blocked', () => {
  const findings = policy.findings.map(f => f.id === 'CVE-2026-84786' ? { id: f.id, versionConstraint: f.versionConstraint } : f)
  assert.equal(reviewedOpensslImageFinding(backend, backendDistro, fixture(), { ...policy, findings }, now), null)
})
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
  ['different found CVE', m => { m.matchDetails[0].found.vulnerabilityID = 'CVE-2026-124709' }],
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
  ['crossed backend distro', redis, backendDistro, policy, now],
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
test('review pins the owner acceptance window and reviewed CVEs', () => {
  assert.equal(policy.reviewedAt, '2026-11-23')
  assert.equal(policy.expiresAt, '2026-12-19')
  assert.deepEqual(policy.findings.map(f => f.id).sort(), ['CVE-2026-107493', 'CVE-2026-107494', 'CVE-2026-107496', 'CVE-2026-121482',
    'CVE-2026-124709', 'CVE-2026-84786', 'CVE-2026-88823', 'CVE-2026-95691', 'CVE-2026-95692'])
})

for (const name of ['backend', 'frontend', 'tls-agent']) test(`NA-0206: ${name} release ref preserves the exact reviewed policy`, () => {
  const release = `nodeaccess-${name}:2.2.0-na0206.1`
  const local = `nodeaccess-${name}:security-local`
  assert.deepEqual(policy.images[release], policy.images[local])
  for (const ref of [`nodeaccess-${name}:2.2.0-na0206.2`, `nodeaccess-${name}:latest`]) {
    assert.equal(reviewedOpensslImageFinding(ref, policy.images[local], fixture(), policy, now), null)
  }
})

test('Redis r2 accepts only the three remaining reviewed CVEs and rejects backported CVEs', () => {
  const remaining = ['CVE-2026-107494', 'CVE-2026-121482', 'CVE-2026-84786']
  assert.deepEqual(policy.findings.filter(f => f.packageVersions.includes('3.5.9-r2')).map(f => f.id).sort(), [...remaining].sort())
  for (const { id } of policy.findings) {
    for (const name of ['libssl3', 'libcrypto3']) {
      const match = fixture(id, name, '3.5.9-r2')
      assert.equal(reviewedOpensslImageFinding(redis, policy.images[redis], match, policy, now)?.reason ?? null,
        remaining.includes(id) ? policy.reason : null)
      for (const ref of Object.keys(policy.images).filter(ref => ref !== redis)) {
        assert.equal(reviewedOpensslImageFinding(ref, policy.images[ref], match, policy, now), null)
      }
    }
  }
  for (const version of ['3.5.9-r0', '3.5.9-r1', '3.5.9-r3', '3.5.10-r0']) {
    assert.equal(reviewedOpensslImageFinding(redis, policy.images[redis], fixture(remaining[0], 'libssl3', version), policy, now), null)
  }
  assert.equal(reviewedOpensslImageFinding(redis, policy.images[redis], fixture(remaining[0], 'openssl', '3.5.9-r2'), policy, now), null)
  assert.equal(policy.expiresAt, '2026-12-19')
})
