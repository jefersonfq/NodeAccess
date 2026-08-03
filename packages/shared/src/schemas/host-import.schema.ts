import { z } from 'zod'
import { AclPrincipalTypeSchema, InventoryPermissionsSchema } from './inventory-acl.schema.js'
import { HostAccessProtocolValueSchema } from './host.schema.js'

export const GuacamoleImportDraftSchema = z.object({
  sourceId: z.string().min(1).max(255),
  name: z.string().trim().min(1).max(100),
  ip: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  accessProtocol: HostAccessProtocolValueSchema,
  sshUser: z.string().max(64).default(''),
  password: z.string().max(16384).optional(),
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

export const GuacamoleImportPreviewRequestSchema = z.object({
  destinationId: z.number().int().positive(),
  preserveHierarchy: z.boolean().default(true),
  importCredentials: z.boolean().default(false),
  hosts: z.array(GuacamoleImportDraftSchema).min(1).max(5000),
  aclMappings: z.array(GuacamoleAclMappingSchema).max(500).default([]),
  sourceStats: z.object({
    invalidConnections: z.number().int().nonnegative().default(0),
    unsupportedProtocols: z.array(z.string().max(40)).max(50).default([]),
    unmappedPermissions: z.number().int().nonnegative().default(0),
  }),
})

export const GuacamoleImportPreviewResponseSchema = z.object({
  previewId: z.string().uuid(),
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
  }),
  report: z.array(z.object({
    sourceId: z.string(),
    name: z.string(),
    status: z.enum(['ready', 'blocked']),
    destinationPath: z.string(),
    warnings: z.array(z.string()),
  })),
})

export const GuacamoleImportCommitRequestSchema = z.object({
  previewId: z.string().uuid(),
  confirm: z.literal(true),
})

export const GuacamoleImportCommitResponseSchema = z.object({
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
    status: z.enum(['created', 'rolled_back', 'failed']),
    message: z.string(),
  })),
})

export type GuacamoleImportDraft = z.infer<typeof GuacamoleImportDraftSchema>
export type GuacamoleAclMapping = z.infer<typeof GuacamoleAclMappingSchema>
export type GuacamoleImportPreviewRequest = z.infer<typeof GuacamoleImportPreviewRequestSchema>
export type GuacamoleImportPreviewResponse = z.infer<typeof GuacamoleImportPreviewResponseSchema>
export type GuacamoleImportCommitRequest = z.infer<typeof GuacamoleImportCommitRequestSchema>
export type GuacamoleImportCommitResponse = z.infer<typeof GuacamoleImportCommitResponseSchema>
