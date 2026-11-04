// Run with Node24 from a checkout root, or pass its absolute path as argv[2].
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const root = resolve(process.argv[2] || process.cwd())
const { stripDcsSequences, countTerminalControlSequences } = await import(pathToFileURL(resolve(root, 'apps/frontend/src/services/terminal-audit-controls.service.ts')))
const results = []
for (const prefixes of [1000, 4000, 12000, 250000]) {
  const input = '\x1bP'.repeat(prefixes) + '🙂\u2028\u2029'
  let start = performance.now()
  const actual = stripDcsSequences(input)
  const stripMs = performance.now() - start
  start = performance.now()
  const count = countTerminalControlSequences(input)
  const countMs = performance.now() - start
  let legacyMs = null
  if (prefixes <= 12000) {
    start = performance.now()
    const old = input.replace(/\x1bP[\s\S]*?(?:\x1b\\|\x07)/g, '')
    legacyMs = performance.now() - start
    if (old !== actual) throw new Error('Differential mismatch')
  }
  if (actual !== input || count !== prefixes) throw new Error('Contract mismatch')
  results.push({ prefixes, utf16Units: input.length, stripMs, countMs, legacyMs, unchanged: true, count })
}
console.log(JSON.stringify({ runtime: process.version, measuredAt: new Date().toISOString(), kind: 'Synthetic measurements; not an end-to-end exploit or SLA', results }, null, 2))
