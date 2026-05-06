#!/usr/bin/env node

require('dotenv').config({ path: 'apps/backend/.env' })

const crypto = require('node:crypto')
const net = require('node:net')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const BASE_URL = (process.env.MCP_VALIDATE_BASE_URL || 'http://127.0.0.1:3013/api/v1').replace(/\/$/, '')
const TENANT_SLUG = process.env.LOADTEST_TENANT_SLUG || 'loadtest'
const ADMIN_EMAIL = process.env.LOADTEST_MCP_ADMIN_EMAIL || 'loadtest-mcp-admin@nodeaccess.local'
const TOKEN_VALUE = process.env.LOADTEST_MCP_TOKEN || `na_mcp_validate_${crypto.randomBytes(24).toString('hex')}`
const MOCK_SSH_HOST = process.env.MOCK_SSH_HOST || '127.0.0.1'
const MOCK_SSH_PORT = Number(process.env.MOCK_SSH_PORT || '2222')

const INTERACTIVE_CAPABILITIES = [
  'open_interactive_ssh_session',
  'write_interactive_ssh_session',
  'read_interactive_ssh_session',
  'resize_interactive_ssh_session',
  'close_interactive_ssh_session',
]

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function mergeEntitlements(current) {
  const parsed = current && typeof current === 'object' && !Array.isArray(current) ? current : {}
  return {
    ...parsed,
    mcp: true,
    aiSshActions: true,
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function checkTcp(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: 1500 })
    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.on('error', () => resolve(false))
  })
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN_VALUE}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { response, body }
}

async function ensureToken() {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: TENANT_SLUG },
    select: { id: true, slug: true },
  })
  assert(tenant, `Tenant ${TENANT_SLUG} nao encontrado. Rode seed-local-loadtest antes.`)

  const host = await prisma.host.findFirst({
    where: { tenantId: tenant.id, name: { startsWith: 'loadtest-mock-' } },
    orderBy: { id: 'asc' },
    select: { id: true, name: true },
  })
  assert(host, `Nenhum host loadtest-mock encontrado no tenant ${TENANT_SLUG}. Rode seed-local-loadtest antes.`)

  const deniedHost = await prisma.host.findFirst({
    where: { tenantId: tenant.id, id: { not: host.id }, name: { startsWith: 'loadtest-mock-' } },
    orderBy: { id: 'asc' },
    select: { id: true, name: true },
  })

  const license = await prisma.license.findUnique({
    where: { tenantId: tenant.id },
    select: { featureEntitlementsJson: true },
  })
  await prisma.license.update({
    where: { tenantId: tenant.id },
    data: {
      active: true,
      featureEntitlementsJson: mergeEntitlements(license?.featureEntitlementsJson),
    },
  })

  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {
      tenantId: tenant.id,
      active: true,
      role: 'ADMIN',
      canManageHosts: true,
      forcePasswordChange: false,
      licenseConsumed: true,
    },
    create: {
      name: 'Loadtest MCP Admin',
      email: ADMIN_EMAIL,
      tenantId: tenant.id,
      active: true,
      role: 'ADMIN',
      canManageHosts: true,
      forcePasswordChange: false,
      licenseConsumed: true,
    },
    select: { id: true, email: true },
  })

  await prisma.mcpToken.upsert({
    where: { tokenHash: hashToken(TOKEN_VALUE) },
    update: {
      tenantId: tenant.id,
      createdById: admin.id,
      name: 'Loadtest MCP interactive validation',
      allowedCapabilitiesJson: INTERACTIVE_CAPABILITIES,
      allowedActionModesJson: ['full_operational_access'],
      allowedHostIdsJson: [host.id],
      active: true,
      expiresAt: null,
      revokedAt: null,
      revokedById: null,
    },
    create: {
      tenantId: tenant.id,
      createdById: admin.id,
      name: 'Loadtest MCP interactive validation',
      tokenHash: hashToken(TOKEN_VALUE),
      allowedCapabilitiesJson: INTERACTIVE_CAPABILITIES,
      allowedActionModesJson: ['full_operational_access'],
      allowedHostIdsJson: [host.id],
      active: true,
    },
  })

  return { tenant, host, deniedHost, admin }
}

async function main() {
  const tcpReady = await checkTcp(MOCK_SSH_HOST, MOCK_SSH_PORT)
  assert(tcpReady, `Mock SSH indisponivel em ${MOCK_SSH_HOST}:${MOCK_SSH_PORT}. Rode node tools/load-tests/scripts/mock-ssh-server.js`)

  const context = await ensureToken()
  console.log(`API: ${BASE_URL}`)
  console.log(`Tenant: ${context.tenant.slug} id=${context.tenant.id}`)
  console.log(`Admin: ${context.admin.email} id=${context.admin.id}`)
  console.log(`Allowed host: ${context.host.name} id=${context.host.id}`)

  const tools = await request('/mcp/tools')
  assert(tools.response.ok, `tools failed: HTTP ${tools.response.status} ${JSON.stringify(tools.body)}`)
  for (const capability of INTERACTIVE_CAPABILITIES) {
    assert(tools.body.items.some((tool) => tool.key === capability), `Tool ausente no catalogo: ${capability}`)
  }
  console.log('OK tools catalog')

  const open = await request('/mcp/tools/open-interactive-ssh-session', {
    method: 'POST',
    body: JSON.stringify({
      hostId: context.host.id,
      reason: 'Validacao automatizada MCP interativa local',
      ttlSeconds: 120,
      cols: 120,
      rows: 32,
    }),
  })
  assert(open.response.ok, `open failed: HTTP ${open.response.status} ${JSON.stringify(open.body)}`)
  const sessionId = open.body.sessionId
  assert(sessionId, 'open nao retornou sessionId')
  console.log(`OK open session=${sessionId}`)

  const write = await request('/mcp/tools/write-interactive-ssh-session', {
    method: 'POST',
    body: JSON.stringify({ sessionId, data: 'uptime\n' }),
  })
  assert(write.response.ok, `write failed: HTTP ${write.response.status} ${JSON.stringify(write.body)}`)
  assert(write.body.acceptedBytes === 7, 'write nao confirmou 7 bytes')
  console.log('OK write uptime')

  let read = null
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    read = await request('/mcp/tools/read-interactive-ssh-session', {
      method: 'POST',
      body: JSON.stringify({ sessionId, cursor: 0, maxBytes: 16000 }),
    })
    assert(read.response.ok, `read failed: HTTP ${read.response.status} ${JSON.stringify(read.body)}`)
    if (String(read.body.output || '').includes('load average')) break
    await wait(200)
  }
  assert(String(read.body.output || '').includes('Welcome to NodeAccess mock SSH'), 'read nao retornou banner do mock SSH')
  assert(String(read.body.output || '').includes('load average'), 'read nao retornou output do uptime')
  console.log('OK read output')

  const close = await request('/mcp/tools/close-interactive-ssh-session', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  })
  assert(close.response.ok, `close failed: HTTP ${close.response.status} ${JSON.stringify(close.body)}`)
  assert(close.body.closed === true, 'close nao confirmou encerramento')
  console.log('OK close')

  if (context.deniedHost) {
    const denied = await request('/mcp/tools/open-interactive-ssh-session', {
      method: 'POST',
      body: JSON.stringify({
        hostId: context.deniedHost.id,
        reason: 'Validacao automatizada de bloqueio por host',
        ttlSeconds: 120,
        cols: 120,
        rows: 32,
      }),
    })
    assert(denied.response.status === 403, `host deny esperado HTTP 403, recebeu ${denied.response.status}`)
    const lastDenied = await prisma.adminLog.findFirst({
      where: { action: 'MCP_DENIED', targetType: 'MCP' },
      orderBy: { timestamp: 'desc' },
      select: { details: true },
    })
    const details = JSON.parse(lastDenied?.details || '{}')
    assert(details.capability === 'open_interactive_ssh_session', 'MCP_DENIED registrou capability incorreta')
    assert(details.hostId === context.deniedHost.id, 'MCP_DENIED registrou hostId incorreto')
    console.log(`OK host deny host=${context.deniedHost.id}`)
  }

  const auditCount = await prisma.adminLog.count({
    where: {
      targetType: 'MCP_INTERACTIVE_SSH',
      action: { in: ['MCP_INTERACTIVE_SSH_OPENED', 'MCP_INTERACTIVE_SSH_INPUT', 'MCP_INTERACTIVE_SSH_OUTPUT_READ', 'MCP_INTERACTIVE_SSH_CLOSED'] },
      details: { contains: sessionId },
    },
  })
  assert(auditCount >= 4, `auditoria incompleta para sessionId=${sessionId}`)
  console.log('OK audit trail')

  const persistedRows = await prisma.$queryRawUnsafe(`
    SELECT
      session_id AS sessionId,
      tenant_id AS tenantId,
      token_id AS tokenId,
      host_id AS hostId,
      status,
      close_reason AS closeReason,
      input_bytes AS inputBytes,
      output_bytes_read AS outputBytesRead,
      closed_at AS closedAt
    FROM mcp_interactive_ssh_sessions
    WHERE session_id = ?
    LIMIT 1
  `, sessionId)
  const persistedSession = Array.isArray(persistedRows) ? persistedRows[0] : null
  assert(persistedSession, `sessao persistida nao encontrada para sessionId=${sessionId}`)
  assert(persistedSession.tenantId === context.tenant.id, 'sessao persistida registrou tenant incorreto')
  assert(persistedSession.hostId === context.host.id, 'sessao persistida registrou host incorreto')
  assert(persistedSession.status === 'closed', 'sessao persistida nao foi marcada como closed')
  assert(persistedSession.closeReason === 'client_closed', 'sessao persistida registrou motivo de fechamento incorreto')
  assert(persistedSession.inputBytes >= 7, 'sessao persistida nao acumulou inputBytes')
  assert(persistedSession.outputBytesRead > 0, 'sessao persistida nao acumulou outputBytesRead')
  assert(persistedSession.closedAt, 'sessao persistida nao registrou closedAt')
  console.log('OK persisted session')

  console.log('MCP interactive SSH validation passed')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
