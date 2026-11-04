// The reviewed CVE affects the SQLite shell, not the separately packaged shared library.
export function reviewedSqliteImageFinding(ref, distro, match, policy, now = new Date()) {
  const expiry = Date.parse(`${policy.expiresAt}T00:00:00Z`)
  if (!Number.isFinite(expiry) || !Number.isFinite(now.getTime()) || now.getTime() >= expiry
    || !policy.images.includes(ref) || distro?.name !== policy.distro.name || distro.version !== policy.distro.version) return null
  const a = match?.artifact, v = match?.vulnerability, details = match?.matchDetails
  if (!a || !v || a.type !== 'apk' || a.name !== policy.package || a.version !== policy.version
    || v.id !== policy.id || v.severity !== 'High' || v.namespace !== policy.namespace || v.dataSource !== policy.source
    || v.fix?.state !== '' || !Array.isArray(v.fix.versions) || v.fix.versions.length !== 0
    || !Array.isArray(details) || details.length !== 1) return null
  const d = details[0]
  if (d?.matcher !== 'apk-matcher' || d.type !== 'cpe-match' || d.searchedBy?.namespace !== policy.namespace
    || d.searchedBy.package?.name !== 'sqlite' || d.searchedBy.package?.version !== policy.version
    || d.found?.vulnerabilityID !== policy.id || d.found.versionConstraint !== '<= 3.54.1 (unknown)'
    || !Array.isArray(d.searchedBy.cpes) || d.searchedBy.cpes.length !== 1 || d.searchedBy.cpes[0] !== policy.searchedCpe
    || !Array.isArray(d.found.cpes) || d.found.cpes.length !== 1 || d.found.cpes[0] !== policy.foundCpe) return null
  return { reason: policy.reason }
}
