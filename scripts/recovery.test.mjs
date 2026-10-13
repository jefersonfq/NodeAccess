import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recovery } from './recovery.mjs'

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'na-recovery-'))
  const repo = join(base, 'repo'); mkdirSync(repo)
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim()
  git('init'); git('symbolic-ref', 'HEAD', 'refs/heads/master'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid')
  writeFileSync(join(repo, 'file.txt'), 'version one\n');git('add', '.');git('commit', '-m', 'base')
  const sha = git('rev-parse', 'HEAD');git('update-ref', 'refs/remotes/origin/master', sha)
  return { base, repo, git, sha }
}
test('checkpoint is annotated, idempotent, preserves history, never publishes automatically', t => {
  const { repo, git, sha } = fixture(t)
  const result = recovery(['checkpoint', 'NA-0055'], repo)
  assert.equal(result.sha, sha); assert.equal(result.published, false)
  assert.equal(git('cat-file', '-t', `refs/tags/${result.tag}`), 'tag')
  assert.deepEqual(recovery(['checkpoint', 'NA-0055'], repo), result)
  assert.equal(recovery(['list'], repo).checkpoints.length, 1)
  writeFileSync(join(repo, 'file.txt'), 'dirty')
  assert.throws(() => recovery(['checkpoint', 'NA-0055'], repo), /limpa/)
})
test('restore gets old content without changing current branch, files or HEAD', t => {
  const { base, repo, git, sha } = fixture(t)
  writeFileSync(join(repo, 'file.txt'), 'version two\n');git('commit', '-am', 'second')
  const current = git('rev-parse', 'HEAD');const dest = join(base, 'restored with spaces')
  recovery(['restore-code', sha, dest], repo)
  assert.equal(readFileSync(join(dest, 'file.txt'), 'utf8'), 'version one\n')
  assert.equal(readFileSync(join(repo, 'file.txt'), 'utf8'), 'version two\n')
  assert.equal(git('rev-parse', 'HEAD'), current);assert.equal(git('branch', '--show-current'), 'master')
  assert.equal(git('status', '--porcelain'), '')
  assert.throws(() => recovery(['restore-code', sha, dest], repo), /novo/)
  assert.throws(() => recovery(['restore-code', sha, join(repo, 'nested')], repo), /fora/)
  assert.throws(() => recovery(['restore-code', sha, join(repo, '..restored')], repo), /fora/)
  assert.throws(() => recovery(['restore-code', sha, join(repo, '.git', '..restored')], repo), /fora/)
  symlinkSync(repo, join(base, 'linked'), 'dir')
  assert.throws(() => recovery(['restore-code', sha, join(base, 'linked', 'new')], repo), /fora/)

  assert.throws(() => recovery(['restore-code', '--help', join(base, 'invalid')], repo))
  assert.throws(() => recovery(['checkpoint', 'NA-0056'], repo), /sincronizada/)
})
test('rejects a conflicting existing checkpoint and invalid identity', t => {
  const { repo, git, sha } = fixture(t)
  git('tag', `checkpoint/NA-0055-${sha.slice(0, 12)}`, sha)
  assert.throws(() => recovery(['checkpoint', 'NA-0055'], repo), /não anotado/)
  assert.throws(() => recovery(['checkpoint', '../bad'], repo), /válido/)
})
