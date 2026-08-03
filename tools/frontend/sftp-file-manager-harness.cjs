#!/usr/bin/env node
/*
 * SFTP File Manager UI/API harness via Chromium CDP.
 *
 * Usage:
 *   chromium-browser --headless=new --disable-gpu --no-sandbox \
 *     --remote-debugging-port=9353 --user-data-dir=/tmp/nodeaccess-sftp-ui \
 *     --window-size=1440,1000 about:blank
 *
 *   FRONTEND_BASE=http://127.0.0.1:5173 \
 *   CDP_BASE=http://127.0.0.1:9353 \
 *   node tools/frontend/sftp-file-manager-harness.cjs
 *
 * The harness mocks the API endpoints used by /files/:hostId. It does not
 * require a real backend database or SFTP server.
 */

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const WebSocket = require('ws')

const CDP_BASE = process.env.CDP_BASE || 'http://127.0.0.1:9353'
const FRONTEND = process.env.FRONTEND_BASE || 'http://127.0.0.1:5173'
const HOST_ID = Number(process.env.SFTP_HOST_ID || '10')
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-sftp-file-manager-harness.json'
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || ''

let scenario = 'happy-path'
const captured = {
  apiCalls: [],
  createPayloads: [],
  writePayloads: [],
  restorePayloads: [],
  readPaths: [],
  auditLogQueries: [],
  console: [],
  pageErrors: [],
  timings: [],
}

const files = new Map([
  ['/app/app.conf', 'port=8080\nmode=prod\n'],
  ['/app/readonly.conf', 'managed=true\n'],
])
const fileModifiedAt = new Map([
  ['/app/app.conf', '2026-07-19T18:00:00.000Z'],
  ['/app/readonly.conf', '2026-07-19T18:00:00.000Z'],
])

function entry(name, type, size = 0, permissions = 'rw-r--r--') {
  return {
    name,
    path: `/app/${name}`,
    type,
    size,
    permissions: type === 'directory' ? 'rwxr-xr-x' : permissions,
    owner: 1000,
    group: 1000,
    modifiedAt: new Date('2026-01-01T10:00:00.000Z').toISOString(),
  }
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 1
    this.pending = new Map()
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
      if (msg.method === 'Fetch.requestPaused') void this.handleFetch(msg.params)
      if (msg.method === 'Runtime.consoleAPICalled') captured.console.push(msg.params)
      if (msg.method === 'Runtime.exceptionThrown') captured.pageErrors.push(msg.params)
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

  async handleFetch(params) {
    const { requestId, request } = params
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/v1/')) {
      await this.send('Fetch.continueRequest', { requestId })
      return
    }

    const apiPath = url.pathname.replace('/api/v1', '')
    const body = parseBody(request.postData)
    captured.apiCalls.push({
      scenario,
      method: request.method,
      path: apiPath,
      query: Object.fromEntries(url.searchParams.entries()),
      body,
    })

    if (request.method === 'POST' && apiPath.endsWith('/touch')) captured.createPayloads.push(body)
    if (request.method === 'PUT' && apiPath.endsWith('/write')) captured.writePayloads.push(body)
    if (request.method === 'POST' && apiPath.endsWith('/restore-backup')) captured.restorePayloads.push(body)
    if (request.method === 'GET' && apiPath.endsWith('/read')) captured.readPaths.push(url.searchParams.get('path'))
    if (request.method === 'GET' && apiPath === '/logs/admin') {
      captured.auditLogQueries.push(Object.fromEntries(url.searchParams.entries()))
    }

    const response = mockApi(request.method, apiPath, url, body)
    const headers = [
      { name: 'access-control-allow-origin', value: '*' },
      { name: 'content-type', value: response.contentType || 'application/json' },
    ]
    await this.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: response.status,
      responseHeaders: headers,
      body: Buffer.from(response.rawBody ?? JSON.stringify(response.body)).toString('base64'),
    })
  }

  close() {
    this.ws.close()
  }
}

function parseBody(postData) {
  if (!postData) return null
  try { return JSON.parse(postData) } catch { return postData }
}

function mockApi(method, apiPath, url, body) {
  if (method === 'GET' && apiPath === '/features') {
    return ok({
      agentsLicensed: true,
      secretsLicensed: true,
      snippetsLicensed: true,
      portForwardingLicensed: true,
      feedbackLicensed: false,
      localAiLicensed: false,
      mcpEnabled: false,
      integrationsLicensed: true,
      integrationProviders: {},
    })
  }

  if (method === 'GET' && apiPath === '/users/me/preferences') return ok(null)
  if (method === 'PATCH' && apiPath === '/users/me/preferences') return ok(body || {})
  if (method === 'POST' && apiPath === '/auth/refresh') return ok({ accessToken: fakeJwt() })
  if (method === 'POST' && apiPath === '/client-ux/events') return ok({ ok: true })
  if (method === 'POST' && apiPath === '/logs/client-ux') return ok({ ok: true })
  if (method === 'POST' && apiPath === '/logs/user-productivity') return ok({ ok: true })
  if (method === 'GET' && apiPath === '/logs/admin') return ok(mockSftpAuditLogs(url))
  if (method === 'GET' && apiPath === `/sftp/${HOST_ID}/ping`) return ok({ ok: true, home: '/app' })
  if (method === 'GET' && apiPath === '/sessions/access-map') {
    return ok({
      generatedAt: new Date().toISOString(),
      refreshAfterSeconds: 5,
      totals: {
        activeSessions: 0,
        activeHosts: 0,
        uniqueUsers: 0,
        concurrentHosts: 0,
      },
      hosts: [],
    })
  }
  if (method === 'GET' && apiPath === '/hosts/sidebar-bootstrap') {
    return ok({
      summary: {
        all: 1,
        global: 1,
        unfiled: 0,
        maxHosts: null,
        folders: {},
        groups: {},
        tags: {},
      },
      folders: [],
      groups: [],
      tags: [],
    })
  }
  if (method === 'GET' && apiPath === '/inventory') return ok([])

  if (method === 'GET' && apiPath === `/sftp/${HOST_ID}/list`) {
    const currentPath = url.searchParams.get('path') || '/'
    if (currentPath === '/') return ok({ path: '/', entries: [{ ...entry('app', 'directory'), path: '/app' }] })
    if (currentPath === '/app') {
      const fileEntries = [...files.entries()]
        .filter(([filePath]) => filePath.startsWith('/app/'))
        .map(([filePath, content]) => entry(filePath.split('/').pop(), 'file', Buffer.byteLength(content, 'utf8')))
      return ok({ path: '/app', entries: fileEntries })
    }
    return ok({ path: currentPath, entries: [] })
  }

  if (method === 'POST' && apiPath === `/sftp/${HOST_ID}/touch`) {
    if (!body || typeof body.path !== 'string') {
      return fail(400, 'FST_ERR_VALIDATION', "body must have required property 'path'")
    }
    if (body.path.includes('denied')) return permissionDenied()
    files.set(body.path, '')
    fileModifiedAt.set(body.path, new Date().toISOString())
    return empty(204)
  }

  if (method === 'GET' && apiPath === `/sftp/${HOST_ID}/read`) {
    const filePath = url.searchParams.get('path') || ''
    if (filePath.includes('denied')) return permissionDenied()
    if (!files.has(filePath)) return fail(404, 'SFTP_NOT_FOUND', 'Arquivo ou diretório não encontrado no servidor SFTP.')
    const content = files.get(filePath)
    return ok({
      content,
      size: Buffer.byteLength(content, 'utf8'),
      truncated: false,
      modifiedAt: fileModifiedAt.get(filePath) || null,
      hash: hashContent(content),
      mode: 416,
      owner: 1000,
      group: 1001,
      accessedAt: '2026-07-19T17:55:00.000Z',
      accessedAtEpoch: 1784483700,
      modifiedAtEpoch: 1784484000,
    })
  }

  if (method === 'PUT' && apiPath === `/sftp/${HOST_ID}/write`) {
    if (!body || typeof body.path !== 'string' || typeof body.content !== 'string') {
      return fail(400, 'FST_ERR_VALIDATION', "body must have required property 'path'")
    }
    if (body.path.includes('readonly')) return permissionDenied()
    const previous = files.get(body.path)
    if (previous !== undefined && body.expectedHash && body.expectedHash !== hashContent(previous)) {
      return fail(409, 'SFTP_CONFLICT', 'O arquivo foi alterado no servidor desde que foi aberto. Recarregue o arquivo antes de salvar.')
    }
    files.set(body.path, body.content)
    fileModifiedAt.set(body.path, new Date().toISOString())
    return empty(204)
  }

  if (method === 'POST' && apiPath === `/sftp/${HOST_ID}/restore-backup`) {
    if (!body || typeof body.path !== 'string' || typeof body.backupPath !== 'string') {
      return fail(400, 'FST_ERR_VALIDATION', "body must have required property 'backupPath'")
    }
    if (!body.backupPath.includes('/.nodeaccess-backups/')) {
      return fail(400, 'SFTP_INVALID_BACKUP_PATH', 'Backup inválido para este caminho.')
    }
    files.set(body.path, 'port=8080\nmode=prod\n')
    fileModifiedAt.set(body.path, new Date().toISOString())
    return empty(204)
  }

  if (method === 'POST' && apiPath === `/sftp/${HOST_ID}/mkdir`) return empty(204)
  if (method === 'POST' && apiPath === `/sftp/${HOST_ID}/rename`) return empty(204)
  if (method === 'DELETE' && apiPath === `/sftp/${HOST_ID}/file`) return empty(204)
  if (method === 'GET' && apiPath === `/sftp/${HOST_ID}/download`) {
    return { status: 200, contentType: 'application/octet-stream', rawBody: 'downloaded-content' }
  }
  if (method === 'GET' && apiPath === `/sftp/${HOST_ID}/download-backup`) {
    const backupPath = url.searchParams.get('backupPath') || ''
    if (!backupPath.includes('/.nodeaccess-backups/')) {
      return fail(400, 'SFTP_INVALID_BACKUP_PATH', 'Backup inválido para este caminho.')
    }
    return { status: 200, contentType: 'application/octet-stream', rawBody: 'backup-content' }
  }
  if (method === 'GET' && apiPath === `/sftp/${HOST_ID}/backup-diff`) {
    const backupPath = url.searchParams.get('backupPath') || ''
    if (!backupPath.includes('/.nodeaccess-backups/')) {
      return fail(400, 'SFTP_INVALID_BACKUP_PATH', 'Backup inválido para este caminho.')
    }
    return ok({
      path: url.searchParams.get('path') || '/app/app.conf',
      backupPath,
      beforeSize: 20,
      afterSize: 23,
      beforeHash: hashContent('password=old-secret\n'),
      afterHash: hashContent('password=new-secret\n'),
      changedLines: 1,
      addedLines: 1,
      removedLines: 1,
      truncated: false,
      skippedReason: null,
      diffMasked: '@@ line 1 @@\n-password=[MASKED]\n+password=[MASKED]',
    })
  }

  return ok({})
}

function ok(body) {
  return { status: 200, body }
}

function empty(status) {
  return { status, rawBody: '' }
}

function fail(status, code, message) {
  return { status, body: { statusCode: status, code, error: status >= 500 ? 'Error' : 'Bad Request', message } }
}

function permissionDenied() {
  return fail(
    403,
    'SFTP_PERMISSION_DENIED',
    'Permissão negada pelo servidor SFTP para este caminho. Verifique usuário SSH, dono do arquivo e permissões de escrita/leitura.',
  )
}

function hashContent(content) {
  return crypto.createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex')
}

function mockSftpAuditLogs(url) {
  const detailsContains = (url.searchParams.get('detailsContains') || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const search = (url.searchParams.get('search') || '').toLowerCase()
  const targetId = Number(url.searchParams.get('targetId') || '0')
  const logs = [
    makeSftpLog(1, 'readFile', '/app/app.conf', true, { size: 20 }),
    makeSftpLog(2, 'writeFile', '/app/app.conf', true, {
      size: 23,
      backupPath: '/app/.nodeaccess-backups/app.conf.2026-07-19T18-00-00-000Z.user-1.bak',
      tempPath: '/app/.app.conf.nodeaccess-2026-07-19T18-00-00-000Z.user-1.tmp',
      preservedMode: true,
      preservedOwnership: false,
      preservedTimestamps: true,
      metadataPreservationErrors: ['chown: permission denied'],
      changedLines: 1,
      addedLines: 1,
      removedLines: 1,
      diffPreviewMasked: '-password=[MASKED]\n+password=[MASKED]',
    }),
    makeSftpLog(3, 'writeFile', '/app/readonly.conf', false, { errorMessage: 'Permission denied' }),
    makeSftpLog(4, 'rename', '/app/old.txt', true, { newPath: '/app/new.txt' }),
  ].filter((row) => {
    if (url.searchParams.get('actions') !== 'SFTP_OPERATION') return false
    if (url.searchParams.get('targetType') !== 'Host') return false
    if (targetId > 0 && row.targetId !== targetId) return false
    if (search && !`${row.adminName} ${row.details}`.toLowerCase().includes(search)) return false
    return detailsContains.every((needle) => row.details.includes(needle))
  })
  return {
    data: logs,
    total: logs.length,
    page: Number(url.searchParams.get('page') || '1'),
    limit: Number(url.searchParams.get('limit') || '20'),
  }
}

function makeSftpLog(id, action, filePath, success, extra = {}) {
  return {
    id,
    adminId: 1,
    adminName: 'Admin Harness',
    action: 'SFTP_OPERATION',
    targetType: 'Host',
    targetId: HOST_ID,
    details: JSON.stringify({
      provider: 'sftp',
      action,
      hostId: HOST_ID,
      path: filePath,
      success,
      ...extra,
    }),
    timestamp: new Date('2026-07-19T18:00:00.000Z').toISOString(),
  }
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

async function waitFor(cdp, expression, timeoutMs = 12000, intervalMs = 100) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeoutMs) {
    last = await evaluate(cdp, expression)
    if (last) return last
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`waitFor timeout: ${expression}; last=${JSON.stringify(last)}`)
}

async function navigate(cdp, nextScenario) {
  scenario = nextScenario
  const startedAt = Date.now()
  await cdp.send('Page.navigate', { url: `${FRONTEND}/files/${HOST_ID}?harness=${encodeURIComponent(nextScenario)}&t=${Date.now()}` })
  await waitFor(cdp, 'document.readyState === "complete" || document.readyState === "interactive"')
  await waitFor(cdp, 'document.body && document.body.innerText.includes("Gerenciador de Arquivos")')
  await waitFor(cdp, 'document.body.innerText.includes("SFTP conectado")')
  captured.timings.push({ label: `navigate:${nextScenario}`, ms: Date.now() - startedAt })
}

async function navigateTo(cdp, urlPath, nextScenario, text) {
  scenario = nextScenario
  const startedAt = Date.now()
  await cdp.send('Page.navigate', { url: `${FRONTEND}${urlPath}?harness=${encodeURIComponent(nextScenario)}&t=${Date.now()}` })
  await waitFor(cdp, 'document.readyState === "complete" || document.readyState === "interactive"')
  await waitFor(cdp, `document.body && document.body.innerText.includes(${JSON.stringify(text)})`)
  captured.timings.push({ label: `navigate:${nextScenario}`, ms: Date.now() - startedAt })
}

async function captureScreenshot(cdp, label) {
  if (!SCREENSHOT_DIR) return null
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const filePath = path.join(SCREENSHOT_DIR, `${label}.png`)
  fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'))
  return filePath
}

async function textIncludes(cdp, text) {
  return evaluate(cdp, `document.body.innerText.includes(${JSON.stringify(text)})`)
}

async function clickButtonContaining(cdp, text) {
  const ok = await evaluate(cdp, `
    (() => {
      const button = Array.from(document.querySelectorAll('button')).find((el) => el.innerText.includes(${JSON.stringify(text)}));
      if (!button) return false;
      button.click();
      return true;
    })()
  `)
  if (!ok) throw new Error(`Button not found containing: ${text}`)
}

async function fillVisibleInput(cdp, value) {
  const ok = await evaluate(cdp, `
    (() => {
      const inputs = Array.from(document.querySelectorAll('input')).filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && !el.disabled;
      });
      const input = inputs.at(-1);
      if (!input) return false;
      input.focus();
      input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()
  `)
  if (!ok) throw new Error('Visible input not found')
}

async function openDirectory(cdp, name) {
  const ok = await evaluate(cdp, `
    (() => {
      const row = Array.from(document.querySelectorAll('tbody tr')).find((el) => el.innerText.includes(${JSON.stringify(name)}));
      if (!row) return false;
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
      return true;
    })()
  `)
  if (!ok) throw new Error(`Directory row not found: ${name}`)
}

async function createFileFromUi(cdp, fileName) {
  const before = captured.createPayloads.length
  await clickButtonContaining(cdp, 'Novo arquivo')
  await waitFor(cdp, 'document.body.innerText.includes("Nome do arquivo")')
  await fillVisibleInput(cdp, fileName)
  await clickButtonContaining(cdp, 'Criar')
  await waitFor(cdp, `document.body.innerText.includes(${JSON.stringify(fileName)})`)
  if (captured.createPayloads.length !== before + 1) throw new Error('Create file did not call POST /touch')
  return captured.createPayloads.at(-1)
}

async function directApi(cdp, method, pathName, body) {
  return evaluate(cdp, `
    (async () => {
      const response = await fetch(${JSON.stringify(`/api/v1${pathName}`)}, {
        method: ${JSON.stringify(method)},
        headers: ${JSON.stringify(body === undefined ? {} : { 'content-type': 'application/json' })},
        body: ${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))},
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      return { ok: response.ok, status: response.status, data };
    })()
  `)
}

async function getPerformanceSnapshot(cdp, label) {
  const metrics = await cdp.send('Performance.getMetrics')
  const map = Object.fromEntries(metrics.metrics.map((item) => [item.name, item.value]))
  return {
    label,
    timestamp: new Date().toISOString(),
    domNodes: map.Nodes ?? null,
    jsHeapUsedBytes: map.JSHeapUsedSize ?? null,
    jsEventListeners: map.JSEventListeners ?? null,
    layoutCount: map.LayoutCount ?? null,
    recalcStyleCount: map.RecalcStyleCount ?? null,
  }
}

function fakeJwt() {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: '1',
    email: 'admin@nodeaccess.local',
    name: 'Admin',
    role: 'admin',
    tenantId: 1,
    canManageHosts: true,
    canViewLiveSessions: true,
    forcePasswordChange: false,
    stage: 'authenticated',
    iat: now,
    exp: now + 3600,
  }
  return `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.x`
}

function evaluateSftpAuditMatrix() {
  const cases = [
    { action: 'download', path: '/app/app.conf', success: true, size: 20 },
    {
      action: 'downloadBackup',
      path: '/app/app.conf',
      success: true,
      size: 20,
      backupPath: '/app/.nodeaccess-backups/app.conf.2026-07-19T18-00-00-000Z.user-1.bak',
      content: 'secret=must-not-log',
    },
    {
      action: 'viewBackupDiff',
      path: '/app/app.conf',
      success: true,
      backupPath: '/app/.nodeaccess-backups/app.conf.2026-07-19T18-00-00-000Z.user-1.bak',
      changedLines: 1,
      addedLines: 1,
      removedLines: 1,
      diffSkippedReason: null,
      content: 'secret=must-not-log',
    },
    { action: 'upload', path: '/app/upload.txt', success: true, size: 12, uploadFileName: 'upload.txt' },
    { action: 'delete', path: '/app/old.txt', success: true },
    { action: 'rename', path: '/app/old.txt', newPath: '/app/new.txt', success: true },
    { action: 'mkdir', path: '/app/new-dir', success: true },
    { action: 'createFile', path: '/app/new.txt', success: true },
    { action: 'readFile', path: '/app/app.conf', success: true, size: 20, content: 'secret=must-not-log' },
    {
      action: 'writeFile',
      path: '/app/app.conf',
      success: true,
      size: 16,
      backupPath: '/app/.nodeaccess-backups/app.conf.2026-07-19T18-00-00-000Z.user-1.bak',
      preRestoreBackupPath: '/app/.nodeaccess-backups/app.conf.2026-07-19T18-01-00-000Z.user-1.pre-restore.bak',
      tempPath: '/app/.app.conf.nodeaccess-2026-07-19T18-00-00-000Z.user-1.tmp',
      preservedMode: true,
      preservedOwnership: false,
      preservedTimestamps: true,
      metadataPreservationErrors: ['chown: permission denied'],
      changedLines: 1,
      addedLines: 1,
      removedLines: 1,
      diffPreviewMasked: '-secret=[MASKED]\n+secret=[MASKED]',
      content: 'secret=must-not-log',
    },
    { action: 'writeFile', path: '/app/readonly.conf', success: false, errorMessage: 'Permission denied' },
  ]
  return cases.map((item) => {
    const details = {
      provider: 'sftp',
      action: item.action,
      hostId: HOST_ID,
      path: item.path,
      success: item.success,
      ...(item.size !== undefined ? { size: item.size } : {}),
      ...(item.newPath !== undefined ? { newPath: item.newPath } : {}),
      ...(item.uploadFileName !== undefined ? { uploadFileName: item.uploadFileName } : {}),
      ...(item.backupPath !== undefined ? { backupPath: item.backupPath } : {}),
      ...(item.preRestoreBackupPath !== undefined ? { preRestoreBackupPath: item.preRestoreBackupPath } : {}),
      ...(item.tempPath !== undefined ? { tempPath: item.tempPath } : {}),
      ...(item.preservedMode !== undefined ? { preservedMode: item.preservedMode } : {}),
      ...(item.preservedOwnership !== undefined ? { preservedOwnership: item.preservedOwnership } : {}),
      ...(item.preservedTimestamps !== undefined ? { preservedTimestamps: item.preservedTimestamps } : {}),
      ...(item.metadataPreservationErrors !== undefined ? { metadataPreservationErrors: item.metadataPreservationErrors } : {}),
      ...(item.changedLines !== undefined ? { changedLines: item.changedLines } : {}),
      ...(item.addedLines !== undefined ? { addedLines: item.addedLines } : {}),
      ...(item.removedLines !== undefined ? { removedLines: item.removedLines } : {}),
      ...(item.diffPreviewMasked !== undefined ? { diffPreviewMasked: item.diffPreviewMasked } : {}),
      ...(item.diffSkippedReason !== undefined ? { diffSkippedReason: item.diffSkippedReason } : {}),
      ...(item.errorMessage !== undefined ? { errorMessage: item.errorMessage } : {}),
    }
    return {
      scenario: item.success ? `${item.action}:success` : `${item.action}:failure`,
      details,
      ok: details.provider === 'sftp'
        && typeof details.path === 'string'
        && typeof details.success === 'boolean'
        && !JSON.stringify(details).includes('must-not-log'),
    }
  })
}

function summarizeFindings(results, auditMatrix) {
  const findings = []
  const consoleIssues = captured.console.filter((item) => ['error', 'warning', 'assert'].includes(item.type))
  const perfSnapshots = results.map((item) => item.performance).filter(Boolean)
  const maxWarmNavigationMs = Math.max(0, ...captured.timings.slice(1).map((item) => item.ms))
  const maxDomNodes = Math.max(0, ...perfSnapshots.map((item) => item.domNodes || 0))

  if (maxWarmNavigationMs > 2000) {
    findings.push({
      severity: 'warning',
      area: 'performance',
      message: 'Navegação quente do File Manager passou de 2s.',
      evidence: { maxWarmNavigationMs },
    })
  }

  if (maxDomNodes > 8000) {
    findings.push({
      severity: 'info',
      area: 'performance',
      message: 'File Manager montou mais de 8k nós DOM no harness; monitorar crescimento com árvores grandes.',
      evidence: { maxDomNodes },
    })
  }

  if (consoleIssues.length > 0) {
    findings.push({
      severity: 'warning',
      area: 'runtime',
      message: 'Console emitiu avisos/erros durante o harness.',
      evidence: { count: consoleIssues.length },
    })
  }

  if (captured.pageErrors.length > 0) {
    findings.push({
      severity: 'error',
      area: 'runtime',
      message: 'A página emitiu exceções JavaScript.',
      evidence: { count: captured.pageErrors.length },
    })
  }

  const failedAuditCases = auditMatrix.filter((item) => !item.ok)
  if (failedAuditCases.length > 0) {
    findings.push({
      severity: 'error',
      area: 'audit',
      message: 'Matriz de auditoria SFTP contém metadados ausentes ou conteúdo sensível.',
      evidence: failedAuditCases.map((item) => item.scenario),
    })
  }

  return findings
}

async function main() {
  const tabs = await getJson(`${CDP_BASE}/json`)
  const tab = tabs.find((item) => item.type === 'page') || tabs[0]
  if (!tab?.webSocketDebuggerUrl) throw new Error(`No CDP page found at ${CDP_BASE}`)

  const cdp = new Cdp(tab.webSocketDebuggerUrl)
  await cdp.open()
  try {
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')
    await cdp.send('Network.enable')
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    await cdp.send('Performance.enable')
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        localStorage.setItem('na_access_token', ${JSON.stringify(fakeJwt())});
        localStorage.setItem('na_refresh_token', 'harness-refresh-token');
        localStorage.setItem('nodeaccess_locale', 'pt-BR');
      `,
    })
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

    const results = []

    await navigate(cdp, 'happy-path')
    results.push({
      scenario,
      connectedVisible: await textIncludes(cdp, 'SFTP conectado'),
      rootVisible: await textIncludes(cdp, 'app'),
      screenshot: await captureScreenshot(cdp, 'sftp-root'),
      performance: await getPerformanceSnapshot(cdp, 'sftp-root'),
    })
    if (!results.at(-1).connectedVisible) throw new Error('SFTP connected state should be visible')

    await openDirectory(cdp, 'app')
    await waitFor(cdp, 'document.body.innerText.includes("app.conf")')
    const createPayload = await createFileFromUi(cdp, 'new-harness.txt')
    results.push({
      scenario: 'create-file-ui',
      createPayload,
      sentPathInBody: createPayload?.path === '/app/new-harness.txt',
      noPathInQuery: captured.apiCalls
        .filter((call) => call.method === 'POST' && call.path.endsWith('/touch'))
        .at(-1)?.query?.path === undefined,
      screenshot: await captureScreenshot(cdp, 'sftp-create-file'),
      performance: await getPerformanceSnapshot(cdp, 'sftp-create-file'),
    })
    if (!results.at(-1).sentPathInBody) throw new Error('Create file must send path in request body')
    if (!results.at(-1).noPathInQuery) throw new Error('Create file must not send path only as query string')

    const read = await directApi(cdp, 'GET', `/sftp/${HOST_ID}/read?path=${encodeURIComponent('/app/app.conf')}`)
    const write = await directApi(cdp, 'PUT', `/sftp/${HOST_ID}/write`, {
      path: '/app/app.conf',
      content: 'port=9090\nmode=harness\n',
      expectedHash: read.data?.hash,
      expectedModifiedAt: read.data?.modifiedAt,
      expectedSize: read.data?.size,
    })
    const readAfterWrite = await directApi(cdp, 'GET', `/sftp/${HOST_ID}/read?path=${encodeURIComponent('/app/app.conf')}`)
    results.push({
      scenario: 'read-write-api',
      readStatus: read.status,
      writeStatus: write.status,
      readAfterWriteStatus: readAfterWrite.status,
      contentChanged: readAfterWrite.data?.content === 'port=9090\nmode=harness\n',
      sentExpectedHash: captured.writePayloads.at(-1)?.expectedHash === read.data?.hash,
      writePayload: captured.writePayloads.at(-1),
    })
    if (!read.ok || !write.ok || !readAfterWrite.ok || !results.at(-1).contentChanged) {
      throw new Error('SFTP read/write API flow failed')
    }

    const deniedCreate = await directApi(cdp, 'POST', `/sftp/${HOST_ID}/touch`, { path: '/app/denied.txt' })
    const deniedWrite = await directApi(cdp, 'PUT', `/sftp/${HOST_ID}/write`, {
      path: '/app/readonly.conf',
      content: 'blocked=true\n',
    })
    results.push({
      scenario: 'permission-denied-api',
      createStatus: deniedCreate.status,
      createMessage: deniedCreate.data?.message,
      writeStatus: deniedWrite.status,
      writeMessage: deniedWrite.data?.message,
      clearPermissionMessage: String(deniedCreate.data?.message || '').includes('Permissão negada')
        && String(deniedWrite.data?.message || '').includes('Permissão negada'),
    })
    if (!results.at(-1).clearPermissionMessage) throw new Error('Permission denied responses should be clear')

    scenario = 'permission-denied-ui'
    await clickButtonContaining(cdp, 'Novo arquivo')
    await waitFor(cdp, 'document.body.innerText.includes("Nome do arquivo")')
    await fillVisibleInput(cdp, 'denied-ui.txt')
    await clickButtonContaining(cdp, 'Criar')
    await waitFor(cdp, 'document.body.innerText.includes("Permissão negada")')
    results.push({
      scenario,
      permissionToastVisible: await textIncludes(cdp, 'Permissão negada'),
      screenshot: await captureScreenshot(cdp, 'sftp-permission-denied'),
      performance: await getPerformanceSnapshot(cdp, 'sftp-permission-denied'),
    })
    if (!results.at(-1).permissionToastVisible) throw new Error('Permission denied toast should be visible')

    await navigateTo(cdp, '/admin/sftp-audit', 'sftp-audit-screen', 'Auditoria SFTP')
    await waitFor(cdp, 'document.body.innerText.includes("/app/app.conf")')
    results.push({
      scenario,
      auditTitleVisible: await textIncludes(cdp, 'Auditoria SFTP'),
      readOperationVisible: await textIncludes(cdp, 'Abertura/leitura'),
      diffActionVisible: await textIncludes(cdp, 'Diff'),
      downloadBackupActionVisible: await textIncludes(cdp, 'Baixar'),
      restoreActionVisible: await textIncludes(cdp, 'Restaurar'),
      successVisible: await textIncludes(cdp, 'Sucesso'),
      auditQuery: captured.auditLogQueries.at(-1),
      screenshot: await captureScreenshot(cdp, 'sftp-audit-screen'),
      performance: await getPerformanceSnapshot(cdp, 'sftp-audit-screen'),
    })
    if (!results.at(-1).auditTitleVisible || !results.at(-1).readOperationVisible || !results.at(-1).diffActionVisible || !results.at(-1).downloadBackupActionVisible || !results.at(-1).restoreActionVisible) {
      throw new Error('SFTP audit screen should render structured operation rows')
    }
    if (results.at(-1).auditQuery?.actions !== 'SFTP_OPERATION') {
      throw new Error('SFTP audit screen must query only SFTP_OPERATION logs')
    }

    const auditMatrix = evaluateSftpAuditMatrix()
    if (!auditMatrix.every((item) => item.ok)) throw new Error('SFTP audit matrix has unsafe metadata')
    const findings = summarizeFindings(results, auditMatrix)

    const report = {
      ok: true,
      frontend: FRONTEND,
      cdpBase: CDP_BASE,
      hostId: HOST_ID,
      results,
      auditMatrix,
      findings,
      apiCalls: captured.apiCalls,
      createPayloads: captured.createPayloads,
      restorePayloads: captured.restorePayloads,
      writePayloads: captured.writePayloads.map((payload) => payload ? {
        path: payload.path,
        contentLength: typeof payload.content === 'string' ? payload.content.length : null,
        expectedHash: payload.expectedHash || null,
        expectedModifiedAt: payload.expectedModifiedAt || null,
        expectedSize: payload.expectedSize ?? null,
      } : payload),
      readPaths: captured.readPaths,
      auditLogQueries: captured.auditLogQueries,
      timings: captured.timings,
      consoleEvents: captured.console.length,
      pageErrors: captured.pageErrors,
      writtenAt: new Date().toISOString(),
    }
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally {
    cdp.close()
  }
}

main().catch((error) => {
  const report = {
    ok: false,
    error: error.stack || error.message,
    apiCalls: captured.apiCalls,
    createPayloads: captured.createPayloads,
    restorePayloads: captured.restorePayloads,
    writePayloads: captured.writePayloads.map((payload) => payload ? {
      path: payload.path,
      contentLength: typeof payload.content === 'string' ? payload.content.length : null,
      expectedHash: payload.expectedHash || null,
      expectedModifiedAt: payload.expectedModifiedAt || null,
      expectedSize: payload.expectedSize ?? null,
    } : payload),
    readPaths: captured.readPaths,
    auditLogQueries: captured.auditLogQueries,
    timings: captured.timings,
    consoleEvents: captured.console.length,
    pageErrors: captured.pageErrors,
    writtenAt: new Date().toISOString(),
  }
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
  console.error(JSON.stringify(report, null, 2))
  process.exit(1)
})
