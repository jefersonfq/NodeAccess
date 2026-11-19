// Temporary, owner-accepted risk: OpenSSL CVEs fixed upstream (3.5.10) but not yet packaged by Alpine.
// Matches only the exact reviewed image/distro, package version, CVE, range and CPEs; expiry restores the block.
export function reviewedOpensslImageFinding(ref, distro, match, policy, now = new Date()) {
  const reviewedDistro = Object.hasOwn(policy.images, ref) ? policy.images[ref] : null
  const expiry = Date.parse(`${policy.expiresAt}T00:00:00Z`)
  if (!Number.isFinite(expiry) || !Number.isFinite(now.getTime()) || now.getTime() >= expiry
    || !reviewedDistro || distro?.name !== reviewedDistro.name || distro.version !== reviewedDistro.version) return null
  const a = match?.artifact, v = match?.vulnerability, details = match?.matchDetails
  if (!a || !v || a.type !== 'apk' || !policy.packages.includes(a.name) || a.version !== policy.version
    || v.severity !== 'High' || v.namespace !== policy.namespace
    || v.dataSource !== `https://nvd.nist.gov/vuln/detail/${v.id}`
    || v.fix?.state !== 'unknown' || !Array.isArray(v.fix.versions) || v.fix.versions.length !== 0
    || !Array.isArray(details) || details.length !== 1) return null
  const finding = policy.findings.find(f => f.id === v.id)
  if (!finding) return null
  const d = details[0]
  if (d?.matcher !== 'apk-matcher' || d.type !== 'cpe-match' || d.searchedBy?.namespace !== policy.namespace
    || d.searchedBy.package?.name !== policy.searchedPackage || d.searchedBy.package?.version !== policy.version
    || d.found?.vulnerabilityID !== v.id || d.found.versionConstraint !== finding.versionConstraint
    || !Array.isArray(d.searchedBy.cpes) || d.searchedBy.cpes.length !== 1 || d.searchedBy.cpes[0] !== policy.searchedCpe
    || !Array.isArray(d.found.cpes) || d.found.cpes.length !== 1 || d.found.cpes[0] !== policy.foundCpe) return null
  return { reason: policy.reason }
}
