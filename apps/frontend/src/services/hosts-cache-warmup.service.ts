import { watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { hostService } from './host.service'
import { inventoryService } from './inventory.service'

const HOSTS_FIRST_PAGE_CARD_LIMIT = 24
const HOSTS_FIRST_PAGE_LIST_LIMIT = 40
const WARMUP_DELAY_MS = 1_200

let initialized = false
let warmupTimer: number | null = null
let lastWarmupKey = ''
let activeWarmup: Promise<void> | null = null
let pendingWarmupKey: string | null = null

function clearWarmupTimer() {
  if (warmupTimer !== null) {
    window.clearTimeout(warmupTimer)
    warmupTimer = null
  }
}

function scheduleIdle(callback: () => void) {
  clearWarmupTimer()

  warmupTimer = window.setTimeout(() => {
    warmupTimer = null
    const idleWindow = window as Window & {
      requestIdleCallback?: (handler: IdleRequestCallback, options?: IdleRequestOptions) => number
    }
    if (idleWindow.requestIdleCallback) {
      idleWindow.requestIdleCallback(callback, { timeout: 2_000 })
    } else {
      window.setTimeout(callback, 0)
    }
  }, WARMUP_DELAY_MS)
}

async function warmHostsCaches() {
  await Promise.allSettled([
    hostService.getSidebarBootstrap(),
    inventoryService.list(),
    hostService.list({ page: 1, limit: HOSTS_FIRST_PAGE_CARD_LIMIT }),
    hostService.list({ page: 1, limit: HOSTS_FIRST_PAGE_LIST_LIMIT }),
  ])
}

function runWarmup(warmupKey: string) {
  if (activeWarmup) {
    pendingWarmupKey = warmupKey
    return
  }

  activeWarmup = warmHostsCaches()
    .finally(() => {
      activeWarmup = null
      if (pendingWarmupKey && pendingWarmupKey === lastWarmupKey) {
        const nextWarmupKey = pendingWarmupKey
        pendingWarmupKey = null
        runWarmup(nextWarmupKey)
      } else {
        pendingWarmupKey = null
      }
    })
}

export function initHostsCacheWarmup() {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  const auth = useAuthStore()

  watch(
    () => ({
      isAuthenticated: auth.isAuthenticated,
      userId: auth.user?.id ?? null,
      tenantId: auth.user?.actingTenantId ?? auth.user?.tenantId ?? null,
    }),
    ({ isAuthenticated, userId, tenantId }) => {
      clearWarmupTimer()

      if (!isAuthenticated || !userId) {
        lastWarmupKey = ''
        pendingWarmupKey = null
        return
      }

      const warmupKey = `${tenantId ?? 'tenant'}:${userId}`
      if (warmupKey === lastWarmupKey) return
      lastWarmupKey = warmupKey

      scheduleIdle(() => {
        runWarmup(warmupKey)
      })
    },
    { immediate: true },
  )
}
