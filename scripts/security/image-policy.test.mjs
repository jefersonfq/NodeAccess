import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reviewedImageFinding } from './image-policy.mjs'
const policy = JSON.parse(readFileSync(new URL('../../security/image-triage.json', import.meta.url)))
const now = new Date('2026-10-08T00:00:00Z')
for (const finding of policy.findings) {
  test(`image triage is exact and expires: ${finding.package}`, () => {
    const match = { artifact: { name: finding.package, version: finding.version }, vulnerability: {
      id: finding.id, severity: finding.severity, namespace: policy.namespace, dataSource: finding.source, fix: { versions: [finding.fix] },
    } }
    assert.ok(reviewedImageFinding(policy.image, policy.distro, match, policy, now))
    assert.equal(reviewedImageFinding('unreviewed:latest', policy.distro, match, policy, now), null)
    assert.equal(reviewedImageFinding(policy.image, { ...policy.distro, version: '9.9' }, match, policy, now), null)
    assert.equal(reviewedImageFinding(policy.image, policy.distro, match, policy, new Date('2026-11-08T00:00:00Z')), null)
    for (const [key, value] of [['id', 'NEW-CVE'], ['severity', 'Critical'], ['namespace', 'another:namespace'], ['dataSource', 'https://unreviewed.invalid'], ['fix', { versions: ['a-different-fix'] }]]) {
      assert.equal(reviewedImageFinding(policy.image, policy.distro, { ...match, vulnerability: { ...match.vulnerability, [key]: value } }, policy, now), null)
    }
    assert.equal(reviewedImageFinding(policy.image, policy.distro, { ...match, artifact: { ...match.artifact, version: 'older-version' } }, policy, now), null)
  })
}
