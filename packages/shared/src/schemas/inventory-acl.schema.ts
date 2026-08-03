import { z } from 'zod'
import { InventoryNodePublicSchema } from './inventory.schema.js'

export const AclPrincipalTypeSchema = z.enum(['USER', 'GROUP', 'ROLE'])

export const INVENTORY_ACL_ROLE_IDS = {
  USER: 1,
  ADMIN: 2,
} as const

export const InventoryPermissionsSchema = z.object({
  view: z.boolean(),
  connect: z.boolean(),
  edit: z.boolean(),
  admin: z.boolean(),
})

export const UpsertInventoryAclEntrySchema = z.object({
  principalType: AclPrincipalTypeSchema,
  principalId: z.number().int().positive(),
  permissions: InventoryPermissionsSchema,
}).refine(
  ({ permissions }) => Object.values(permissions).some(Boolean),
  { message: 'Ao menos uma permissão deve ser concedida', path: ['permissions'] },
)

export const InventoryAclImpactPreviewSchema = z.object({
  action: z.enum(['upsert', 'delete']),
  principalType: AclPrincipalTypeSchema,
  principalId: z.number().int().positive(),
  permissions: InventoryPermissionsSchema.optional(),
})

export const InventoryAclImpactPreviewResultSchema = z.object({
  inventoryNodeId: z.number().int().positive(),
  action: z.enum(['upsert', 'delete']),
  principalType: AclPrincipalTypeSchema,
  principalId: z.number().int().positive(),
  affectedHostCount: z.number().int().nonnegative(),
  activeSessionCount: z.number().int().nonnegative(),
  mayRevokeConnect: z.boolean(),
  before: InventoryPermissionsSchema.nullable(),
  after: InventoryPermissionsSchema.nullable(),
})

export const EffectiveInventoryPermissionsSchema = InventoryPermissionsSchema.extend({
  explanation: z.object({
    access: z.enum(['none', 'view', 'connect', 'edit', 'admin']),
    sourceCount: z.number().int().nonnegative(),
    localSourceCount: z.number().int().nonnegative(),
    inheritedSourceCount: z.number().int().nonnegative(),
    principalTypes: z.array(AclPrincipalTypeSchema),
  }),
  sources: z.array(z.object({
    aclEntryId: z.number().int().positive(),
    inventoryNodeId: z.number().int().positive(),
    inventoryNodeName: z.string(),
    principalType: AclPrincipalTypeSchema,
    principalId: z.number().int().positive(),
    principalName: z.string(),
    permissions: InventoryPermissionsSchema,
    local: z.boolean(),
    inheritToChildren: z.boolean(),
  })),
})

export const InventoryAclEntryPublicSchema = z.object({
  id: z.number().int().positive(),
  inventoryNodeId: z.number().int().positive(),
  inventoryNodeName: z.string(),
  principalType: AclPrincipalTypeSchema,
  principalId: z.number().int().positive(),
  principalName: z.string(),
  permissions: InventoryPermissionsSchema,
  inheritToChildren: z.boolean(),
  local: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

export const EffectiveHostInventoryPermissionsSchema = EffectiveInventoryPermissionsSchema.extend({
  inventoryNode: InventoryNodePublicSchema,
})

export type AclPrincipalType = z.infer<typeof AclPrincipalTypeSchema>
export type InventoryPermissions = z.infer<typeof InventoryPermissionsSchema>
export type UpsertInventoryAclEntryDto = z.infer<typeof UpsertInventoryAclEntrySchema>
export type InventoryAclImpactPreviewDto = z.infer<typeof InventoryAclImpactPreviewSchema>
export type InventoryAclImpactPreviewResult = z.infer<typeof InventoryAclImpactPreviewResultSchema>
export type EffectiveInventoryPermissions = z.infer<typeof EffectiveInventoryPermissionsSchema>
export type EffectiveHostInventoryPermissions = z.infer<typeof EffectiveHostInventoryPermissionsSchema>
export type InventoryAclEntryPublic = z.infer<typeof InventoryAclEntryPublicSchema>
