// Reproducible source-extracted equivalence probe. No service/DB/SSH claim.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import assert from 'node:assert/strict'
const root = resolve(process.argv[2] || '.')
const ts = createRequire(resolve(root, 'package.json'))('typescript')
const base = '02e7521cbe69e72cb5c8c3f5f951dcdc6e1c5fec'
const paths = {
  slug: 'apps/backend/src/modules/diagnostic-playbooks/diagnostic-run.controller.ts',
  prompt: 'apps/backend/src/modules/session-audit/session-audit-normalizer.ts',
  fingerprints: ['native-ssh-gateway/native-ssh-gateway.host-key.ts', 'trials/trial-machines.ts', 'trials/trial.service.ts'].map(p => 'apps/backend/src/modules/' + p),
}
function ast(path, previous) {
  const text = previous ? execFileSync('/usr/bin/git', ['show', `${base}:${path}`], { cwd: root, encoding: 'utf8' }) : readFileSync(resolve(root, path), 'utf8')
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
}
function nodes(tree, predicate) {
  const result = []
  function visit(node) { if (predicate(node)) result.push(node); ts.forEachChild(node, visit) }
  visit(tree); return result
}
function evaluable(code) { return vm.runInNewContext(ts.transpile(code, { target: ts.ScriptTarget.ES2022 })) }
function slug(previous) {
  const tree = ast(paths.slug, previous)
  const entry = nodes(tree, n => ts.isVariableDeclaration(n) && n.name.getText(tree) === 'safeName')[0]
  return evaluable(`(name => { const report = { identity: { playbookName: name } }; return ${entry.initializer.getText(tree)} })`)
}
function prompt(previous) {
  const tree = ast(paths.prompt, previous)
  const guard = nodes(tree, n => ts.isVariableDeclaration(n) && n.name.getText(tree) === 'MULTI_PROMPT_LINE')[0]
  const fn = nodes(tree, n => ts.isFunctionDeclaration(n) && n.name?.text === 'collapseInlinePrompts')[0]
  return evaluable(`const ${guard.getText(tree)}; ${fn.getText(tree)}; collapseInlinePrompts`)
}
function padding(path, previous) {
  const tree = ast(path, previous)
  return nodes(tree, n => ts.isCallExpression(n) && n.expression.getText(tree).endsWith('.replace') && ts.isRegularExpressionLiteral(n.arguments[0]) && n.arguments[0].getText(tree).startsWith('/=')).map(n => evaluable(`value => value.replace(${n.arguments.map(arg => arg.getText(tree)).join(',')})`))
}
const current = { slug: slug(false), prompt: prompt(false) }
if (process.argv.includes('--large')) {
  let adversarialCases = 0
  for (const text of ['a'.repeat(200000), '['.repeat(200000), '-'.repeat(200000), 'a'.repeat(200000) + '$']) {
    current.slug(text); current.prompt(text); adversarialCases += 2
  }
  for (const path of paths.fingerprints) for (const fn of padding(path, false)) { assert.equal(fn('='.repeat(200000) + '!').length, 200001); adversarialCases++ }
  console.log(JSON.stringify({ adversarialCases, result: 'passed' }))
} else {
  const prior = { slug: slug(true), prompt: prompt(true) }
  let seed = 177, checks = 0
  const alphabet = ['a', 'Z', '-', ' ', '$', '#', '[', ']', '\t', '\r', '\n', 'é', '😀', '\u2028', '\u00a0']
  for (let index = 0; index < 5000; index++) {
    let value = ''
    for (let j = 0; j < index % 65; j++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; value += alphabet[seed % alphabet.length] }
    for (const name of ['slug', 'prompt']) { assert.equal(current[name](value), prior[name](value)); checks++ }
  }
  for (const a of ['root@host:~$', '[user /srv]#', '[中😀]>', 'router%']) for (const b of ['other$', '[x]#']) for (const ws of ['', ' ', '\t', '\r', '\n', '\u2028', '\u2029', '\ufeff']) {
    const value = ws + a + ws + b + ws
    assert.equal(current.prompt(value), prior.prompt(value)); checks++
  }
  for (const path of paths.fingerprints) {
    const before = padding(path, true), after = padding(path, false)
    assert.equal(before.length, after.length)
    for (let i = 0; i < before.length; i++) for (const prefix of ['', 'SHA256:']) for (const suffix of ['', '=']) {
      const value = prefix + 'Ab+/'.repeat(10) + 'abc' + suffix
      assert.equal(after[i](value), before[i](value)); checks++
    }
  }
  const large = execFileSync(process.execPath, [fileURLToPath(import.meta.url), root, '--large'], { timeout: 3000, encoding: 'utf8' })
  console.log(JSON.stringify({ base, equivalenceChecks: checks, result: 'passed', large: JSON.parse(large), limits: 'Source-extracted normalization expressions only; padding equivalence limited to validated zero/one suffix. No DB, transport or exploit assertion.' }, null, 2))
}
