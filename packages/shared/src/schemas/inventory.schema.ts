import { z } from 'zod'

export const InventoryNodeTypeSchema = z.enum(['ROOT', 'FOLDER', 'HOST'])

export const InventoryNodePublicSchema = z.object({
  id: z.number().int().positive(),
  parentId: z.number().int().positive().nullable(),
  type: InventoryNodeTypeSchema,
  hostId: z.number().int().positive().nullable(),
  name: z.string(),
  path: z.string(),
  depth: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

export const CreateInventoryFolderSchema = z.object({
  parentId: z.number().int().positive(),
  name: z.string().trim().min(1).max(120),
})

export const UpdateInventoryFolderSchema = z.object({
  name: z.string().trim().min(1).max(120),
})

export const MoveInventoryHostSchema = z.object({
  parentId: z.number().int().positive(),
})

export const MoveInventoryFolderSchema = z.object({
  parentId: z.number().int().positive(),
})

export const InventoryIntegrityReportSchema = z.object({
  hostsWithoutInventoryNode: z.object({
    total: z.number().int().nonnegative(),
    sample: z.array(z.object({
      id: z.number().int().positive(),
      name: z.string(),
      ip: z.string(),
    })),
    sampleLimit: z.number().int().positive(),
  }),
})

export const InventoryIntegrityRepairResultSchema = z.object({
  repairedHosts: z.number().int().nonnegative(),
  report: InventoryIntegrityReportSchema,
})

export type InventoryNodeType = z.infer<typeof InventoryNodeTypeSchema>
export type InventoryNodePublic = z.infer<typeof InventoryNodePublicSchema>
export type CreateInventoryFolderDto = z.infer<typeof CreateInventoryFolderSchema>
export type UpdateInventoryFolderDto = z.infer<typeof UpdateInventoryFolderSchema>
export type MoveInventoryHostDto = z.infer<typeof MoveInventoryHostSchema>
export type MoveInventoryFolderDto = z.infer<typeof MoveInventoryFolderSchema>
export type InventoryIntegrityReport = z.infer<typeof InventoryIntegrityReportSchema>
export type InventoryIntegrityRepairResult = z.infer<typeof InventoryIntegrityRepairResultSchema>
