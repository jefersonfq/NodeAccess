import { createDiscreteApi } from 'naive-ui'
import { i18n } from '@/plugins/i18n'
import { useAuthStore } from '@/stores/auth'

const { message } = createDiscreteApi(['message'])

const BACKEND_RECOVERY_STATE_KEY = 'na:backend-recovery'
const HEALTHCHECK_INTERVAL_MS = 2_000

let watchingRecovery = false
let recoveryTimer: number | null = null
let recoveryGeneration = 0
let probeController: AbortController | null = null
let lastRecoveryNotificationAt = 0
export const BACKEND_RECOVERED_EVENT = 'nodeaccess:backend-recovered'

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
  const axiosError = (error ?? {}) as {
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
  const controller = new AbortController()
  probeController = controller
  const timeout = window.setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch('/api/v1/features', {
      method: 'GET', cache: 'no-store', signal: controller.signal,
      headers: auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {},
    })
    return response.ok
  } catch { return false }
  finally { window.clearTimeout(timeout); if (probeController === controller) probeController = null }
}

export function watchBackendRecovery() {
  if (watchingRecovery) return
  watchingRecovery = true
  const generation = ++recoveryGeneration
  const now = Date.now()
  if (now - lastRecoveryNotificationAt > 3000) {
    message.warning(i18n.global.t('auth.backendRecovering'))
    lastRecoveryNotificationAt = now
  }
  let delay = HEALTHCHECK_INTERVAL_MS
  const check = async () => {
    const recovered = await pingBackend()
    if (!watchingRecovery || generation !== recoveryGeneration) return
    if (recovered) {
      watchingRecovery = false
      clearRecovering()
      // Refresh only interested read-only views. Never destroy a healthy SSH socket.
      window.dispatchEvent(new Event(BACKEND_RECOVERED_EVENT))
      return
    }
    recoveryTimer = window.setTimeout(() => { void check() }, delay)
    delay = Math.min(delay * 2, 30000)
  }
  recoveryTimer = window.setTimeout(() => { void check() }, delay)
}

export function stopBackendRecoveryWatch() {
  watchingRecovery = false
  recoveryGeneration++
  probeController?.abort(); probeController = null
  if (recoveryTimer !== null) window.clearTimeout(recoveryTimer)
  recoveryTimer = null
}
