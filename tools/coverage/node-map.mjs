import { readFile, readdir } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { stripTypeScriptTypes } from 'node:module'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeProcessCovs } from '@bcoe/v8-coverage'
import convert from 'ast-v8-to-istanbul'
import { parseAstAsync } from 'vite'
import libCoverage from 'istanbul-lib-coverage'

const sha256 = value => createHash('sha256').update(value).digest('hex')
const nativeTs = path => /\.(?:ts|mts)$/.test(path)

/** Capture before collectors execute; callers must launch children without custom loaders. */
export async function nativeTypeScriptProvenance(root, files) {
  const sourceHashes = {}
  for (const file of files.filter(nativeTs)) sourceHashes[file] = sha256(await readFile(resolve(root, file)))
  return { schemaVersion: 1, session: randomUUID(), root: resolve(root), nodeVersion: process.versions.node, mode: process.features.typescript, sourceHashes }
}

async function nativeTypeScriptCode({ root, path, script, data, nativeTypeScript, executedProof }) {
  const unsupported = () => new Error(`Unsupported native coverage transform: ${path}`)
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (!nativeTypeScript || nativeTypeScript.nodeVersion !== process.versions.node
    || (major !== 24 || minor < 21)
    || nativeTypeScript.mode !== 'strip' || process.features.typescript !== 'strip'
    || Object.hasOwn(data['source-map-cache'] ?? {}, script.url)) throw unsupported()
  const loader = data.result.find(entry => entry.url === 'node:internal/modules/typescript')
  if (!loader?.functions?.some(fn => fn.functionName === 'stripTypeScriptModuleTypes' && fn.ranges?.[0]?.count > 0)) throw unsupported()
  const bytes = await readFile(path), source = bytes.toString('utf8')
  if (nativeTypeScript.sourceHashes?.[relative(root, path)] !== sha256(bytes)) throw new Error(`Native TypeScript source provenance mismatch: ${path}`)
  let stripped, code
  try {
    stripped = stripTypeScriptTypes(source, { mode: 'strip' })
    code = stripTypeScriptTypes(source, { mode: 'strip', sourceUrl: script.url })
  } catch { throw unsupported() }
  // Only erasure is supported: every surviving UTF-16 position and line stays original.
  if (stripped.length !== source.length || code !== stripped + '\n\n//# sourceURL=' + script.url) throw unsupported()
  for (let offset = 0; offset < source.length; offset++) {
    if ((source[offset] === '\n' || source[offset] === '\r') && stripped[offset] !== source[offset]) throw unsupported()
    if (stripped[offset] !== source[offset] && stripped[offset] !== ' ' && stripped[offset] !== '\uFEFF') throw unsupported()
  }
  const matches = executedProof.scripts.filter(entry => entry.scriptId === script.scriptId && entry.url === script.url)
  if (matches.length !== 1 || matches[0].sha256 !== sha256(code) || matches[0].length !== code.length) throw new Error(`Native TypeScript executed source mismatch: ${path}`)
  const rootRange = script.functions?.[0]?.ranges?.[0]
  if (!rootRange || rootRange.startOffset !== 0 || rootRange.endOffset !== code.length) throw new Error(`Native TypeScript root offsets mismatch: ${path}`)
  for (const fn of script.functions) {
    for (const range of fn.ranges ?? []) {
      if (![range.startOffset, range.endOffset, range.count].every(Number.isSafeInteger)
        || range.startOffset < 0 || range.endOffset <= range.startOffset || range.count < 0
        || (range !== rootRange && range.endOffset > source.length)) throw new Error(`Native TypeScript coverage offsets/counts invalid: ${path}`)
    }
  }
  return code
}

/** Convert actual Node V8 ranges using the same AST converter as Vitest. */
export async function nodeCoverageMap({ root, directory, files, anomalies = [], nativeTypeScript }) {
  const allowed = new Set(files.map(file => resolve(root, file)))
  let merged = { result: [] }
  const nativeCodes = new Map()
  const inputs = (await readdir(directory)).filter(file => /^coverage-.+\.json$/.test(file)).sort((left, right) => left.localeCompare(right, 'en'))
  if (!inputs.length) throw new Error('Node coverage was not produced')
  for (const file of inputs) {
    const data = JSON.parse(await readFile(resolve(directory, file), 'utf8'))
    if (!Array.isArray(data.result)) throw new Error('Invalid Node coverage artifact')
    const result = data.result.filter(script => script.url?.startsWith('file:') && allowed.has(fileURLToPath(script.url)))
    let executedProof
    if (result.some(script => nativeTs(fileURLToPath(script.url)))) {
      const identity = /^coverage-(\d+)-(\d+)-(\d+)\.json$/.exec(file)
      if (!identity) throw new Error('Native TypeScript producer identity missing')
      try { executedProof = JSON.parse(await readFile(resolve(directory, `native-ts-${identity[1]}-${identity[3]}.json`), 'utf8')) }
      catch { throw new Error('Native TypeScript executed source proof missing') }
      if (executedProof.schemaVersion !== 1 || executedProof.complete !== true
        || executedProof.session !== nativeTypeScript?.session || executedProof.nodeVersion !== nativeTypeScript?.nodeVersion
        || executedProof.pid !== Number(identity[1]) || executedProof.threadId !== Number(identity[3])
        || !Array.isArray(executedProof.scripts)
        || new Set(executedProof.scripts.map(entry => entry.scriptId)).size !== executedProof.scripts.length) throw new Error('Native TypeScript executed source proof invalid')
    }
    // Validate each artifact before merging: a bad process must not be hidden by a good one.
    for (const script of result) {
      const path = fileURLToPath(script.url)
      if (nativeTs(path)) nativeCodes.set(path, await nativeTypeScriptCode({ root, path, script, data, nativeTypeScript, executedProof }))
    }
    merged = mergeProcessCovs([merged, { result }])
  }
  const map = libCoverage.createCoverageMap({})
  for (const script of merged.result) {
    const path = fileURLToPath(script.url)
    if (!/\.(?:js|mjs|cjs)$/.test(path) && !nativeCodes.has(path)) throw new Error(`Unsupported native coverage transform: ${path}`)
    const code = nativeCodes.get(path) ?? await readFile(path, 'utf8')
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
