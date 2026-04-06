import { z } from 'zod'

export const SftpEntrySchema = z.object({
  name:        z.string(),
  path:        z.string(),
  type:        z.enum(['file', 'directory', 'symlink']),
  size:        z.number(),
  permissions: z.string(),
  owner:       z.number(),
  group:       z.number(),
  modifiedAt:  z.string(),
})

export type SftpEntry = z.infer<typeof SftpEntrySchema>

export const SftpListResponseSchema = z.object({
  entries: z.array(SftpEntrySchema),
  path:    z.string(),
})

export type SftpListResponse = z.infer<typeof SftpListResponseSchema>
