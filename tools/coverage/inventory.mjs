import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { matchesGlob, resolve } from 'node:path'
import { sourcePatterns, nonSourcePatterns } from './sources.mjs'

export function isSource(file) {
  return sourcePatterns.some(pattern => matchesGlob(file, pattern))
    && !nonSourcePatterns.some(pattern => matchesGlob(file, pattern))
}
export function repositoryFiles(root) {
  return [...new Set(execFileSync('/usr/bin/git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))].sort((left, right) => left.localeCompare(right, 'en'))
}
export function sourceInventory(root) { return repositoryFiles(root).filter(file => isSource(file) && existsSync(resolve(root, file))) }
export function nodeTestFiles(root) {
  return repositoryFiles(root).filter(file => existsSync(resolve(root, file)) && /^(apps\/agent\/src|scripts|tools)\//.test(file) && /\.(?:test|spec)\.(?:js|mjs|cjs)$/.test(file))
}
export function sourceFingerprint(root, files) {
  const hash = createHash('sha256')
  for (const file of files) hash.update(file).update('\0').update(readFileSync(resolve(root, file))).update('\0')
  return hash.digest('hex')
}
