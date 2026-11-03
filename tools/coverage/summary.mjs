import { resolve, relative, matchesGlob } from 'node:path'
import libCoverage from 'istanbul-lib-coverage'
import { globalThresholds, legacyServicePattern } from './sources.mjs'

export function summarizeCoverage(map, root, files) {
  const missing = files.filter(file => !map.files().includes(resolve(root, file)))
  const groups = new Map(), legacy = libCoverage.createCoverageMap({})
  for (const file of map.files()) {
    const name = relative(root, file).replaceAll('\\', '/')
    const group = /^(?:apps|packages)\//.test(name) ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]
    if (!groups.has(group)) groups.set(group, libCoverage.createCoverageMap({}))
    groups.get(group).addFileCoverage(map.fileCoverageFor(file))
    if (matchesGlob(name, legacyServicePattern)) legacy.addFileCoverage(map.fileCoverageFor(file))
  }
  const legacySummary = legacy.getCoverageSummary().toJSON()
  const requiredFiles = files.filter(file => matchesGlob(file, legacyServicePattern))
  const failures = []
  if (!requiredFiles.length || requiredFiles.length !== legacy.files().length) failures.push('LEGACY_SOURCE_SET_INCOMPLETE')
  for (const [metric, threshold] of Object.entries(globalThresholds)) {
    const value = legacySummary[metric]
    if (!value.total || 100 * value.covered / value.total < threshold) failures.push(`LEGACY_${metric.toUpperCase()}_BELOW_${threshold}`)
  }
  if (missing.length) failures.push('SOURCE_COVERAGE_INCOMPLETE')
  const unexpected = map.files().filter(file => !files.includes(relative(root, file).replaceAll('\\', '/')))
  if (unexpected.length) failures.push('UNEXPECTED_SOURCE_COVERAGE')
  return { global: map.getCoverageSummary().toJSON(), globalIsInformational: true,
    layers: Object.fromEntries([...groups].map(([name, group]) => [name, group.getCoverageSummary().toJSON()])),
    inventory: { count: files.length, reportedCount: map.files().length, missing, unexpected },
    legacy: { pattern: legacyServicePattern, count: legacy.files().length, thresholds: globalThresholds,
      summary: legacySummary, passed: failures.filter(reason => reason.startsWith('LEGACY_')).length === 0 }, failures }
}

/** Raw Node AST is authoritative for files executed by Node: transformed Vite branch maps cannot be summed. */
export function mergeCollectorMaps(vitestMap, nodeMap, root) {
  const map = libCoverage.createCoverageMap(vitestMap.toJSON())
  const nodeFiles = new Set(nodeMap.files())
  const discardedVitestCredit = []
  for (const file of map.files()) {
    if (!nodeFiles.has(file)) continue
    const summary = map.fileCoverageFor(file).toSummary().toJSON()
    if (summary.lines.covered || summary.functions.covered || summary.branches.covered) {
      discardedVitestCredit.push({ file: relative(root, file), lines: summary.lines.covered,
        functions: summary.functions.covered, branches: summary.branches.covered })
    }
  }
  map.filter(file => !nodeFiles.has(file))
  map.merge(nodeMap)
  return { map, authority: { nodeFiles: [...nodeFiles].map(file => relative(root, file)).sort((left, right) => left.localeCompare(right, 'en')), discardedVitestCredit } }
}
