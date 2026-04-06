import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { UserPublic } from '@nodeaccess/shared'
import { authService } from '@/services/auth.service'

interface AuthUser extends UserPublic {
  forcePasswordChange?: boolean
}

const TOKEN_KEY   = 'na_access_token'
const REFRESH_KEY = 'na_refresh_token'

export const useAuthStore = defineStore('auth', () => {
  const accessToken  = ref<string | null>(localStorage.getItem(TOKEN_KEY))
  const refreshToken = ref<string | null>(localStorage.getItem(REFRESH_KEY))
  const user         = ref<AuthUser | null>(null)
  const tempToken    = ref<string | null>(null)  // pós-senha, pré-TOTP

  const isAuthenticated = computed(() => !!accessToken.value)
  const isAdmin         = computed(() => user.value?.role === 'admin')

  function setTokens(access: string, refresh: string) {
    accessToken.value  = access
    refreshToken.value = refresh
    localStorage.setItem(TOKEN_KEY,   access)
    localStorage.setItem(REFRESH_KEY, refresh)
  }

  function clearTokens() {
    accessToken.value  = null
    refreshToken.value = null
    user.value         = null
    tempToken.value    = null
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
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
        canManageHosts:      payload.canManageHosts,
        mfaEnabled:          true,
        active:              true,
        groupIds:            Array.isArray(payload.groupIds) ? payload.groupIds : [],
        createdAt:           new Date(),
        updatedAt:           new Date(),
        forcePasswordChange: payload.forcePasswordChange,
      }
    } catch {
      return null
    }
  }

  async function refresh(): Promise<boolean> {
    if (!refreshToken.value) return false
    try {
      const res = await authService.refresh(refreshToken.value)
      accessToken.value = res.data.accessToken
      localStorage.setItem(TOKEN_KEY, res.data.accessToken)
      user.value = decodeToken(res.data.accessToken)
      return true
    } catch {
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

  // Popula user a partir do token persistido (on page load)
  if (accessToken.value) {
    user.value = decodeToken(accessToken.value)
  }

  return {
    accessToken,
    refreshToken,
    user,
    tempToken,
    isAuthenticated,
    isAdmin,
    setTokens,
    clearTokens,
    decodeToken,
    refresh,
    logout,
    markPasswordChanged,
  }
})
