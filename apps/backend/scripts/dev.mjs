import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { backendDirectory, checkDevelopmentDatabase, loadDevelopmentEnvironment } from './dev-runtime.mjs'

try {
  const mode = process.argv[2] || 'api'
  if (!['api', 'gateway', 'tacacs'].includes(mode)) throw new Error('Modo de desenvolvimento inválido.')
  const environment = loadDevelopmentEnvironment()
  await checkDevelopmentDatabase(environment)
  console.log('[dev] Configuração local carregada; conexão TCP com MySQL validada.')
  if (process.argv.includes('--check')) process.exit(0)
  const entry = mode === 'tacacs' ? 'src/modules/network-access/tacacs-main.ts' : 'src/server.ts'
  const child = spawn(process.execPath, [createRequire(import.meta.url).resolve('tsx/cli'), 'watch', entry], {
    cwd: backendDirectory,
    env: { ...environment, APP_MODE: mode === 'gateway' ? 'gateway' : 'api' },
    stdio: 'inherit',
  })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  child.on('error', () => { console.error('[dev] Não foi possível iniciar tsx. Execute npm ci.'); process.exitCode = 1 })
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143) })
} catch (error) {
  console.error(`[dev] ${error.message}`)
  process.exitCode = 1
}
