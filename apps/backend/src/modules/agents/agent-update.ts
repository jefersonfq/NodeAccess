import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

// Public release metadata only. Never includes enrollment credentials or host data.
export function readWindowsAgentUpdate(directory: string) {
  const manifest = JSON.parse(readFileSync(resolve(directory, 'nodeaccess-agent-windows-x64.json'), 'utf8').replace(/^\uFEFF/, ''))
  if (manifest.product !== 'NodeAccess Agent' || manifest.platform !== 'windows' || manifest.architecture !== 'x64' ||
      typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Invalid agent release')
  const entries = Array.isArray(manifest.artifacts) ? manifest.artifacts.filter((item: { file?: string }) => item?.file === 'nodeaccess-agent-windows-x64.msi') : []
  if (entries.length !== 1) throw new Error('Installer missing or duplicated')
  const entry = entries[0]
  const file = statSync(resolve(directory, 'nodeaccess-agent-windows-x64.msi'))
  if (!file.isFile() || !Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > 512 * 1024 * 1024 ||
      entry.size !== file.size || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid installer metadata')
  return {
    ...(manifest.releaseProof ? { releaseProof: manifest.releaseProof } : {}),
    schemaVersion: 1,
    version: manifest.version as string,
    platform: 'windows',
    architecture: 'x64',
    downloadPath: '/api/v1/agents/download/windows_msi',
    size: entry.size as number,
    sha256: entry.sha256 as string,
  }
}
