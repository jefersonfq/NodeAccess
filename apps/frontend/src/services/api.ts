import axios, { type AxiosRequestConfig } from 'axios'
import { useAuthStore } from '@/stores/auth'
import { handleExpiredSession } from '@/services/auth-session.service'
import { isTransientBackendError, watchBackendRecovery } from '@/services/backend-recovery.service'

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

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

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true
      const auth = useAuthStore()
      const ok = await auth.refresh()
      if (ok) {
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
