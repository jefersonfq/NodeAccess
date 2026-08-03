#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { validateLifecycle } from './change-governance-lib.mjs'

const args = parseArgs(process.argv.slice(2))
const root = resolve(args.root ?? process.cwd())
const output = resolve(args.output ?? 'artifacts/change-governance/summary.json')
const startedAt = new Date().toISOString()

let branch = args.branch
let baseSha = args.base
let headSha = args.head
let prBody = null
let requirePr = false

if (args.event) {
  const event = JSON.parse(readFileSync(resolve(args.event), 'utf8'))
  const pr = event.pull_request
  if (!pr) failConfiguration('Evento não contém pull_request')
  branch = pr.head.ref
  baseSha = pr.base.sha
  headSha = pr.head.sha
  prBody = pr.body ?? ''
  requirePr = !pr.draft
}

if (!branch || !baseSha || !headSha) failConfiguration('Informe --branch, --base e --head, ou --event')

const result = validateLifecycle({ root, branch, baseSha, headSha, prBody, requirePr })
const summary = {
  schemaVersion: 1,
  changeId: result.changeId,
  branch,
  baseSha,
  testedSha: headSha,
  startedAt,
  finishedAt: new Date().toISOString(),
  status: result.errors.length ? 'failed' : 'passed',
  plan: result.planPath,
  commitsValidated: result.commits,
  checks: {
    branch: result.errors.some(error => error.startsWith('Branch inválida')) ? 'failed' : 'passed',
    plan: result.planPath && !result.errors.some(error => error.startsWith('Plano') || error.startsWith('Esperado exatamente')) ? 'passed' : 'failed',
    commits: result.commits > 0 && !result.errors.some(error => error.startsWith('Commit') || error.startsWith('Nenhum commit')) ? 'passed' : 'failed',
    pullRequest: requirePr ? (result.errors.some(error => error.startsWith('PR')) ? 'failed' : 'passed') : 'skipped',
  },
  errors: result.errors,
}

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 })
console.log(JSON.stringify(summary, null, 2))
process.exitCode = result.errors.length ? 1 : 0

function parseArgs(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index++) {
    const key = values[index]
    if (!key?.startsWith('--')) continue
    parsed[key.slice(2)] = values[index + 1]
    index++
  }
  return parsed
}

function failConfiguration(message) {
  console.error(message)
  process.exit(2)
}
