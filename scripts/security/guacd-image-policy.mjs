// These are component-identification errors, not accepted vulnerabilities.
// Keep the Oracle/FIPS matcher separate and unchanged.
export function reviewedGuacdImageFinding(ref, distro, match, policy, now = new Date()) {
  const expiry = Date.parse(`${policy.expiresAt}T00:00:00Z`)
  if (!Number.isFinite(expiry) || !Number.isFinite(now.getTime()) || now.getTime() >= expiry
    || ref !== policy.image || distro?.name !== policy.distro.name || distro.version !== policy.distro.version) return null
  const a = match?.artifact, v = match?.vulnerability, details = match?.matchDetails
  if (!a || !v || v.namespace !== policy.namespace || v.fix?.state !== ''
    || !Array.isArray(v.fix.versions) || v.fix.versions.length !== 0
    || !Array.isArray(details) || details.length !== 1) return null
  const d = details[0]
  if (d?.matcher !== 'apk-matcher' || d.type !== 'cpe-match'
    || d.searchedBy?.namespace !== policy.namespace || d.found?.vulnerabilityID !== v.id
    || d.found.versionConstraint !== 'none (unknown)') return null
  return policy.findings.find(f => f.package === a.name && f.version === a.version && f.id === v.id
    && f.severity === v.severity && f.source === v.dataSource
    && d.searchedBy.package?.name === f.searchedPackage && d.searchedBy.package?.version === f.version
    && Array.isArray(d.searchedBy.cpes) && d.searchedBy.cpes.length === 1 && d.searchedBy.cpes[0] === f.searchedCpe
    && Array.isArray(d.found.cpes) && d.found.cpes.length === 1 && d.found.cpes[0] === f.foundCpe) ?? null
}
