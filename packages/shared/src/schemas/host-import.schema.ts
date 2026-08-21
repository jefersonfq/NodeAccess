import { z } from 'zod'
import { AclPrincipalTypeSchema, InventoryPermissionsSchema } from './inventory-acl.schema.js'
import { HostAccessProtocolValueSchema, HostConnectionModeValueSchema } from './host.schema.js'

export const HostImportSourceSchema = z.enum(['guacamole', 'mobaxterm', 'csv', 'openssh'])
export const HostImportDuplicateStrategySchema = z.enum(['skip', 'create', 'update'])

export const HostImportDraftSchema = z.object({
  sourceId: z.string().min(1).max(255),
  name: z.string().trim().min(1).max(100),
  ip: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  accessProtocol: HostAccessProtocolValueSchema,
  sshUser: z.string().max(64).default(''),
  authType: z.enum(['password', 'pem', 'pem_password']).optional(),
  pemKeyId: z.number().int().positive().optional(),
  bastionId: z.number().int().positive().optional(),
  connectionMode: HostConnectionModeValueSchema.optional(),
  requiresBastion: z.boolean().optional(),
  password: z.string().max(16384).optional(),
  onePasswordRef: z.string().trim().max(500).optional(),
  folderPath: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  warnings: z.array(z.string().max(120)).max(20).default([]),
})

export const GuacamoleAclMappingSchema = z.object({
  sourcePrincipal: z.string().trim().min(1).max(255),
  principalType: AclPrincipalTypeSchema,
  principalId: z.number().int().positive(),
  folderPath: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  permissions: InventoryPermissionsSchema,
})

export const HostImportPreviewRequestSchema = z.object({
  source: HostImportSourceSchema,
  destinationId: z.number().int().positive(),
  preserveHierarchy: z.boolean().default(true),
  importCredentials: z.boolean().default(false),
  duplicateStrategy: HostImportDuplicateStrategySchema.optional(),
  unresolvedBastionPolicy: z.enum(['block', 'allow']).optional(),
  hosts: z.array(HostImportDraftSchema).min(1).max(5000),
  aclMappings: z.array(GuacamoleAclMappingSchema).max(500).default([]),
  sourceStats: z.object({
    invalidConnections: z.number().int().nonnegative().default(0),
    unsupportedProtocols: z.array(z.string().max(40)).max(50).default([]),
    unmappedPermissions: z.number().int().nonnegative().default(0),
  }),
})

export const HostImportPreviewResponseSchema = z.object({
  previewId: z.string().uuid(),
  jobId: z.number().int().positive().optional(),
  expiresAt: z.string().datetime(),
  summary: z.object({
    detected: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    foldersToCreate: z.number().int().nonnegative(),
    aclMappings: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    credentialsDetected: z.number().int().nonnegative(),
    credentialsToImport: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
    hostsToCreate: z.number().int().nonnegative(),
    hostsToUpdate: z.number().int().nonnegative(),
    hostsToSkip: z.number().int().nonnegative(),
    privateHostsViaAgent: z.number().int().nonnegative(),
    unresolvedBastions: z.number().int().nonnegative(),
    reversible: z.boolean(),
  }),
  report: z.array(z.object({
    sourceId: z.string(),
    name: z.string(),
    status: z.enum(['ready', 'blocked', 'duplicate']),
    destinationPath: z.string(),
    warnings: z.array(z.string()),
    existingHostId: z.number().int().positive().optional(),
    existingHost: z.object({
      id: z.number().int().positive(),
      name: z.string(),
      ip: z.string(),
      port: z.number().int(),
      sshUser: z.string(),
    }).optional(),
  })),
})

export const HostImportCommitRequestSchema = z.object({
  previewId: z.string().uuid(),
  confirm: z.literal(true),
})

export const HostImportCommitResponseSchema = z.object({
  status: z.enum(['committed', 'rolled_back']),
  createdHosts: z.number().int().nonnegative(),
  createdFolders: z.number().int().nonnegative(),
  createdSecrets: z.number().int().nonnegative(),
  appliedAclMappings: z.number().int().nonnegative(),
  rolledBackHosts: z.number().int().nonnegative(),
  rolledBackFolders: z.number().int().nonnegative(),
  rolledBackSecrets: z.number().int().nonnegative(),
  rows: z.array(z.object({
    sourceId: z.string(),
    name: z.string(),
    status: z.enum(['created', 'updated', 'skipped', 'rolled_back', 'failed']),
    message: z.string(),
    hostId: z.number().int().positive().optional(),
  })),
  importId: z.number().int().positive().optional(),
})

export const HostImportHistoryItemSchema = z.object({
  id: z.number().int().positive(),
  source: HostImportSourceSchema,
  actorName: z.string(),
  timestamp: z.string().datetime(),
  status: z.enum(['committed', 'reverted']),
  createdHosts: z.number().int().nonnegative(),
  updatedHosts: z.number().int().nonnegative(),
  createdFolders: z.number().int().nonnegative(),
  canRevert: z.boolean(),
})

export const HostImportHistoryResponseSchema = z.object({
  items: z.array(HostImportHistoryItemSchema),
  total: z.number().int().nonnegative(),
})

export const HostImportRevertResponseSchema = z.object({
  status: z.enum(['reverted', 'partially_reverted']),
  revertedHosts: z.number().int().nonnegative(),
  revertedFolders: z.number().int().nonnegative(),
  failures: z.array(z.string()),
})

// Compatibility aliases remain exported while callers migrate to the source-neutral contract.
export const GuacamoleImportDraftSchema = HostImportDraftSchema
export const GuacamoleImportPreviewRequestSchema = HostImportPreviewRequestSchema.omit({ source: true })
export const GuacamoleImportPreviewResponseSchema = HostImportPreviewResponseSchema
export const GuacamoleImportCommitRequestSchema = HostImportCommitRequestSchema
export const GuacamoleImportCommitResponseSchema = HostImportCommitResponseSchema

export type HostImportSource = z.infer<typeof HostImportSourceSchema>
export type HostImportDuplicateStrategy = z.infer<typeof HostImportDuplicateStrategySchema>
export type HostImportDraft = z.infer<typeof HostImportDraftSchema>
export type HostImportPreviewRequest = z.infer<typeof HostImportPreviewRequestSchema>
export type HostImportPreviewResponse = z.infer<typeof HostImportPreviewResponseSchema>
export type HostImportCommitRequest = z.infer<typeof HostImportCommitRequestSchema>
export type HostImportCommitResponse = z.infer<typeof HostImportCommitResponseSchema>
export type HostImportHistoryItem = z.infer<typeof HostImportHistoryItemSchema>
export type HostImportHistoryResponse = z.infer<typeof HostImportHistoryResponseSchema>
export type HostImportRevertResponse = z.infer<typeof HostImportRevertResponseSchema>

export type GuacamoleImportDraft = HostImportDraft
export type GuacamoleAclMapping = z.infer<typeof GuacamoleAclMappingSchema>
export type GuacamoleImportPreviewRequest = z.infer<typeof GuacamoleImportPreviewRequestSchema>
export type GuacamoleImportPreviewResponse = HostImportPreviewResponse
export type GuacamoleImportCommitRequest = HostImportCommitRequest
export type GuacamoleImportCommitResponse = HostImportCommitResponse
