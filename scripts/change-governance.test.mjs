import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseFrontmatter,
  validateBranch,
  validateCommit,
  validatePlan,
  validatePullRequest,
} from './change-governance-lib.mjs'

const branch = 'feature/NA-0001-20260803-change-lifecycle-governance'
const planPath = 'docs/changes/2026/08/NA-0001-change-lifecycle-governance/plan.md'
const sha = 'a'.repeat(40)

test('accepts a traceable branch and rejects generic branches', () => {
  assert.deepEqual(validateBranch(branch), {
    errors: [], changeId: 'NA-0001', date: '20260803', keywords: 'change-lifecycle-governance',
  })
  assert.deepEqual(validateBranch('process/NA-0007-20260804-observability-ui-governance'), {
    errors: [], changeId: 'NA-0007', date: '20260804', keywords: 'observability-ui-governance',
  })
  assert.equal(validateBranch('feature/login-fixes').errors.length, 1)
  assert.equal(validateBranch('main').errors.length, 1)
})

test('parses and validates plan metadata and required sections', () => {
  const content = `---
change_id: NA-0001
title: Lifecycle
type: feature
status: planned
created_at: 2026-08-03T10:00:00-03:00
base_branch: main
base_sha: ${'b'.repeat(40)}
branch: ${branch}
owner: codex
planner: codex
risk: medium
---
## Contexto e situação anterior
## Problema e objetivo
## Escopo
## Critérios de aceitação
- [ ] Validar
## Estratégia técnica
## Riscos e mitigações
## Matriz de testes e evidências
## Baseline
## Rollback ou recuperação
## Aprovação
- Decisão: \`GO\`
`
  assert.equal(parseFrontmatter(content).change_id, 'NA-0001')
  assert.deepEqual(validatePlan(content, { branch, changeId: 'NA-0001', path: planPath }).errors, [])
  assert.ok(validatePlan(content.replace('change_id: NA-0001', 'change_id: NA-9999'), { branch, changeId: 'NA-0001', path: planPath }).errors.length)
})

test('requires conventional commits, change id and traceability trailers', () => {
  const valid = {
    sha,
    subject: 'feat(governance): NA-0001 validate change lifecycle',
    body: `Plan: ${planPath}\nChange-Date: 2026-08-03T10:00:00-03:00\nTests: node --test`,
  }
  assert.deepEqual(validateCommit(valid, { changeId: 'NA-0001', planPath }), [])
  assert.ok(validateCommit({ ...valid, subject: 'ajustes finais', body: '' }, { changeId: 'NA-0001', planPath }).length >= 3)
})

test('requires a complete PR and evidence for the current SHA', () => {
  const body = `NA-0001
Plan: ${planPath}
## Identification
## Summary and reason
## Before
## Implemented
## After and comparison
## Scope
## Validation
Tested SHA: ${sha}
Result: PASS
## Risks and rollback
## Homologation
`
  assert.deepEqual(validatePullRequest(body, { changeId: 'NA-0001', planPath, headSha: sha }), [])
  assert.ok(validatePullRequest(body.replace(sha, 'b'.repeat(40)), { changeId: 'NA-0001', planPath, headSha: sha }).length)
})
