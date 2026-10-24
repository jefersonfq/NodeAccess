import childProcess from 'node:child_process'
import { createRequire } from 'node:module'
import { AppError, ValidationError } from '../../shared/errors.js'

const sshModule = createRequire(import.meta.url).resolve('ssh2')
let workers = 0
// Static code only. Key material travels on stdin, never argv/environment/logs.
const CHILD = `
let input = ''; let size = 0;
process.stdin.on('data', chunk => { size += chunk.length; if (size > 262144) process.exit(1); input += chunk; });
process.stdin.on('end', () => {
  try {
    const {key, passphrase} = JSON.parse(input);
    const parsed = require(process.argv[1]).utils.parseKey(key, passphrase);
    const result = Array.isArray(parsed) ? parsed[0] : parsed;
    process.stdout.write(result && !(result instanceof Error) && result.isPrivateKey() ? '1' : '0');
  } catch { process.stdout.write('0'); }
});`

/** Bound expensive attacker-controlled OpenSSH/PEM KDF work outside the API event loop. */
export async function validateTrialPrivateKey(key: string, passphrase?: string): Promise<void> {
  if (Buffer.byteLength(key, 'utf8') > 65536 || (passphrase !== undefined && Buffer.byteLength(passphrase, 'utf8') > 16384)) throw new ValidationError('A chave privada excede o tamanho permitido.')
  if (workers >= 2) throw new AppError('Validação de chaves ocupada. Tente novamente em instantes.', 503, 'TRIAL_PEM_VALIDATION_BUSY')
  workers++
  try {
    await new Promise<void>((resolve, reject) => {
      const child = childProcess.spawn(process.execPath, ['--max-old-space-size=32', '-e', CHILD, sshModule], {
        stdio: ['pipe', 'pipe', 'ignore'], env: { NODE_ENV: 'production' }, windowsHide: true,
      })
      let output = '', failure: Error | undefined, settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true; clearTimeout(timeout)
        if (error) reject(error); else resolve()
      }
      const timeout = setTimeout(() => {
        failure = new AppError('Não foi possível validar esta chave dentro do limite de tempo.', 503, 'TRIAL_PEM_VALIDATION_TIMEOUT')
        child.kill('SIGKILL')
      }, 2000)
      child.once('error', () => finish(new AppError('Validação de chaves indisponível.', 503, 'TRIAL_PEM_VALIDATION_UNAVAILABLE')))
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8')
        if (output.length > 1) { failure = new ValidationError('Chave privada inválida.'); child.kill('SIGKILL') }
      })
      child.stdin.on('error', () => { /* EPIPE is handled by the child close result. */ })
      child.once('close', code => finish(failure ?? (code === 0 && output === '1' ? undefined : new ValidationError('Chave privada inválida ou senha da chave incorreta.'))))
      child.stdin.end(JSON.stringify({ key, passphrase }))
    })
  } finally { workers-- }
}
