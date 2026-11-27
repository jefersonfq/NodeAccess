import { z } from 'zod'
const id = z.number().int().positive().safe()
export const VaultDiagnosticsInputSchema = z.object({ userId: id, secretId: id }).strict()
export const VaultDiagnosticsRequestSchema = VaultDiagnosticsInputSchema.extend({ sessionId: z.string().min(1).max(256) }).strict()
const actions = z.object({ reveal: z.boolean(), copy: z.boolean() }).strict()
export const VaultDiagnosticsSchema = z.object({
  kind: z.literal('configuration'), userId: id, secretId: id,
  user: z.object({ exists: z.literal(true), active: z.boolean(), deleted: z.boolean() }).strict(),
  policy: actions, grants: actions,
  item: z.object({ released: z.boolean(), revoked: z.boolean() }).strict(),
  acl: z.boolean(), runtime: z.literal('not-evaluated'),
}).strict()
export type VaultDiagnostics = z.infer<typeof VaultDiagnosticsSchema>
