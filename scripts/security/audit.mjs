import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const output = resolve(process.env.SECURITY_OUTPUT_DIR || 'artifacts/security')
mkdirSync(output, { recursive: true })
function npmJson(args, filename) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (result.error) throw result.error
  let data
  try { data = JSON.parse(result.stdout) } catch { throw new Error(`npm ${args[0]} não retornou JSON válido; auditoria inconclusiva`) }
  if (data.error || (result.status !== 0 && (args[0] !== 'audit' || !data.metadata?.vulnerabilities))) {
    throw new Error(`npm ${args[0]} falhou; auditoria inconclusiva`)
  }
  writeFileSync(resolve(output, filename), JSON.stringify(data, null, 2) + '\n')
  return data
}
try {
  const runtime = npmJson(['audit', '--omit=dev', '--json'], 'npm-runtime.json')
  const all = npmJson(['audit', '--json'], 'npm-all.json')
  npmJson(['sbom', '--omit=dev', '--sbom-format=cyclonedx'], 'sbom-runtime.cdx.json')
  const runtimeOnly = process.argv.includes('--runtime-only')
  const summary = {
    at: new Date().toISOString(), node: process.version,
    lockSha256: createHash('sha256').update(readFileSync('package-lock.json')).digest('hex'),
    runtime: runtime.metadata.vulnerabilities, all: all.metadata.vulnerabilities,
    policy: runtimeOnly ? 'runtime-only' : 'all-dependencies',
    passed: (runtimeOnly ? runtime : all).metadata.vulnerabilities.total === 0,
    limitations: 'npm cobre dependências conhecidas. Não certifica código, SO, imagens, configuração ou ausência de falhas.',
  }
  writeFileSync(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  console.log(JSON.stringify(summary, null, 2))
  if (!summary.passed) process.exitCode = 1
} catch (error) { console.error(error.message); process.exitCode = 2 }
