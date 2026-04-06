import { createDiscreteApi } from 'naive-ui'
import { i18n } from '@/plugins/i18n'
import { useAuthStore } from '@/stores/auth'

const { message } = createDiscreteApi(['message'])

const BACKEND_RECOVERY_STATE_KEY = 'na:backend-recovery'
const HEALTHCHECK_INTERVAL_MS = 2_000

let watchingRecovery = false
let recoveryTimer: number | null = null
let lastRecoveryNotificationAt = 0

function markRecovering() {
  window.sessionStorage.setItem(BACKEND_RECOVERY_STATE_KEY, '1')
}

function clearRecovering() {
  window.sessionStorage.removeItem(BACKEND_RECOVERY_STATE_KEY)
}

export function consumeBackendRecoveredFlag(): boolean {
  const active = window.sessionStorage.getItem(BACKEND_RECOVERY_STATE_KEY) === '1'
  if (active) {
    clearRecovering()
  }
  return active
}

export function isTransientBackendError(error: unknown): boolean {
  const axiosError = error as {
    code?: string
    message?: string
    response?: { status?: number }
  }

  if ([502, 503, 504].includes(axiosError.response?.status ?? 0)) {
    return true
  }

  if (axiosError.response) {
    return false
  }

  const code = axiosError.code ?? ''
  const messageText = (axiosError.message ?? '').toLowerCase()
  return code === 'ERR_NETWORK'
    || messageText.includes('network error')
    || messageText.includes('failed to fetch')
}

async function pingBackend(): Promise<boolean> {
  const auth = useAuthStore()

  try {
    const response = await fetch('/api/v1/features', {
      method: 'GET',
      cache: 'no-store',
      headers: auth.accessToken
        ? { Authorization: `Bearer ${auth.accessToken}` }
        : {},
    })

    return response.status < 500
  } catch {
    return false
  }
}

export function watchBackendRecovery() {
  const now = Date.now()
  markRecovering()

  if (now - lastRecoveryNotificationAt > 3_000) {
    message.warning(i18n.global.t('auth.backendRecovering'))
    lastRecoveryNotificationAt = now
  }

  if (watchingRecovery) {
    return
  }
  watchingRecovery = true

  const check = async () => {
    const recovered = await pingBackend()
    if (recovered) {
      window.location.reload()
      return
    }

    recoveryTimer = window.setTimeout(() => {
      void check()
    }, HEALTHCHECK_INTERVAL_MS)
  }

  void check()
}

export function stopBackendRecoveryWatch() {
  watchingRecovery = false
  if (recoveryTimer !== null) {
    window.clearTimeout(recoveryTimer)
    recoveryTimer = null
  }
}
