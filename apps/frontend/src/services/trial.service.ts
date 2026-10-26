import axios, { type AxiosResponse } from 'axios'
import api from './api'

export interface TrialProfile {
  experience?: 'full' | 'guided'
  maxAiRequests?: number
  maxAiConcurrentRequests?: number
  features?: Record<string, boolean>
  integrations?: Record<string, boolean>
  name: string
  durationDays: number
  maxUsers: number
  maxHosts: number
  machineCount: number
  maxMachines?: number
  allowCustomHosts?: boolean
  maxCustomHosts?: number
  templateId: string
  privacyUrl: string
  termsUrl: string
  privacyVersion: string
  maxActiveTrials: number
  expiryNoticeHours?: number
  retentionDays: number
  networkCidr: string
  maxSessions: number
  resources?: ('ssh' | 'sftp' | 'sharing' | 'audit')[]
}
export interface TrialCustomHost {
  id: number
  name: string
  ip: string
  port: number
  sshUser: string
  authType: 'password' | 'pem'
}
export interface TrialCustomHostInput {
  name: string
  ip: string
  port: number
  sshUser: string
  authType: 'password' | 'pem'
  password?: string
  privateKey?: string
  passphrase?: string
}
export interface TrialResources {
  customHosts?: TrialCustomHost[]
  machineCount: number
  requestedMachines: number
  maxMachines: number
  customHostCount: number
  maxCustomHosts: number
  allowCustomHosts: boolean
  maxHosts: number
  provisioning: boolean
  error: string | null
}
export interface TrialPublicConfig {
  enabled: boolean
  privacyUrl: string
  termsUrl: string
  privacyVersion: string
  profile: Pick<TrialProfile, 'name' | 'durationDays' | 'maxUsers' | 'maxHosts'> & Partial<Pick<TrialProfile, 'retentionDays' | 'machineCount' | 'maxMachines' | 'allowCustomHosts' | 'maxCustomHosts' | 'maxSessions' | 'resources'>>
}
export interface TrialPreferences { marketingConsent: boolean; researchConsent: boolean }
export interface TrialStatus extends TrialPreferences {
  owner: boolean
  consentRequired?: boolean
  privacyVersion?: string
  privacyUrl?: string
  termsUrl?: string
  maxUsers: number
  users: number
  status: string
  expiresAt: string | null
  tenantSlug: string | null
  activated: boolean
  message?: string
}
export interface TrialAdminRow { id: string; email: string; phone?: string | null; name: string; status: string; expiresAt: string | null; verifiedAt?: string | null; tenantId?: number | null }

// Public onboarding must neither borrow nor refresh an existing application's JWT.
// Its opaque capability is explicitly supplied and scoped only to the trial APIs.
const publicApi = axios.create({ baseURL: '/api/v1/trials/public', timeout: 30_000, headers: { 'Content-Type': 'application/json' } })
const authorization = (token: string): { headers: { Authorization: string } } => ({ headers: { Authorization: `Bearer ${token}` } })
export const trialService = {
  createHost: (body: TrialCustomHostInput): Promise<AxiosResponse<{ id: number }>> => api.post('/trials/me/hosts', body),
  updateHost: (id: number, body: TrialCustomHostInput): Promise<AxiosResponse<{ id: number }>> => api.put(`/trials/me/hosts/${id}`, body),
  deleteHost: (id: number): Promise<AxiosResponse<unknown>> => api.delete(`/trials/me/hosts/${id}`),
  resources: (): Promise<TrialResources> => api.get<TrialResources>('/trials/me/resources').then(r => ({ ...r.data, customHosts: r.data.customHosts?.map(host => ({ ...host, authType: host.authType.toLowerCase() as TrialCustomHost['authType'] })) })),
  requestMachines: (count: number): Promise<AxiosResponse<unknown>> => api.post('/trials/me/machines', { count }),
  config: (): Promise<TrialPublicConfig> => publicApi.get<TrialPublicConfig>('/config').then(r => r.data),
  register: (body: TrialPreferences & { name: string; email: string; phone?: string; termsAccepted: true; privacyVersion: string }): Promise<{ message: string }> => publicApi.post<{ message: string }>('/register', body).then(r => r.data),
  verify: (token: string): Promise<{ accessToken: string }> => publicApi.post<{ accessToken: string }>('/verify', { token }).then(r => r.data),
  status: (token: string): Promise<TrialStatus> => publicApi.get<TrialStatus>('/status', authorization(token)).then(r => r.data),
  activate: (token: string, password: string, consent?: TrialPreferences & { termsAccepted: true; privacyVersion: string }): Promise<{ tenantSlug: string }> => publicApi.post<{ tenantSlug: string }>('/activate', { password, ...consent }, authorization(token)).then(r => r.data),
  preferences: (token: string, body: TrialPreferences): Promise<AxiosResponse<unknown>> => publicApi.post('/preferences', body, authorization(token)),
  invite: (token: string, body: { name: string; email: string }): Promise<{ message: string }> => publicApi.post<{ message: string }>('/invite', body, authorization(token)).then(r => r.data),
  cancel: (token: string): Promise<AxiosResponse<unknown>> => publicApi.post('/cancel', {}, authorization(token)),
  list: (): Promise<{ trials: TrialAdminRow[]; profile: TrialProfile | null; provisionerReady?: boolean }> => api.get<{ trials: TrialAdminRow[]; profile: TrialProfile | null; provisionerReady?: boolean }>('/platform/trials').then(r => r.data),
  saveProfile: (profile: TrialProfile): Promise<AxiosResponse<unknown>> => api.put('/platform/trials/profile', profile),
  cancelAdmin: (id: string): Promise<AxiosResponse<unknown>> => api.post(`/platform/trials/${encodeURIComponent(id)}/cancel`),
}

export const TRIAL_ACCESS_KEY = 'na_trial_access'
export { trialPhoneError } from './trial-registration'
export function takeTrialVerificationToken(location: Pick<Location, 'hash' | 'pathname' | 'search'>, history: Pick<History, 'replaceState'>): string | null {
  const token = new URLSearchParams(location.hash.replace(/^#/, '')).get('token')
  if (token !== null) history.replaceState(null, '', location.pathname + location.search)
  return token
}
export function trialError(error: unknown, fallback: string): string {
  if (axios.isAxiosError<{ message?: unknown }>(error)) {
    if (error.response?.status === 429) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
    if (error.response?.status === 401 || error.response?.status === 410) return 'Este link expirou ou já foi utilizado. Solicite um novo acesso pelo formulário.'
    if (!error.response || error.response.status >= 500) return 'Não foi possível concluir agora. Seus dados continuam nesta tela; tente novamente.'
    const message = error.response.data?.message
    if (typeof message === 'string' && message.length <= 300) return message
  }
  return fallback
}
export function trialStateLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: 'Confirme seu e-mail', pending_email: 'Confirme seu e-mail', pending_verification: 'Confirme seu e-mail',
    verified: 'Cadastro confirmado', queued: 'Aguardando disponibilidade', provisioning: 'Preparando seu ambiente',
    active: 'Seu ambiente está pronto', ready: 'Seu ambiente está pronto', expired: 'Seu período de teste terminou',
    cancelled: 'Demonstração cancelada', cancel_requested: 'Encerrando teste', deleting: 'Removendo o laboratório',
    removing: 'Removendo o laboratório', removed: 'Laboratório removido', deleted: 'Laboratório removido',
    failed: 'A preparação precisa de atenção', cleanup_failed: 'Limpeza em acompanhamento',
  }
  return labels[status.toLowerCase()] ?? 'Acompanhando seu teste'
}
export function safeTrialDocumentUrl(value: string | undefined): string | undefined {
  try { const url = new URL(value ?? ''); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined } catch { return undefined }
}
