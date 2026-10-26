/** Private subprocess entry point. Only bounded stdin/stdout, no credentials in argv or logs. */
import { Agent } from 'undici'
import { configureTrialProtectedAddresses } from './trial-policy.js'
import { trialOutboundLookup } from './trial-outbound.js'
import { isOnePasswordVendorHost, validateTrialOnePasswordToken } from './trial-onepassword.js'

async function main(): Promise<void> {
  process.stdin.setEncoding('utf8')
  let input = ''
  for await (const chunk of process.stdin) {
    input += String(chunk)
    if (Buffer.byteLength(input) > 72 * 1024) throw new Error()
  }
  const payload = JSON.parse(input) as { token: string; ref?: string; protectedAddresses: string[] }
  validateTrialOnePasswordToken(payload.token)
  configureTrialProtectedAddresses(payload.protectedAddresses)
  const agent = new Agent({ connect: { lookup: trialOutboundLookup, timeout: 5000 }, connections: 2 })
  const originalFetch = globalThis.fetch
  globalThis.fetch = (input, init): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !isOnePasswordVendorHost(url.hostname)) return Promise.reject(new Error('Destination denied'))
    return originalFetch(input, { ...init, redirect: 'error', dispatcher: agent as unknown as NonNullable<RequestInit['dispatcher']>, signal: AbortSignal.timeout(25_000) })
  }
  try {
    const { createClient } = await import('@1password/sdk')
    const client = await createClient({ auth: payload.token, integrationName: 'NodeAccess', integrationVersion: '1.0.0' })
    let value = ''
    if (payload.ref !== undefined) value = await client.secrets.resolve(payload.ref)
    else {
      try { await client.secrets.resolve('op://test/test/test') } catch (error) {
        const message = error instanceof Error ? error.message : ''
        if (!/not found|does not exist/i.test(message)) throw new Error()
      }
    }
    process.stdout.write(JSON.stringify({ ok: true, value }))
  } finally { globalThis.fetch = originalFetch; await agent.destroy() }
}
void main().catch(() => { process.exitCode = 1 })
