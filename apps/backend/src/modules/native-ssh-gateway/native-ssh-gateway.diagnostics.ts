import net from 'node:net'

export interface NativeSshGatewayProbeAttempt {
  host: string
  port: number
  success: boolean
  latencyMs: number | null
  banner: string | null
  error: string | null
}

export interface NativeSshGatewayProbeResult {
  success: boolean
  testedAt: string
  latencyMs: number | null
  banner: string | null
  endpoint: string | null
  attempts: NativeSshGatewayProbeAttempt[]
  message: string
}

const DEFAULT_TIMEOUT_MS = 2_500
const MAX_BANNER_BYTES = 512

export async function probeNativeSshGateway(
  runtimeHost: string | null,
  runtimePort: number | null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<NativeSshGatewayProbeResult> {
  if (!runtimePort) {
    return { success: false, testedAt: new Date().toISOString(), latencyMs: null, banner: null, endpoint: null, attempts: [], message: 'Listener do gateway não foi reportado pelo runtime' }
  }

  const candidates = diagnosticHosts(runtimeHost)
  const attempts: NativeSshGatewayProbeAttempt[] = []
  for (const host of candidates) {
    const attempt = await probeSshBanner(host, runtimePort, timeoutMs)
    attempts.push(attempt)
    if (attempt.success) {
      return {
        success: true,
        testedAt: new Date().toISOString(),
        latencyMs: attempt.latencyMs,
        banner: attempt.banner,
        endpoint: `${host}:${runtimePort}`,
        attempts,
        message: 'Listener acessível e protocolo SSH identificado',
      }
    }
  }

  return {
    success: false,
    testedAt: new Date().toISOString(),
    latencyMs: null,
    banner: null,
    endpoint: null,
    attempts,
    message: attempts.at(-1)?.error ?? 'Não foi possível acessar o listener SSH',
  }
}

export function diagnosticHosts(runtimeHost: string | null): string[] {
  const candidates = runtimeHost && !['0.0.0.0', '::', '[::]'].includes(runtimeHost.trim())
    ? [runtimeHost.trim(), 'ssh-gateway', '127.0.0.1']
    : ['ssh-gateway', '127.0.0.1']
  return [...new Set(candidates)]
}

function probeSshBanner(host: string, port: number, timeoutMs: number): Promise<NativeSshGatewayProbeAttempt> {
  const startedAt = Date.now()
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    let settled = false
    let received = ''
    const finish = (result: Omit<NativeSshGatewayProbeAttempt, 'host' | 'port'>) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve({ host, port, ...result })
    }
    socket.setTimeout(timeoutMs)
    socket.on('data', (chunk: Buffer) => {
      received += chunk.toString('utf8')
      if (received.length > MAX_BANNER_BYTES) received = received.slice(0, MAX_BANNER_BYTES)
      const banner = received.split(/\r?\n/).find((line) => line.startsWith('SSH-')) ?? null
      if (banner) finish({ success: true, latencyMs: Date.now() - startedAt, banner, error: null })
    })
    socket.once('timeout', () => finish({ success: false, latencyMs: null, banner: null, error: 'Timeout aguardando identificação SSH' }))
    socket.once('error', (error) => finish({ success: false, latencyMs: null, banner: null, error: error.message }))
    socket.once('close', () => {
      if (!settled) finish({ success: false, latencyMs: null, banner: null, error: 'Conexão encerrada sem banner SSH' })
    })
  })
}
