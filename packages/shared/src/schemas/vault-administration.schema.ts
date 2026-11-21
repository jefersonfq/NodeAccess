import { z } from 'zod'

/** NA-0183 — read side of the two-manager vault administration shown in the portal. */
export const VaultGrantActionSchema = z.enum(['reveal', 'copy', 'extension'])
export type VaultGrantAction = z.infer<typeof VaultGrantActionSchema>
export const VaultAdministrationChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('grant'), userId: z.number().int().positive(), action: VaultGrantActionSchema, enabled: z.boolean() }).strict(),
  z.object({ kind: z.literal('item'), secretId: z.number().int().positive(), enabled: z.boolean() }).strict(),
  z.object({ kind: z.literal('policy'), reveal: z.boolean(), copy: z.boolean(), tenantQuota: z.number().int().min(1).max(300) }).strict(),
])
export type VaultAdministrationChange = z.infer<typeof VaultAdministrationChangeSchema>
export const VaultAdministrationStatusSchema = z.object({ manager: z.boolean() }).strict()
export const VaultAdministrationOverviewSchema = z.object({
  users: z.array(z.object({
    id: z.number().int().positive(), name: z.string().max(255), email: z.string().max(320),
    grants: z.object({ reveal: z.boolean(), copy: z.boolean(), extension: z.boolean() }).strict(),
  }).strict()).max(500),
  proposals: z.array(z.object({
    reference: z.string().regex(/^[a-f0-9]{64}$/), change: VaultAdministrationChangeSchema,
    proposedBy: z.object({ id: z.number().int().positive(), name: z.string().max(255) }).strict(), mine: z.boolean(), expiresAt: z.number().int(),
    beneficiary: z.object({ id: z.number().int().positive(), name: z.string().max(255), email: z.string().max(320) }).strict().nullable(),
  }).strict()).max(50),
  serverNow: z.number().int(),
}).strict()
export type VaultAdministrationOverview = z.infer<typeof VaultAdministrationOverviewSchema>
