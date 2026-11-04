import ts from 'typescript'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
const path = 'tools/frontend/trial-live-playwright.mts'
const text = fs.readFileSync(path, 'utf8')
const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const expressions = []
function visit(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'password' && node.parent.getText(source).includes("'Forbidden destination'")) expressions.push(node.initializer.getText(source))
  ts.forEachChild(node, visit)
}
visit(source)
assert.equal(expressions.length, 1)
// Executa somente a expressão extraída da fonte confiável desta revisão.
const evaluate = new Function('randomBytes', `return (${expressions[0]})`)
const samples = Array.from({ length: 16 }, () => evaluate(randomBytes))
for (const value of samples) assert.match(value, /^[0-9a-f]{64}$/)
assert.equal(new Set(samples).size, 16)
const result = ts.transpileModule(text, { fileName: path, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.NodeNext, target: ts.ScriptTarget.ES2022 } })
assert.equal(result.diagnostics?.length, 0)
console.log(JSON.stringify({ expressions: 1, samples: 16, hex64: true, unique: true, transpileDiagnostics: 0 }))
