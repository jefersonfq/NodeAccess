import api from './api'
import { cacheTtls } from './cache-ttl.service'
import { createTimedPromiseCache } from './service-cache'
import type {
  IntegrationPublic,
  UpsertOnePasswordDto,
  UpsertGoogleDto,
  UpsertOpenAiDto,
  UpsertLocalAiDto,
  UpsertJiraDto,
  GoogleConfigPublic,
  OpenAiConfigPublic,
  LocalAiConfigPublic,
  OpenAiTestResult,
  LocalAiTestResult,
  JiraConfigPublic,
  JiraTestResult,
  JiraTicketPublic,
} from '@nodeaccess/shared'

type LocalAiActivityItem = {
  id: number
  action: 'TEST_LOCAL_AI' | 'OPEN_LOCAL_AI_DIAGNOSTIC'
  adminName: string
  timestamp: string
  details?: string | null
}

const integrationsListCache = createTimedPromiseCache<{ data: IntegrationPublic[] }>(cacheTtls.integrationsList, { name: 'integrations:list' })
const googleConfigCache = createTimedPromiseCache<{ data: GoogleConfigPublic }>(cacheTtls.integrationsGoogle, { name: 'integrations:google' })
const openAiConfigCache = createTimedPromiseCache<{ data: OpenAiConfigPublic }>(cacheTtls.integrationsOpenAi, { name: 'integrations:openai' })
const localAiConfigCache = createTimedPromiseCache<{ data: LocalAiConfigPublic }>(cacheTtls.integrationsLocalAi, { name: 'integrations:local-ai' })
const jiraConfigCache = createTimedPromiseCache<{ data: JiraConfigPublic }>(cacheTtls.integrationsJira, { name: 'integrations:jira' })

export const integrationService = {
  list:              ()                          => integrationsListCache.get(() => api.get<IntegrationPublic[]>('/integrations')),
  upsertOnePassword: (dto: UpsertOnePasswordDto) => api.put<IntegrationPublic>('/integrations/onepassword', dto).then((res) => {
    integrationsListCache.clear()
    return res
  }),

  getGoogle:    ()                    => googleConfigCache.get(() => api.get<GoogleConfigPublic>('/integrations/google')),
  upsertGoogle: (dto: UpsertGoogleDto) => api.put<GoogleConfigPublic>('/integrations/google', dto).then((res) => {
    googleConfigCache.clear()
    integrationsListCache.clear()
    return res
  }),
  syncGoogle:   ()                    => api.post<{ synced: number; deactivated: number }>('/integrations/google/sync'),

  getOpenAi:    ()                    => openAiConfigCache.get(() => api.get<OpenAiConfigPublic>('/integrations/openai')),
  upsertOpenAi: (dto: UpsertOpenAiDto) => api.put<OpenAiConfigPublic>('/integrations/openai', dto).then((res) => {
    openAiConfigCache.clear()
    integrationsListCache.clear()
    return res
  }),
  getLocalAi:    ()                     => localAiConfigCache.get(() => api.get<LocalAiConfigPublic>('/integrations/local-ai')),
  upsertLocalAi: (dto: UpsertLocalAiDto) => api.put<LocalAiConfigPublic>('/integrations/local-ai', dto).then((res) => {
    localAiConfigCache.clear()
    integrationsListCache.clear()
    return res
  }),
  testLocalAi:   ()                     => api.post<LocalAiTestResult>('/integrations/local-ai/test').then((res) => {
    localAiConfigCache.clear()
    return res
  }),
  openLocalAiLink: ()                   => api.post<{ url: string; expiresIn: string }>('/integrations/local-ai/open-link'),
  getLocalAiActivity: ()                => api.get<LocalAiActivityItem[]>('/integrations/local-ai/activity'),
  testOpenAi:   ()                    => api.post<OpenAiTestResult>('/integrations/openai/test').then((res) => {
    openAiConfigCache.clear()
    return res
  }),

  getJira:      ()                    => jiraConfigCache.get(() => api.get<JiraConfigPublic>('/integrations/jira')),
  upsertJira:   (dto: UpsertJiraDto)  => api.put<JiraConfigPublic>('/integrations/jira', dto).then((res) => {
    jiraConfigCache.clear()
    integrationsListCache.clear()
    return res
  }),
  testJira:     ()                    => api.post<JiraTestResult>('/integrations/jira/test').then((res) => {
    jiraConfigCache.clear()
    return res
  }),
  getJiraTicket:(key: string)         => api.get<JiraTicketPublic>(`/integrations/jira/tickets/${encodeURIComponent(key)}`),
  clear() {
    integrationsListCache.clear()
    googleConfigCache.clear()
    openAiConfigCache.clear()
    localAiConfigCache.clear()
    jiraConfigCache.clear()
  },
}
