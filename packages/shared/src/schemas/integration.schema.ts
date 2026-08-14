import { z } from 'zod'

export const UpsertOnePasswordSchema = z.object({
  enabled:             z.boolean(),
  serviceAccountToken: z.string().min(1).optional(),
})

export const UpsertGoogleSchema = z.object({
  enabled:              z.boolean(),
  clientId:             z.string().min(1),
  adminEmail:           z.string().email().optional(),
  domain:               z.string().optional(),
  syncIntervalMinutes:  z.number().int().min(5).optional(),
  autoProvision:        z.boolean().optional(),
  serviceAccountJson:   z.string().optional(),
})

export const UpsertLdapSchema = z.object({
  enabled:               z.boolean(),
  url:                   z.string().url(),
  bindDn:                z.string().min(1).optional(),
  bindPassword:          z.string().min(1).optional(),
  baseDn:                z.string().min(1),
  userSearchFilter:      z.string().min(1).default('(mail={{email}})'),
  startTls:              z.boolean().optional(),
  tlsRejectUnauthorized: z.boolean().optional(),
  autoProvision:         z.boolean().optional(),
})

export const UpsertOidcSchema = z.object({
  enabled: z.boolean(),
  name: z.string().trim().min(1).max(80),
  issuer: z.string().url(),
  clientId: z.string().trim().min(1).max(255),
  clientSecret: z.string().min(1).optional(),
  scopes: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  allowedDomains: z.array(z.string().trim().min(1).max(255)).max(50).default([]),
  autoProvision: z.boolean().default(false),
  requireMfaClaim: z.boolean().default(false),
  acceptedAmrValues: z.array(z.string().trim().min(1).max(120)).max(20).default(['mfa']),
  acceptedAcrValues: z.array(z.string().trim().min(1).max(255)).max(20).default([]),
}).superRefine((value, context) => {
  if (value.requireMfaClaim && value.acceptedAmrValues.length === 0 && value.acceptedAcrValues.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['acceptedAmrValues'],
      message: 'Informe ao menos um valor AMR ou ACR aceito para exigir MFA',
    })
  }
})

export const RotateOidcClientSecretSchema = z.object({
  clientSecret: z.string().trim().min(8).max(4096),
})

export const CreateOidcGroupMappingSchema = z.object({
  externalGroup: z.string().trim().min(1).max(255),
  groupId: z.number().int().positive(),
})

export const OidcGroupMappingPublicSchema = z.object({
  id: z.number().int().positive(),
  externalGroup: z.string(),
  groupId: z.number().int().positive(),
  groupName: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

export const OpenAiHealthStatusSchema = z.enum([
  'unknown',
  'healthy',
  'unhealthy',
])

export const LocalAiModeSchema = z.enum([
  'read_only',
  'low_impact',
  'full_control',
])

export const LocalAiRoutingPolicySchema = z.enum([
  'local_only',
  'network_only',
  'prefer_local',
  'prefer_network',
])

export const UpsertOpenAiSchema = z.object({
  enabled:      z.boolean(),
  apiKey:       z.string().min(1).optional(),
  baseUrl:      z.string().url().optional(),
  defaultModel: z.string().min(1),
  auditInstructions: z.string().max(4000).optional(),
})

export const UpsertLocalAiSchema = z.object({
  enabled: z.boolean(),
  mode: LocalAiModeSchema,
  routingPolicy: LocalAiRoutingPolicySchema,
  localProvider: z.string().min(1).optional(),
  localBaseUrl: z.string().url().optional(),
  localModel: z.string().min(1).optional(),
  networkProvider: z.string().min(1).optional(),
  networkBaseUrl: z.string().url().optional(),
  networkModel: z.string().min(1).optional(),
  networkApiKey: z.string().min(1).optional(),
  auditInstructions: z.string().max(4000).optional(),
  assistantInstructions: z.string().max(4000).optional(),
})

export const UpsertJiraSchema = z.object({
  enabled:             z.boolean(),
  baseUrl:             z.string().url(),
  serviceAccountEmail: z.string().email().optional(),
  apiToken:            z.string().min(1).optional(),
  projectKeys:         z.array(z.string().min(1)).max(50).default([]),
  ticketRequirement:   z.enum(['optional', 'required']).default('optional'),
  ticketEnforcementMode: z.enum(['off', 'tenant', 'selected']).default('off'),
  ticketUserIds: z.array(z.number().int().positive()).max(1000).default([]),
  ticketGroupIds: z.array(z.number().int().positive()).max(1000).default([]),
  ticketInventoryFolderIds: z.array(z.number().int().positive()).max(1000).default([]),
})

export const IntegrationPublicSchema = z.object({
  provider:  z.string(),
  enabled:   z.boolean(),
  hasToken:  z.boolean(),
  updatedAt: z.coerce.date(),
})

export const GoogleConfigPublicSchema = z.object({
  enabled:              z.boolean(),
  clientId:             z.string().nullable(),
  adminEmail:           z.string().nullable(),
  domain:               z.string().nullable(),
  syncIntervalMinutes:  z.number(),
  autoProvision:        z.boolean(),
  hasServiceAccount:    z.boolean(),
  updatedAt:            z.coerce.date().nullable(),
})

export const LdapConfigPublicSchema = z.object({
  enabled:               z.boolean(),
  url:                   z.string().nullable(),
  bindDn:                z.string().nullable(),
  hasBindPassword:       z.boolean(),
  baseDn:                z.string().nullable(),
  userSearchFilter:      z.string().nullable(),
  startTls:              z.boolean(),
  tlsRejectUnauthorized: z.boolean(),
  autoProvision:         z.boolean(),
  updatedAt:             z.coerce.date().nullable(),
})

export const OidcConfigPublicSchema = z.object({
  licensed: z.boolean(),
  enabled: z.boolean(),
  name: z.string().nullable(),
  issuer: z.string().nullable(),
  clientId: z.string().nullable(),
  hasClientSecret: z.boolean(),
  scopes: z.array(z.string()),
  allowedDomains: z.array(z.string()),
  autoProvision: z.boolean(),
  requireMfaClaim: z.boolean(),
  acceptedAmrValues: z.array(z.string()),
  acceptedAcrValues: z.array(z.string()),
  updatedAt: z.coerce.date().nullable(),
})

export const OpenAiConfigPublicSchema = z.object({
  enabled:       z.boolean(),
  hasApiKey:     z.boolean(),
  baseUrl:       z.string().nullable(),
  defaultModel:  z.string().nullable(),
  auditInstructions: z.string().nullable(),
  healthStatus:  OpenAiHealthStatusSchema,
  healthMessage: z.string().nullable(),
  lastCheckedAt: z.coerce.date().nullable(),
  updatedAt:     z.coerce.date().nullable(),
})

export const LocalAiConfigPublicSchema = z.object({
  enabled: z.boolean(),
  mode: LocalAiModeSchema,
  routingPolicy: LocalAiRoutingPolicySchema,
  localProvider: z.string().nullable(),
  localBaseUrl: z.string().nullable(),
  localModel: z.string().nullable(),
  networkProvider: z.string().nullable(),
  networkBaseUrl: z.string().nullable(),
  networkModel: z.string().nullable(),
  hasNetworkApiKey: z.boolean(),
  auditInstructions: z.string().nullable(),
  assistantInstructions: z.string().nullable(),
  healthStatus: OpenAiHealthStatusSchema,
  healthMessage: z.string().nullable(),
  lastCheckedAt: z.coerce.date().nullable(),
  updatedAt: z.coerce.date().nullable(),
})

export const OpenAiTestResultSchema = z.object({
  ok:            z.boolean(),
  healthStatus:  OpenAiHealthStatusSchema,
  healthMessage: z.string().nullable(),
  checkedAt:     z.coerce.date(),
})

export const LdapTestResultSchema = z.object({
  ok:            z.boolean(),
  healthStatus:  OpenAiHealthStatusSchema,
  healthMessage: z.string().nullable(),
  checkedAt:     z.coerce.date(),
})

export const LocalAiTestResultSchema = z.object({
  ok: z.boolean(),
  healthStatus: OpenAiHealthStatusSchema,
  healthMessage: z.string().nullable(),
  checkedAt: z.coerce.date(),
})

export const JiraConfigPublicSchema = z.object({
  enabled:             z.boolean(),
  hasApiToken:         z.boolean(),
  authMode:            z.enum(['api_token', 'oauth']).nullable(),
  oauthConnected:      z.boolean(),
  oauthSiteName:       z.string().nullable(),
  oauthScopes:         z.array(z.string()),
  ticketRequirement:   z.enum(['optional', 'required']),
  ticketEnforcementMode: z.enum(['off', 'tenant', 'selected']),
  ticketUserIds: z.array(z.number().int().positive()),
  ticketGroupIds: z.array(z.number().int().positive()),
  ticketInventoryFolderIds: z.array(z.number().int().positive()),
  baseUrl:             z.string().nullable(),
  serviceAccountEmail: z.string().nullable(),
  projectKeys:         z.array(z.string()),
  healthStatus:        OpenAiHealthStatusSchema,
  healthMessage:       z.string().nullable(),
  lastCheckedAt:       z.coerce.date().nullable(),
  updatedAt:           z.coerce.date().nullable(),
})

export const JiraTestResultSchema = z.object({
  ok:            z.boolean(),
  healthStatus:  OpenAiHealthStatusSchema,
  healthMessage: z.string().nullable(),
  checkedAt:     z.coerce.date(),
})

export const JiraTicketPublicSchema = z.object({
  key: z.string(),
  url: z.string().url().nullable(),
  summary: z.string(),
  status: z.string().nullable(),
  issueType: z.string().nullable(),
  projectKey: z.string().nullable(),
  projectName: z.string().nullable(),
  assigneeDisplayName: z.string().nullable(),
  labels: z.array(z.string()),
  updatedAt: z.coerce.date().nullable(),
})

export type UpsertOnePasswordDto = z.infer<typeof UpsertOnePasswordSchema>
export type UpsertGoogleDto      = z.infer<typeof UpsertGoogleSchema>
export type UpsertLdapDto        = z.infer<typeof UpsertLdapSchema>
export type UpsertOidcDto        = z.infer<typeof UpsertOidcSchema>
export type RotateOidcClientSecretDto = z.infer<typeof RotateOidcClientSecretSchema>
export type CreateOidcGroupMappingDto = z.infer<typeof CreateOidcGroupMappingSchema>
export type OidcGroupMappingPublic = z.infer<typeof OidcGroupMappingPublicSchema>
export type UpsertOpenAiDto      = z.infer<typeof UpsertOpenAiSchema>
export type UpsertLocalAiDto     = z.infer<typeof UpsertLocalAiSchema>
export type UpsertJiraDto        = z.infer<typeof UpsertJiraSchema>
export type IntegrationPublic    = z.infer<typeof IntegrationPublicSchema>
export type GoogleConfigPublic   = z.infer<typeof GoogleConfigPublicSchema>
export type LdapConfigPublic     = z.infer<typeof LdapConfigPublicSchema>
export type OidcConfigPublic     = z.infer<typeof OidcConfigPublicSchema>
export type OpenAiConfigPublic   = z.infer<typeof OpenAiConfigPublicSchema>
export type LocalAiConfigPublic  = z.infer<typeof LocalAiConfigPublicSchema>
export type OpenAiTestResult     = z.infer<typeof OpenAiTestResultSchema>
export type LdapTestResult       = z.infer<typeof LdapTestResultSchema>
export type LocalAiTestResult    = z.infer<typeof LocalAiTestResultSchema>
export type JiraConfigPublic     = z.infer<typeof JiraConfigPublicSchema>
export type JiraTestResult       = z.infer<typeof JiraTestResultSchema>
export type JiraTicketPublic     = z.infer<typeof JiraTicketPublicSchema>
