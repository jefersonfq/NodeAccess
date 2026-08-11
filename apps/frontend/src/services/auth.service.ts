import api from './api'
import type { LoginDto, VerifyTotpDto, AuthResponse, LoginPending } from '@nodeaccess/shared'

export interface TenantOption { name: string; slug: string }

export const authService = {
  lookupTenant: (email: string) =>
    api.post<{ tenants: TenantOption[] }>('/auth/lookup-tenant', { email }),

  login: (dto: LoginDto) =>
    api.post<LoginPending>('/auth/login', dto),

  setupTotp: (setupToken: string) =>
    api.post<{ qrCode: string }>('/auth/setup-totp', { setupToken }),

  confirmTotp: (dto: VerifyTotpDto) =>
    api.post<AuthResponse>('/auth/confirm-totp', dto),

  verifyTotp: (token: string, tempToken: string) =>
    api.post<AuthResponse>('/auth/verify-totp', { token, setupToken: tempToken }),

  refresh: (refreshToken: string) =>
    api.post<{ accessToken: string }>('/auth/refresh', { refreshToken }),

  logout: (refreshToken: string) =>
    api.post('/auth/logout', { refreshToken }),

  logoutAll: () =>
    api.post('/auth/logout-all'),

  requestEmailOtp: (tempToken: string) =>
    api.post('/auth/request-email-otp', { tempToken }),

  verifyEmailOtp: (code: string, tempToken: string) =>
    api.post<AuthResponse>('/auth/verify-email-otp', { code, tempToken }),

  googleConfig: (tenantSlug?: string) =>
    api.get<{ enabled: boolean; clientId: string | null }>('/auth/google/config', {
      params: tenantSlug ? { tenantSlug } : undefined,
    }),

  googleLogin: (credential: string, tenantSlug?: string) =>
    api.post<AuthResponse>('/auth/google', { credential, ...(tenantSlug ? { tenantSlug } : {}) }),

  oidcConfig: (tenantSlug?: string) =>
    api.get<{ enabled: boolean; name: string | null }>('/auth/oidc/config', {
      params: tenantSlug ? { tenantSlug } : undefined,
    }),

  oidcStart: (tenantSlug?: string) =>
    api.post<{ authorizationUrl: string }>('/auth/oidc/start', tenantSlug ? { tenantSlug } : {}),

  oidcComplete: (state: string, code: string) =>
    api.post<AuthResponse | LoginPending>('/auth/oidc/complete', { state, code }),

  enterTenant: (tenantId: number) =>
    api.post<{ accessToken: string; tenant: { id: number; name: string; slug: string } }>('/auth/platform/enter-tenant', { tenantId }),

  exitTenant: (tenantId: number) =>
    api.post('/auth/platform/exit-tenant', { tenantId }),
}
