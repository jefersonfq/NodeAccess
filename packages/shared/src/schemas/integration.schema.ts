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

export const OpenAiHealthStatusSchema = z.enum([
  'unknown',
  'healthy',
  'unhealthy',
])

export const UpsertOpenAiSchema = z.object({
  enabled:      z.boolean(),
  apiKey:       z.string().min(1).optional(),
  baseUrl:      z.string().url().optional(),
  defaultModel: z.string().min(1),
})

export const UpsertJiraSchema = z.object({
  enabled:             z.boolean(),
  baseUrl:             z.string().url(),
  serviceAccountEmail: z.string().email(),
  apiToken:            z.string().min(1).optional(),
  projectKeys:         z.array(z.string().min(1)).max(50).default([]),
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

export const OpenAiConfigPublicSchema = z.object({
  enabled:       z.boolean(),
  hasApiKey:     z.boolean(),
  baseUrl:       z.string().nullable(),
  defaultModel:  z.string().nullable(),
  healthStatus:  OpenAiHealthStatusSchema,
  healthMessage: z.string().nullable(),
  lastCheckedAt: z.coerce.date().nullable(),
  updatedAt:     z.coerce.date().nullable(),
})

export const OpenAiTestResultSchema = z.object({
  ok:            z.boolean(),
  healthStatus:  OpenAiHealthStatusSchema,
  healthMessage: z.string().nullable(),
  checkedAt:     z.coerce.date(),
})

export const JiraConfigPublicSchema = z.object({
  enabled:             z.boolean(),
  hasApiToken:         z.boolean(),
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
export type UpsertOpenAiDto      = z.infer<typeof UpsertOpenAiSchema>
export type UpsertJiraDto        = z.infer<typeof UpsertJiraSchema>
export type IntegrationPublic    = z.infer<typeof IntegrationPublicSchema>
export type GoogleConfigPublic   = z.infer<typeof GoogleConfigPublicSchema>
export type OpenAiConfigPublic   = z.infer<typeof OpenAiConfigPublicSchema>
export type OpenAiTestResult     = z.infer<typeof OpenAiTestResultSchema>
export type JiraConfigPublic     = z.infer<typeof JiraConfigPublicSchema>
export type JiraTestResult       = z.infer<typeof JiraTestResultSchema>
export type JiraTicketPublic     = z.infer<typeof JiraTicketPublicSchema>
