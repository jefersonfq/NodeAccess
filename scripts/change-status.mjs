#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { deriveDeliveryStatus, DELIVERY_STATES } from './change-status-lib.mjs'

const args = parseArgs(process.argv.slice(2))
const root = process.cwd()
const currentBranch = git(['branch', '--show-current'])
const branch = args.branch ?? currentBranch
const defaultBranch = args.default ?? 'master'
const remote = args.remote ?? 'origin'
const localSha = ref(`refs/heads/${branch}`)
if (!localSha) fail(`Branch local não encontrada: ${branch}`)

const defaultLocalSha = ref(`refs/heads/${defaultBranch}`)
const defaultRemoteSha = ref(`refs/remotes/${remote}/${defaultBranch}`)
const expectedDefaultUpstream = `${remote}/${defaultBranch}`
const defaultUpstream = upstream(defaultBranch)
const remoteSha = ref(`refs/remotes/${remote}/${branch}`)
const baseCandidate = args.base ?? mergeBase(localSha, defaultRemoteSha ?? defaultLocalSha)
const baseSha = resolveCommit(baseCandidate)
if (!baseSha || !isAncestor(baseSha, localSha)) {
  fail('Base inválida ou não ancestral da branch. Informe --base <SHA> usando base_sha do plano.')
}
const topicWorktree = findWorktree(branch)
const dirty = Boolean(topicWorktree && gitAt(topicWorktree, ['status', '--porcelain'], { trim: false }).trim())
const hasCommits = localSha !== baseSha
const pushed = remoteSha === localSha
const merged = Boolean(hasCommits && defaultRemoteSha && isAncestor(localSha, defaultRemoteSha))
const masterSynced = Boolean(defaultLocalSha && defaultRemoteSha && defaultLocalSha === defaultRemoteSha)
const prOpen = parsePrState(args.pr)

const delivery = deriveDeliveryStatus({
  dirty,
  hasCommits,
  pushed,
  prOpen,
  merged,
  masterSynced,
  workspaceOnTopic: currentBranch === branch,
  workspaceOnDefault: currentBranch === defaultBranch,
})

const result = {
  schemaVersion: 2,
  branch,
  currentWorkspaceBranch: currentBranch,
  defaultBranch,
  baseSha,
  topicWorktree,
  localSha,
  remoteSha,
  defaultLocalSha,
  defaultRemoteSha,
  defaultUpstream,
  expectedDefaultUpstream,
  ...delivery,
  notes: [
    args.base ? null : 'BASE_DERIVED: use --base <base_sha do plano> para uma classificação histórica inequívoca.',
    prOpen === null ? 'PR_OPEN exige confirmação manual ou --pr open; GitHub CLI/API não foi consultado.' : null,
    !defaultUpstream ? `DEFAULT_UPSTREAM_MISSING: configure ${defaultBranch} para rastrear ${expectedDefaultUpstream}.` : null,
    defaultUpstream && defaultUpstream !== expectedDefaultUpstream
      ? `DEFAULT_UPSTREAM_MISMATCH: ${defaultBranch} rastreia ${defaultUpstream}; esperado ${expectedDefaultUpstream}.`
      : null,
  ].filter(Boolean),
}

if (args.json === 'true') {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log(`Mudança: ${branch}`)
  console.log(`Workspace atual: ${currentBranch || '(detached)'}`)
  for (const state of DELIVERY_STATES) console.log(`${state}: ${result.states[state]}`)
  console.log(`VISIBLE_IN_CURRENT_WORKSPACE: ${result.visibleInCurrentWorkspace ? 'yes' : 'no'}`)
  console.log(`NEXT_ACTION: ${result.nextAction}`)
  for (const note of result.notes) console.log(`NOTE: ${note}`)
}

function ref(name) {
  try {
    return git(['rev-parse', '--verify', name])
  } catch {
    return null
  }
}

function resolveCommit(value) {
  if (!value) return null
  try {
    return git(['rev-parse', '--verify', `${value}^{commit}`])
  } catch {
    return null
  }
}

function upstream(branchName) {
  try {
    return git(['for-each-ref', '--format=%(upstream:short)', `refs/heads/${branchName}`]) || null
  } catch {
    return null
  }
}

function isAncestor(ancestor, descendant) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd: root,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

function mergeBase(left, right) {
  if (!left || !right) return null
  try {
    return git(['merge-base', left, right])
  } catch {
    return null
  }
}

function findWorktree(targetBranch) {
  const entries = git(['worktree', 'list', '--porcelain'], { trim: false }).split(/\n\n+/)
  for (const entry of entries) {
    const lines = entry.split('\n')
    const path = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length)
    const refName = lines.find((line) => line.startsWith('branch '))?.slice('branch '.length)
    if (path && refName === `refs/heads/${targetBranch}`) return path
  }
  return null
}

function gitAt(cwd, values, options = {}) {
  const output = execFileSync('git', values, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return options.trim === false ? output : output.trim()
}

function git(values, options = {}) {
  const output = execFileSync('git', values, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return options.trim === false ? output : output.trim()
}

function parsePrState(value) {
  if (value === 'open') return true
  if (value === 'closed' || value === 'missing') return false
  return null
}

function parseArgs(values) {
  const result = {}
  for (let index = 0; index < values.length; index++) {
    const key = values[index]
    if (!key?.startsWith('--')) continue
    const name = key.slice(2)
    const next = values[index + 1]
    if (!next || next.startsWith('--')) result[name] = 'true'
    else {
      result[name] = next
      index++
    }
  }
  return result
}

function fail(message) {
  console.error(message)
  process.exit(2)
}
