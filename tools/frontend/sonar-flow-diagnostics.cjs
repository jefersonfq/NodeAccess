const { lstatSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const stages = new Set(['setup', 'diagnostic', 'diagnostic-recovery', 'traceability', 'comparison-summary', 'jira', 'diagnostic-layout', 'dashboard', 'users-destination', 'hosts-destination', 'sessions-destination', 'dashboard-recovery', 'complete'])
const categories = new Set(['ASSERTION', 'TIMEOUT', 'OTHER'])
function flowFailure(stage, error) {
  return { stage: stages.has(stage) ? stage : 'setup', category: error?.name === 'AssertionError' ? 'ASSERTION' : error?.name === 'TimeoutError' ? 'TIMEOUT' : 'OTHER' }
}
function sanitizeFlowFailure(value) {
  if (!value || !stages.has(value.stage) || !categories.has(value.category)) return undefined
  return { stage: value.stage, category: value.category }
}
function readFlowFailure(directory) {
  try {
    if (!lstatSync(directory).isDirectory()) return undefined
    const file = join(directory, 'report.json'), stat = lstatSync(file)
    if (!stat.isFile() || stat.size > 65536) return undefined
    return sanitizeFlowFailure(JSON.parse(readFileSync(file, 'utf8')).failure)
  } catch { return undefined }
}
module.exports = { flowFailure, sanitizeFlowFailure, readFlowFailure }
