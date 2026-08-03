#!/usr/bin/env node
/*
 * ACL browser/API flow check via Chromium CDP.
 *
 * Usage:
 *   chromium-browser --headless=new --disable-gpu --no-sandbox \
 *     --remote-debugging-port=9346 --user-data-dir=/tmp/nodeaccess-acl-cdp \
 *     --window-size=1440,1000 about:blank
 *
 *   ACL_MUTATE=1 node tools/frontend/acl-cdp-flow.cjs
 *
 * Useful env vars:
 *   FRONTEND_BASE=http://127.0.0.1:5173
 *   CDP_BASE=http://127.0.0.1:9346
 *   ADMIN_USER_ID=1
 *   ADMIN_EMAIL=admin@nodeaccess.local
 *   TENANT_ID=1
 *   ACL_TARGET_NODE_ID=123       Existing inventory node to receive ACL changes
 *   ACL_HOST_ID=123              Existing host used for effective-permission and visibility checks
 *   ACL_USER_ID=123              Existing user to validate direct ACL
 *   ACL_GROUP_ID=123             Existing group to validate group ACL
 *   ACL_MUTATE=1                 Required to change ACLs or create test actors
 *   ACL_CREATE_TEST_ACTORS=1     Create temporary user and group when ids are omitted
 *   ACL_INCLUDE_ROLE_SCENARIO=1  Also validate ROLE ADMIN ACL, restoring previous state
 *   ACL_KEEP_CHANGES=1           Do not restore touched ACLs at the end
 *   ACL_CLEANUP_ACTORS=1         Delete temporary user/group created by this script
 *   REPORT_PATH=/tmp/nodeaccess-acl-cdp-flow.json
 */

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const crypto = require('node:crypto')
const WebSocket = require('ws')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const CDP_BASE = process.env.CDP_BASE || 'http://127.0.0.1:9346'
const FRONTEND = process.env.FRONTEND_BASE || 'http://127.0.0.1:5173'
const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID || '1')
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@nodeaccess.local'
const TENANT_ID = Number(process.env.TENANT_ID || '1')
const ACL_TARGET_NODE_ID = Number(process.env.ACL_TARGET_NODE_ID || '0')
const ACL_HOST_ID = Number(process.env.ACL_HOST_ID || '0')
const ACL_USER_ID = Number(process.env.ACL_USER_ID || '0')
const ACL_GROUP_ID = Number(process.env.ACL_GROUP_ID || '0')
const ACL_MUTATE = process.env.ACL_MUTATE === '1'
const ACL_CREATE_TEST_ACTORS = process.env.ACL_CREATE_TEST_ACTORS === '1'
const ACL_INCLUDE_ROLE_SCENARIO = process.env.ACL_INCLUDE_ROLE_SCENARIO === '1'
const ACL_KEEP_CHANGES = process.env.ACL_KEEP_CHANGES === '1'
const ACL_CLEANUP_ACTORS = process.env.ACL_CLEANUP_ACTORS === '1'
const POST_ACTION_WAIT_MS = Number(process.env.POST_ACTION_WAIT_MS || '700')
const TEST_PREFIX = process.env.ACL_TEST_PREFIX || 'CDP ACL'

const EMPTY_PERMISSIONS = Object.freeze({ view: false, connect: false, edit: false, admin: false })
const ROLE_ADMIN_ID = 2

function readJwtSecret() {
  const envPath = process.env.BACKEND_ENV_PATH || path.join(REPO_ROOT, 'apps/backend/.env')
  const envFile = fs.readFileSync(envPath, 'utf8')
  const match = envFile.match(/^JWT_SECRET=(.+)$/m)
  if (!match) throw new Error(`JWT_SECRET not found in ${envPath}`)
  return match[1].trim().replace(/^"|"$/g, '')
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function signJwt(payload, secret, ttlSeconds = 3600) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64Url(JSON.stringify({ iat: now, exp: now + ttlSeconds, ...payload }))
  const data = `${header}.${body}`
  const signature = crypto.createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${signature}`
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
      })
    }).on('error', reject)
  })
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 1
    this.pending = new Map()
    this.events = []
    this.network = []
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timeout } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        clearTimeout(timeout)
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)))
        else resolve(msg.result)
        return
      }
      if (msg.method) {
        this.events.push({ at: Date.now(), ...msg })
        if (msg.method === 'Network.responseReceived') {
          this.network.push({
            at: Date.now(),
            requestId: msg.params.requestId,
            url: msg.params.response.url,
            status: msg.params.response.status,
            mimeType: msg.params.response.mimeType,
          })
        }
      }
    })
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve)
      this.ws.once('error', reject)
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 20000)
      this.pending.set(id, { resolve, reject, timeout })
    })
  }

  close() {
    this.ws.close()
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description
      || result.exceptionDetails.exception?.value
      || result.exceptionDetails.text
      || 'Runtime exception'
    throw new Error(String(detail))
  }
  return result.result?.value
}

async function waitFor(cdp, expression, timeoutMs = 10000, intervalMs = 100) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeoutMs) {
    last = await evaluate(cdp, expression)
    if (last) return last
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`waitFor timeout: ${expression}; last=${JSON.stringify(last)}`)
}

async function navigate(cdp, url) {
  const startedAt = Date.now()
  await cdp.send('Page.navigate', { url })
  await waitFor(cdp, 'document.readyState === "complete" || document.readyState === "interactive"', 15000)
  return Date.now() - startedAt
}

function tokenFor(secret, user, overrides = {}) {
  const role = user.role || 'user'
  return signJwt({
    sub: Number(user.id),
    email: user.email,
    role,
    isPlatformAdmin: Boolean(user.isPlatformAdmin),
    tenantId: Number(user.tenantId || TENANT_ID),
    canManageHosts: Boolean(user.canManageHosts || role === 'admin'),
    canViewLiveSessions: Boolean(user.canViewLiveSessions || role === 'admin'),
    forcePasswordChange: false,
    stage: 'authenticated',
    ...overrides,
  }, secret)
}

async function setToken(cdp, token) {
  await evaluate(cdp, `
    localStorage.setItem('na_access_token', ${JSON.stringify(token)});
    localStorage.setItem('na_refresh_token', 'cdp-dev-refresh-placeholder');
    localStorage.setItem('na_hosts_display_mode', 'list');
    localStorage.setItem('na_hosts_default_view', 'all');
    localStorage.setItem('na_corporate_folders_panel_expanded', 'true');
    true;
  `)
}

async function api(cdp, token, method, pathName, body) {
  const startedAt = Date.now()
  const headers = { authorization: `Bearer ${token}` }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const result = await evaluate(cdp, `
    (async () => {
      const response = await fetch(${JSON.stringify(`/api/v1${pathName}`)}, {
        method: ${JSON.stringify(method)},
        headers: ${JSON.stringify(headers)},
        body: ${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))},
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      return { ok: response.ok, status: response.status, data, durationMs: performance.now() };
    })()
  `)
  const durationMs = Date.now() - startedAt
  if (!result.ok) {
    const message = result.data?.message || result.data?.error || JSON.stringify(result.data)
    const error = new Error(`${method} ${pathName} failed with ${result.status}: ${message}`)
    error.response = result
    throw error
  }
  return { data: result.data, durationMs }
}

function permissions(flags) {
  return { ...EMPTY_PERMISSIONS, ...flags }
}

function sourceSummary(effective) {
  return {
    permissions: {
      view: Boolean(effective?.view),
      connect: Boolean(effective?.connect),
      edit: Boolean(effective?.edit),
      admin: Boolean(effective?.admin),
    },
    explanation: effective?.explanation || null,
    sources: Array.isArray(effective?.sources)
      ? effective.sources.map((source) => ({
        inventoryNodeId: source.inventoryNodeId,
        inventoryNodeName: source.inventoryNodeName,
        principalType: source.principalType,
        principalId: source.principalId,
        principalName: source.principalName,
        permissions: source.permissions,
        local: source.local,
      }))
      : [],
  }
}

function forgetTouched(touched, principal) {
  const index = touched.findIndex((item) =>
    item.principalType === principal.principalType && Number(item.principalId) === Number(principal.principalId))
  if (index >= 0) touched.splice(index, 1)
}

async function listAcl(cdp, token, targetNodeId) {
  return (await api(cdp, token, 'GET', `/inventory/nodes/${targetNodeId}/acl`)).data
}

function findAcl(entries, principalType, principalId) {
  return entries.find((entry) => entry.principalType === principalType && Number(entry.principalId) === Number(principalId)) || null
}

async function restoreAcl(cdp, adminToken, targetNodeId, snapshot, touched) {
  const restored = []
  for (const item of touched.reverse()) {
    const previous = findAcl(snapshot, item.principalType, item.principalId)
    if (previous) {
      await api(cdp, adminToken, 'PUT', `/inventory/nodes/${targetNodeId}/acl`, {
        principalType: previous.principalType,
        principalId: previous.principalId,
        permissions: previous.permissions,
      })
      restored.push({ ...item, action: 'restored' })
    } else {
      try {
        await api(cdp, adminToken, 'DELETE', `/inventory/nodes/${targetNodeId}/acl/${item.principalType}/${item.principalId}`)
        restored.push({ ...item, action: 'deleted' })
      } catch (error) {
        restored.push({ ...item, action: 'delete_failed', error: error.message })
      }
    }
  }
  return restored
}

async function resolveSetup(cdp, adminToken, secret) {
  const created = { user: null, group: null }
  let hostId = ACL_HOST_ID
  let targetNodeId = ACL_TARGET_NODE_ID
  let testUser = null
  let testGroup = null
  let originalUserGroupIds = null

  if (!hostId) {
    const hosts = (await api(cdp, adminToken, 'GET', '/hosts?page=1&limit=1')).data
    hostId = Number(hosts?.data?.[0]?.id || 0)
  }
  if (!hostId && !targetNodeId) {
    throw new Error('No ACL_HOST_ID or ACL_TARGET_NODE_ID provided, and no host was found by /hosts?page=1&limit=1')
  }

  if (!targetNodeId && hostId) {
    targetNodeId = Number((await api(cdp, adminToken, 'GET', `/inventory/hosts/${hostId}/node`)).data?.id || 0)
  }
  if (!targetNodeId) throw new Error('Could not resolve inventory target node')

  if (ACL_USER_ID) {
    testUser = (await api(cdp, adminToken, 'GET', `/users/${ACL_USER_ID}`)).data
  }

  if (ACL_GROUP_ID) {
    testGroup = (await api(cdp, adminToken, 'GET', `/groups/${ACL_GROUP_ID}`)).data
  }

  if ((!testUser || !testGroup) && ACL_CREATE_TEST_ACTORS) {
    if (!ACL_MUTATE) throw new Error('ACL_CREATE_TEST_ACTORS requires ACL_MUTATE=1')
    const suffix = `${Date.now()}`
    if (!testGroup) {
      testGroup = (await api(cdp, adminToken, 'POST', '/groups', {
        name: `${TEST_PREFIX} Group ${suffix}`,
        description: 'Temporary group generated by tools/frontend/acl-cdp-flow.cjs',
      })).data
      created.group = testGroup
    }
    if (!testUser) {
      testUser = (await api(cdp, adminToken, 'POST', '/users', {
        name: `${TEST_PREFIX} User ${suffix}`,
        email: `cdp-acl-${suffix}@nodeaccess.local`,
        role: 'user',
        canManageHosts: false,
        canViewLiveSessions: false,
        groupIds: [testGroup.id],
        password: `NodeAccess@${suffix.slice(-6)}aA1!`,
      })).data
      created.user = testUser
    }
  }

  if (!testUser) {
    const users = (await api(cdp, adminToken, 'GET', '/users?page=1&limit=100&role=user&active=true')).data
    testUser = users?.data?.find((user) => user.role === 'user' && user.active)
      || users?.data?.find((user) => user.id !== ADMIN_USER_ID && user.active)
      || null
  }
  if (!testUser) throw new Error('No test user resolved. Set ACL_USER_ID or ACL_CREATE_TEST_ACTORS=1.')

  if (!testGroup) {
    const groups = (await api(cdp, adminToken, 'GET', '/groups')).data
    testGroup = groups?.find((group) => testUser.groupIds?.includes(group.id)) || groups?.[0] || null
  }
  if (!testGroup) throw new Error('No test group resolved. Set ACL_GROUP_ID or ACL_CREATE_TEST_ACTORS=1.')

  if (!testUser.groupIds?.includes(testGroup.id)) {
    if (!ACL_MUTATE) {
      throw new Error(`User ${testUser.id} is not in group ${testGroup.id}. Set ACL_MUTATE=1 to add membership temporarily or use another ACL_GROUP_ID.`)
    }
    originalUserGroupIds = [...(testUser.groupIds || [])]
    testUser = (await api(cdp, adminToken, 'PATCH', `/users/${testUser.id}`, {
      groupIds: [...new Set([...(testUser.groupIds || []), testGroup.id])],
    })).data
  }

  const userToken = tokenFor(secret, testUser)
  const adminUser = {
    id: ADMIN_USER_ID,
    email: ADMIN_EMAIL,
    role: 'admin',
    isPlatformAdmin: true,
    tenantId: TENANT_ID,
    canManageHosts: true,
    canViewLiveSessions: true,
  }

  return {
    hostId,
    targetNodeId,
    adminUser,
    testUser,
    testGroup,
    userToken,
    created,
    originalUserGroupIds,
  }
}

async function upsertAndMeasure(cdp, adminToken, setup, principalType, principalId, nextPermissions) {
  const preview = await api(cdp, adminToken, 'POST', `/inventory/nodes/${setup.targetNodeId}/acl/impact-preview`, {
    action: 'upsert',
    principalType,
    principalId,
    permissions: nextPermissions,
  })
  const upsert = await api(cdp, adminToken, 'PUT', `/inventory/nodes/${setup.targetNodeId}/acl`, {
    principalType,
    principalId,
    permissions: nextPermissions,
  })
  await new Promise((resolve) => setTimeout(resolve, POST_ACTION_WAIT_MS))
  const effective = setup.hostId
    ? await api(cdp, adminToken, 'GET', `/inventory/hosts/${setup.hostId}/effective-permissions/users/${setup.testUser.id}`)
    : await api(cdp, adminToken, 'GET', `/inventory/nodes/${setup.targetNodeId}/effective-permissions/users/${setup.testUser.id}`)
  return {
    preview: preview.data,
    upsertDurationMs: upsert.durationMs,
    effectiveDurationMs: effective.durationMs,
    effective: sourceSummary(effective.data),
  }
}

async function visibleAsUser(cdp, userToken, setup) {
  if (!setup.hostId) return { skipped: true, reason: 'No hostId resolved' }
  const result = await api(cdp, userToken, 'GET', `/hosts?page=1&limit=300&inventoryNodeId=${setup.targetNodeId}`)
  const rows = result.data?.data || []
  const host = rows.find((item) => Number(item.id) === Number(setup.hostId)) || null
  return {
    durationMs: result.durationMs,
    total: result.data?.total ?? rows.length,
    hostVisible: Boolean(host),
    hostAccessPermissions: host?.accessPermissions || null,
  }
}

async function runDirectUserScenario(cdp, adminToken, setup, touched) {
  const steps = []
  const principal = { principalType: 'USER', principalId: setup.testUser.id }
  const ladder = [
    { name: 'view', permissions: permissions({ view: true }) },
    { name: 'connect', permissions: permissions({ view: true, connect: true }) },
    { name: 'edit', permissions: permissions({ view: true, connect: true, edit: true }) },
    { name: 'admin', permissions: permissions({ view: true, connect: true, edit: true, admin: true }) },
  ]

  for (const step of ladder) {
    const result = await upsertAndMeasure(cdp, adminToken, setup, principal.principalType, principal.principalId, step.permissions)
    const userVisibility = await visibleAsUser(cdp, setup.userToken, setup)
    steps.push({
      name: step.name,
      expected: step.permissions,
      ...result,
      userVisibility,
      ok: ['view', 'connect', 'edit', 'admin'].every((key) => Boolean(result.effective.permissions[key]) === Boolean(step.permissions[key])),
    })
  }
  touched.push(principal)

  const deletePreview = await api(cdp, adminToken, 'POST', `/inventory/nodes/${setup.targetNodeId}/acl/impact-preview`, {
    action: 'delete',
    ...principal,
  })
  await api(cdp, adminToken, 'DELETE', `/inventory/nodes/${setup.targetNodeId}/acl/${principal.principalType}/${principal.principalId}`)
  forgetTouched(touched, principal)
  await new Promise((resolve) => setTimeout(resolve, POST_ACTION_WAIT_MS))
  const afterDelete = setup.hostId
    ? await api(cdp, adminToken, 'GET', `/inventory/hosts/${setup.hostId}/effective-permissions/users/${setup.testUser.id}`)
    : await api(cdp, adminToken, 'GET', `/inventory/nodes/${setup.targetNodeId}/effective-permissions/users/${setup.testUser.id}`)

  return {
    name: 'direct-user-acl-ladder',
    principal,
    steps,
    deletePreview: deletePreview.data,
    afterDelete: sourceSummary(afterDelete.data),
    ok: steps.every((step) => step.ok),
  }
}

async function runGroupScenario(cdp, adminToken, setup, touched) {
  const principal = { principalType: 'GROUP', principalId: setup.testGroup.id }
  const result = await upsertAndMeasure(cdp, adminToken, setup, principal.principalType, principal.principalId, permissions({ view: true, connect: true }))
  touched.push(principal)
  const hasGroupSource = result.effective.sources.some((source) => source.principalType === 'GROUP' && Number(source.principalId) === Number(setup.testGroup.id))
  const userVisibility = await visibleAsUser(cdp, setup.userToken, setup)

  await api(cdp, adminToken, 'DELETE', `/inventory/nodes/${setup.targetNodeId}/acl/${principal.principalType}/${principal.principalId}`)
  forgetTouched(touched, principal)
  await new Promise((resolve) => setTimeout(resolve, POST_ACTION_WAIT_MS))
  const afterDelete = setup.hostId
    ? await api(cdp, adminToken, 'GET', `/inventory/hosts/${setup.hostId}/effective-permissions/users/${setup.testUser.id}`)
    : await api(cdp, adminToken, 'GET', `/inventory/nodes/${setup.targetNodeId}/effective-permissions/users/${setup.testUser.id}`)

  return {
    name: 'group-acl-membership',
    principal,
    grant: result,
    userVisibility,
    afterDelete: sourceSummary(afterDelete.data),
    ok: hasGroupSource && result.effective.permissions.view && result.effective.permissions.connect,
  }
}

async function runRoleScenario(cdp, adminToken, setup, touched) {
  const principal = { principalType: 'ROLE', principalId: ROLE_ADMIN_ID }
  const result = await upsertAndMeasure(cdp, adminToken, setup, principal.principalType, principal.principalId, permissions({ view: true, connect: true, edit: true, admin: true }))
  touched.push(principal)
  const normalUserHasRoleSource = result.effective.sources.some((source) => source.principalType === 'ROLE' && Number(source.principalId) === ROLE_ADMIN_ID)

  return {
    name: 'role-admin-acl-isolated-from-normal-user',
    principal,
    normalUserEffective: result.effective,
    ok: !normalUserHasRoleSource,
  }
}

async function runBrowserSmoke(cdp, token, setup) {
  await setToken(cdp, token)
  const navigationMs = await navigate(cdp, `${FRONTEND}/hosts`)
  await waitFor(cdp, '!location.pathname.includes("/login")', 10000)
  await new Promise((resolve) => setTimeout(resolve, POST_ACTION_WAIT_MS))
  const snapshot = await evaluate(cdp, `
    const bodyText = document.body.innerText || '';
    ({
      path: location.pathname,
      title: document.title,
      hasHostsHeading: Boolean([...document.querySelectorAll('h1,h2,h3,[role="heading"]')]
        .find((item) => /hosts/i.test(item.textContent || ''))),
      hasAppContent: bodyText.length > 80 && !/entrar|login/i.test(bodyText.slice(0, 500)),
      visibleTextSample: bodyText.slice(0, 1000),
      longTasks: window.__aclPerf?.longTasks || [],
      layoutShifts: window.__aclPerf?.layoutShifts || [],
      errors: window.__aclPerfErrors || [],
    })
  `)
  return {
    name: 'browser-hosts-smoke-as-user',
    navigationMs,
    path: snapshot.path,
    hasHostsHeading: snapshot.hasHostsHeading,
    hasAppContent: snapshot.hasAppContent,
    longTaskCount: snapshot.longTasks.length,
    maxLongTaskMs: Math.max(0, ...snapshot.longTasks.map((item) => item.duration || 0)),
    layoutShiftTotal: snapshot.layoutShifts.reduce((sum, item) => sum + (item.value || 0), 0),
    browserErrors: snapshot.errors,
    ok: !snapshot.path.includes('/login') && snapshot.hasAppContent,
  }
}

async function cleanupActors(cdp, adminToken, setup) {
  const cleaned = []
  if (setup.originalUserGroupIds) {
    try {
      await api(cdp, adminToken, 'PATCH', `/users/${setup.testUser.id}`, { groupIds: setup.originalUserGroupIds })
      cleaned.push({ type: 'user-group-membership', id: setup.testUser.id, action: 'restored' })
    } catch (error) {
      cleaned.push({ type: 'user-group-membership', id: setup.testUser.id, action: 'restore_failed', error: error.message })
    }
  }
  if (!ACL_CLEANUP_ACTORS) return cleaned
  if (setup.created.user) {
    try {
      await api(cdp, adminToken, 'DELETE', `/users/${setup.created.user.id}`)
      cleaned.push({ type: 'user', id: setup.created.user.id, action: 'deleted' })
    } catch (error) {
      cleaned.push({ type: 'user', id: setup.created.user.id, action: 'delete_failed', error: error.message })
    }
  }
  if (setup.created.group) {
    try {
      await api(cdp, adminToken, 'DELETE', `/groups/${setup.created.group.id}`)
      cleaned.push({ type: 'group', id: setup.created.group.id, action: 'deleted' })
    } catch (error) {
      cleaned.push({ type: 'group', id: setup.created.group.id, action: 'delete_failed', error: error.message })
    }
  }
  return cleaned
}

async function run(cdp) {
  if (!ACL_MUTATE) {
    throw new Error('This harness changes ACLs. Run with ACL_MUTATE=1 and preferably ACL_CREATE_TEST_ACTORS=1 or dedicated ACL_USER_ID/ACL_GROUP_ID.')
  }

  const secret = readJwtSecret()
  const adminToken = tokenFor(secret, {
    id: ADMIN_USER_ID,
    email: ADMIN_EMAIL,
    role: 'admin',
    isPlatformAdmin: true,
    tenantId: TENANT_ID,
    canManageHosts: true,
    canViewLiveSessions: true,
  })

  await navigate(cdp, FRONTEND)
  await setToken(cdp, adminToken)
  await navigate(cdp, `${FRONTEND}/hosts`)

  const setup = await resolveSetup(cdp, adminToken, secret)
  const aclSnapshot = await listAcl(cdp, adminToken, setup.targetNodeId)
  const touched = []
  const scenarios = []
  let cleanup = []
  let aclRestore = []

  try {
    scenarios.push(await runBrowserSmoke(cdp, setup.userToken, setup))
    scenarios.push(await runDirectUserScenario(cdp, adminToken, setup, touched))
    scenarios.push(await runGroupScenario(cdp, adminToken, setup, touched))
    if (ACL_INCLUDE_ROLE_SCENARIO) {
      scenarios.push(await runRoleScenario(cdp, adminToken, setup, touched))
    }
  } finally {
    if (!ACL_KEEP_CHANGES) {
      aclRestore = await restoreAcl(cdp, adminToken, setup.targetNodeId, aclSnapshot, touched)
    }
    cleanup = await cleanupActors(cdp, adminToken, setup)
  }

  const consoleErrors = cdp.events
    .filter((event) => event.method === 'Runtime.exceptionThrown' || event.method === 'Log.entryAdded')
    .slice(-30)

  const failedNetwork = cdp.network
    .filter((entry) => entry.status >= 400 && !entry.url.includes('/api/v1/auth/refresh'))
    .slice(-40)

  return {
    frontend: FRONTEND,
    cdpBase: CDP_BASE,
    setup: {
      tenantId: TENANT_ID,
      targetNodeId: setup.targetNodeId,
      hostId: setup.hostId,
      testUser: {
        id: setup.testUser.id,
        email: setup.testUser.email,
        role: setup.testUser.role,
        groupIds: setup.testUser.groupIds,
      },
      testGroup: {
        id: setup.testGroup.id,
        name: setup.testGroup.name,
      },
      created: {
        userId: setup.created.user?.id || null,
        groupId: setup.created.group?.id || null,
      },
    },
    summary: scenarios.map((scenario) => ({
      name: scenario.name,
      ok: scenario.ok,
      stepCount: scenario.steps?.length || undefined,
    })),
    scenarios,
    aclRestore,
    cleanup,
    failedNetwork,
    consoleErrors,
    ok: scenarios.every((scenario) => scenario.ok),
  }
}

async function main() {
  const targets = await getJson(`${CDP_BASE}/json/list`)
  const target = targets.find((item) => item.type === 'page') || targets[0]
  if (!target?.webSocketDebuggerUrl) throw new Error(`No CDP page target found at ${CDP_BASE}`)

  const cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__aclPerfErrors = [];
      window.__aclPerf = { longTasks: [], layoutShifts: [] };
      try {
        new PerformanceObserver((list) => {
          window.__aclPerf.longTasks.push(...list.getEntries().map((entry) => ({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration,
          })).slice(-100));
        }).observe({ type: 'longtask', buffered: true });
      } catch {}
      try {
        new PerformanceObserver((list) => {
          window.__aclPerf.layoutShifts.push(...list.getEntries()
            .filter((entry) => !entry.hadRecentInput)
            .map((entry) => ({ startTime: entry.startTime, value: entry.value })).slice(-100));
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {}
      window.addEventListener('error', (event) => {
        window.__aclPerfErrors.push({ type: 'error', message: event.message, source: event.filename, line: event.lineno });
      });
      window.addEventListener('unhandledrejection', (event) => {
        window.__aclPerfErrors.push({ type: 'unhandledrejection', reason: String(event.reason) });
      });
    `,
  })

  try {
    const report = await run(cdp)
    const output = JSON.stringify(report, null, 2)
    if (process.env.REPORT_PATH) {
      fs.mkdirSync(path.dirname(process.env.REPORT_PATH), { recursive: true })
      fs.writeFileSync(process.env.REPORT_PATH, `${output}\n`)
    }
    console.log(output)
    process.exitCode = report.ok ? 0 : 1
  } finally {
    cdp.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
