import { createDiscreteApi } from 'naive-ui'
import router from '@/router'
import { i18n } from '@/plugins/i18n'
import { useAuthStore } from '@/stores/auth'
import { useTerminalStore } from '@/stores/terminals'
import { featuresService } from '@/services/features.service'
import { integrationService } from '@/services/integration.service'
import { settingsService } from '@/services/settings.service'
import { buildAuthRedirectQuery } from '@/services/auth-redirect.service'
import { recordClientUxEvent } from '@/services/client-ux-telemetry.service'

const { message } = createDiscreteApi(['message'])

export const SESSION_EXPIRED_EVENT = 'na:session-expired'

let expiringSession = false
let lastNotificationAt = 0

export async function handleExpiredSession() {
  const auth = useAuthStore()
  const terminalStore = useTerminalStore()
  const now = Date.now()
  const currentRoute = router.currentRoute.value
  const isSharedSessionRoute =
    currentRoute.name === 'shared-session-view'
    || currentRoute.name === 'shared-session-entry'
  const expiredFromTerminal = currentRoute.name === 'terminal'
  const redirectQuery = isSharedSessionRoute
    ? { redirect: '/terminal' }
    : buildAuthRedirectQuery(currentRoute)

  recordClientUxEvent(expiredFromTerminal ? 'CLIENT_UX_SESSION_EXPIRED_TERMINAL' : 'CLIENT_UX_SESSION_EXPIRED')

  if (now - lastNotificationAt > 3_000) {
    message.warning(i18n.global.t('auth.sessionExpired'))
    lastNotificationAt = now
  }

  if (expiringSession) return
  expiringSession = true

  try {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
    terminalStore.clear()
    auth.clearTokens()
    featuresService.clear()
    settingsService.clear()
    integrationService.clear()
    if (currentRoute.name !== 'login') {
      await router.push({
        name: 'login',
        query: {
          reason: 'expired',
          context: expiredFromTerminal || isSharedSessionRoute ? 'terminal' : 'app',
          ...redirectQuery,
        },
      })
    }
  } finally {
    window.setTimeout(() => {
      expiringSession = false
    }, 300)
  }
}
