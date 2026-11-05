import test from 'node:test'
import assert from 'node:assert/strict'
import config from '../../stryker.config.mjs'
import vitestConfig from './vitest.config.mjs'
import { mutationFiles, mutationTests, mutationBudgetMs } from './scope.mjs'
import { summarizeMutationReport } from './report.mjs'

function fixture(statuses = ['Killed', 'Killed', 'Killed', 'Killed', 'Survived']) {
  return { files: Object.fromEntries(mutationFiles.map(file => [file, { source: 'private source', mutants: statuses.map((status, id) => ({ id: String(id), status, replacement: 'private replacement', location: { start: { line: id + 1 } } })) }])) }
}

test('pilot retains explicit scope, budget and enforcement without exclusions', () => {
  assert.deepEqual(config.mutate, [...mutationFiles])
  assert.deepEqual(vitestConfig.test.include, [...mutationTests])
  assert.equal(vitestConfig.test.maxWorkers, 1)
  assert.equal(vitestConfig.test.environment, 'node')
  assert.equal(config.concurrency, 2)
  assert.equal(config.thresholds.break, 80)
  assert.equal(config.thresholds.low, 80)
  assert.equal(config.incremental, false)
  assert.equal(config.allowEmpty, false)
  assert.equal(config.cleanTempDir, 'always')
  assert.equal(config.mutator, undefined)
  assert.equal(mutationBudgetMs, 900000)
})
test('boundary score passes and summary does not contain source or replacement', () => {
  const result = summarizeMutationReport(fixture())
  assert.equal(result.score, 80); assert.equal(result.passed, true)
  assert.equal(result.survivors.length, 2)
  assert.equal(JSON.stringify(result).includes('private'), false)
})
test('below-threshold and uncovered mutants fail', () => {
  assert.equal(summarizeMutationReport(fixture(['Killed', 'NoCoverage'])).passed, false)
  assert.equal(summarizeMutationReport(fixture(['Survived'])).passed, false)
})
test('aggregate score cannot conceal a weak selected module', () => {
  const data = fixture(Array(20).fill('Killed'))
  data.files[mutationFiles[1]].mutants = [{ id: '0', status: 'Survived' }]
  const result = summarizeMutationReport(data)
  assert.ok(result.score > 80); assert.equal(result.passed, false)
})
for (const status of ['Timeout', 'RuntimeError', 'Ignored']) test(`${status} cannot produce a green pilot`, () => {
  assert.equal(summarizeMutationReport(fixture(['Killed', 'Killed', 'Killed', 'Killed', status])).passed, false)
})
for (const [name, mutate] of [
  ['empty files', data => { data.files = {} }],
  ['missing module', data => { delete data.files[mutationFiles[0]] }],
  ['unexpected module', data => { data.files['outside.ts'] = data.files[mutationFiles[0]] }],
  ['no mutations', data => { data.files[mutationFiles[0]].mutants = [] }],
  ['unknown status', data => { data.files[mutationFiles[0]].mutants[0].status = 'Unknown' }],
  ['duplicate ID', data => { data.files[mutationFiles[0]].mutants[1].id = '0' }],
  ['no valid mutation', data => { data.files[mutationFiles[0]].mutants = [{ id: '0', status: 'CompileError' }] }],
]) test(`${name} rejects incomplete evidence`, () => {
  const data = fixture(); mutate(data)
  assert.throws(() => summarizeMutationReport(data))
})
