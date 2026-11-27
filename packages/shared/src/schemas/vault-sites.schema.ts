import { z } from 'zod'

/** URL parsing is shared by matching, storage and the extension. No suffix matching. */
export function vaultSiteUrl(value: string, originOnly = false): string {
  if (value.length > 2048 || !/^https:\/\//i.test(value) || /[\s\\\u0000-\u001f\u007f]/u.test(value)) throw new Error('Invalid HTTPS URL')
  const url = new URL(value)
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || value.split('/')[2]?.includes('@')) throw new Error('Invalid HTTPS URL')
  if (originOnly && ((url.pathname !== '/' && url.pathname !== '') || value.includes('?') || value.includes('#'))) {
    throw new Error('Expected an HTTPS origin')
  }
  return originOnly ? url.origin : url.href
}

function httpsSchema(originOnly: boolean) {
  return z.string().min(1).max(2048).transform((value, ctx) => {
    try { return vaultSiteUrl(value, originOnly) } catch {
      ctx.addIssue({ code: 'custom', message: originOnly ? 'Expected an HTTPS origin' : 'Expected an HTTPS URL' })
      return z.NEVER
    }
  })
}
export const VaultSiteOriginSchema = httpsSchema(true)
export const VaultSiteUrlSchema = httpsSchema(false)
const id = z.number().int().positive().max(2147483647)
const origins = z.array(VaultSiteOriginSchema).min(1).max(8).transform(values => [...new Set(values)])
const label = z.string().trim().min(1).max(160)
const username = z.string().max(320)
const password = z.string().min(1).max(1024).refine(value => new TextEncoder().encode(value).byteLength <= 4096, { message: 'Password exceeds 4096 UTF-8 bytes' })
const common = { label, scope: z.enum(['PERSONAL', 'GROUP', 'TENANT']).default('PERSONAL'), groupId: id.optional(), hostId: id.nullable().optional() }
export const VaultSiteCreateSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('login'), username, password, origins, allowFill: z.boolean().default(false) }).strict(),
  z.object({ ...common, kind: z.literal('url'), url: VaultSiteUrlSchema }).strict(),
]).refine(value => (value.scope === 'GROUP') === (value.groupId !== undefined), { message: 'groupId is required only for GROUP' })
export type VaultSiteCreate = z.infer<typeof VaultSiteCreateSchema>

/** Kind and ownership are immutable; passwords are never required for a metadata edit. */
export const VaultSiteUpdateSchema = z.object({
  id, version: id, label: label.optional(), username: username.optional(), password: password.optional(),
  origins: origins.optional(), url: VaultSiteUrlSchema.optional(), hostId: id.nullable().optional(), allowFill: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).some(key => key !== 'id' && key !== 'version'), { message: 'No changes supplied' })
export type VaultSiteUpdate = z.infer<typeof VaultSiteUpdateSchema>
export const VaultSiteVersionSchema = z.object({ id, version: id }).strict()
export type VaultSiteVersion = z.infer<typeof VaultSiteVersionSchema>
export const VaultSiteDeliverySchema = VaultSiteVersionSchema.extend({ origin: VaultSiteOriginSchema })
export type VaultSiteDelivery = z.infer<typeof VaultSiteDeliverySchema>
export const VaultSiteListSchema = z.object({
  after: z.number().int().min(0).max(2147483647).default(0), limit: z.number().int().min(1).max(50).default(50),
  origin: VaultSiteOriginSchema.optional(),
  q: z.string().trim().max(160).optional(),
}).strict()
export type VaultSiteList = z.infer<typeof VaultSiteListSchema>
export const VaultSiteMetadataSchema = z.object({
  id, version: id, kind: z.enum(['login', 'url']), label, scope: z.enum(['PERSONAL', 'GROUP', 'TENANT']),
  groupId: id.nullable(), username: username.nullable(), origins: z.array(VaultSiteOriginSchema).max(8),
  url: VaultSiteUrlSchema.nullable(), host: z.object({ id, name: z.string() }).strict().nullable(), canManage: z.boolean(), allowFill: z.boolean(),
}).strict()
export type VaultSiteMetadata = z.infer<typeof VaultSiteMetadataSchema>
export const VaultSiteListReplySchema = z.object({ items: z.array(VaultSiteMetadataSchema).max(50), next: id.nullable() }).strict()
