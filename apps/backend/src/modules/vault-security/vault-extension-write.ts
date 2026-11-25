import { VaultExtensionWriteSchema, type VaultExtensionWrite } from '@nodeaccess/shared'
import type { Prisma } from '@prisma/client'
import { SecretService } from '../secrets/secret.service.js'
import { PemKeyService } from '../pem-keys/pem-key.service.js'
import { SecretRepository } from '../secrets/secret.repository.js'
import { PemKeyRepository } from '../pem-keys/pem-key.repository.js'
import type { LogRepository } from '../logs/log.repository.js'
import { denied } from './vault-domain.js'
import type { VaultIdentity } from './vault-domain.js'

/** Same encryption, validation and audit as the portal; never confer administrator privileges. */
export function personalItemWriter(secrets: SecretService, pems: PemKeyService) {
  return async (identity: VaultIdentity, raw: VaultExtensionWrite, shared = false, role: 'admin' | 'user' = 'user'): Promise<{ id: number }> => {
    const input = VaultExtensionWriteSchema.parse(raw)
    const { userId, tenantId } = identity
    if (input.operation !== 'import-pem' && !shared && ((input.scope !== undefined && input.scope !== 'PERSONAL') || input.groupId !== undefined)) denied()
    let result: { id: number }
    switch (input.operation) {
      case 'create-secret':
        result = await secrets.create(userId, tenantId, role, { alias: input.alias, value: input.value,
          ...(input.description !== undefined ? { description: input.description } : {}), scope: input.scope ?? 'PERSONAL', ...(input.groupId !== undefined ? { groupId: input.groupId } : {}), source: 'MANUAL' })
        break
      case 'update-secret':
        result = await secrets.update(input.id, userId, tenantId, role, {
          ...(shared && input.scope !== undefined ? { scope: input.scope } : {}),
          ...(shared && input.groupId !== undefined ? { groupId: input.groupId } : {}),
          ...(input.alias !== undefined ? { alias: input.alias } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        }, !shared)
        break
      case 'rotate-secret':
        result = await secrets.rotate(input.id, userId, tenantId, role, { value: input.value }, !shared)
        break
      case 'import-pem':
        result = await pems.create({ name: input.name, key: input.key,
          ...(input.passphrase !== undefined ? { passphrase: input.passphrase } : {}) }, userId)
    }
    return { id: result.id }
  }
}

/** Called only by SqlVaultTransaction after readAuthority checked the locked tenant's Secrets license.
 * Buffer the portal services' best-effort audit calls, then require their persistence before commit. */
export async function writePersonalInTransaction(db: Prisma.TransactionClient, identity: VaultIdentity, input: VaultExtensionWrite, role: 'admin' | 'user' = 'user'): Promise<{ id: number }> {
  input = VaultExtensionWriteSchema.parse(input)
  let shared = false
  if (input.operation !== 'import-pem') {
    const scope = input.scope ?? 'PERSONAL'
    if ((scope === 'GROUP') !== (input.groupId !== undefined)) denied()
    let existing: { scope: string; groupId: number | null; owner: number | null } | undefined
    if (input.operation !== 'create-secret') {
      const rows = await db.$queryRaw<Array<{ scope: string; groupId: number | null; owner: number | null }>>`SELECT scope,group_id AS groupId,owner_user_id AS owner FROM secrets WHERE tenant_id=${identity.tenantId} AND id=${input.id} AND revoked_at IS NULL FOR UPDATE`
      existing = rows[0]
      if (!existing) denied()
      if (existing.scope === 'PERSONAL' && existing.owner !== identity.userId) denied()
      // Omitted scope must never select or convert a shared item implicitly.
      if (existing.scope !== 'PERSONAL' && input.scope === undefined) denied()
      if (input.operation === 'rotate-secret' && (existing.scope !== scope || (existing.groupId ?? undefined) !== input.groupId)) denied()
    }
    shared = scope !== 'PERSONAL' || (existing !== undefined && existing.scope !== 'PERSONAL')
    if (shared && !await sharedWriteGranted(db, identity)) denied()
    if (shared && input.operation === 'update-secret' && existing?.scope === scope && (existing.groupId ?? undefined) === input.groupId) {
      delete input.scope
      delete input.groupId
    }
  }
  const events: Array<Parameters<LogRepository['logAdminEvent']>[0]> = []
  const logs = { logAdminEvent: (event: Parameters<LogRepository['logAdminEvent']>[0]): Promise<void> => { events.push(event); return Promise.resolve() } }
  const secrets = new SecretService(new SecretRepository(db), logs, { requireFeature: (): Promise<void> => Promise.resolve() })
  const pems = new PemKeyService(new PemKeyRepository(db), logs)
  const result = await personalItemWriter(secrets, pems)(identity, input, shared, role)
  for (const event of events) await db.adminLog.create({ data: event })
  return result
}

/** Lock the same grant row used by the two-manager administration until audit and commit. */
export async function sharedWriteGranted(db: Prisma.TransactionClient, identity: VaultIdentity): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ enabled: unknown; grantedBy: number; approvedBy: number }>>`SELECT enabled,granted_by AS grantedBy,approved_by AS approvedBy FROM vault_entitlements WHERE tenant_id=${identity.tenantId} AND user_id=${identity.userId} AND action='shared-write' FOR SHARE`
  const g = rows[0]
  return !!g && (g.enabled === true || g.enabled === 1 || g.enabled === 1n) && g.grantedBy !== g.approvedBy && g.grantedBy !== identity.userId && g.approvedBy !== identity.userId
}
