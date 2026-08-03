import api from './api'
import type { UserProductivityEvent } from '@nodeaccess/shared'

const screenRouteIds: Partial<Record<string, number>> = {
  dashboard: 1,
  hosts: 2,
  terminal: 3,
  files: 4,
  snippets: 5,
  forwardings: 6,
  profile: 7,
  'admin-dashboard': 100,
  'admin-logs': 101,
  'admin-sessions': 102,
  'admin-reports-sessions': 102,
  'admin-session-audit': 103,
  'admin-sftp-audit': 108,
  'admin-users': 104,
  'admin-groups': 105,
  'admin-integrations': 106,
  'admin-settings': 107,
}

let lastScreenKey = ''
let lastScreenAt = 0

export function recordUserProductivityEvent(event: UserProductivityEvent, targetId: number): void {
  void api.post('/logs/user-productivity', {
    events: [{ event, targetId }],
  }).catch(() => undefined)
}

export function recordScreenView(routeName?: string | null): void {
  if (!routeName) return
  const targetId = screenRouteIds[routeName]
  if (!targetId) return

  const now = Date.now()
  const key = `${routeName}:${targetId}`
  if (lastScreenKey === key && now - lastScreenAt < 15_000) return

  lastScreenKey = key
  lastScreenAt = now
  recordUserProductivityEvent('USER_SCREEN_VIEWED', targetId)
}
