import api from './api'
import type { LoginDto, VerifyTotpDto, AuthResponse, LoginPending } from '@nodeaccess/shared'

export const authService = {
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

  requestEmailOtp: (tempToken: string) =>
    api.post('/auth/request-email-otp', { tempToken }),

  verifyEmailOtp: (code: string, tempToken: string) =>
    api.post<AuthResponse>('/auth/verify-email-otp', { code, tempToken }),

  googleConfig: () =>
    api.get<{ enabled: boolean; clientId: string | null }>('/auth/google/config'),

  googleLogin: (credential: string) =>
    api.post<AuthResponse>('/auth/google', { credential }),
}
