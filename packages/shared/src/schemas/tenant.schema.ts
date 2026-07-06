import { z } from 'zod'

export const TENANT_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const TENANT_SLUG_MESSAGE = 'Use apenas letras minúsculas, números e hífen entre palavras'
export const RESERVED_TENANT_SLUGS = [
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'cdn',
  'dashboard',
  'default',
  'docs',
  'help',
  'login',
  'logout',
  'mail',
  'nodeaccess',
  'root',
  'static',
  'status',
  'support',
  'system',
  'www',
] as const
export const TENANT_SLUG_RESERVED_MESSAGE = 'Este slug é reservado para rotas ou infraestrutura da plataforma'

export const TenantAdminBootstrapSchema = z.object({
  name:  z.string().min(2).max(120),
  email: z.string().email(),
})

export const CreateTenantSchema = z.object({
  name:   z.string().min(2).max(120),
  slug:   z.string()
    .min(2).max(63)
    .regex(TENANT_SLUG_REGEX, TENANT_SLUG_MESSAGE)
    .refine((slug) => !RESERVED_TENANT_SLUGS.includes(slug as typeof RESERVED_TENANT_SLUGS[number]), TENANT_SLUG_RESERVED_MESSAGE),
  active:     z.boolean().default(true),
  maxUsers:   z.number().int().positive().default(50),
  firstAdmin: TenantAdminBootstrapSchema,
})

export const UpdateTenantSchema = z.object({
  name:     z.string().min(2).max(120).optional(),
  slug:     z.string()
    .min(2).max(63)
    .regex(TENANT_SLUG_REGEX, TENANT_SLUG_MESSAGE)
    .refine((slug) => !RESERVED_TENANT_SLUGS.includes(slug as typeof RESERVED_TENANT_SLUGS[number]), TENANT_SLUG_RESERVED_MESSAGE)
    .optional(),
  active:   z.boolean().optional(),
  maxUsers: z.number().int().positive().optional(),
})

export const TenantPublicSchema = z.object({
  id:          z.number(),
  name:        z.string(),
  slug:        z.string(),
  active:      z.boolean(),
  maxUsers:    z.number().nullable(),
  activeUsers: z.number(),
  totalUsers:  z.number(),
  createdAt:   z.coerce.date(),
  updatedAt:   z.coerce.date(),
})

export const CreateTenantResultSchema = z.object({
  tenant: TenantPublicSchema,
  firstAdminTemporaryPassword: z.string().optional(),
})

export const CreateTenantAdminResultSchema = z.object({
  temporaryPassword: z.string(),
})

export const TenantDashboardTenantSchema = z.object({
  tenantId:          z.number(),
  name:              z.string(),
  slug:              z.string(),
  active:            z.boolean(),
  maxUsers:          z.number().nullable(),
  users:             z.number(),
  activeUsers:       z.number(),
  hosts:             z.number(),
  snippets:          z.number(),
  hostLinks:         z.number(),
  associatedLinks:   z.number(),
  bastions:          z.number(),
  pemKeys:           z.number(),
  secrets:           z.number(),
  agents:            z.number(),
  sessionsLast7Days: z.number(),
  activeSessions:    z.number(),
  loginsLast7Days:   z.number(),
  lastLoginAt:       z.coerce.date().nullable(),
})

export const TenantDashboardDailyActivitySchema = z.object({
  date:     z.string(),
  logins:   z.number(),
  sessions: z.number(),
})

export const TenantDashboardSummarySchema = z.object({
  totals: z.object({
    tenants:           z.number(),
    activeTenants:     z.number(),
    users:             z.number(),
    activeUsers:       z.number(),
    hosts:             z.number(),
    resources:         z.number(),
    loginsLast7Days:   z.number(),
    sessionsLast7Days: z.number(),
    activeSessions:    z.number(),
  }),
  tenantUsage:          z.array(TenantDashboardTenantSchema),
  topTenantsByActivity: z.array(TenantDashboardTenantSchema),
  dailyActivity:        z.array(TenantDashboardDailyActivitySchema),
})

export type TenantAdminBootstrapDto = z.infer<typeof TenantAdminBootstrapSchema>
export type CreateTenantDto         = z.infer<typeof CreateTenantSchema>
export type UpdateTenantDto         = z.infer<typeof UpdateTenantSchema>
export type TenantPublic            = z.infer<typeof TenantPublicSchema>
export type CreateTenantResult      = z.infer<typeof CreateTenantResultSchema>
export type CreateTenantAdminResult = z.infer<typeof CreateTenantAdminResultSchema>
export type TenantDashboardTenant   = z.infer<typeof TenantDashboardTenantSchema>
export type TenantDashboardDailyActivity = z.infer<typeof TenantDashboardDailyActivitySchema>
export type TenantDashboardSummary  = z.infer<typeof TenantDashboardSummarySchema>
