import type { HostPublic } from '@nodeaccess/shared'

const PENDING_TERMINAL_HOST_KEY = 'na:pending-terminal-host'

interface PendingTerminalHost {
  id: number
  name: string
  ip: string
  port: number
  authType: HostPublic['authType']
}

export function savePendingTerminalHost(host: HostPublic) {
  const payload: PendingTerminalHost = {
    id: host.id,
    name: host.name,
    ip: host.ip,
    port: host.port,
    authType: host.authType,
  }
  window.sessionStorage.setItem(PENDING_TERMINAL_HOST_KEY, JSON.stringify(payload))
}

export function consumePendingTerminalHost(): PendingTerminalHost | null {
  const raw = window.sessionStorage.getItem(PENDING_TERMINAL_HOST_KEY)
  if (!raw) return null
  window.sessionStorage.removeItem(PENDING_TERMINAL_HOST_KEY)

  try {
    const parsed = JSON.parse(raw) as PendingTerminalHost
    if (!parsed?.id || !parsed?.name || !parsed?.ip || !parsed?.port || !parsed?.authType) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}
