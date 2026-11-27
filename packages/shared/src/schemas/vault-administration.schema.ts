import { z } from 'zod'

/** NA-0183 — read side of the two-manager vault administration shown in the portal. */
export const VaultGrantActionSchema = z.enum(['reveal', 'copy', 'extension', 'shared-write', 'fill'])
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
    grants: z.object({ reveal: z.boolean(), copy: z.boolean(), extension: z.boolean(), 'shared-write': z.boolean().default(false), fill: z.boolean().default(false) }).strict(),
  }).strict()).max(500),
  proposals: z.array(z.object({
    reference: z.string().regex(/^[a-f0-9]{64}$/), change: VaultAdministrationChangeSchema,
    proposedBy: z.object({ id: z.number().int().positive(), name: z.string().max(255) }).strict(), mine: z.boolean(), expiresAt: z.number().int(),
    beneficiary: z.object({ id: z.number().int().positive(), name: z.string().max(255), email: z.string().max(320) }).strict().nullable(),
    item: z.object({ id: z.number().int().positive(), alias: z.string().max(120) }).strict().nullable(),
  }).strict()).max(50),
  policy: z.object({ confirmationSeconds: z.number().int().min(60).max(900).multipleOf(60),
    proposalSeconds: z.number().int().min(120).max(86400).multipleOf(60),
    reveal: z.boolean(), copy: z.boolean(), tenantQuota: z.number().int().min(1).max(300) }).strict(),
  items: z.array(z.object({ id: z.number().int().positive(), alias: z.string().max(120) }).strict()).max(1000),
  serverNow: z.number().int(),
}).strict()
/** NA-0199: tenant vault settings for /admin/settings (read only; changes are two-manager proposals). */
export const VaultSettingsSchema = z.object({
  manager: z.boolean(), reveal: z.boolean(), copy: z.boolean(), tenantQuota: z.number().int().min(1).max(300),
  confirmationSeconds: z.number().int().min(60).max(900), proposalSeconds: z.number().int().min(120).max(86400),
  origin: z.string().url().max(512), webauthn: z.boolean(),
}).strict()
export type VaultSettings = z.infer<typeof VaultSettingsSchema>
/** NA-0196: guidance for the signed-in user before unlocking; the server still decides every delivery. */
export const VaultAvailabilitySchema = z.object({
  policy: z.object({ reveal: z.boolean(), copy: z.boolean() }).strict(),
  grants: z.object({ reveal: z.boolean(), copy: z.boolean() }).strict(),
  items: z.array(z.number().int().positive()).max(1000),
}).strict()
export type VaultAvailability = z.infer<typeof VaultAvailabilitySchema>
export type VaultAdministrationOverview = z.infer<typeof VaultAdministrationOverviewSchema>
