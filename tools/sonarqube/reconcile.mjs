import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, lstatSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const hash = value => createHash('sha256').update(value).digest('hex')
const fail = code => { throw new Error(`REVIEW_${code}`) }
const states = 'OPEN,CONFIRMED,FALSE_POSITIVE,ACCEPTED,FIXED,IN_SANDBOX'
export function ruleFingerprint(rule) {
  if (!rule?.key || !rule.name || (!rule.htmlDesc && !rule.descriptionSections?.length)) fail('RULE_INVALID')
  return hash(JSON.stringify({ key: rule.key, name: rule.name, description: rule.htmlDesc,
    type: rule.type, repository: rule.repo,
    sections: [...(rule.descriptionSections ?? [])].map(section => ({ key: section.key, content: section.content,
      context: section.context ?? null })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en')),
    params: [...(rule.params ?? [])].sort((a, b) => a.key.localeCompare(b.key, 'en'))
      .map(({ key, type, defaultValue }) => ({ key, type, defaultValue })) }))
}
function source(root, path) {
  if (typeof path !== 'string' || !/^[\w./-]+$/.test(path) || path.startsWith('/')
      || path.split('/').some(part => !part || part === '.' || part === '..')) fail('PATH_INVALID')
  const file = resolve(root, path)
  if (!lstatSync(file).isFile() || realpathSync(file) !== file) fail('SOURCE_UNSAFE')
  return readFileSync(file)
}
const rangeKey = range => JSON.stringify(['startLine', 'endLine', 'startOffset', 'endOffset'].map(key => range?.[key]))
const identity = item => JSON.stringify([item.rule, item.file, item.hash, rangeKey(item.range)])
const group = item => JSON.stringify([item.rule, item.file, item.hash])
function validateManifest(root, manifest, project) {
  if (manifest?.schemaVersion !== 1 || manifest.project !== project || typeof manifest.serverVersion !== 'string'
      || !Array.isArray(manifest.findings) || manifest.findings.length > 1000) fail('MANIFEST_INVALID')
  const ids = new Set(), signatures = new Set()
  for (const item of manifest.findings) {
    if (!/^[A-Z0-9-]{3,64}$/.test(item.id) || ids.has(item.id) || signatures.has(identity(item))
        || !/^[\w-]+:S?\w+$/.test(item.rule) || !/^[a-f0-9]{32,64}$/.test(item.hash)
        || !/^[a-f0-9]{64}$/.test(item.sourceSha256) || !/^[a-f0-9]{64}$/.test(item.ruleSha256)
        || typeof item.rationale !== 'string' || item.rationale.trim().length < 30 || item.rationale.length > 2000
        || !Array.isArray(item.evidence) || !item.evidence.length) fail('ENTRY_INVALID')
    const r = item.range
    if (!r || !['startLine', 'endLine', 'startOffset', 'endOffset'].every(k => Number.isSafeInteger(r[k]))
        || r.startLine < 1 || r.endLine < r.startLine || r.startOffset < 0 || r.endOffset < 0
        || (r.startLine === r.endLine && r.endOffset < r.startOffset)) fail('RANGE_INVALID')
    if (hash(source(root, item.file)) !== item.sourceSha256) fail('SOURCE_CHANGED')
    for (const evidence of item.evidence) source(root, evidence)
    ids.add(item.id); signatures.add(identity(item))
  }
}
function checkout(root, revision, findings, verifyBlobs = false) {
  if (!/^[a-f0-9]{40}$/.test(revision ?? '')) fail('REVISION_INVALID')
  const git = args => execFileSync('/usr/bin/git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 })
  try {
    if (git(['rev-parse', 'HEAD']).trim() !== revision || git(['status', '--porcelain', '--untracked-files=no']).trim()) fail('CHECKOUT_CHANGED')
    if (verifyBlobs) for (const item of findings) {
      const blob = execFileSync('/usr/bin/git', ['show', `${revision}:${item.file}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 })
      if (hash(blob) !== item.sourceSha256) fail('GIT_SOURCE_CHANGED')
    }
  } catch (error) {
    if (/^REVIEW_[A-Z_]+$/.test(error?.message ?? '')) throw error
    fail('CHECKOUT_UNVERIFIED')
  }
}
async function inventory(request, project) {
  const result = [], seen = new Set()
  let total
  for (let p = 1; p <= 100; p++) {
    const data = await request('/api/issues/search', { components: project, issueStatuses: states,
      additionalFields: 'transitions', p, ps: 100 }, 'GET')
    if (!data.paging || !Number.isSafeInteger(data.paging.total) || data.paging.total < 0 || data.paging.total > 10000
        || data.paging.pageIndex !== p || data.paging.pageSize !== 100 || !Array.isArray(data.issues)
        || (total !== undefined && total !== data.paging.total)) fail('PAGINATION_INVALID')
    total = data.paging.total
    for (const issue of data.issues) {
      if (typeof issue.key !== 'string' || seen.has(issue.key) || issue.project !== project
          || !issue.component?.startsWith(`${project}:`)) fail('ISSUE_INVALID')
      seen.add(issue.key); result.push(issue)
    }
    if (result.length === total) return result
    if (result.length > total || data.issues.length !== 100) fail('PAGINATION_INVALID')
  }
  fail('PAGINATION_LIMIT')
}

/** Only applies independently documented false-positive decisions. Never accepts risk. */
export async function reconcile({ root, project = 'nodeaccess', analysisId, revision, request,
  manifestPath = 'docs/sonarqube/reviewed-false-positives.json', dryRun = true, record = () => {} }) {
  if (!existsSync(resolve(root, manifestPath))) {
    checkout(root, revision, [])
    return { status: 'no_reviews', proposed: 0, changed: 0, absent: 0, unchanged: 0 }
  }
  const result = { status: 'pending', proposed: 0, changed: 0, absent: 0, unchanged: 0 }
  try {
    const manifestBytes = source(root, manifestPath), manifestHash = hash(manifestBytes)
    const manifest = JSON.parse(manifestBytes.toString('utf8'))
    validateManifest(root, manifest, project)
    checkout(root, revision, manifest.findings, true)
    const current = async () => {
      const data = await request('/api/project_analyses/search', { project, ps: 1 }, 'GET')
      if (!analysisId || !revision || data.analyses?.[0]?.key !== analysisId || data.analyses[0].revision !== revision) fail('ANALYSIS_CHANGED')
      validateManifest(root, manifest, project)
      checkout(root, revision, manifest.findings)
      if (hash(source(root, manifestPath)) !== manifestHash) fail('MANIFEST_CHANGED')
    }
    await current()
    if ((await request('/api/system/status', {}, 'GET')).version !== manifest.serverVersion) fail('SERVER_CHANGED')
    const rules = new Map()
    for (const item of manifest.findings) {
      if (!rules.has(item.rule)) rules.set(item.rule, ruleFingerprint((await request('/api/rules/show', { key: item.rule }, 'GET')).rule))
      if (rules.get(item.rule) !== item.ruleSha256) fail('RULE_CHANGED')
    }
    const issues = await inventory(request, project), pending = []
    const groups = new Set(manifest.findings.map(item => group(item))), expected = new Set(manifest.findings.map(item => identity(item)))
    for (const issue of issues) {
      const item = { rule: issue.rule, file: issue.component.slice(project.length + 1), hash: issue.hash, range: issue.textRange }
      if (groups.has(group(item)) && !expected.has(identity(item))) fail('UNREVIEWED_OCCURRENCE')
    }
    for (const item of manifest.findings) {
      const candidates = issues.filter(issue => identity({ rule: issue.rule, file: issue.component.slice(project.length + 1),
        hash: issue.hash, range: issue.textRange }) === identity(item))
      if (!candidates.length) { result.absent++; continue }
      if (candidates.length !== 1) fail('MATCH_AMBIGUOUS')
      const issue = candidates[0]
      if (issue.issueStatus === 'FALSE_POSITIVE') { result.unchanged++; continue }
      if (issue.issueStatus !== 'OPEN' || !issue.transitions?.includes('falsepositive')) fail('DECISION_CONFLICT')
      pending.push({ item, issue })
    }
    result.proposed = pending.length
    await current()
    if (dryRun) return { ...result, status: 'dry_run' }
    for (const { item, issue } of pending) {
      await current()
      const fresh = await request('/api/issues/search', { issues: issue.key, additionalFields: 'transitions,comments', ps: 1 }, 'GET')
      const actual = fresh.issues?.[0]
      if (fresh.paging?.total !== 1 || actual?.key !== issue.key || actual.project !== project
          || actual.issueStatus !== 'OPEN' || !actual.transitions?.includes('falsepositive')
          || identity({ rule: actual.rule, file: actual.component.slice(project.length + 1), hash: actual.hash, range: actual.textRange }) !== identity(item)) fail('ISSUE_CHANGED')
      const marker = `[NodeAccess review ${item.id} ${item.sourceSha256}]`
      const comment = `${marker}\n${item.rationale}\nEvidence: ${item.evidence.join(', ')}`
      if (!Array.isArray(actual.comments)) fail('COMMENTS_UNVERIFIED')
      const previous = actual.comments.filter(c => (c.markdown ?? c.htmlText ?? '').includes(marker))
      if (previous.length > 1 || (previous.length === 1 && previous[0].markdown !== comment)) fail('COMMENT_CONFLICT')
      if (!previous.length) {
        await request('/api/issues/add_comment', { issue: issue.key, text: comment }, 'POST')
        record({ id: item.id, key: issue.key, action: 'commented', previousState: issue.issueStatus })
      }
      await current()
      const before = await request('/api/issues/search', { issues: issue.key, additionalFields: 'transitions', ps: 1 }, 'GET')
      const latest = before.issues?.[0]
      if (before.paging?.total !== 1 || latest?.key !== issue.key || latest.issueStatus !== 'OPEN'
          || latest.project !== project || latest.component !== issue.component || !latest.transitions?.includes('falsepositive')
          || identity({ rule: latest.rule, file: latest.component.slice(project.length + 1), hash: latest.hash, range: latest.textRange }) !== identity(item)) fail('ISSUE_CHANGED')
      record({ id: item.id, key: issue.key, action: 'transition_intent', previousState: issue.issueStatus })
      const changed = await request('/api/issues/do_transition', { issue: issue.key, transition: 'falsepositive' }, 'POST')
      record({ id: item.id, key: issue.key, action: 'transition_requested', previousState: issue.issueStatus })
      if (changed.issue?.key !== issue.key || changed.issue.issueStatus !== 'FALSE_POSITIVE') fail('TRANSITION_NOT_VERIFIED')
      result.changed++
    }
    await current()
    const after = await inventory(request, project)
    for (const { issue } of pending) if (after.find(i => i.key === issue.key)?.issueStatus !== 'FALSE_POSITIVE') fail('FINAL_STATE_INVALID')
    return { ...result, status: 'applied' }
  } catch (error) {
    record({ action: 'failed', changed: result.changed })
    if (/^REVIEW_[A-Z_]+$/.test(error?.message ?? '')) throw error
    fail('EXECUTION_FAILED')
  }
}
