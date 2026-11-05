import { readFile, readdir, realpath } from 'node:fs/promises'
import { resolve, relative, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import convert from 'ast-v8-to-istanbul'
import { parseAstAsync } from 'vite'
import { normalizeBranchCounts } from './node-map.mjs'

const hash = text => createHash('sha256').update(text).digest('hex')
export async function convertBrowserScript({ root, origin, script, files, anomalies = [] }) {
  const url = new URL(script.url)
  if (url.origin !== origin || !url.pathname.startsWith('/src/') || url.searchParams.get('type') === 'style') throw new Error('Unexpected browser script URL')
  const file = resolve(root, 'apps/frontend', '.' + decodeURIComponent(url.pathname))
  const allowed = new Set(files.map(name => resolve(root, name)))
  if (!allowed.has(file) || await realpath(file) !== file) throw new Error('Browser source is outside inventory or symlinked')
  const code = script.source
  if (typeof code !== 'string' || script.codeSha256 !== hash(code)) throw new Error('Browser executed code hash mismatch')
  if (!Array.isArray(script.functions) || !script.functions.length) throw new Error('Browser ranges missing')
  for (const fn of script.functions) {
    if (!Array.isArray(fn.ranges) || !fn.ranges.length) throw new Error('Browser function ranges missing')
    for (const range of fn.ranges) {
      if (![range.startOffset, range.endOffset, range.count].every(Number.isSafeInteger)
        || range.startOffset < 0 || range.endOffset <= range.startOffset || range.endOffset > code.length || range.count < 0) throw new Error('Browser coverage offsets/counts invalid')
    }
  }
  const marker = '\n//# sourceMappingURL=data:application/json;base64,'
  const mapIndex = code.lastIndexOf(marker)
  if (mapIndex < 0) throw new Error('Browser source map missing or external')
  const encoded = code.slice(mapIndex + marker.length).trim()
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Browser source map encoding invalid')
  const sourceMap = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
  if (sourceMap.version !== 3 || sourceMap.sourceRoot || !Array.isArray(sourceMap.sources)
    || !sourceMap.sources.length || !Array.isArray(sourceMap.sourcesContent)
    || sourceMap.sources.length !== sourceMap.sourcesContent.length || typeof sourceMap.mappings !== 'string') throw new Error('Browser source map invalid')
  const provenance = []
  for (let index = 0; index < sourceMap.sources.length; index++) {
    const source = sourceMap.sources[index]
    if (typeof source !== 'string' || /^[a-z]+:/i.test(source)) throw new Error('Browser mapped source URL rejected')
    const path = resolve(dirname(file), source)
    if (!allowed.has(path) || await realpath(path) !== path) throw new Error('Browser mapped source outside inventory or symlinked')
    const content = await readFile(path, 'utf8')
    if (sourceMap.sourcesContent[index] !== content) throw new Error('Browser mapped source content differs from current source')
    provenance.push({ file: relative(root, path), sha256: hash(content) })
    sourceMap.sources[index] = path
  }
  const converted = await convert({ code, ast: await parseAstAsync(code), coverage: { ...script, url: pathToFileURL(file).href }, sourceMap, wrapperLength: 0 })
  const coverages = Object.values(converted)
  for (const coverage of coverages) if (!provenance.some(source => resolve(root, source.file) === coverage.path)) throw new Error('Unexpected converted browser source')
  normalizeBranchCounts(coverages, root, anomalies, 'chromium')
  return { coverages, provenance }
}

export async function browserCoverageRecords({ root, directory, files, fingerprint, capture, anomalies = [] }) {
  const inputs = (await readdir(directory)).filter(file => /^chromium-[a-f0-9-]+\.json$/.test(file)).sort((a, b) => a.localeCompare(b, 'en'))
  if (!inputs.length) throw new Error('Chromium coverage was not produced')
  const coverages = [], provenance = [], excluded = []
  let scripts = 0
  for (const file of inputs) {
    const report = JSON.parse(await readFile(join(directory, file), 'utf8'))
    const origin = new URL(report.origin)
    if (report.schemaVersion !== 1 || report.root !== root || report.fingerprint !== fingerprint
      || typeof capture?.captureRunId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(capture.captureRunId)
      || report.captureRunId !== capture?.captureRunId || report.origin !== capture?.origin
      || !Number.isFinite(Date.parse(report.capturedAt)) || !Number.isFinite(Date.parse(capture?.startedAt)) || !Number.isFinite(Date.parse(capture?.finishedAt))
      || Date.parse(report.capturedAt) < Date.parse(capture.startedAt) || Date.parse(report.capturedAt) > Date.parse(capture.finishedAt)
      || origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.origin !== report.origin
      || !Array.isArray(report.scripts)) throw new Error('Chromium capture provenance invalid')
    excluded.push(report.excluded)
    for (const script of report.scripts) {
      const result = await convertBrowserScript({ root, origin: report.origin, script, files, anomalies })
      coverages.push(...result.coverages); provenance.push(...result.provenance); scripts++
    }
  }
  if (!scripts || !coverages.length) throw new Error('Chromium capture has no mapped product sources')
  return { coverages, evidence: { captures: inputs.length, scripts, sources: [...new Map(provenance.map(item => [item.file, item])).values()], excluded } }
}

const location = loc => JSON.stringify({ start: loc.start, end: loc.end })
const signature = (kind, item) => kind === 's' ? location(item)
  : kind === 'f' ? JSON.stringify({ decl: item.decl, loc: item.loc })
    : JSON.stringify({ type: item.type, loc: item.loc, locations: item.locations })
/** Keep the authoritative map and its zeros; only exact source locations may receive observed browser hits. */
export function overlayBrowserCoverage(map, browserCoverages, root) {
  const evidence = { policy: 'exact original locations only; authoritative denominators unchanged', matched: { s: 0, f: 0, b: 0 }, unmatched: { s: 0, f: 0, b: 0 }, files: [] }
  for (const browser of browserCoverages) {
    if (!map.files().includes(browser.path)) throw new Error('Browser source missing from authoritative coverage')
    const target = map.fileCoverageFor(browser.path)
    evidence.files.push(relative(root, browser.path))
    for (const [kind, mapName] of [['s', 'statementMap'], ['f', 'fnMap'], ['b', 'branchMap']]) {
      const lookup = new Map()
      for (const [id, item] of Object.entries(browser[mapName])) {
        const key = signature(kind, item)
        if (!lookup.has(key)) lookup.set(key, [])
        lookup.get(key).push(id)
      }
      const targetCounts = new Map()
      for (const item of Object.values(target[mapName])) { const key = signature(kind, item); targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1) }
      const consumed = new Set()
      for (const [id, item] of Object.entries(target[mapName])) {
        const candidates = lookup.get(signature(kind, item)) ?? []
        // Duplicate mapping is ambiguous; never grant credit based on one of multiple generated entities.
        if (candidates.length !== 1 || targetCounts.get(signature(kind, item)) !== 1) continue
        const sourceId = candidates[0], hits = browser[kind][sourceId]
        const counts = Array.isArray(hits) ? hits : [hits]
        if (counts.some(count => !Number.isSafeInteger(count) || count < 0)) throw new Error('Invalid browser hit count')
        if (kind === 'b') {
          if (!Array.isArray(target.b[id]) || hits.length !== target.b[id].length) throw new Error('Browser branch arity mismatch')
          target.b[id] = target.b[id].map((count, index) => Math.max(count, hits[index]))
        } else target[kind][id] = Math.max(target[kind][id], hits)
        consumed.add(sourceId); evidence.matched[kind]++
      }
      evidence.unmatched[kind] += Object.keys(browser[mapName]).length - consumed.size
    }
  }
  evidence.files = [...new Set(evidence.files)].sort((a, b) => a.localeCompare(b, 'en'))
  return evidence
}
