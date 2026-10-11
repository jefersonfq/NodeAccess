export function reviewedImageFinding(ref, distro, match, policy, now = new Date()) {
  if (ref !== policy.image || distro?.name !== policy.distro.name || distro.version !== policy.distro.version
    || now >= new Date(`${policy.expiresAt}T00:00:00Z`) || !Number.isFinite(Date.parse(policy.expiresAt))) return null
  const { artifact: a, vulnerability: v } = match
  if (v.namespace !== policy.namespace || v.fix?.versions?.length !== 1) return null
  return policy.findings.find(f => f.package === a.name && f.version === a.version && f.id === v.id
    && f.severity === v.severity && f.fix === v.fix.versions[0] && f.source === v.dataSource) ?? null
}
