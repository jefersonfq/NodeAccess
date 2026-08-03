import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

export const BRANCH_RE = /^(feature|fix|security|performance|refactor|docs|test|chore|release)\/(NA-\d+)-(\d{8})-([a-z0-9]+(?:-[a-z0-9]+)*)$/
export const COMMIT_RE = /^(feat|fix|security|perf|refactor|docs|test|chore|build|ci|revert)(\([a-z0-9][a-z0-9-]*\))?!?: (NA-\d+) [a-z0-9].+$/
export const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

const REQUIRED_PLAN_FIELDS = [
  'change_id', 'title', 'type', 'status', 'created_at', 'base_branch',
  'base_sha', 'branch', 'owner', 'planner', 'risk',
]

const REQUIRED_PLAN_SECTIONS = [
  'Contexto e situação anterior', 'Problema e objetivo', 'Escopo',
  'Critérios de aceitação', 'Estratégia técnica', 'Riscos e mitigações',
  'Matriz de testes e evidências', 'Baseline', 'Rollback ou recuperação',
  'Aprovação',
]

const REQUIRED_PR_SECTIONS = [
  'Identification', 'Summary and reason', 'Before', 'Implemented',
  'After and comparison', 'Scope', 'Validation', 'Risks and rollback',
  'Homologation',
]

export function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return {}
  const result = {}
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([a-z_]+):\s*(.*)$/)
    if (!field) continue
    const value = field[2].trim().replace(/^['"]|['"]$/g, '')
    result[field[1]] = value === 'null' ? null : value
  }
  return result
}

export function validateBranch(branch) {
  const match = branch.match(BRANCH_RE)
  if (!match) return { errors: [`Branch inválida: ${branch}`] }
  return {
    errors: [],
    changeId: match[2],
    date: match[3],
    keywords: match[4],
  }
}

export function findPlanFiles(root = process.cwd()) {
  const base = join(root, 'docs', 'changes')
  if (!existsSync(base)) return []
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name === 'plan.md') files.push(relative(root, path).replaceAll('\\', '/'))
    }
  }
  walk(base)
  return files.sort()
}

export function validatePlan(content, { branch, changeId, path }) {
  const errors = []
  const metadata = parseFrontmatter(content)
  for (const field of REQUIRED_PLAN_FIELDS) {
    if (metadata[field] === undefined || metadata[field] === null || metadata[field] === '') {
      errors.push(`Plano sem metadado obrigatório: ${field}`)
    }
  }
  if (metadata.change_id !== changeId) errors.push(`Plano ${path} usa change_id ${metadata.change_id ?? 'ausente'}, esperado ${changeId}`)
  if (metadata.branch !== branch) errors.push(`Plano ${path} referencia branch ${metadata.branch ?? 'ausente'}, esperado ${branch}`)
  if (!ISO_RE.test(metadata.created_at ?? '')) errors.push('created_at deve usar ISO 8601 com timezone')
  if (!/^[0-9a-f]{40}$/i.test(metadata.base_sha ?? '')) errors.push('base_sha deve conter SHA completo de 40 caracteres')
  for (const section of REQUIRED_PLAN_SECTIONS) {
    if (!new RegExp(`^## ${escapeRegExp(section)}\\s*$`, 'mi').test(content)) errors.push(`Plano sem seção: ${section}`)
  }
  if (!/- \[[ xX]\]/.test(content)) errors.push('Plano sem critérios de aceitação em checklist')
  if (!/Decisão:\s*`?(GO|GO_WITH_RISKS|NO_GO)`?/i.test(content)) errors.push('Plano sem decisão GO, GO_WITH_RISKS ou NO_GO')
  return { errors, metadata }
}

export function validateCommit(commit, { changeId, planPath }) {
  const errors = []
  const subject = commit.subject.trim()
  const match = subject.match(COMMIT_RE)
  if (!match) errors.push(`Commit ${commit.sha.slice(0, 8)} não segue Conventional Commit + Change ID: ${subject}`)
  else if (match[3] !== changeId) errors.push(`Commit ${commit.sha.slice(0, 8)} usa ${match[3]}, esperado ${changeId}`)
  const trailers = parseTrailers(commit.body)
  if (trailers.Plan !== planPath) errors.push(`Commit ${commit.sha.slice(0, 8)} sem trailer Plan correto`)
  if (!ISO_RE.test(trailers['Change-Date'] ?? '')) errors.push(`Commit ${commit.sha.slice(0, 8)} sem Change-Date ISO 8601`)
  if (!trailers.Tests && !trailers.Evidence) errors.push(`Commit ${commit.sha.slice(0, 8)} precisa de Tests ou Evidence`)
  return errors
}

export function parseTrailers(body) {
  const trailers = {}
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z-]+):\s+(.+)$/)
    if (match) trailers[match[1]] = match[2].trim()
  }
  return trailers
}

export function validatePullRequest(body, { changeId, planPath, headSha }) {
  const errors = []
  if (!body?.trim()) return ['PR sem descrição']
  if (body.includes('{{')) errors.push('PR ainda contém placeholders não preenchidos')
  if (!body.includes(changeId)) errors.push(`PR não referencia ${changeId}`)
  if (!body.includes(planPath)) errors.push(`PR não referencia o plano ${planPath}`)
  for (const section of REQUIRED_PR_SECTIONS) {
    if (!new RegExp(`^## ${escapeRegExp(section)}\\s*$`, 'mi').test(body)) errors.push(`PR sem seção: ${section}`)
  }
  const testedSha = body.match(/Tested SHA:\s*`?([0-9a-f]{40})`?/i)?.[1]
  if (!testedSha) errors.push('PR sem Tested SHA completo')
  else if (testedSha !== headSha) errors.push(`PR referencia SHA testado ${testedSha}, HEAD atual é ${headSha}`)
  if (!/(PASS|PASS_WITH_WARNINGS)/.test(body)) errors.push('PR sem resultado PASS ou PASS_WITH_WARNINGS do harness')
  return errors
}

export function gitCommits(baseSha, headSha, cwd = process.cwd()) {
  const output = execFileSync('git', [
    'log', '--format=%H%x1f%s%x1f%b%x1e', `${baseSha}..${headSha}`,
  ], { cwd, encoding: 'utf8' })
  return output.split('\x1e').map(row => row.trim()).filter(Boolean).map((row) => {
    const [sha = '', subject = '', body = ''] = row.split('\x1f')
    return { sha, subject, body }
  })
}

export function validateLifecycle({ root = process.cwd(), branch, baseSha, headSha, prBody = null, requirePr = false }) {
  const errors = []
  const branchResult = validateBranch(branch)
  errors.push(...branchResult.errors)
  if (errors.length) return { errors, changeId: null, planPath: null, commits: 0 }

  const changeId = branchResult.changeId
  const matches = findPlanFiles(root).filter(path => path.includes(`/${changeId}-`))
  if (matches.length !== 1) {
    errors.push(`Esperado exatamente um plan.md para ${changeId}; encontrados ${matches.length}`)
    return { errors, changeId, planPath: matches[0] ?? null, commits: 0 }
  }
  const planPath = matches[0]
  const content = readFileSync(join(root, planPath), 'utf8')
  errors.push(...validatePlan(content, { branch, changeId, path: planPath }).errors)

  const commits = gitCommits(baseSha, headSha, root)
  if (!commits.length) errors.push(`Nenhum commit encontrado entre ${baseSha} e ${headSha}`)
  for (const commit of commits) errors.push(...validateCommit(commit, { changeId, planPath }))
  if (requirePr) errors.push(...validatePullRequest(prBody, { changeId, planPath, headSha }))

  return { errors, changeId, planPath, commits: commits.length }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
