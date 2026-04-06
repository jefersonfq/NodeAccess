import { ref } from 'vue'

/** Whether "Espelhar Entrada" (Mirror Input) is active. */
export const broadcastEnabled = ref(false)

/** tabId → function that sends raw bytes to that terminal's WebSocket */
const senders = new Map<string, (data: Uint8Array) => void>()

export function registerBroadcastSender(tabId: string, send: (data: Uint8Array) => void): void {
  senders.set(tabId, send)
}

export function unregisterBroadcastSender(tabId: string): void {
  senders.delete(tabId)
}

/**
 * Sends `data` to every registered terminal EXCEPT the source.
 * No-op when broadcastEnabled is false.
 */
export function broadcastInput(data: Uint8Array, sourceTabId: string): void {
  if (!broadcastEnabled.value) return
  for (const [tabId, send] of senders) {
    if (tabId !== sourceTabId) send(data)
  }
}
