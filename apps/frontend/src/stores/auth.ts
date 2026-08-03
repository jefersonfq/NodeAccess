import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { UserPublic } from '@nodeaccess/shared'
import { authService } from '@/services/auth.service'
import { clearAllRegisteredCaches } from '@/services/service-cache'

interface AuthUser extends UserPublic {
  forcePasswordChange?: boolean
  platformTenantId?: number
  actingTenantId?: number
  impersonatedByUserId?: number
}

const TOKEN_KEY   = 'na_access_token'
const REFRESH_KEY = 'na_refresh_token'
const PLATFORM_TOKEN_KEY = 'na_platform_access_token'
const MANAGED_TENANT_KEY = 'na_managed_tenant'
const TEMP_TOKEN_KEY = 'na_temp_auth_token'
const EMAIL_OTP_AVAILABLE_KEY = 'na_email_otp_available'
const TENANT_CONTEXT_CHANGED_EVENT = 'nodeaccess:tenant-context-changed'

function isRefreshTransientFailure(error: unknown): boolean {
  const e = error as { response?: { status?: number }; code?: string; message?: string }
  const status = e.response?.status
  if (status !== undefined) return status >= 500
  const message = (e.message ?? '').toLowerCase()
  return e.code === 'ERR_NETWORK'
    || message.includes('network error')
    || message.includes('failed to fetch')
}

export const useAuthStore = defineStore('auth', () => {
  const accessToken  = ref<string | null>(localStorage.getItem(TOKEN_KEY))
  const refreshToken = ref<string | null>(localStorage.getItem(REFRESH_KEY))
  const platformAccessToken = ref<string | null>(localStorage.getItem(PLATFORM_TOKEN_KEY))
  const managedTenant = ref<{ id: number; name: string; slug: string } | null>(
    localStorage.getItem(MANAGED_TENANT_KEY)
      ? JSON.parse(localStorage.getItem(MANAGED_TENANT_KEY)!)
      : null,
  )
  const user         = ref<AuthUser | null>(null)
  const tempToken          = ref<string | null>(sessionStorage.getItem(TEMP_TOKEN_KEY))  // pós-senha, pré-TOTP
  const emailOtpAvailable  = ref(sessionStorage.getItem(EMAIL_OTP_AVAILABLE_KEY) === 'true')

  const isAuthenticated = computed(() => !!accessToken.value)
  const isAdmin         = computed(() => user.value?.role === 'admin')
  const isPlatformAdmin = computed(() => user.value?.isPlatformAdmin === true)
  const isManagingTenant = computed(() => !!user.value?.actingTenantId && !!platformAccessToken.value)

  function setTokens(access: string, refresh: string) {
    accessToken.value  = access
    refreshToken.value = refresh
    localStorage.setItem(TOKEN_KEY,   access)
    localStorage.setItem(REFRESH_KEY, refresh)
    clearPendingMfa()
    clearTenantScopedState()
  }

  function completeLogin(access: string, refresh: string) {
    accessToken.value  = access
    refreshToken.value = refresh
    user.value         = decodeToken(access)
    localStorage.setItem(TOKEN_KEY,   access)
    localStorage.setItem(REFRESH_KEY, refresh)
    clearPendingMfa()
    clearTenantScopedState()
  }

  function setPendingMfa(token: string, emailOtp: boolean) {
    tempToken.value = token
    emailOtpAvailable.value = emailOtp
    sessionStorage.setItem(TEMP_TOKEN_KEY, token)
    sessionStorage.setItem(EMAIL_OTP_AVAILABLE_KEY, String(emailOtp))
  }

  function clearPendingMfa() {
    tempToken.value = null
    emailOtpAvailable.value = false
    sessionStorage.removeItem(TEMP_TOKEN_KEY)
    sessionStorage.removeItem(EMAIL_OTP_AVAILABLE_KEY)
  }

  function clearTokens() {
    accessToken.value       = null
    refreshToken.value      = null
    user.value              = null
    clearPendingMfa()
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
    localStorage.removeItem(PLATFORM_TOKEN_KEY)
    localStorage.removeItem(MANAGED_TENANT_KEY)
    platformAccessToken.value = null
    managedTenant.value = null
    clearTenantScopedState()
  }

  function clearTenantScopedState() {
    clearAllRegisteredCaches()
    window.dispatchEvent(new Event(TENANT_CONTEXT_CHANGED_EVENT))
  }

  /** Decodifica o payload do JWT sem verificar assinatura (só leitura no cliente) */
  function decodeToken(token: string): AuthUser | null {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]!))
      return {
        id:                  Number(payload.sub),
        tenantId:            payload.tenantId,
        name:                payload.name ?? '',
        email:               payload.email,
        role:                payload.role,
        isPlatformAdmin:     payload.isPlatformAdmin === true,
        canManageHosts:      payload.canManageHosts,
        canViewLiveSessions: payload.canViewLiveSessions === true,
        avatarUrl:           payload.avatarUrl ?? null,
        avatarVersion:       payload.avatarVersion ?? null,
        mfaEnabled:          true,
        active:              true,
        groupIds:            Array.isArray(payload.groupIds) ? payload.groupIds : [],
        createdAt:           new Date(),
        updatedAt:           new Date(),
        forcePasswordChange: payload.forcePasswordChange,
        platformTenantId:    payload.platformTenantId,
        actingTenantId:      payload.actingTenantId,
        impersonatedByUserId: payload.impersonatedByUserId,
      }
    } catch {
      return null
    }
  }

  async function refresh(): Promise<boolean> {
    if (isManagingTenant.value) return false
    if (!refreshToken.value) return false
    try {
      const res = await authService.refresh(refreshToken.value)
      accessToken.value = res.data.accessToken
      localStorage.setItem(TOKEN_KEY, res.data.accessToken)
      user.value = decodeToken(res.data.accessToken)
      return true
    } catch (err) {
      if (isRefreshTransientFailure(err)) {
        throw err
      }
      clearTokens()
      return false
    }
  }

  async function logout() {
    if (refreshToken.value) {
      await authService.logout(refreshToken.value).catch(() => { /* best-effort */ })
    }
    clearTokens()
  }

  function markPasswordChanged() {
    if (!user.value) return
    user.value = {
      ...user.value,
      forcePasswordChange: false,
    }
  }

  function updateProfileUser(next: UserPublic) {
    if (!user.value || user.value.id !== next.id) return
    user.value = {
      ...user.value,
      name: next.name,
      email: next.email,
      avatarUrl: next.avatarUrl ?? null,
      avatarVersion: next.avatarVersion ?? null,
      updatedAt: next.updatedAt,
    }
  }

  async function enterTenantManagement(tenantId: number) {
    if (!accessToken.value) return
    if (!platformAccessToken.value) {
      platformAccessToken.value = accessToken.value
      localStorage.setItem(PLATFORM_TOKEN_KEY, accessToken.value)
    }
    const res = await authService.enterTenant(tenantId)
    accessToken.value = res.data.accessToken
    user.value = decodeToken(res.data.accessToken)
    managedTenant.value = res.data.tenant
    localStorage.setItem(TOKEN_KEY, res.data.accessToken)
    localStorage.setItem(MANAGED_TENANT_KEY, JSON.stringify(res.data.tenant))
    clearTenantScopedState()
  }

  async function exitTenantManagement(options: { notifyServer?: boolean } = {}) {
    const notifyServer = options.notifyServer ?? true
    const tenantId = user.value?.actingTenantId
    if (notifyServer && tenantId) {
      await authService.exitTenant(tenantId).catch(() => { /* best-effort */ })
    }
    if (!platformAccessToken.value) return
    accessToken.value = platformAccessToken.value
    user.value = decodeToken(platformAccessToken.value)
    localStorage.setItem(TOKEN_KEY, platformAccessToken.value)
    platformAccessToken.value = null
    managedTenant.value = null
    localStorage.removeItem(PLATFORM_TOKEN_KEY)
    localStorage.removeItem(MANAGED_TENANT_KEY)
    clearTenantScopedState()
  }

  // Popula user a partir do token persistido (on page load)
  if (accessToken.value) {
    user.value = decodeToken(accessToken.value)
  }

  return {
    accessToken,
    refreshToken,
    user,
    tempToken,
    emailOtpAvailable,
    managedTenant,
    isAuthenticated,
    isAdmin,
    isPlatformAdmin,
    isManagingTenant,
    setTokens,
    completeLogin,
    setPendingMfa,
    clearPendingMfa,
    clearTokens,
    decodeToken,
    refresh,
    logout,
    markPasswordChanged,
    updateProfileUser,
    enterTenantManagement,
    exitTenantManagement,
  }
})
