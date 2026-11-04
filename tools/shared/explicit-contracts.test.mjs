import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const require = createRequire(import.meta.url)
const ts = require('typescript')
const root = new URL('../../', import.meta.url)
const files = ['scripts/change-governance-lib.mjs', 'scripts/deploy/runtime-permissions.mjs', 'scripts/lint-changed.mjs', 'scripts/release/release-provenance.mjs', 'scripts/trial-lab/provider.mjs', 'tools/session-audit/reconstruction-sql-review.mts', 'tools/tls/manager.mjs', 'apps/frontend/src/services/guacamole-import.service.ts', 'apps/frontend/src/services/mobaxterm-import.service.ts']
function source(file) { return ts.createSourceFile(file, readFileSync(new URL(file, root), 'utf8'), ts.ScriptTarget.Latest, true) }
function declaration(file, name) {
  const ast = source(file)
  const node = ast.statements.find(entry => ts.isFunctionDeclaration(entry) && entry.name?.text === name)
  assert.ok(node, `${file}: ${name}`)
  return ts.transpile(node.getText(ast), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS })
}
const values = ['', 'a', 'A', '10', '2', 'é', 'e\u0301', 'Ω', '中', '😀', '\ud800', '\udfff', '/a', '/A', '../a', 'sha256:00', 'sha256:ff']
for (const file of files) {
  test(`${file} preserves native UTF16 ordering including duplicates and hash input`, () => {
    const compare = vm.runInNewContext(`${declaration(file, 'compareCodeUnits')}; compareCodeUnits`)
    for (let shift = 0; shift < values.length; shift++) {
      const input = [...values.slice(shift), ...values.slice(0, shift), ...values].reverse()
      assert.deepEqual(input.toSorted(compare), input.toSorted())
      const digest = array => createHash('sha256').update(JSON.stringify(array)).digest('hex')
      assert.equal(digest(input.toSorted(compare)), digest(input.toSorted()))
    }
    for (const left of values) for (const right of values) assert.deepEqual([left, right].sort(compare), [left, right].sort())
  })
}

test('TLS request digest remains identical for reordered properties, Unicode and replay input', () => {
  const file = 'tools/tls/manager.mjs'
  const ast = source(file)
  const declarationNode = ast.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]).find(node => node.name.getText(ast) === 'requestDigest')
  assert.ok(declarationNode)
  const digest = vm.runInNewContext(`${declaration(file, 'compareCodeUnits')}; (${declarationNode.initializer.getText(ast)})`, { createHash })
  const entries = values.map((key, index) => [key, index])
  for (const pairs of [entries, [...entries].reverse()]) {
    const input = Object.fromEntries(pairs)
    const expected = createHash('sha256').update(JSON.stringify(['actor', Object.keys(input).sort().map(key => [key, input[key]])])).digest('hex')
    assert.equal(digest(input, 'actor'), expected)
  }
})

test('real viewport function fills only missing dimensions without mutating caller', async () => {
  const calls = []
  const context = { addInitScript: async () => {}, newPage: async () => ({}) }
  const browser = { newContext: async options => { calls.push(options.viewport); return context } }
  const newPage = vm.runInNewContext(`${declaration('tools/frontend/session-command-policies-playwright.cjs', 'newPage')}; newPage`, { fakeJwt: () => 'fixture', installMocks: async () => {} })
  for (const [input, expected] of [[undefined, { width: 1440, height: 900 }], [{ width: 800 }, { width: 800, height: 900 }], [{ height: 600 }, { width: 1440, height: 600 }], [{ width: 0, height: 0 }, { width: 0, height: 0 }], [{ width: 800, height: 600 }, { width: 800, height: 600 }]]) {
    if (input) Object.freeze(input)
    await newPage(browser, 'fixture', input)
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), expected)
  }
})
