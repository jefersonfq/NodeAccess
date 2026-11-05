import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const PAGE_SIZE = 100
const MAX_RESULTS = 10_000
const MAX_BYTES = 32 * 1024 * 1024
const retryable = new Set([429, 502, 503, 504])
// Confirmed against Community Build 26.10 /api/webservices/list.
const expectedApi = {
  'api/issues': { search: ['components', 'resolved', 'p', 'ps'] },
  'api/hotspots': { search: ['project', 'p', 'ps'] },
  'api/qualitygates': { project_status: ['projectKey'] },
}

// Fixed error codes only: server responses can contain credentials or source snippets.
export class ExportError extends Error {
  constructor(code) { super(code); this.name = 'ExportError'; this.code = code }
}
function fail(code) { throw new ExportError(code) }
export function localUrl(value) {
  let url
  try { url = new URL(value) } catch { fail('INVALID_SERVER_URL') }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') fail('LOCAL_SERVER_REQUIRED')
  // Avoid DNS rebinding through local hostname configuration.
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1'
  return url
}

async function readJson(response) {
  if (!response.body) fail('INVALID_JSON')
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_BYTES) { await reader.cancel(); fail('RESPONSE_TOO_LARGE') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { fail('INVALID_JSON') }
}

export function client({ server, token, timeoutMs = 15_000, retryDelayMs = 300 }) {
  const base = localUrl(server)
  if (!token || /[\r\n]/.test(token)) fail('TOKEN_REQUIRED')
  return async (path, params = {}) => {
    const url = new URL(path, base)
    if (url.origin !== base.origin) fail('LOCAL_SERVER_REQUIRED')
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
        })
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel(); fail('REDIRECT_REFUSED')
        }
        if (!response.ok) {
          await response.body?.cancel()
          if (retryable.has(response.status) && attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, retryDelayMs * (attempt + 1)))
            continue
          }
          fail(response.status === 401 || response.status === 403 ? 'AUTHORIZATION_FAILED' : 'HTTP_REQUEST_FAILED')
        }
        return await readJson(response)
      } catch (error) {
        if (error instanceof ExportError) throw error
        if (attempt === 2) fail('NETWORK_OR_TIMEOUT')
        await new Promise(resolve => setTimeout(resolve, retryDelayMs * (attempt + 1)))
      }
    }
    fail('REQUEST_FAILED')
  }
}

function validateApi(document) {
  if (!Array.isArray(document?.webServices)) fail('API_SCHEMA_MISMATCH')
  for (const [path, actions] of Object.entries(expectedApi)) {
    const service = document.webServices.find(item => item.path === path)
    for (const [key, params] of Object.entries(actions)) {
      const action = service?.actions?.find(item => item.key === key)
      if (!action || params.some(name => !action.params?.some(param => param.key === name))) fail('API_SCHEMA_MISMATCH')
    }
  }
}

async function paginated(request, endpoint, field, params) {
  const items = []
  const seen = new Set()
  let total
  for (let page = 1; page <= MAX_RESULTS / PAGE_SIZE; page++) {
    const data = await request(endpoint, { ...params, p: page, ps: PAGE_SIZE })
    const paging = data?.paging
    if (!paging || !Number.isInteger(paging.total) || paging.total < 0
      || paging.pageIndex !== page || paging.pageSize !== PAGE_SIZE || !Array.isArray(data[field])) fail('PAGINATION_INVALID')
    if (paging.total > MAX_RESULTS) fail('RESULT_LIMIT_EXCEEDED')
    if (total !== undefined && total !== paging.total) fail('RESULTS_CHANGED_RETRY_EXPORT')
    total = paging.total
    if (data[field].length !== Math.min(PAGE_SIZE, Math.max(0, total - items.length))) fail('RESULTS_TRUNCATED')
    for (const item of data[field]) {
      if (typeof item?.key !== 'string' || seen.has(item.key)) fail('DUPLICATE_OR_INVALID_RESULT')
      seen.add(item.key); items.push(item)
    }
    if (items.length === total) return items
  }
  fail('RESULTS_TRUNCATED')
}

async function privateDirectory(path) {
  try { await mkdir(path, { mode: 0o700 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) fail('PRIVATE_DIRECTORY_REQUIRED')
}
async function writePrivate(path, value, token) {
  // Redact the active credential even if a hostile local server echoes it.
  const content = JSON.stringify(value, null, 2).split(JSON.stringify(token).slice(1, -1)).join('[REDACTED]') + '\n'
  const temporary = `${path}.${randomUUID()}.tmp`
  let handle
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    await handle.writeFile(content); await handle.close(); handle = undefined
    await rename(temporary, path)
  } finally { await handle?.close(); await rm(temporary, { force: true }) }
}

export async function exportReport({ server = 'http://127.0.0.1:9000', token = process.env.SONAR_TOKEN,
  projectKey = 'nodeaccess', outputRoot = resolve('.sonar-reports'), timeoutMs, retryDelayMs } = {}) {
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(projectKey)) fail('INVALID_PROJECT_KEY')
  const request = client({ server, token, timeoutMs, retryDelayMs })
  // outputRoot is one directory under an existing, trusted working directory, not a recursive mkdir.
  await privateDirectory(outputRoot)
  const output = join(outputRoot, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`)
  await privateDirectory(output)
  const summary = { schemaVersion: 1, projectKey, startedAt: new Date().toISOString(), complete: false,
    limits: ['Pagination detects changed totals/duplicates, but the API does not provide an atomic snapshot.',
      'Security hotspots require human review and are separate from issues and Quality Gate.'] }
  try {
    validateApi(await request('/api/webservices/list'))
    const issues = await paginated(request, '/api/issues/search', 'issues', { components: projectKey, resolved: false })
    const hotspots = await paginated(request, '/api/hotspots/search', 'hotspots', { project: projectKey })
    const gate = await request('/api/qualitygates/project_status', { projectKey })
    if (!['OK', 'WARN', 'ERROR', 'NONE'].includes(gate?.projectStatus?.status)) fail('QUALITY_GATE_INVALID')
    summary.counts = { issues: issues.length, hotspots: hotspots.length,
      hotspotsToReview: hotspots.filter(item => item.status === 'TO_REVIEW').length }
    summary.qualityGate = gate.projectStatus.status
    for (const [name, value] of Object.entries({ issues: { issues }, hotspots: { hotspots }, 'quality-gate': gate })) {
      await writePrivate(join(output, `${name}.json`), value, token)
    }
    summary.complete = true; summary.finishedAt = new Date().toISOString()
    await writePrivate(join(output, 'summary.json'), summary, token)
    return { output, summary }
  } catch (error) {
    summary.finishedAt = new Date().toISOString()
    summary.error = error instanceof ExportError ? error.code : 'EXPORT_FAILED'
    await writePrivate(join(output, 'summary.json'), summary, token)
    throw new ExportError(summary.error)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length > 2) {
    console.error('Use SONAR_HOST_URL, SONAR_PROJECT_KEY and SONAR_TOKEN environment variables; no CLI credentials.')
    process.exitCode = 1
  } else {
    try {
      const { summary } = await exportReport({ server: process.env.SONAR_HOST_URL || 'http://127.0.0.1:9000',
        projectKey: process.env.SONAR_PROJECT_KEY || 'nodeaccess' })
      console.log(JSON.stringify({ complete: true, counts: summary.counts, qualityGate: summary.qualityGate,
        reports: '.sonar-reports/<timestamp-uuid> (private)' }))
    } catch (error) {
      console.error(`SonarQube export failed: ${error instanceof ExportError ? error.code : 'EXPORT_FAILED'}`)
      process.exitCode = 1
    }
  }
}
