import { PrismaClient } from '@prisma/client'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export function configuration(input) {
  const keys = ['tenantId', 'origin', 'managerIds', 'allowLocalReauthentication']
  if (!input || Object.keys(input).some(k => !keys.includes(k)) || !Number.isSafeInteger(input.tenantId) || input.tenantId <= 0
    || !Array.isArray(input.managerIds) || input.managerIds.length !== 2 || new Set(input.managerIds).size !== 2
    || input.managerIds.some(id => !Number.isSafeInteger(id) || id <= 0) || input.allowLocalReauthentication !== true) throw new Error('Invalid vault bootstrap configuration')
  const u = new URL(input.origin)
  if (u.protocol !== 'https:' || u.origin !== input.origin) throw new Error('Exact HTTPS origin required')
  return input
}
/** Deployment operator establishes two managers, never extraction permission or item eligibility. */
export async function bootstrap(db, raw, apply = false) {
  const c = configuration(raw)
  return db.$transaction(async tx => {
    const tenants = await tx.$queryRaw`SELECT id FROM tenants WHERE id=${c.tenantId} AND active=TRUE FOR UPDATE`
    const trials = await tx.$queryRaw`SELECT id FROM trial_registrations WHERE tenant_id=${c.tenantId} FOR SHARE`
    const policies = await tx.$queryRaw`SELECT tenant_id FROM vault_policies WHERE tenant_id=${c.tenantId} FOR UPDATE`
    if (!tenants.length || trials.length || policies.length) throw new Error('Tenant unavailable or already configured; use authenticated administration')
    for (const id of c.managerIds) {
      const users = await tx.$queryRaw`SELECT id FROM users WHERE id=${id} AND tenant_id=${c.tenantId} AND active=TRUE AND deleted_at IS NULL
        AND mfa_enabled=TRUE AND mfa_secret IS NOT NULL AND password_hash IS NOT NULL AND force_password_change=FALSE FOR SHARE`
      if (!users.length) throw new Error('Manager must be an active local MFA identity in this tenant')
    }
    if (!apply) return { applied: false, managers: 2, extractionEnabled: false }
    const config = { unlock: true, localReauth: true, reveal: false, copy: false, origin: c.origin, tenantQuota: 30 }
    await tx.$executeRaw`INSERT INTO vault_policies(tenant_id,version,config) VALUES(${c.tenantId},1,${JSON.stringify(config)})`
    for (const id of c.managerIds) await tx.$executeRaw`INSERT INTO vault_managers(tenant_id,user_id,enabled) VALUES(${c.tenantId},${id},TRUE)`
    await tx.$executeRaw`INSERT INTO vault_audit(event_id,tenant_id,user_id,event_type,metadata)
      VALUES(${randomUUID()},${c.tenantId},0,'DEPLOYMENT_BOOTSTRAP',${JSON.stringify({ managerIds: c.managerIds, extractionEnabled: false, policyVersion: 1 })})`
    return { applied: true, managers: 2, extractionEnabled: false }
  }, { isolationLevel: 'Serializable', maxWait: 500, timeout: 2500 })
}
/** Bounded maintenance; never removes audit history. Run outside request/gateway paths. */
export async function maintenance(db, apply = false) {
  if (!apply) return { applied: false, records: 0, proposals: 0 }
  const records = await db.$executeRaw`DELETE FROM vault_records WHERE expires_at < UTC_TIMESTAMP(3) LIMIT 1000`
  const proposals = await db.$executeRaw`DELETE FROM vault_proposals WHERE expires_at < UTC_TIMESTAMP(3) LIMIT 1000`
  return { applied: true, records, proposals }
}
export async function disable(db, tenantId, apply = false) {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new Error('Invalid tenant')
  if (!apply) return { applied: false }
  await db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE vault_policies SET version=version+1,config=JSON_SET(config,'$.unlock',CAST('false' AS JSON)) WHERE tenant_id=${tenantId}`
    await tx.$executeRaw`INSERT INTO vault_audit(event_id,tenant_id,user_id,event_type,metadata) VALUES(${randomUUID()},${tenantId},0,'DEPLOYMENT_DISABLED','{}')`
  })
  return { applied: true }
}
/** NA-0198: exact HTTPS origin of the portal for a configured tenant (e.g. https://localhost:5173: WebAuthn refuses IP
 * origins). Bumps the policy version, so every vault session and client of the tenant ends; audited. */
export async function origin(db, tenantId, value, apply = false) {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new Error('Invalid tenant')
  let next
  try { next = new URL(value) } catch { throw new Error('Exact HTTPS origin required') }
  if (next.protocol !== 'https:' || next.origin !== value) throw new Error('Exact HTTPS origin required')
  const rows = await db.$queryRaw`SELECT JSON_UNQUOTE(JSON_EXTRACT(config,'$.origin')) AS origin FROM vault_policies WHERE tenant_id=${tenantId}`
  if (!rows.length) throw new Error('Vault not configured for this tenant')
  const current = rows[0].origin
  if (!apply || current === value) return { applied: false, current, next: value }
  await db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE vault_policies SET version=version+1,config=JSON_SET(config,'$.origin',${value}) WHERE tenant_id=${tenantId}`
    const digest = text => createHash('sha256').update(String(text)).digest('hex')
    const metadata = JSON.stringify({ from: digest(current), to: digest(value) })
    await tx.$executeRaw`INSERT INTO vault_audit(event_id,tenant_id,user_id,event_type,metadata) VALUES(${randomUUID()},${tenantId},0,'DEPLOYMENT_ORIGIN_CHANGED',${metadata})`
  })
  return { applied: true, current, next: value }
}
async function main() {
  const db = new PrismaClient({ log: [] })
  try {
    const [mode, input, flag, extra] = process.argv.slice(2)
    let result
    if (mode === 'bootstrap') result = await bootstrap(db, JSON.parse(input ?? '{}'), flag === '--apply')
    else if (mode === 'disable') result = await disable(db, Number(input), flag === '--apply')
    else if (mode === 'maintenance') result = await maintenance(db, input === '--apply')
    else if (mode === 'origin') result = await origin(db, Number(input), flag ?? '', extra === '--apply')
    else throw new Error('Use bootstrap <json> [--apply], disable <tenantId> [--apply], origin <tenantId> <https-origin> [--apply], maintenance [--apply]')
    process.stdout.write(JSON.stringify(result) + '\n')
  } catch {
    process.stderr.write('Vault management failed; no sensitive database details printed. Verify configuration and private database diagnostics.\n')
    process.exitCode = 1
  } finally { await db.$disconnect() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
