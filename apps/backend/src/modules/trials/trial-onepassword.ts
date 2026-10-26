import { assertTrialIntegration } from './trial-outbound.js'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { AppError } from '../../shared/errors.js'
import { monitorTrialAccess, trialProtectedAddresses } from './trial-policy.js'

export function isOnePasswordVendorHost(hostname: string): boolean {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+1password\.(?:com|eu|ca)$/i.test(hostname)
}
export function validateTrialOnePasswordToken(token: string): void {
  try {
    if (token.length > 64 * 1024 || !/^ops_[a-zA-Z0-9_-]+={0,2}$/.test(token)) throw new Error()
    const data = JSON.parse(Buffer.from(token.slice(4), 'base64url').toString('utf8')) as { signInAddress?: unknown }
    if (typeof data.signInAddress !== 'string' || !isOnePasswordVendorHost(data.signInAddress)) throw new Error()
  } catch { throw new AppError('Token de serviço 1Password inválido para o teste', 400, 'TRIAL_ONEPASSWORD_TOKEN') }
}
let running = 0
/** Native/WASM SDK work is isolated so deadline/revocation can actually terminate it. */
export async function runTrialOnePassword(tenantId: number, token: string, ref?: string): Promise<string> {
  const trial = await assertTrialIntegration(tenantId, 'onepassword')
  if (!trial) throw new Error('Trial SDK scope required')
  validateTrialOnePasswordToken(token)
  if (!trialProtectedAddresses().length) throw new AppError('Destino externo indisponível', 503, 'TRIAL_OUTBOUND_UNAVAILABLE')
  if (running >= 2) throw new AppError('Integração ocupada; tente novamente', 503, 'TRIAL_INTEGRATION_BUSY')
  const payload = JSON.stringify({ token, ref, protectedAddresses: trialProtectedAddresses() })
  if (Buffer.byteLength(payload) > 72 * 1024) throw new AppError('Entrada excede o limite', 400, 'TRIAL_ONEPASSWORD_INPUT')
  running++
  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [...(import.meta.url.endsWith('.ts') ? ['--import', import.meta.resolve('tsx')] : []), fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './trial-onepassword.worker.ts' : './trial-onepassword.worker.js', import.meta.url))], { stdio: ['pipe', 'pipe', 'ignore'], env: { NODE_ENV: 'production' } })
      let output = ''; let done = false
      const fail = (): void => { child.kill('SIGKILL') }
      const stop = monitorTrialAccess(tenantId, trial, fail)
      const timer = setTimeout(fail, 30_000)
      const finish = (error?: Error): void => {
        if (done) return
        done = true; clearTimeout(timer); stop()
        if (error) { reject(error); return }
        try {
          const result = JSON.parse(output) as { ok?: boolean; value?: unknown }
          if (!result.ok || typeof result.value !== 'string') throw new Error()
          const value = result.value
          void assertTrialIntegration(tenantId, 'onepassword').then(() => resolve(value), reject)
        } catch { reject(new AppError('Não foi possível consultar 1Password', 502, 'TRIAL_ONEPASSWORD_FAILED')) }
      }
      child.on('error', () => finish(new AppError('Integração indisponível', 503, 'TRIAL_ONEPASSWORD_FAILED')))
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => { output += chunk; if (Buffer.byteLength(output) > 1024 * 1024) fail() })
      child.on('close', code => { finish(code === 0 ? undefined : new AppError('Consulta 1Password interrompida ou indisponível', 502, 'TRIAL_ONEPASSWORD_FAILED')) })
      child.stdin.on('error', fail)
      child.stdin.end(payload)
    })
  } finally { running-- }
}
