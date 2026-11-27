/** A deliberate portal navigation action, never a domain-to-SSH inference. */
export function hostRouteContentKey(fullPath: string): string {
  // Consuming the action must not unmount the component that is still connecting.
  // Every other destination, filter and anchor continues to identify its own view.
  const url = new URL(fullPath, 'https://nodeaccess.invalid')
  url.searchParams.delete('connect')
  return `${url.pathname}${url.search}${url.hash}`
}

export function routeConnectHostId(query: Record<string, unknown>): number | null {
  if (query.connect !== '1' || typeof query.hostId !== 'string' || !/^[1-9]\d{0,9}$/.test(query.hostId)) return null
  const id = Number(query.hostId)
  return Number.isSafeInteger(id) ? id : null
}

export function createHostRouteConnector<Host>(ports: {
  consume: () => Promise<boolean>
  current: () => boolean
  load: (id: number) => Promise<Host>
  prepare: () => Promise<void>
  connect: (host: Host) => Promise<void>
  unavailable: () => void
}): (id: number) => Promise<void> {
  let started = false
  return async (id) => {
    if (started) return
    started = true
    try {
      // Remove the action before any request: refresh/back must not reconnect.
      if (!await ports.consume() || !ports.current()) return
      const host = await ports.load(id)
      if (!ports.current()) return
      await ports.prepare()
      if (ports.current()) await ports.connect(host)
    } catch {
      // Deliberately identical for absent, inaccessible and failed lookups.
      if (ports.current()) ports.unavailable()
    }
  }
}
