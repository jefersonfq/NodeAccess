import { z } from 'zod'
import { CreateSecretSchema, UpdateSecretSchema, RotateSecretSchema } from './secret.schema.js'
import { CreatePemKeySchema } from './pem-key.schema.js'

/**
 * NA-0183 — VaultNAccess browser extension contracts (slice E1).
 * Replies contain metadata only. E3 write requests carry new material over HTTPS, never portal credentials.
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
/** NA-0193: renewal by a trusted device — automatic (no `otp`) or with the NodeAccess authenticator code. */
export const VaultExtensionRenewRequestSchema = z.object({
  extensionId: VaultExtensionIdSchema,
  otp: z.string().regex(/^\d{6}$/).optional(),
}).strict()
export type VaultExtensionRenewRequest = z.infer<typeof VaultExtensionRenewRequestSchema>
export const VaultExtensionForgetRequestSchema = z.object({ extensionId: VaultExtensionIdSchema }).strict()
/** NA-0195 (E2): authenticator-code proof and one reveal/copy release to the popup's ephemeral RSA key. */
export const VaultExtensionUnlockRequestSchema = z.object({ otp: z.string().regex(/^\d{6}$/) }).strict()
export const VaultExtensionUnlockReplySchema = z.object({ proofUntil: z.number().int(), serverNow: z.number().int() }).strict()
export const VaultExtensionDeliverRequestSchema = z.object({
  secretId: z.number().int().positive(),
  action: z.enum(['reveal', 'copy']),
  recipient: z.object({ kty: z.literal('RSA'), n: z.string().min(342).max(683), e: z.literal('AQAB') }).strict(),
}).strict()
export type VaultExtensionDeliverRequest = z.infer<typeof VaultExtensionDeliverRequestSchema>

export const VaultItemKindSchema = z.enum(['secret', 'pem'])
export type VaultItemKind = z.infer<typeof VaultItemKindSchema>

export const VaultExtensionWriteAccessSchema = z.object({
  groups: z.array(z.object({ id: z.number().int().positive(), name: z.string() }).strict()),
  tenant: z.boolean(),
}).strict()
export type VaultExtensionWriteAccess = z.infer<typeof VaultExtensionWriteAccessSchema>

export const VaultExtensionCapabilitiesSchema = z.object({
  preferenceScope: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  writeAccess: VaultExtensionWriteAccessSchema.optional(),
  apiVersion: z.literal(1),
  minExtensionVersion: VaultExtensionVersionSchema,
  kinds: z.array(VaultItemKindSchema),
  /** Later slices (E2+) flip these on; E1 is search and open only. */
  features: z.object({ reveal: z.boolean(), copy: z.boolean(), create: z.boolean(), sites: z.boolean().optional(), fill: z.boolean().optional() }).strict(),
  portalOrigin: z.string().url(),
  expiresAt: z.number().int(),
  serverNow: z.number().int(),
  /** NA-0195: the authenticator-code proof in the extension is fresh until then (reveal/copy without asking again). */
  proofUntil: z.number().int().optional(),
}).strict()
export type VaultExtensionCapabilities = z.infer<typeof VaultExtensionCapabilitiesSchema>

/** Projection shared by every client; never a value, passphrase or key body. */
export const VaultItemSummarySchema = z.object({
  writable: z.boolean().optional(),
  writeScope: z.enum(['PERSONAL', 'GROUP', 'TENANT']).optional(),
  groupId: z.number().int().positive().nullable().optional(),
  kind: VaultItemKindSchema,
  sourceId: z.number().int().positive(),
  label: z.string().min(1).max(200),
  description: z.string().max(500).nullable(),
  scope: z.enum(['personal', 'shared']),
  portalPath: z.string().regex(/^\/[A-Za-z0-9/_?=&-]{1,200}$/),
}).strict()
export type VaultItemSummary = z.infer<typeof VaultItemSummarySchema>

export const VaultExtensionItemsQuerySchema = z.object({
  sourceId: z.coerce.number().int().positive().safe().optional(),
  q: z.string().max(100).optional(),
  kind: VaultItemKindSchema.optional(),
  cursor: z.string().regex(/^\d{1,6}$/).optional(),
}).strict()
export type VaultExtensionItemsQuery = z.infer<typeof VaultExtensionItemsQuerySchema>
export const VaultExtensionHostsQuerySchema = z.object({ kind: VaultItemKindSchema, sourceId: z.coerce.number().int().positive().safe(), cursor: z.string().regex(/^\d{1,6}$/).optional() }).strict()
export const VaultExtensionHostsReplySchema = z.object({ hosts: z.array(z.object({ id: z.number().int().positive(), name: z.string().min(1).max(200) }).strict()).max(50), nextCursor: z.string().regex(/^\d{1,6}$/).nullable() }).strict()
export type VaultExtensionHostsReply = z.infer<typeof VaultExtensionHostsReplySchema>
export const VaultExtensionItemsReplySchema = z.object({
  items: z.array(VaultItemSummarySchema).max(50),
  nextCursor: z.string().regex(/^\d{1,6}$/).nullable(),
}).strict()
export type VaultExtensionItemsReply = z.infer<typeof VaultExtensionItemsReplySchema>

/** E4: personal by default; shared scope is explicit and authorized in the write transaction. */
const writeScope = { scope: z.enum(['PERSONAL', 'GROUP', 'TENANT']).optional(), groupId: z.number().int().positive().optional() }

export const VaultExtensionWriteSchema = z.discriminatedUnion('operation', [
  CreateSecretSchema.pick({ alias: true, value: true, description: true }).extend({ ...writeScope, operation: z.literal('create-secret') }).strict(),
  UpdateSecretSchema.pick({ alias: true, description: true }).extend({ ...writeScope, operation: z.literal('update-secret'), id: z.number().int().positive() }).strict(),
  RotateSecretSchema.extend({ ...writeScope, operation: z.literal('rotate-secret'), id: z.number().int().positive() }).strict(),
  CreatePemKeySchema.extend({ operation: z.literal('import-pem'), key: z.string().min(1).max(65535) }).strict(),
])
export type VaultExtensionWrite = z.infer<typeof VaultExtensionWriteSchema>
export const VaultExtensionWriteReplySchema = z.object({ id: z.number().int().positive() }).strict()

export const VaultExtensionDeviceSchema = z.object({
  jkt: VaultExtensionThumbprintSchema,
  extensionId: VaultExtensionIdSchema,
  state: z.enum(['ACTIVE', 'REVOKED']),
  createdAt: z.number().int(),
  lastUsedAt: z.number().int().nullable(),
}).strict()
export type VaultExtensionDevice = z.infer<typeof VaultExtensionDeviceSchema>
export const VaultExtensionDevicesReplySchema = z.object({ devices: z.array(VaultExtensionDeviceSchema).max(50) }).strict()
