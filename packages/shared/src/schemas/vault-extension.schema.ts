import { z } from 'zod'

/**
 * NA-0183 — VaultNAccess browser extension contracts (slice E1).
 * Metadata only: no schema here may carry a secret value, key material or a portal credential.
 */

/** Chromium extension IDs are 32 characters in the a–p alphabet. */
export const VaultExtensionIdSchema = z.string().regex(/^[a-p]{32}$/)
/** Opaque server tokens (code/authorization): 32 random bytes in base64url. */
export const VaultExtensionOpaqueSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
/** RFC 7638 SHA-256 JWK thumbprint, base64url without padding. */
export const VaultExtensionThumbprintSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
/** RFC 7636 code_verifier: 43–128 unreserved characters. */
export const VaultExtensionVerifierSchema = z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/)
export const VaultExtensionStateSchema = z.string().regex(/^[A-Za-z0-9_-]{22,128}$/)
export const VaultExtensionVersionSchema = z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/)

/** Query string the extension sends to the portal consent page (all values are public). */
export const VaultExtensionConnectRequestSchema = z.object({
  extensionId: VaultExtensionIdSchema,
  redirectUri: z.string().url().max(200),
  state: VaultExtensionStateSchema,
  codeChallenge: VaultExtensionThumbprintSchema,
  codeChallengeMethod: z.literal('S256'),
  deviceJkt: VaultExtensionThumbprintSchema,
}).strict()
export type VaultExtensionConnectRequest = z.infer<typeof VaultExtensionConnectRequestSchema>

/** Portal → server, inside an unlocked vault session with a recent step-up proof. */
export const VaultExtensionAuthorizeSchema = VaultExtensionConnectRequestSchema.omit({ codeChallengeMethod: true })
  .extend({ sessionId: VaultExtensionOpaqueSchema }).strict()
export type VaultExtensionAuthorize = z.infer<typeof VaultExtensionAuthorizeSchema>
export const VaultExtensionAuthorizeReplySchema = z.object({ code: VaultExtensionOpaqueSchema, expiresAt: z.number().int(), serverNow: z.number().int() }).strict()
export type VaultExtensionAuthorizeReply = z.infer<typeof VaultExtensionAuthorizeReplySchema>

/** Extension → server (public endpoint, DPoP proof in header). */
export const VaultExtensionTokenRequestSchema = z.object({
  code: VaultExtensionOpaqueSchema,
  codeVerifier: VaultExtensionVerifierSchema,
  redirectUri: z.string().url().max(200),
  extensionId: VaultExtensionIdSchema,
}).strict()
export type VaultExtensionTokenRequest = z.infer<typeof VaultExtensionTokenRequestSchema>
export const VaultExtensionTokenReplySchema = z.object({
  accessToken: VaultExtensionOpaqueSchema,
  tokenType: z.literal('DPoP'),
  expiresAt: z.number().int(),
  serverNow: z.number().int(),
}).strict()
export type VaultExtensionTokenReply = z.infer<typeof VaultExtensionTokenReplySchema>

export const VaultItemKindSchema = z.enum(['secret', 'pem'])
export type VaultItemKind = z.infer<typeof VaultItemKindSchema>

export const VaultExtensionCapabilitiesSchema = z.object({
  apiVersion: z.literal(1),
  minExtensionVersion: VaultExtensionVersionSchema,
  kinds: z.array(VaultItemKindSchema),
  /** Later slices (E2+) flip these on; E1 is search and open only. */
  features: z.object({ reveal: z.boolean(), copy: z.boolean(), create: z.boolean() }).strict(),
  portalOrigin: z.string().url(),
  expiresAt: z.number().int(),
  serverNow: z.number().int(),
}).strict()
export type VaultExtensionCapabilities = z.infer<typeof VaultExtensionCapabilitiesSchema>

/** Projection shared by every client; never a value, passphrase or key body. */
export const VaultItemSummarySchema = z.object({
  kind: VaultItemKindSchema,
  sourceId: z.number().int().positive(),
  label: z.string().min(1).max(200),
  description: z.string().max(500).nullable(),
  scope: z.enum(['personal', 'shared']),
  portalPath: z.string().regex(/^\/[A-Za-z0-9/_?=&-]{1,200}$/),
}).strict()
export type VaultItemSummary = z.infer<typeof VaultItemSummarySchema>

export const VaultExtensionItemsQuerySchema = z.object({
  q: z.string().max(100).optional(),
  kind: VaultItemKindSchema.optional(),
  cursor: z.string().regex(/^\d{1,6}$/).optional(),
}).strict()
export type VaultExtensionItemsQuery = z.infer<typeof VaultExtensionItemsQuerySchema>
export const VaultExtensionItemsReplySchema = z.object({
  items: z.array(VaultItemSummarySchema).max(50),
  nextCursor: z.string().regex(/^\d{1,6}$/).nullable(),
}).strict()
export type VaultExtensionItemsReply = z.infer<typeof VaultExtensionItemsReplySchema>

export const VaultExtensionDeviceSchema = z.object({
  jkt: VaultExtensionThumbprintSchema,
  extensionId: VaultExtensionIdSchema,
  state: z.enum(['ACTIVE', 'REVOKED']),
  createdAt: z.number().int(),
  lastUsedAt: z.number().int().nullable(),
}).strict()
export type VaultExtensionDevice = z.infer<typeof VaultExtensionDeviceSchema>
export const VaultExtensionDevicesReplySchema = z.object({ devices: z.array(VaultExtensionDeviceSchema).max(50) }).strict()
