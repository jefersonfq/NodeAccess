import { z } from 'zod'

/** NA-0183 — read side of the two-manager vault administration shown in the portal. */
export const VaultGrantActionSchema = z.enum(['reveal', 'copy', 'extension'])
export type VaultGrantAction = z.infer<typeof VaultGrantActionSchema>
export const VaultAdministrationChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('grant'), userId: z.number().int().positive(), action: VaultGrantActionSchema, enabled: z.boolean() }).strict(),
  z.object({ kind: z.literal('item'), secretId: z.number().int().positive(), enabled: z.boolean() }).strict(),
  z.object({ kind: z.literal('policy'), reveal: z.boolean(), copy: z.boolean(), tenantQuota: z.number().int().min(1).max(300) }).strict(),
  /** NA-0186: how long an unlock stays valid for reveal/copy in the tenant (60 s default, 15 min max). */
  z.object({ kind: z.literal('confirmation'), seconds: z.number().int().min(60).max(900).multipleOf(60) }).strict(),
  /** NA-0188: vault manager added/removed by two other managers; how long proposals stay open (2 min–24 h). */
  z.object({ kind: z.literal('manager'), userId: z.number().int().positive(), enabled: z.boolean() }).strict(),
  z.object({ kind: z.literal('proposalWindow'), seconds: z.number().int().min(120).max(86400).multipleOf(60) }).strict(),
])
export type VaultAdministrationChange = z.infer<typeof VaultAdministrationChangeSchema>
/** NA-0188: managers also get the count of proposals awaiting their approval and the manager ids (no vault session). */
export const VaultAdministrationStatusSchema = z.object({ manager: z.boolean(), pending: z.number().int().min(0).max(50),
  managers: z.array(z.number().int().positive()).max(500) }).strict()
export type VaultAdministrationStatus = z.infer<typeof VaultAdministrationStatusSchema>
export const VaultAdministrationOverviewSchema = z.object({
  users: z.array(z.object({
    id: z.number().int().positive(), name: z.string().max(255), email: z.string().max(320), manager: z.boolean(),
    grants: z.object({ reveal: z.boolean(), copy: z.boolean(), extension: z.boolean() }).strict(),
  }).strict()).max(500),
  proposals: z.array(z.object({
    reference: z.string().regex(/^[a-f0-9]{64}$/), change: VaultAdministrationChangeSchema,
    proposedBy: z.object({ id: z.number().int().positive(), name: z.string().max(255) }).strict(), mine: z.boolean(), expiresAt: z.number().int(),
    beneficiary: z.object({ id: z.number().int().positive(), name: z.string().max(255), email: z.string().max(320) }).strict().nullable(),
  }).strict()).max(50),
  policy: z.object({ confirmationSeconds: z.number().int().min(60).max(900).multipleOf(60),
    proposalSeconds: z.number().int().min(120).max(86400).multipleOf(60) }).strict(),
  serverNow: z.number().int(),
}).strict()
export type VaultAdministrationOverview = z.infer<typeof VaultAdministrationOverviewSchema>
