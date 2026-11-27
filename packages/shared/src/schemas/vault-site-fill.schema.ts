import { z } from 'zod'

const origin = z.string().max(2048).refine(value => {
  try { const u = new URL(value); return u.protocol === 'https:' && u.origin === value && !u.username && !u.password } catch { return false }
})
/** A user gesture authorizes only this top-level document, not the whole hostname. */
export const VaultSiteFillBindingSchema = z.object({
  mode: z.enum(['username', 'password', 'both']),
  origin, tabId: z.number().int().nonnegative(), frameId: z.literal(0),
  documentId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
}).strict()
export const VaultSiteFillAuthorizeSchema = z.object({
  siteId: z.number().int().positive(), siteVersion: z.number().int().positive(), binding: VaultSiteFillBindingSchema,
  recipient: z.object({ kty: z.literal('RSA'), n: z.string().min(342).max(683), e: z.literal('AQAB') }).strict(),
}).strict()
export const VaultSiteFillConsumeSchema = z.object({
  operation: z.string().regex(/^[A-Za-z0-9_-]{43}$/), binding: VaultSiteFillBindingSchema,
}).strict()
export type VaultSiteFillBinding = z.infer<typeof VaultSiteFillBindingSchema>
export type VaultSiteFillAuthorize = z.infer<typeof VaultSiteFillAuthorizeSchema>
export type VaultSiteFillConsume = z.infer<typeof VaultSiteFillConsumeSchema>

/** Username-only replies cannot carry an envelope or password, including unknown properties. */
export const VaultSiteFillReleaseSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('username'), username: z.string().max(320), operation: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    binding: VaultSiteFillBindingSchema, expiresAt: z.number().int(), serverNow: z.number().int() }).strict(),
  z.object({ mode: z.enum(['password', 'both']), envelope: z.string().max(20480), context: z.unknown(),
    username: z.string().max(320), serverNow: z.number().int() }).strict(),
])
