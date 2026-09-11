import { onMounted, onUnmounted, shallowRef } from 'vue'
import { tunnelService, type TunnelInfo } from '@/services/tunnel.service'

const tunnels = shallowRef<TunnelInfo[] | null>(null)
const unavailable = shallowRef(false)
let consumers = 0
let timer: ReturnType<typeof setInterval> | undefined
let generation = 0
let pending: Promise<void> | undefined

export function uniqueTunnels<T extends { id: string; hostId: number }>(rows: readonly T[], hostId?: number): T[] {
  return [...new Map(rows.filter(row => hostId === undefined || row.hostId === hostId).map(row => [row.id, row])).values()]
}

async function refresh() {
  if (pending) return pending
  const request = generation
  pending = tunnelService.list().then(({ data }) => {
    if (request !== generation) return
    tunnels.value = uniqueTunnels(data)
    unavailable.value = false
  }).catch(() => {
    if (request === generation) unavailable.value = true
  }).finally(() => { pending = undefined })
  return pending
}

function changed() {
  // A response started before a confirmed mutation must not restore old tunnels.
  generation++
  void pending?.finally(() => { if (consumers) void refresh() })
  if (!pending) void refresh()
}
function visible() { if (!document.hidden) void refresh() }

export function useTunnelPresence() {
  onMounted(() => {
    if (++consumers !== 1) return
    window.addEventListener('nodeaccess:tunnels-changed', changed)
    window.addEventListener('focus', visible)
    document.addEventListener('visibilitychange', visible)
    timer = setInterval(visible, 5000)
    void refresh()
  })
  onUnmounted(() => {
    if (--consumers !== 0) return
    generation++
    clearInterval(timer)
    window.removeEventListener('nodeaccess:tunnels-changed', changed)
    window.removeEventListener('focus', visible)
    document.removeEventListener('visibilitychange', visible)
    tunnels.value = null
    unavailable.value = false
  })
  return { tunnels: tunnels, unavailable: unavailable, refresh }
}
