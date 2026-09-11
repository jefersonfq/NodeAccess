import { resolve } from 'node:path'
import { projectRoot, validateArtifacts } from '../../apps/agent/installer/windows/artifacts.mjs'
import { validatePlatform } from '../../apps/agent/installer/platform-artifacts.mjs'
const directory = resolve(process.argv[2] || resolve(projectRoot, 'apps/agent/dist'))
try {
  validateArtifacts(directory)
  for (const platform of ['linux', 'macos']) validatePlatform(platform, projectRoot, directory)
  console.log('[agent] Windows, Linux and macOS artifacts verified')
} catch (error) { console.error(error.message); process.exitCode = 1 }
