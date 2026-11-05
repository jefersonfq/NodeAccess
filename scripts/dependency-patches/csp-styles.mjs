// Temporary, source-pinned nonce propagation at reviewed CSS emitter sites only.
// Remove each patch when its library offers a native nonce API. Never patch DOM globally.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const digest = value => createHash('sha256').update(value).digest('hex')
export function patchCspStyles(root = resolve(here, '../..')) {
  const patches = JSON.parse(readFileSync(join(here, 'csp-styles.json'), 'utf8'))
  let applied = 0
  for (const patch of patches) {
    const file = join(root, 'node_modules', patch.path)
    if (!existsSync(file)) {
      const packageDirectory = join(root, 'node_modules', patch.path.split('/')[0])
      if (existsSync(packageDirectory)) throw new Error(`CSP_PATCH_EMITTER_MISSING: ${patch.path}`)
      continue // Backend-only workspace install without this package.
    }
    const source = readFileSync(file, 'utf8')
    if (source.split(patch.new).length - 1 === patch.count
      && digest(source.split(patch.new).join(patch.old)) === patch.sha256) continue
    if (digest(source) !== patch.sha256 || source.split(patch.old).length - 1 !== patch.count) {
      throw new Error(`CSP_PATCH_SOURCE_REVIEW_REQUIRED: ${patch.path}`)
    }
    writeFileSync(file, source.split(patch.old).join(patch.new))
    applied++
  }
  return applied
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`CSP reviewed emitter patches applied: ${patchCspStyles()}`)
}
