import { PemKeyPublicSchema, SecretPublicSchema } from '@nodeaccess/shared'
import type { PemKeyPublic, SecretPublic } from '@nodeaccess/shared'

export type VaultKind = 'secret' | 'pem'
export type VaultEntry =
  | { key: string; kind: 'secret'; name: string; record: SecretPublic }
  | { key: string; kind: 'pem'; name: string; record: PemKeyPublic }

// Parse the public contracts instead of retaining arbitrary response fields.
export function secretEntries(data: unknown): VaultEntry[] {
  return SecretPublicSchema.array().parse(data).map((record) => ({ key: `secret:${record.id}`, kind: 'secret', name: record.alias, record }))
}
export function pemEntries(data: unknown): VaultEntry[] {
  return PemKeyPublicSchema.array().parse(data).map((record) => ({ key: `pem:${record.id}`, kind: 'pem', name: record.name, record }))
}
export function canManageVaultSecret(secret: SecretPublic, userId: number | undefined, isAdmin: boolean): boolean {
  return isAdmin || secret.ownerUserId === userId || (secret.scope === 'GROUP' && secret.createdByUserId === userId)
}
export function canManageVaultEntry(entry: VaultEntry, userId: number | undefined, isAdmin: boolean): boolean {
  return entry.kind === 'secret'
    ? canManageVaultSecret(entry.record, userId, isAdmin)
    : isAdmin || entry.record.createdById === userId
}
export function filterVaultEntries(entries: VaultEntry[], query: string, kind: VaultKind | 'all'): VaultEntry[] {
  const search = query.trim().toLocaleLowerCase()
  return entries.filter((entry) => {
    if (kind !== 'all' && entry.kind !== kind) return false
    const fields = entry.kind === 'secret'
      ? [entry.name, entry.record.description, entry.record.createdByUsername, entry.record.scope]
      : [entry.name]
    return !search || fields.some((field) => field?.toLocaleLowerCase().includes(search))
  }).sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
}
