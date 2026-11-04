import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { localUrl } from './export.mjs'

const execute = promisify(execFile)
export const images = Object.freeze({
  sonar: 'sonarqube:26.10.0.133078-community@sha256:f95aaa9016dd4e92c7d70691167a6d96dbb5d8acffd61eba1cb4335d364a7840',
  postgres: 'postgres:17.11-bookworm@sha256:839fbb5a4942a7758dd93e18b42ea5649807491a0545b5eeeb8f0b8bb11857a5',
})
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
export function secret() {
  const value = `Aa1!${randomBytes(32).toString('hex')}`
  if (process.env.GITHUB_ACTIONS === 'true') process.stdout.write(`::add-mask::${value}\n`)
  return value
}
export async function docker(args, env = {}) {
  try { return (await execute('/usr/bin/docker', args, { env: { ...process.env, ...env }, timeout: 180_000, maxBuffer: 2 ** 20 })).stdout.trim() }
  catch { throw new Error('CI_DOCKER_COMMAND_FAILED') }
}
export function publishedServer(port) {
  const match = /^127\.0\.0\.1:(\d+)$/.exec(port)
  if (!match || Number(match[1]) === 9000 || Number(match[1]) < 1024 || Number(match[1]) > 65535) throw new Error('CI_ISOLATED_PORT_REQUIRED')
  return `http://127.0.0.1:${match[1]}`
}
export function api(server, login, password) {
  const origin = localUrl(server)
  return async (path, params = {}, method = 'POST') => {
    const url = new URL(path, origin)
    if (url.origin !== origin.origin || !url.pathname.startsWith('/api/')) throw new Error('CI_API_PATH_REFUSED')
    const body = new URLSearchParams(params)
    if (method === 'GET') url.search = body.toString()
    let response
    try {
      response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded' }, ...(method === 'GET' ? {} : { body }) })
    } catch { throw new Error('CI_API_NETWORK_FAILED') }
    if (!response.ok) {
      await response.body?.cancel()
      const permission = ['scan', 'user', 'codeviewer', 'issueadmin', 'securityhotspotadmin', 'admin', 'provisioning'].includes(params.permission) ? `_${params.permission.toUpperCase()}` : ''
      const group = ['Anyone', 'sonar-users'].includes(params.groupName) ? `_${params.groupName.replaceAll('-', '_').toUpperCase()}` : ''
      throw new Error(`CI_API_HTTP_${response.status}_${url.pathname.replaceAll('/', '_').toUpperCase()}${permission}${group}`)
    }
    const text = await response.text()
    if (text.length > 2 ** 20) throw new Error('CI_API_RESPONSE_TOO_LARGE')
    return text ? JSON.parse(text) : {}
  }
}
export async function startServer({ runDocker = docker, kernel = () => readFile('/proc/sys/vm/max_map_count', 'utf8'), wait = pause } = {}) {
  const mapCount = Number(await kernel())
  if (mapCount < 524288) throw new Error('CI_KERNEL_MAX_MAP_COUNT_REQUIRES_524288')
  const owner = `nodeaccess-ci-${randomUUID()}`
  const containers = [], network = owner
  let createdNetwork = false
  const cleanup = async () => {
    const failures = []
    for (const name of [...containers].reverse()) {
      try { await runDocker(['rm', '--force', '--volumes', name]) } catch { failures.push('container') }
    }
    if (createdNetwork) {
      try { await runDocker(['network', 'rm', network]) } catch { failures.push('network') }
    }
    if (failures.length) throw new Error('CI_RESOURCE_CLEANUP_FAILED')
  }
  try {
    await runDocker(['network', 'create', '--label', `nodeaccess.ci.owner=${owner}`, network]); createdNetwork = true
    const password = secret()
    const db = `${owner}-db`, sonar = `${owner}-sonar`
    containers.push(db)
    await runDocker(['run', '--detach', '--name', db, '--label', `nodeaccess.ci.owner=${owner}`, '--network', network,
      '--network-alias', 'db', '--memory', '768m', '--cpus', '1', '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_USER=sonar', '-e', 'POSTGRES_DB=sonar', images.postgres], { POSTGRES_PASSWORD: password })
    for (let attempt = 0; ; attempt++) {
      try { await runDocker(['exec', db, 'pg_isready', '-h', '127.0.0.1', '-U', 'sonar', '-d', 'sonar']); break }
      catch { if (attempt >= 30) throw new Error('CI_DATABASE_START_TIMEOUT'); await wait(1000) }
    }
    containers.push(sonar)
    await runDocker(['run', '--detach', '--name', sonar, '--label', `nodeaccess.ci.owner=${owner}`, '--network', network,
      '--publish', '127.0.0.1::9000', '--memory', '4g', '--cpus', '2', '--ulimit', 'nofile=131072:131072', '--ulimit', 'nproc=8192:8192',
      '-e', 'SONAR_JDBC_PASSWORD', '-e', 'SONAR_JDBC_USERNAME=sonar', '-e', 'SONAR_JDBC_URL=jdbc:postgresql://db:5432/sonar',
      '-e', 'SONAR_TELEMETRY_ENABLE=false', images.sonar], { SONAR_JDBC_PASSWORD: password })
    const server = publishedServer(await runDocker(['port', sonar, '9000/tcp']))
    let ready = false
    for (let attempt = 0; attempt < 180; attempt++) {
      try {
        const response = await fetch(`${server}/api/system/status`, { signal: AbortSignal.timeout(3000), redirect: 'error' })
        ready = response.ok && (await response.json()).status === 'UP'
      } catch { /* Server boot is bounded by the loop. */ }
      if (ready) break
      await wait(2000)
    }
    if (!ready) throw new Error('CI_SONAR_START_TIMEOUT')
    const adminPassword = secret()
    await api(server, 'admin', 'admin')('/api/users/change_password', { login: 'admin', previousPassword: 'admin', password: adminPassword })
    return { server, owner, admin: api(server, 'admin', adminPassword), cleanup }
  } catch (error) { await cleanup(); throw error }
}
async function removeGroupPermission(admin, params) {
  try { await admin('/api/permissions/remove_group', params) }
  catch (error) {
    // Recent Community builds omit the virtual Anyone group altogether. Only
    // its explicit 404 means there is no grant to remove; other failures stop CI.
    if (params.groupName !== 'Anyone' || !error.message.startsWith('CI_API_HTTP_404__API_PERMISSIONS_REMOVE_GROUP_')) throw error
  }
}
export async function configureProject(instance, project = 'nodeaccess') {
  const admin = instance.admin
  await admin('/api/settings/set', { key: 'sonar.forceAuthentication', value: 'true' })
  await admin('/api/projects/create', { project, name: 'NodeAccess CI', visibility: 'private' })
  await admin('/api/settings/set', { component: project, key: 'sonar.qualitygate.ignoreSmallChanges', value: 'false' })
  // Remove the fresh server's default grants; only dedicated project users can scan/browse.
  for (const permission of ['scan', 'user', 'codeviewer', 'issueadmin', 'securityhotspotadmin', 'admin']) {
    for (const groupName of ['sonar-users', 'Anyone']) {
      await removeGroupPermission(admin, { projectKey: project, groupName, permission })
    }
  }
  for (const permission of ['scan', 'provisioning']) {
    await removeGroupPermission(admin, { groupName: 'sonar-users', permission })
    await removeGroupPermission(admin, { groupName: 'Anyone', permission })
  }
  const tokens = {}
  for (const [role, permission] of [['scan', 'scan'], ['review', 'user']]) {
    const login = `ci-${role}`, password = secret()
    await admin('/api/users/create', { login, name: login, password, local: 'true' })
    await admin('/api/permissions/add_user', { projectKey: project, login, permission })
    const userApi = api(instance.server, login, password)
    const result = await userApi('/api/user_tokens/generate', { name: `ci-${role}`, type: role === 'scan' ? 'PROJECT_ANALYSIS_TOKEN' : 'USER_TOKEN', ...(role === 'scan' ? { projectKey: project } : {}) })
    if (!result.token) throw new Error('CI_TOKEN_MISSING')
    if (process.env.GITHUB_ACTIONS === 'true') process.stdout.write(`::add-mask::${result.token}\n`)
    tokens[role] = result.token
  }
  const found = await admin('/api/projects/search', { projects: project }, 'GET')
  if (found.components?.length !== 1 || found.components[0].visibility !== 'private') throw new Error('CI_PRIVATE_PROJECT_REQUIRED')
  const anon = await fetch(`${instance.server}/api/issues/search?components=${encodeURIComponent(project)}`, { redirect: 'error', signal: AbortSignal.timeout(10_000) })
  await anon.body?.cancel()
  if (![401, 403].includes(anon.status)) throw new Error('CI_ANONYMOUS_ACCESS_REFUSED_REQUIRED')
  return tokens
}

/** Separate, disposable issue-review principal; existing scan/read roles stay unchanged. */
export async function createReviewActor(instance, project = 'nodeaccess') {
  if (!/^nodeaccess(?:-[a-z0-9-]+)?$/.test(project)) throw new Error('CI_REVIEW_PROJECT_INVALID')
  const login = `ci-issue-review-${randomUUID()}`, password = secret()
  let created = false
  const cleanup = async () => {
    if (created) {
      await instance.admin('/api/users/deactivate', { login })
      created = false
    }
  }
  try {
    await instance.admin('/api/users/create', { login, name: 'Ephemeral issue review', password, local: 'true' })
    created = true
    for (const permission of ['user', 'issueadmin']) {
      await instance.admin('/api/permissions/add_user', { projectKey: project, login, permission })
    }
    return { request: api(instance.server, login, password), cleanup }
  } catch (error) {
    try { await cleanup() } catch { throw new Error('CI_REVIEW_ACTOR_CLEANUP_FAILED') }
    throw error
  }
}
