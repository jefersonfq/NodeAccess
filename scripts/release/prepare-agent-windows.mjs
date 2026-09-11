import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { distributionNames, importArtifacts, projectRoot } from '../../apps/agent/installer/windows/artifacts.mjs'

const destination = resolve(projectRoot, 'apps/agent/dist')
const repository = process.env.AGENT_WINDOWS_RELEASE_REPO
const source = process.env.AGENT_WINDOWS_ARTIFACTS_DIR
let temporary
try {
  if (repository && source) throw new Error('Informe apenas AGENT_WINDOWS_RELEASE_REPO ou AGENT_WINDOWS_ARTIFACTS_DIR')
  let directory = source ? resolve(source) : destination
  if (repository) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('AGENT_WINDOWS_RELEASE_REPO deve usar owner/repo')
    const version = JSON.parse(readFileSync(resolve(projectRoot, 'apps/agent/package.json'), 'utf8')).version
    temporary = mkdtempSync(join(tmpdir(), 'nodeaccess-agent-'))
    const result = spawnSync('gh', ['release', 'download', `agent-v${version}`, '--repo', repository,
      '--dir', temporary, ...distributionNames.flatMap(name => ['--pattern', name])], { stdio: 'inherit' })
    if (result.error || result.status !== 0) throw new Error('Falha ao obter release Windows. Verifique gh, acesso ao repositorio e a tag do agente')
    directory = temporary
  }
  const manifest = importArtifacts(directory, destination)
  console.log(`[nodeaccess] Agente Windows ${manifest.version} pronto para a release`)
} catch (error) {
  console.error(`[nodeaccess] ${error.message}`)
  console.error('Gere npm run build:win:msi -w apps/agent no Windows; importe com AGENT_WINDOWS_ARTIFACTS_DIR ou AGENT_WINDOWS_RELEASE_REPO=owner/repo.')
  process.exitCode = 1
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true })
}
