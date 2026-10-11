import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { projectRoot, validateArtifacts } from '../../apps/agent/installer/windows/artifacts.mjs'
import { platforms } from '../../apps/agent/installer/platforms.mjs'
import { validatePlatform, recordPlatform } from '../../apps/agent/installer/platform-artifacts.mjs'
const require = createRequire(import.meta.url)
const checkOnly = process.argv.includes('--check')
function run(cmd, args) {
  const child = spawnSync(cmd, args, { cwd: projectRoot, stdio: ['ignore', 'inherit', 'inherit'] })
  if (child.error) throw child.error
  if (child.status !== 0) throw Error(`Agent build failed (${child.status}): ${cmd}`)
}
try {
  if (process.env.AGENT_WINDOWS_ARTIFACTS_DIR || process.env.AGENT_WINDOWS_RELEASE_REPO) {
    run(process.execPath, ['scripts/release/prepare-agent-windows.mjs'])
  }
  try { validateArtifacts(resolve(projectRoot, 'apps/agent/dist')); console.log('[agent] Windows up to date') }
  catch (error) {
    if (checkOnly) throw error
    console.log(`[agent] Windows rebuild required: ${error.message}`)
    if (process.platform === 'win32') {
      run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'apps/agent/installer/windows/build-msi.ps1'])
    } else {
      // Windows npm.cmd cannot use a WSL UNC working directory; Linux paths
      // to signing keys are not Windows paths either. Build on a native Windows
      // checkout and import the signed artifacts, validated against these sources.
      throw Error('Artefatos Windows ausentes ou desatualizados. No Linux/WSL, gere o MSI assinado em um checkout Windows do mesmo codigo e package-lock.json; importe com AGENT_WINDOWS_ARTIFACTS_DIR=/caminho/dos/artefatos ou AGENT_WINDOWS_RELEASE_REPO=owner/repo e NODEACCESS_RELEASE_PUBLIC_KEY. Nenhum pacote antigo sera utilizado.')
    }
    validateArtifacts(resolve(projectRoot, 'apps/agent/dist'))
  }
  for (const platform of ['linux', 'macos']) {
    try { validatePlatform(platform, projectRoot); console.log(`[agent] ${platform} up to date`); continue }
    catch (error) { if (checkOnly) throw error; console.log(`[agent] ${platform} rebuild required: ${error.message}`) }
    const spec = platforms[platform]
    run(process.execPath, [require.resolve('@yao-pkg/pkg/lib-es5/bin.js'), resolve(projectRoot, 'apps/agent/src/index.js'), '--target', spec.target, '--output', resolve(projectRoot, 'apps/agent/dist', spec.binary), '--config', resolve(projectRoot, 'apps/agent/package.json')])
    recordPlatform(platform, projectRoot)
    validatePlatform(platform, projectRoot)
  }
} catch (error) { console.error(`[agent] ${error.message}`); process.exitCode = 1 }
