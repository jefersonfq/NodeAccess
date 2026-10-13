#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, basename, resolve, relative, isAbsolute, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export function recovery(args, cwd = process.cwd()) {
  const git = (...values) => execFileSync('git', values, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const root = git('rev-parse', '--show-toplevel')
  const commit = ref => git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`)
  const tree = sha => git('rev-parse', `${sha}^{tree}`)
  const [command, ref, destination] = args
  if (command === 'list' && args.length === 1) {
    return { checkpoints: git('for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/tags/checkpoint/').split('\n').filter(Boolean), note: 'Tags identificam código; dados/configurações e pacotes têm recuperação própria.' }
  }
  if (command === 'checkpoint' && args.length === 2) {
    if (!/^NA-\d{4,}$/.test(ref)) throw new Error('Informe Change ID NA-0000 válido')
    if (git('status', '--porcelain')) throw new Error('Checkpoint exige árvore limpa')
    const sha = commit('HEAD')
    if (git('branch', '--show-current') !== 'master' || sha !== commit('origin/master')) throw new Error('Checkpoint exige master sincronizada; faça fetch e confirme o merge antes')
    const tag = `checkpoint/${ref}-${sha.slice(0, 12)}`
    const matches = git('tag', '--list', tag)
    if (matches) {
      if (commit(`refs/tags/${tag}`) !== sha || git('cat-file', '-t', `refs/tags/${tag}`) !== 'tag') throw new Error('Checkpoint existente divergente ou não anotado')
    } else git('tag', '-a', tag, sha, '-m', `${ref}: checkpoint de código\nCommit: ${sha}\nTree: ${tree(sha)}\nNão é release homologada nem backup de dados/configuração.`)
    return { tag, sha, tree: tree(sha), published: false, next: `git push origin refs/tags/${tag}` }
  }
  if (command === 'inspect' && args.length === 2 && ref) {
    const sha = commit(ref)
    return { sha, tree: tree(sha), subject: git('show', '-s', '--format=%s', sha) }
  }
  if (command === 'restore-code' && args.length === 3 && ref && destination) {
    const sha = commit(ref)
    const target = resolve(cwd, destination)
    if (existsSync(target)) throw new Error('Destino deve ser novo; nenhum arquivo será sobrescrito')
    const parent = realpathSync(dirname(target))
    const canonicalTarget = resolve(parent, basename(target))
    const gitDir = realpathSync(resolve(cwd, git('rev-parse', '--git-common-dir')))
    for (const source of [realpathSync(root), gitDir]) {
      const rel = relative(source, canonicalTarget)
      if (!rel || (!(rel === '..' || rel.startsWith(`..${sep}`)) && !isAbsolute(rel))) throw new Error('Destino precisa ficar fora do checkout e dos metadados Git')
    }
    git('worktree', 'add', '--detach', canonicalTarget, sha)
    return { destination: canonicalTarget, sha, tree: tree(sha), note: 'Somente código. Não iniciar com banco de produção. Dependências, .env, chaves, dados e imagens exigem preparação própria; worktree compartilha metadados Git.' }
  }
  throw new Error('Uso: node scripts/recovery.mjs list | inspect <ref> | checkpoint <NA-ID> | restore-code <ref> <pasta-nova>')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(recovery(process.argv.slice(2)), null, 2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
