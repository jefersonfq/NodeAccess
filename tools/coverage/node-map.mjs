import { readFile, readdir } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeProcessCovs } from '@bcoe/v8-coverage'
import convert from 'ast-v8-to-istanbul'
import { parseAstAsync } from 'vite'
import libCoverage from 'istanbul-lib-coverage'

/** Convert actual Node V8 ranges using the same AST converter as Vitest. */
export async function nodeCoverageMap({ root, directory, files, anomalies = [] }) {
  const allowed = new Set(files.map(file => resolve(root, file)))
  let merged = { result: [] }
  const inputs = (await readdir(directory)).filter(file => /^coverage-.+\.json$/.test(file)).sort()
  if (!inputs.length) throw new Error('Node coverage was not produced')
  for (const file of inputs) {
    const data = JSON.parse(await readFile(resolve(directory, file), 'utf8'))
    if (!Array.isArray(data.result)) throw new Error('Invalid Node coverage artifact')
    const result = data.result.filter(script => script.url?.startsWith('file:') && allowed.has(fileURLToPath(script.url)))
    merged = mergeProcessCovs([merged, { result }])
  }
  const map = libCoverage.createCoverageMap({})
  for (const script of merged.result) {
    const path = fileURLToPath(script.url)
    // Native tests currently execute JS only. Reject unknown transforms instead of assigning offsets to wrong source.
    if (!/\.(?:js|mjs|cjs)$/.test(path)) throw new Error(`Unsupported native coverage transform: ${path}`)
    const code = await readFile(path, 'utf8')
    if (script.functions.some(fn => fn.ranges.some(range => range.startOffset < 0 || range.endOffset > code.length))) throw new Error(`Coverage offsets do not match source: ${path}`)
    const converted = await convert({ code, ast: await parseAstAsync(code), coverage: script, wrapperLength: 0 })
    normalizeBranchCounts(Object.values(converted), root, anomalies, 'node')
    map.merge(converted)
  }
  return map
}

/** Keep uncertain upstream counts uncovered, including Vitest using this same converter. */
export function normalizeBranchCounts(coverages, root, anomalies, collector) {
  for (const coverage of coverages) {
      for (const [branchId, hits] of Object.entries(coverage.b)) {
        hits.forEach((count, index) => {
          if (!Number.isSafeInteger(count)) throw new Error('Invalid converted branch count')
          // Upstream implicit-else subtraction can be negative for nested callbacks.
          // Preserve the branch denominator; uncertainty must never receive coverage credit.
          if (count < 0) {
            anomalies.push({ file: relative(root, coverage.path), line: coverage.branchMap[branchId].line,
              collector, branchId, index, rawCount: count, normalized: 0, converterVersion: 'ast-v8-to-istanbul@1.0.7' })
            hits[index] = 0
          }
        })
      }
    }
}
