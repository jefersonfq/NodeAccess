import type { ClientUxEvent } from '@nodeaccess/shared'
import { useAuthStore } from '@/stores/auth'
import { logsService } from '@/services/logs.service'

type QueuedClientUxEvent = {
  type: ClientUxEvent
  userIdHint: number | null
  createdAt: string
}

const STORAGE_KEY = 'na:client-ux-telemetry'
const MAX_QUEUE_SIZE = 50

let flushPromise: Promise<void> | null = null

function isBrowser() {
  return typeof window !== 'undefined'
}

function readQueue(): QueuedClientUxEvent[] {
  if (!isBrowser()) return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as QueuedClientUxEvent[] : []
  } catch {
    return []
  }
}

function writeQueue(queue: QueuedClientUxEvent[]) {
  if (!isBrowser()) return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE_SIZE)))
}

export function recordClientUxEvent(type: ClientUxEvent) {
  const auth = useAuthStore()
  const queue = readQueue()
  queue.push({
    type,
    userIdHint: auth.user?.id ?? null,
    createdAt: new Date().toISOString(),
  })
  writeQueue(queue)
}

export async function flushClientUxEvents(): Promise<void> {
  if (flushPromise) return flushPromise

  flushPromise = (async () => {
    const auth = useAuthStore()
    if (!auth.isAuthenticated || !auth.user?.id) return

    const queue = readQueue()
    if (queue.length === 0) return

    const currentUserId = auth.user.id
    const eligible = queue.filter((event) => event.userIdHint === null || event.userIdHint === currentUserId)
    const discarded = queue.filter((event) => event.userIdHint !== null && event.userIdHint !== currentUserId)

    if (eligible.length === 0) {
      writeQueue(discarded)
      return
    }

    const events = eligible.map((event) => event.type).slice(0, 20)
    await logsService.recordClientUx(events)

    const remainingEligible = eligible.slice(events.length)
    writeQueue([...discarded, ...remainingEligible])
  })().finally(() => {
    flushPromise = null
  })

  return flushPromise
}
