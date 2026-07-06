import axios, { type AxiosRequestConfig } from 'axios'
import { useAuthStore } from '@/stores/auth'
import { handleExpiredSession } from '@/services/auth-session.service'
import { isTransientBackendError, watchBackendRecovery } from '@/services/backend-recovery.service'

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

let refreshInFlight: Promise<boolean> | null = null

function refreshSessionOnce() {
  const auth = useAuthStore()
  if (!refreshInFlight) {
    refreshInFlight = auth.refresh().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

function isRefreshRequest(config?: AxiosRequestConfig): boolean {
  const url = String(config?.url ?? '')
  return url === '/auth/refresh' || url.endsWith('/auth/refresh')
}

// Injeta Bearer token em todas as requisições
api.interceptors.request.use((config) => {
  const auth = useAuthStore()
  if (auth.accessToken) {
    config.headers.Authorization = `Bearer ${auth.accessToken}`
  }
  return config
})

// Tenta refresh em 401; encerra a sessão web se falhar
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean }

    if (error.response?.status === 401 && isRefreshRequest(originalRequest)) {
      await handleExpiredSession()
      return Promise.reject(error)
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      const auth = useAuthStore()
      if (auth.isManagingTenant) {
        await auth.exitTenantManagement({ notifyServer: false }).catch(() => { /* best-effort */ })
        return Promise.reject(error)
      }

      originalRequest._retry = true
      let ok = false
      try {
        ok = await refreshSessionOnce()
      } catch (refreshError) {
        if (isTransientBackendError(refreshError)) {
          watchBackendRecovery()
        }
        return Promise.reject(refreshError)
      }
      if (ok) {
        const auth = useAuthStore()
        originalRequest.headers = {
          ...originalRequest.headers,
          Authorization: `Bearer ${auth.accessToken}`,
        }
        return api.request(originalRequest)
      }
      await handleExpiredSession()
    }

    if (isTransientBackendError(error)) {
      watchBackendRecovery()
    }

    return Promise.reject(error)
  },
)

export default api
