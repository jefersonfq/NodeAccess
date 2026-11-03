// TypeDoc 0.28.20 uses matchOne removed by minimatch 11 (GHSA-g3hv-75wg-m249).
// Remove this temporary compatibility patch when upstream supports minimatch 11.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const originalDigest = '44982772d80190c9065e29081826b9586c2f65ab71a8d4dd0bbfdeecfecd9ebc'
const oldSource = `return mini.set.some((row) => mini.matchOne(
        childPath,
        row,
        /* partial */
        true
      ));`
const newSource = `return mini.match(childPath.join("/"), true) !== mini.negate;`
const digest = value => createHash('sha256').update(value).digest('hex')
export function patchTypeDoc(root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')) {
  const directory = join(root, 'node_modules/typedoc')
  if (!existsSync(directory)) return 'not-installed'
  const version = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).version
  if (version !== '0.28.20') throw new Error('TYPEDOC_PATCH_VERSION_REVIEW_REQUIRED')
  const file = join(directory, 'dist/node-utils.js'), source = readFileSync(file, 'utf8')
  if (source.includes(newSource) && digest(source.replace(newSource, oldSource)) === originalDigest) return 'already-applied'
  if (digest(source) !== originalDigest || !source.includes(oldSource)) throw new Error('TYPEDOC_PATCH_SOURCE_REVIEW_REQUIRED')
  writeFileSync(file, source.replace(oldSource, newSource))
  return 'applied'
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(`TypeDoc compatibility: ${patchTypeDoc()}`)
