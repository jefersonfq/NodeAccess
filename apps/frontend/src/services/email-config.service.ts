import api from './api'
import { cacheTtls } from './cache-ttl.service'
import { createTimedPromiseCache } from './service-cache'

export interface EmailConfigPublic {
  id:       number
  provider: string
  host:     string | null
  port:     number | null
  secure:   boolean
  user:     string
  fromName: string
}

export interface EmailConfigInput {
  provider: 'gmail' | 'outlook' | 'smtp'
  host?:    string | null
  port?:    number | null
  secure:   boolean
  user:     string
  password: string
  fromName: string
}

const emailConfigCache = createTimedPromiseCache<{ data: EmailConfigPublic | null }>(cacheTtls.emailConfig, { name: 'settings:email' })

export const emailConfigService = {
  get: () =>
    emailConfigCache.get(() => api.get<EmailConfigPublic | null>('/email-config')),

  upsert: (data: EmailConfigInput) =>
    api.put<EmailConfigPublic>('/email-config', data).then((response) => {
      emailConfigCache.set(response, 'email-config:update')
      return response
    }),

  test: (email?: string) =>
    api.post('/email-config/test', { email }),

  testCredentials: (data: EmailConfigInput & { email?: string }) =>
    api.post('/email-config/test-credentials', data),

  remove: () =>
    api.delete('/email-config').then((response) => {
      emailConfigCache.set({ data: null }, 'email-config:remove')
      return response
    }),
}
