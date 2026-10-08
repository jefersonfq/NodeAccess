import { Agent } from 'undici'
import { parsePublicHttpUrl, publicLookup } from './ssrf-guard.js'
import { responsePrefix } from './bounded-http.js'

/** Bounded response, no redirects, DNS validation at the actual socket connection. */
export async function sendPublicWebhook(url: string, init: RequestInit): Promise<{ status: number; snippet: string }> {
  parsePublicHttpUrl(url)
  const dispatcher = new Agent({ connect: { lookup: publicLookup, timeout: 5_000 }, connections: 1 })
  try {
    const response = await fetch(url, { ...init, redirect: 'error', dispatcher } as RequestInit)
    return { status: response.status, snippet: (await responsePrefix(response, 512)).slice(0, 512) }
  } finally {
    void dispatcher.destroy().catch(() => {})
  }
}
