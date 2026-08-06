#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const baseRef = process.env.LINT_BASE_REF
  ?? (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/master')

const candidates = new Set(lines(git(['diff', '--name-only', '--diff-filter=ACMR', `${baseRef}...HEAD`])))

if (process.env.LINT_INCLUDE_WORKTREE === 'true') {
  for (const file of lines(git(['diff', '--name-only', '--diff-filter=ACMR']))) candidates.add(file)
  for (const file of lines(git(['ls-files', '--others', '--exclude-standard']))) candidates.add(file)
}

const files = [...candidates]
  .filter((file) => /^apps\/(backend|frontend)\/src\/.+\.(ts|vue)$/.test(file))
  .filter((file) => !file.includes('-NOTE-JEFF.'))
  .filter((file) => existsSync(resolve(root, file)))
  .sort()

if (files.length === 0) {
  console.log('Nenhum arquivo TypeScript/Vue alterado para validar.')
  process.exit(0)
}

console.log(`Validando ${files.length} arquivo(s) alterado(s):`)
for (const file of files) console.log(`- ${file}`)

const eslint = resolve(root, 'node_modules/.bin/eslint')
const result = spawnSync(eslint, [...files, '--max-warnings', '0'], {
  cwd: root,
  stdio: 'inherit',
})

if (result.error) throw result.error
process.exit(result.status ?? 1)

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  } catch (error) {
    console.error(`Não foi possível comparar a alteração com ${baseRef}.`)
    throw error
  }
}

function lines(output) {
  return output.split('\n').map((line) => line.trim()).filter(Boolean)
}
