import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import { deriveDeliveryStatus } from './change-status-lib.mjs'

const cliPath = resolve('scripts/change-status.mjs')

const base = {
  dirty: false,
  hasCommits: true,
  pushed: true,
  prOpen: null,
  merged: false,
  masterSynced: true,
  workspaceOnTopic: true,
  workspaceOnDefault: false,
}

test('reports local work before commit as the next action', () => {
  const result = deriveDeliveryStatus({ ...base, dirty: true, hasCommits: false, pushed: false })
  assert.equal(result.states.LOCAL_WIP, 'active')
  assert.equal(result.states.COMMITTED, 'pending')
  assert.equal(result.nextAction, 'review_and_commit')
})

test('does not confuse a local commit with a pushed branch', () => {
  const result = deriveDeliveryStatus({ ...base, pushed: false })
  assert.equal(result.states.COMMITTED, 'complete')
  assert.equal(result.states.PUSHED, 'pending')
  assert.equal(result.nextAction, 'push_branch')
})

test('keeps PR explicit when GitHub was not consulted', () => {
  const result = deriveDeliveryStatus(base)
  assert.equal(result.states.PUSHED, 'complete')
  assert.equal(result.states.PR_OPEN, 'manual')
  assert.equal(result.states.MERGED, 'pending')
  assert.equal(result.nextAction, 'open_or_confirm_pr')
})

test('requires default branch synchronization after merge', () => {
  const result = deriveDeliveryStatus({ ...base, prOpen: true, merged: true, masterSynced: false })
  assert.equal(result.states.MERGED, 'complete')
  assert.equal(result.states.MASTER_SYNCED, 'pending')
  assert.equal(result.nextAction, 'sync_default_branch')
})

test('marks completion only after merge and default synchronization', () => {
  const result = deriveDeliveryStatus({
    ...base,
    prOpen: true,
    merged: true,
    masterSynced: true,
    workspaceOnTopic: false,
    workspaceOnDefault: true,
  })
  assert.equal(result.states.MASTER_SYNCED, 'complete')
  assert.equal(result.visibleInCurrentWorkspace, true)
  assert.equal(result.nextAction, 'none')
})

test('explains when the current VS Code workspace cannot show topic files', () => {
  const result = deriveDeliveryStatus({
    ...base,
    workspaceOnTopic: false,
    workspaceOnDefault: true,
  })
  assert.equal(result.visibleInCurrentWorkspace, false)
})

test('collects fresh, dirty, pushed and merged states from real worktrees', () => {
  const sandbox = mkdtempSync(`${tmpdir()}/nodeaccess-change-status-`)
  const remote = `${sandbox}/remote.git`
  const main = `${sandbox}/main`
  const topic = `${sandbox}/topic`

  try {
    runGit(sandbox, ['init', '--bare', remote])
    runGit(sandbox, ['init', main])
    runGit(main, ['config', 'user.email', 'tests@nodeaccess.local'])
    runGit(main, ['config', 'user.name', 'NodeAccess Tests'])
    runGit(main, ['checkout', '-b', 'master'])
    writeFileSync(`${main}/base.txt`, 'base\n')
    runGit(main, ['add', 'base.txt'])
    runGit(main, ['commit', '-m', 'base'])
    runGit(main, ['remote', 'add', 'origin', remote])
    runGit(main, ['push', '-u', 'origin', 'master'])
    const baseSha = runGit(main, ['rev-parse', 'HEAD'])
    runGit(main, ['worktree', 'add', '-b', 'process/NA-9998-20260806-status-test', topic, baseSha])

    runGit(main, ['branch', '--unset-upstream'])
    const missingUpstream = readStatus(main, 'process/NA-9998-20260806-status-test', baseSha.slice(0, 7), null)
    assert.equal(missingUpstream.states.COMMITTED, 'pending')
    assert.equal(missingUpstream.baseSha, baseSha)
    assert.equal(missingUpstream.notes.some((note) => note.startsWith('DEFAULT_UPSTREAM_MISSING:')), true)
    runGit(main, ['branch', '--set-upstream-to', 'origin/master', 'master'])

    writeFileSync(`${topic}/change.txt`, 'dirty\n')
    const fresh = readStatus(main, 'process/NA-9998-20260806-status-test', baseSha)
    assert.equal(fresh.states.LOCAL_WIP, 'active')
    assert.equal(fresh.states.COMMITTED, 'pending')
    assert.equal(fresh.states.MERGED, 'pending')
    assert.equal(fresh.visibleInCurrentWorkspace, false)
    assert.equal(fresh.topicWorktree, topic)

    runGit(topic, ['add', 'change.txt'])
    runGit(topic, ['commit', '-m', 'topic'])
    runGit(topic, ['push', '-u', 'origin', 'process/NA-9998-20260806-status-test'])
    const pushed = readStatus(main, 'process/NA-9998-20260806-status-test', baseSha)
    assert.equal(pushed.states.COMMITTED, 'complete')
    assert.equal(pushed.states.PUSHED, 'complete')
    assert.equal(pushed.states.MERGED, 'pending')

    runGit(main, ['merge', '--ff-only', 'process/NA-9998-20260806-status-test'])
    runGit(main, ['push', 'origin', 'master'])
    const merged = readStatus(main, 'process/NA-9998-20260806-status-test', baseSha)
    assert.equal(merged.states.MERGED, 'complete')
    assert.equal(merged.states.MASTER_SYNCED, 'complete')
    assert.equal(merged.visibleInCurrentWorkspace, true)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

function readStatus(cwd, branch, baseSha, expectedUpstream = 'origin/master') {
  const result = JSON.parse(execFileSync(process.execPath, [
    cliPath,
    '--branch', branch,
    '--base', baseSha,
    '--json',
  ], { cwd, encoding: 'utf8' }))
  assert.equal(result.defaultUpstream, expectedUpstream)
  assert.equal(result.expectedDefaultUpstream, 'origin/master')
  if (expectedUpstream) {
    assert.equal(result.notes.some((note) => note.startsWith('DEFAULT_UPSTREAM_')), false)
  }
  return result
}

function runGit(cwd, values) {
  return execFileSync('git', values, { cwd, encoding: 'utf8' }).trim()
}
