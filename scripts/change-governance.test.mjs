import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import {
  parseFrontmatter,
  validateBranch,
  validateCommit,
  validatePlan,
  validatePullRequest,
  validateImplementationRecord,
  validateLifecycle,
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

test('keeps the bundled plan template compatible with governance validation', () => {
  const template = readFileSync(
    'codex/skills/nodeaccess-change-lifecycle/assets/change-plan.template.md',
    'utf8',
  )
    .replaceAll('NA-0000', 'NA-0011')
    .replace('type: feature', 'type: docs')
    .replace('status: draft', 'status: planned')
    .replace('base_branch: main', 'base_branch: master')
    .replace('feature/NA-0011-20260803-keywords', 'docs/NA-0011-20260803-template-validation')
    .replace('- Decisão: `GO | GO_WITH_RISKS | NO_GO`', '- Decisão: `GO`')

  const templateBranch = 'docs/NA-0011-20260803-template-validation'
  const templatePath = 'docs/changes/2026/08/NA-0011-template-validation/plan.md'
  assert.deepEqual(validatePlan(template, {
    branch: templateBranch,
    changeId: 'NA-0011',
    path: templatePath,
  }).errors, [])
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


test('new implementation records require meaningful sections, dated interaction and honest checks', () => {
  const valid = `# NA-0055 — Registro
## Pedido e objetivo
Preservar versões e decisões de implementação.
## Implementação
Documentação e validação de rastreabilidade.
## Validação
Ran: teste local de recuperação em Git temporário.
## Recuperação
Reverter por PR sem excluir histórico ou dados.
## Pendências
Manual: homologação humana de release permanece pendente.
## Diário de interações
### 2026-10-11T08:00:00-03:00 — Pedido
Usuário autorizou organização e recuperação.
`
  assert.deepEqual(validateImplementationRecord(valid, 'NA-0055'), [])
  for (const invalid of [valid.replace('NA-0055', 'NA-0054'), valid.replace('## Recuperação', '## Outro'), valid.replace('Ran:', 'TBD:'), valid.replace('2026-10-11T08:00:00-03:00', 'hoje'), valid.replace('Preservar versões e decisões de implementação.', '')]) {
    assert.ok(validateImplementationRecord(invalid, 'NA-0055').length > 0)
  }
})


test('lifecycle requires journals for new changes while preserving legacy plans', t => {
  const root = mkdtempSync(join(tmpdir(), 'na-journal-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()
  git('init');git('config', 'user.name', 'Fixture');git('config', 'user.email', 'fixture@example.invalid')
  git('commit', '--allow-empty', '-m', 'base');const baseSha = git('rev-parse', 'HEAD')
  for (const id of ['NA-0054', 'NA-0055']) {
    const topic = `process/${id}-20261011-test`
    const planPath = `docs/changes/2026/10/${id}-test/plan.md`
    const dir = join(root, 'docs/changes/2026/10', `${id}-test`);mkdirSync(dir, { recursive: true })
    const plan = readFileSync('codex/skills/nodeaccess-change-lifecycle/assets/change-plan.template.md', 'utf8')
      .replaceAll('NA-0000', id).replace(`feature/${id}-20260803-keywords`, topic)
      .replace('- Decisão: `GO | GO_WITH_RISKS | NO_GO`', '- Decisão: `GO`')
    writeFileSync(join(dir, 'plan.md'), plan)
    git('add', '.');git('commit', '-m', `chore(test): ${id} validate journal`, '-m', `Plan: ${planPath}\nChange-Date: 2026-10-11T08:00:00-03:00\nTests: fixture`)
    const result = validateLifecycle({ root, branch: topic, baseSha: git('rev-parse', 'HEAD^'), headSha: git('rev-parse', 'HEAD') })
    assert.equal(result.errors.some(e => e.includes('implementation.md obrigatório')), id === 'NA-0055')
    if (id === 'NA-0055') {
      writeFileSync(join(dir, 'implementation.md'), '# NA-0055\nPREENCHER')
      const invalid = validateLifecycle({ root, branch: topic, baseSha, headSha: git('rev-parse', 'HEAD') })
      assert.ok(invalid.errors.some(e => e.includes('não preenchidos')))
    }
  }
})
