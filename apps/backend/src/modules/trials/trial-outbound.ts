import { reserveTrialAiRequest } from './trial-ai-quota.js'
import { promises as dns } from 'node:dns'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { Agent } from 'undici'
import { assertPublicAddress, parsePublicHttpUrl } from '../../shared/ssrf-guard.js'
import { AppError } from '../../shared/errors.js'
import { assertTrialCapability, monitorTrialAccess, trialProtectedAddresses } from './trial-policy.js'

export async function assertTrialIntegration(tenantId: number, provider: string): Promise<import('./trial-policy.js').TrialAccess | null> {
  const trial = await assertTrialCapability(tenantId, 'integrations')
  if (trial && (trial.profileJson as { integrations?: Record<string, boolean> }).integrations?.[provider] === false) throw new AppError('Integração indisponível no teste', 403, 'TRIAL_FEATURE_DISABLED')
  return trial
}

function denied(): AppError { return new AppError('Destino externo indisponível para este tenant', 403, 'TRIAL_DESTINATION_DENIED') }
export function assertTrialOutboundAddress(address: string): void {
  assertPublicAddress(address)
  const protectedIps = trialProtectedAddresses()
  if (!protectedIps.length) throw denied()
  const protectedList = new BlockList()
  for (const ip of protectedIps) protectedList.addAddress(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4')
  if (protectedList.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4')) throw denied()
}
/** DNS is resolved and checked at socket creation; no later unvalidated resolution. */
export const trialOutboundLookup: LookupFunction = (hostname, options, callback) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  void Promise.race([
    dns.lookup(hostname, { all: true }),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(denied()), 5000) }),
  ]).then(addresses => {
    if (!addresses.length) throw denied()
    for (const row of addresses) assertTrialOutboundAddress(row.address)
    const candidates = options.family ? addresses.filter(row => row.family === options.family) : addresses
    if (!candidates.length) throw denied()
    if (options.all) callback(null, candidates)
    else callback(null, candidates[0]!.address, candidates[0]!.family)
  }).catch(() => callback(denied(), '', 0)).finally(() => clearTimeout(timer))
}

/** Explicit tenant context prevents a background job from inheriting another request's policy. */
export async function trialOutboundFetch(tenantId: number | undefined, url: string, init: RequestInit = {}, capability = 'integrations'): Promise<Response> {
  if (tenantId === undefined) return fetch(url, init)
  const trial = await assertTrialCapability(tenantId, capability)
  if (!trial) return fetch(url, init)
  const parsed = parsePublicHttpUrl(url)
  if (parsed.protocol !== 'https:') throw new AppError('Use HTTPS para integrações externas no teste', 400, 'TRIAL_HTTPS_REQUIRED')
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
  if (isIP(hostname)) assertTrialOutboundAddress(hostname)
  if (!trialProtectedAddresses().length) throw denied()
  const releaseQuota = capability === 'localAi' && init.method?.toUpperCase() === 'POST'
    ? await reserveTrialAiRequest(tenantId) : null
  let released = false
  const dispatcher = new Agent({ connect: { lookup: trialOutboundLookup, timeout: 5000 }, connections: 1 })
  const controller = new AbortController()
  const abort = (): void => { controller.abort(); cleanup() }
  const stop = monitorTrialAccess(tenantId, trial, abort)
  const timer = setTimeout(abort, 120_000)
  init.signal?.addEventListener('abort', abort, { once: true })
  const cleanup = (): void => {
    if (!released) { released = true; if (releaseQuota) void releaseQuota().catch(() => {}) }
    clearTimeout(timer); stop(); init.signal?.removeEventListener('abort', abort)
    void dispatcher.destroy().catch(() => {})
  }
  if (init.signal?.aborted) abort()
  try {
    const response = await fetch(url, { ...init, redirect: 'error', signal: controller.signal, dispatcher: dispatcher as unknown as NonNullable<RequestInit['dispatcher']> })
    if (!response.body) { cleanup(); return response }
    const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader()
    let bytes = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(stream): Promise<void> {
        try {
          const chunk = await reader.read()
          if (chunk.done) { cleanup(); stream.close(); return }
          bytes += chunk.value.byteLength
          if (bytes > 8 * 1024 * 1024) throw new AppError('Resposta externa excede o limite', 502, 'TRIAL_RESPONSE_LIMIT')
          stream.enqueue(chunk.value)
        } catch (error) { abort(); cleanup(); stream.error(error) }
      },
      cancel(): void { abort(); void reader.cancel().catch(() => {}); cleanup() },
    })
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  } catch (error) { cleanup(); throw error }
}

export function trialAiFetch(tenantId: number | undefined, url: string, init: RequestInit = {}): Promise<Response> {
  return trialOutboundFetch(tenantId, url, init, 'localAi')
}

/** LDAP has no redirects. Pin the URL to the validated IP and retain TLS servername. */
export async function trialLdapTarget(tenantId: number | undefined, rawUrl: string): Promise<{ url: string; servername?: string } | null> {
  if (tenantId === undefined || !await assertTrialIntegration(tenantId, 'ldap')) return null
  const parsed = new URL(rawUrl)
  if (!['ldap:', 'ldaps:'].includes(parsed.protocol) || parsed.username || parsed.password) throw denied()
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
  let address = hostname
  if (!isIP(hostname)) {
    address = await new Promise<string>((resolve, reject) => {
      trialOutboundLookup(hostname, {}, (error, result) => {
        if (error || typeof result !== 'string') reject(denied())
        else resolve(result)
      })
    })
  }
  assertTrialOutboundAddress(address)
  parsed.hostname = isIP(address) === 6 ? `[${address}]` : address
  return { url: parsed.toString(), ...(!isIP(hostname) ? { servername: hostname } : {}) }
}

export async function resolveTrialOutboundHost(hostname: string): Promise<string> {
  if (isIP(hostname)) { assertTrialOutboundAddress(hostname); return hostname }
  return new Promise<string>((resolve, reject) => {
    trialOutboundLookup(hostname, {}, (error, address) => {
      if (error || typeof address !== 'string') reject(denied())
      else resolve(address)
    })
  })
}

export function trialOpenAiFetch(tenantId: number | undefined, url: string, init: RequestInit = {}): Promise<Response> {
  return trialOutboundFetch(tenantId, url, init, 'localAi')
}
