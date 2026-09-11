import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const result = spawnSync(process.execPath, ['scripts/release/prepare-agents.mjs'], { cwd: root, stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status || 0
