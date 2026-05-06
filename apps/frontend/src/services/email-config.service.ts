import api from './api'

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

export const emailConfigService = {
  get: () =>
    api.get<EmailConfigPublic | null>('/email-config'),

  upsert: (data: EmailConfigInput) =>
    api.put<EmailConfigPublic>('/email-config', data),

  test: (email?: string) =>
    api.post('/email-config/test', { email }),

  testCredentials: (data: EmailConfigInput & { email?: string }) =>
    api.post('/email-config/test-credentials', data),

  remove: () =>
    api.delete('/email-config'),
}
