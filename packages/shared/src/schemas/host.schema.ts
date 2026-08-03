import { z } from 'zod'
import { TagPublicSchema } from './tag.schema.js'

export const HostScopeSchema  = z.enum(['personal', 'team', 'global'])
export const AuthTypeSchema   = z.enum(['pem', 'password', 'pem_password'])
export const HostAccessProtocolValueSchema = z.enum(['ssh', 'rdp', 'telnet', 'vnc', 'serial'])
export const HostAccessProtocolSchema = HostAccessProtocolValueSchema.default('ssh')
export const HostOperatingSystemValueSchema = z.enum([
  'unknown',
  'linux',
  'ubuntu',
  'debian',
  'centos',
  'rhel',
  'rocky',
  'almalinux',
  'suse',
  'windows',
  'windows_server',
  'macos',
  'freebsd',
  'other',
])
export const HostOperatingSystemSchema = HostOperatingSystemValueSchema.default('unknown')
export const HostConnectionModeValueSchema = z.enum([
  'direct',
  'agent',
  'agent_user',
  'agent_tenant_fallback',
  'private_access_connector',
  'auto',
])
export const HostConnectionModeSchema = HostConnectionModeValueSchema.default('direct')
export const HostStartupSnippetModeSchema = z.enum(['disabled', 'suggest', 'auto']).default('disabled')

export const HostAssociatedLinkOpenModeSchema = z.enum([
  'new_tab',
  'same_tab',
]).default('new_tab')

export const HostAssociatedLinkSourceTypeSchema = z.enum([
  'manual',
  'integration',
  'derived',
]).default('manual')

export const HostAssociatedLinkSourceStatusSchema = z.enum([
  'manual',
  'synced',
  'stale',
  'error',
]).default('manual')

export const HostAssociatedLinkSchema = z.object({
  id: z.number().int().positive().optional(),
  label: z.string().min(1).max(120),
  urlTemplate: z.string().min(1).max(2000),
  position: z.number().int().min(0).max(999).default(0),
  enabled: z.boolean().default(true),
  openMode: HostAssociatedLinkOpenModeSchema.default('new_tab'),
  sourceType: HostAssociatedLinkSourceTypeSchema.default('manual'),
  sourceProvider: z.string().min(1).max(80).nullable().optional(),
  sourceRef: z.string().min(1).max(255).nullable().optional(),
  sourceStatus: HostAssociatedLinkSourceStatusSchema.default('manual'),
  sourceUpdatedAt: z.coerce.date().nullable().optional(),
})

export const CreateHostSchema = z.object({
  name:           z.string().min(1).max(100),
  description:    z.string().max(1000).nullable().optional(),
  ip:             z.string().min(7).max(45),
  port:           z.number().int().min(1).max(65535).default(22),
  accessProtocol: HostAccessProtocolSchema,
  operatingSystem: HostOperatingSystemSchema,
  sshUser:        z.string().max(64).default(''),
  authType:       AuthTypeSchema,
  connectionMode: HostConnectionModeSchema,
  privateAccessConnectorId: z.number().int().positive().nullable().optional(),
  scope:          HostScopeSchema.default('personal'),
  groupId:        z.number().int().positive().optional(),
  folderId:       z.number().int().positive().optional(),
  inventoryParentId: z.number().int().positive(),
  bastionId:      z.number().int().positive().optional(),
  password:       z.string().optional(),
  pemKeyId:       z.number().int().positive().optional(),
  onePasswordRef: z.string().max(500).optional(),
  startupSnippetId: z.number().int().positive().nullable().optional(),
  startupSnippetMode: HostStartupSnippetModeSchema.optional(),
  tagNames:       z.string().array().max(20).optional(),
  associatedLinks: z.array(HostAssociatedLinkSchema).max(20).optional(),
})

export const HostPublicSchema = z.object({
  id:             z.number(),
  tenantId:       z.number(),
  name:           z.string(),
  description:    z.string().nullable(),
  ip:             z.string(),
  port:           z.number(),
  accessProtocol: HostAccessProtocolSchema,
  operatingSystem: HostOperatingSystemSchema,
  sshUser:        z.string(),
  authType:       AuthTypeSchema,
  connectionMode: HostConnectionModeSchema,
  privateAccessConnectorId: z.number().nullable().optional(),
  scope:          HostScopeSchema,
  groupId:        z.number().nullable(),
  folderId:       z.number().nullable(),
  inventoryNodeId: z.number().int().positive().nullable().optional(),
  inventoryParentId: z.number().int().positive().nullable().optional(),
  inventoryParentName: z.string().nullable().optional(),
  bastionId:      z.number().nullable(),
  pemKeyId:       z.number().nullable().optional(),
  hasPasswordCredential: z.boolean().optional(),
  effectiveBastionId:     z.number().nullable(),
  effectiveBastionName:   z.string().nullable(),
  effectiveBastionSource: z.enum(['host', 'group', 'none']),
  onePasswordRef: z.string().nullable(),
  startupSnippetId: z.number().int().positive().nullable().optional(),
  startupSnippetMode: HostStartupSnippetModeSchema.optional(),
  trustedHostKeyFingerprint: z.string().nullable(),
  trustedHostKeyVerifiedAt: z.coerce.date().nullable(),
  tags:           z.array(TagPublicSchema),
  associatedLinks: z.array(HostAssociatedLinkSchema).optional(),
  accessPermissions: z.object({
    view: z.boolean(),
    connect: z.boolean(),
    edit: z.boolean(),
    admin: z.boolean(),
  }).optional(),
  createdAt:      z.coerce.date(),
})

export const TestConnectionSchema = z.object({
  ip:        z.string().min(1),
  port:      z.number().int().min(1).max(65535),
  accessProtocol: HostAccessProtocolSchema,
  sshUser:   z.string().default(''),
  authType:  AuthTypeSchema,
  connectionMode: HostConnectionModeSchema.default('direct'),
  privateAccessConnectorId: z.number().int().positive().nullable().optional(),
  password:  z.string().optional(),
  pemKeyId:  z.number().int().positive().optional(),
  hostId:    z.number().int().positive().optional(),
  agentId:   z.number().int().positive().optional(),
  bastionId: z.number().int().positive().optional(),
  groupId:   z.number().int().positive().optional(),
})

export const TestConnectionResultSchema = z.object({
  success:   z.boolean(),
  latencyMs: z.number().nullable(),
  message:   z.string(),
  route: z.enum(['direct', 'user_agent', 'tenant_agent', 'private_access_connector']).optional(),
  routeLabel: z.string().optional(),
  agentName: z.string().nullable().optional(),
  agentSource: z.enum(['user', 'tenant', 'private_access']).nullable().optional(),
  fallbackUsed: z.boolean().optional(),
  failureStep: z.enum(['agent', 'bastion', 'ssh', 'tcp', 'credential', 'validation']).nullable().optional(),
})

export const TrustHostKeySchema = z.object({
  fingerprint: z.string().min(1).max(255),
})

export const ImportHostAssociatedLinksFromOnePasswordSchema = z.object({
  ref: z.string().min(1).max(500),
})

export const HostBulkFilterSchema = z.object({
  search: z.string().max(120).optional(),
  scope: HostScopeSchema.optional(),
  groupId: z.number().int().positive().optional(),
  folderId: z.number().int().positive().nullable().optional(),
  tagId: z.number().int().positive().optional(),
  unfiled: z.boolean().optional(),
  bastionId: z.number().int().positive().nullable().optional(),
  pemKeyId: z.number().int().positive().nullable().optional(),
  authType: AuthTypeSchema.optional(),
  accessProtocol: HostAccessProtocolValueSchema.optional(),
  operatingSystem: HostOperatingSystemValueSchema.optional(),
  connectionMode: HostConnectionModeValueSchema.optional(),
})

export const HostBulkSelectionSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('ids'),
    hostIds: z.array(z.number().int().positive()).min(1).max(500),
  }),
  z.object({
    mode: z.literal('filter'),
    filter: HostBulkFilterSchema,
  }),
])

export const HostBulkActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('set_bastion'),
    bastionId: z.number().int().positive().nullable(),
  }),
  z.object({
    type: z.literal('set_pem_key'),
    pemKeyId: z.number().int().positive().nullable(),
  }),
  z.object({
    type: z.literal('add_tags'),
    tagIds: z.array(z.number().int().positive()).min(1).max(20),
  }),
  z.object({
    type: z.literal('remove_tags'),
    tagIds: z.array(z.number().int().positive()).min(1).max(20),
  }),
  z.object({
    type: z.literal('move_inventory'),
    inventoryParentId: z.number().int().positive(),
  }),
])

export const HostBulkRollbackActionSchema = z.object({
  type: z.literal('rollback'),
  historyId: z.number().int().positive(),
})

export const HostBulkHistoryActionSchema = z.union([HostBulkActionSchema, HostBulkRollbackActionSchema])

export const HostBulkPreviewSchema = z.object({
  selection: HostBulkSelectionSchema,
  action: HostBulkActionSchema,
})

export const HostBulkApplySchema = HostBulkPreviewSchema.extend({
  confirm: z.literal(true),
})

export const HostBulkPreviewRowSchema = z.object({
  hostId: z.number().int().positive(),
  name: z.string(),
  ip: z.string(),
  port: z.number().int(),
  currentBastionId: z.number().int().positive().nullable(),
  currentBastionName: z.string().nullable(),
  currentPemKeyId: z.number().int().positive().nullable(),
  currentPemKeyName: z.string().nullable(),
  currentInventoryParentId: z.number().int().positive().nullable(),
  currentInventoryParentName: z.string().nullable(),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
})

export const HostBulkPreviewResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  sample: z.array(HostBulkPreviewRowSchema),
  blocked: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
  actionLabel: z.string(),
})

export const HostBulkApplyRowSchema = z.object({
  hostId: z.number().int().positive(),
  name: z.string(),
  status: z.enum(['updated', 'skipped', 'failed']),
  message: z.string(),
  before: z.record(z.unknown()).optional(),
  after: z.record(z.unknown()).optional(),
})

export const HostBulkApplyResponseSchema = z.object({
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  rows: z.array(HostBulkApplyRowSchema),
})

export const HostBulkActionHistoryItemSchema = z.object({
  id: z.number().int().positive(),
  actorName: z.string(),
  actorEmail: z.string(),
  actionType: z.enum(['set_bastion', 'set_pem_key', 'add_tags', 'remove_tags', 'move_inventory', 'rollback']),
  actionLabel: z.string(),
  selection: HostBulkSelectionSchema,
  action: HostBulkHistoryActionSchema,
  requested: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  rows: z.array(HostBulkApplyRowSchema),
  createdAt: z.coerce.date(),
  reversible: z.boolean(),
})

export const HostBulkActionHistoryResponseSchema = z.object({
  data: z.array(HostBulkActionHistoryItemSchema),
})

export const HostKeyTrustEventSchema = z.object({
  action: z.enum(['HOST_KEY_TRUSTED', 'HOST_KEY_UPDATED']),
  adminName: z.string(),
  previousFingerprint: z.string().nullable(),
  nextFingerprint: z.string().nullable(),
  timestamp: z.coerce.date(),
})

export type HostScope            = z.infer<typeof HostScopeSchema>
export type AuthType             = z.infer<typeof AuthTypeSchema>
export type HostConnectionMode   = z.infer<typeof HostConnectionModeSchema>
export type HostOperatingSystem  = z.infer<typeof HostOperatingSystemSchema>
export type HostAssociatedLinkOpenMode = z.infer<typeof HostAssociatedLinkOpenModeSchema>
export type HostAssociatedLinkSourceType = z.infer<typeof HostAssociatedLinkSourceTypeSchema>
export type HostAssociatedLinkSourceStatus = z.infer<typeof HostAssociatedLinkSourceStatusSchema>
export type HostAssociatedLink = z.infer<typeof HostAssociatedLinkSchema>
export type CreateHostDto        = z.infer<typeof CreateHostSchema>
export type HostPublic           = z.infer<typeof HostPublicSchema>
export type HostAccessProtocol   = z.infer<typeof HostAccessProtocolSchema>
export type TestConnectionDto    = z.infer<typeof TestConnectionSchema>
export type TestConnectionResult = z.infer<typeof TestConnectionResultSchema>
export type TrustHostKeyDto      = z.infer<typeof TrustHostKeySchema>
export type HostKeyTrustEvent    = z.infer<typeof HostKeyTrustEventSchema>
export type ImportHostAssociatedLinksFromOnePasswordDto = z.infer<typeof ImportHostAssociatedLinksFromOnePasswordSchema>
export type HostBulkFilter = z.infer<typeof HostBulkFilterSchema>
export type HostBulkSelection = z.infer<typeof HostBulkSelectionSchema>
export type HostBulkAction = z.infer<typeof HostBulkActionSchema>
export type HostBulkRollbackAction = z.infer<typeof HostBulkRollbackActionSchema>
export type HostBulkHistoryAction = z.infer<typeof HostBulkHistoryActionSchema>
export type HostBulkPreviewDto = z.infer<typeof HostBulkPreviewSchema>
export type HostBulkApplyDto = z.infer<typeof HostBulkApplySchema>
export type HostBulkPreviewRow = z.infer<typeof HostBulkPreviewRowSchema>
export type HostBulkPreviewResponse = z.infer<typeof HostBulkPreviewResponseSchema>
export type HostBulkApplyRow = z.infer<typeof HostBulkApplyRowSchema>
export type HostBulkApplyResponse = z.infer<typeof HostBulkApplyResponseSchema>
export type HostBulkActionHistoryItem = z.infer<typeof HostBulkActionHistoryItemSchema>
export type HostBulkActionHistoryResponse = z.infer<typeof HostBulkActionHistoryResponseSchema>
