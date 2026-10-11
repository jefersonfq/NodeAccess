#!/usr/bin/env node
// NodeAccess Agent — proxy reverso SSH via VPN local
// Uso: nodeaccess-agent --server wss://meuserver.com --token na_agent_xxx

'use strict'

const { WebSocket } = require('ws')
const net           = require('net')
const { loadPolicy } = require('./access-policy')
const { connectionOptions } = require('./connection-security')
const { DesktopEdits } = require('./desktop-edit')
const { LocalListeners } = require('./local-listeners')
const os            = require('os')
const fs            = require('fs')
const { parseArgs } = require('util')
const { version: AGENT_VERSION } = require('../package.json')
const { reconnectDelay, resolveToken } = require('./agent-runtime')
const { randomUUID, createHash } = require('node:crypto')
const { catalog, errorCode, closeCode, watchConnection } = require('./connection-health')
const { createOutbox } = require('./diagnostic-outbox')
const { createDiagnosticLogger } = require('./diagnostic-log')

// ── CLI args ─────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    server:  { type: 'string',  short: 's' },
    token:   { type: 'string',  short: 't' },
    'token-file': { type: 'string' },
    ca:      { type: 'string' },
    policy: { type: 'string' },
    'check-policy': { type: 'string' },
    development: { type: 'boolean', default: false },
    insecure:{ type: 'boolean', default: false },
    verbose: { type: 'boolean', short: 'v', default: false },
    version: { type: 'boolean' },
    check: { type: 'boolean' },
    'status-file': { type: 'string' },
    'log-file': { type: 'string' },
  },
  strict: false,
})

if (values.version) {
  console.log(`NodeAccess Agent ${AGENT_VERSION}`)
  process.exit(0)
}

if (values['check-policy']) {
  try { loadPolicy(values['check-policy']); console.log('Politica local valida'); process.exit(0) }
  catch (error) { console.error(error.message); process.exit(1) }
}

let resolvedToken = ''
try { resolvedToken = resolveToken(values, process.env, fs.readFileSync) } catch (error) {
  console.error(`Não foi possível ler --token-file: ${error.message}`)
  process.exit(1)
}

if (!values.server || !resolvedToken) {
  console.error('Uso: nodeaccess-agent --server <url> (--token <token> | --token-file <arquivo>)')
  console.error('  -s, --server   URL HTTPS/WSS do servidor NodeAccess')
  console.error('  -t, --token    Token do agente (gerado no painel)')
  console.error('      --token-file Arquivo protegido contendo o token')
  console.error('      --check-policy Valida o arquivo JSON local sem conectar')
  console.error('      --policy    Arquivo JSON local de destinos/portas autorizados')
  console.error('      --development Permite transporte inseguro apenas em laboratório')
  console.error('      --ca        Certificado CA adicional em PEM')
  console.error('      --insecure  Desabilita validação TLS (exige --development)')
  console.error('  -v, --verbose  Log detalhado')
  console.error('      --check     Verifica registro uma vez e encerra')
  console.error('      --status-file Arquivo local de estado e diagnostico')
  console.error('      --log-file Log operacional JSONL com rotação local')
  console.error('      --version  Mostra a versão do agente')
  process.exit(1)
}

const SERVER_URL = values.server.replace(/^http/, 'ws').replace(/\/$/, '')
const TOKEN      = resolvedToken
const VERBOSE    = values.verbose
const LOG_FILE   = values['log-file'] || process.env.NODEACCESS_AGENT_LOG_FILE || null
const INSECURE   = values.insecure === true
const CA_CERT    = values.ca ? fs.readFileSync(values.ca) : undefined
let security, localPolicy
try {
  security = connectionOptions(SERVER_URL, TOKEN, { insecure: INSECURE, development: values.development, ca: CA_CERT })
  localPolicy = loadPolicy(values.policy || process.env.NODEACCESS_AGENT_POLICY)
} catch (error) { console.error(error.message); process.exit(1) }
if (!values.check) console.error(localPolicy.mode === 'managed_acl' ? 'Acessos gerenciados pelas ACLs do usuário no NodeAccess.' : 'Restrição local adicional ativa; as ACLs do usuário continuam obrigatórias.')
const TCP_CONNECT_TIMEOUT_MS = 15_000
const CONNECTION_STABLE_MS = 30_000

// ── Frame protocol ───────────────────────────────────────────────────────────

const CONN_ID_LEN = 36 // UUID length

function buildFrame(connectionId, payload) {
  const id = Buffer.alloc(CONN_ID_LEN, ' ')
  id.write(connectionId, 'utf8')
  return Buffer.concat([id, payload])
}

function parseFrame(data) {
  if (data.length < CONN_ID_LEN) return null
  const connectionId = data.subarray(0, CONN_ID_LEN).toString('utf8').trim()
  const payload      = data.subarray(CONN_ID_LEN)
  return { connectionId, payload }
}

// ── State ─────────────────────────────────────────────────────────────────────

// connectionId → net.Socket (local TCP connection)
const connections = new Map()
let registeredName = null
let statusState = 'connecting'
let diagnostic = null
let connectedAt = null
let lastDisconnectedAt = null
let lastDisconnectCode = null
let lastDisconnectReason = null
let lastError = null
let lastPingAt = null
let diagnosticCode = null
let attemptId = null
let platformConnectionId = null
let nextRetryAt = null
const outbox = createOutbox(values['status-file'] ? `${values['status-file']}.events.json` : LOG_FILE ? `${LOG_FILE}.events.json` : null, createHash('sha256').update(`${SERVER_URL}|${TOKEN}`).digest('hex'))
function writeStatus(state = statusState) {
  statusState = state
  if (!values['status-file']) return
  try {
    fs.writeFileSync(values['status-file'], JSON.stringify({
      state, diagnostic, diagnosticCode, guidance: catalog[diagnosticCode] || null, attemptId, platformConnectionId, nextRetryAt, pid: process.pid, version: AGENT_VERSION, server: SERVER_URL,
      accessMode: localPolicy.mode, name: registeredName, activeConnections: connections.size,
      connectedAt, lastDisconnectedAt, lastDisconnectCode, lastDisconnectReason,
      lastError, lastPingAt, reconnectAttempts, updatedAt: new Date().toISOString(),
    }), { mode: 0o600 })
  } catch { /* A local status file must never interrupt a tunnel. */ }
}
const checkTimer = values.check ? setTimeout(() => { diagnostic = 'timeout'; diagnosticCode = 'REGISTRATION_TIMEOUT'; writeStatus('disconnected'); process.exit(2) }, 10000) : null
let activeWs = null
let reconnectTimer = null
let shuttingDown = false
let reconnectAttempts = 0
let stableTimer = null

// ── Logging ───────────────────────────────────────────────────────────────────

const diagnostics = createDiagnosticLogger({ filePath: LOG_FILE, verbose: VERBOSE })
function log(event, fields = {}) { diagnostics.info(event, typeof fields === 'object' ? fields : { message: String(fields) }) }
function debug(event, fields = {}) { diagnostics.debug(event, typeof fields === 'object' ? fields : { message: String(fields) }) }

function agentQuery() {
  const params = new URLSearchParams({
    version: AGENT_VERSION,
    hostname: os.hostname(),
    platform: process.platform,
    desktopEditing: process.platform === 'win32' ? '1' : '0',
    arch: process.arch,
    tlsMode: INSECURE || SERVER_URL.startsWith('ws:') ? 'insecure' : 'verified',
  })
  return params.toString()
}

function destroyAllConnections() {
  for (const sock of connections.values()) sock.destroy()
  connections.clear()
}

function sendControl(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message))
  }
}

function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  writeStatus('stopped')
  log('agent.shutdown', { signal, activeConnections: connections.size })
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (stableTimer) clearTimeout(stableTimer)
  destroyAllConnections()
  if (activeWs && activeWs.readyState === WebSocket.OPEN) {
    activeWs.close(1000, signal)
    setTimeout(() => process.exit(0), 500)
    return
  }
  process.exit(0)
}

// ── WebSocket connection ──────────────────────────────────────────────────────

function connect() {
  if (shuttingDown) return
  attemptId = randomUUID()
  platformConnectionId = null
  nextRetryAt = null
  diagnostic = null
  diagnosticCode = null
  lastError = null
  lastPingAt = null
  writeStatus('connecting')
  const url = `${SERVER_URL}/ws/agent?${agentQuery()}`
  log('agent.connecting', { server: SERVER_URL, attempt: reconnectAttempts + 1, attemptId })

  const ws = new WebSocket(url, { ...security.ws, ...(process.platform === 'win32' ? { maxPayload: Math.ceil(2 * 1024 * 1024 / 3) * 4 + 4096 } : {}) })
  activeWs = ws
  ws.agentRegistered = false
  const localListeners = new LocalListeners(ws, localPolicy)
  const desktopEdits = new DesktopEdits(ws)
  ws.once('close', () => desktopEdits.destroy())
  ws.once('close', () => localListeners.destroy())

  ws.on('open', () => {
    connectedAt = new Date().toISOString()
    log('agent.websocket.open', { server: SERVER_URL, attempt: reconnectAttempts + 1, attemptId })
    if (INSECURE) diagnostics.warn('agent.tls.insecure', { server: SERVER_URL })
    ws.health = watchConnection(code => {
      diagnosticCode = code
      diagnostic = 'timeout'
      ws.terminate()
    })
  })

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      if (!ws.agentRegistered) return
      if (!localListeners.binary(data)) handleBinary(ws, data)
    } else {
      try {
        const message = JSON.parse(data.toString())
        if (!ws.agentRegistered && !['registered', 'error', 'ping'].includes(message.type)) { sendControl(ws, { type: 'error', connectionId: message.connectionId, message: 'Agent registration required' }); return }
        if (message.type === 'registered') ws.personalAgent = message.agentMode === 'USER_BOUND'
        if (!(ws.personalAgent && desktopEdits.handle(message)) && !localListeners.handle(message)) void handleControl(ws, message).catch(() => sendControl(ws, { type: 'error', connectionId: message.connectionId, message: 'Invalid agent request' }))
      } catch { /* ignorar JSON inválido */ }
    }
  })

  ws.on('close', (code, reasonBuffer) => {
    const reason = reasonBuffer?.toString('utf8') || ''
    ws.health?.stop()
    clearInterval(ws.reportTimer)
    diagnosticCode = shuttingDown ? 'STOPPED' : diagnosticCode || closeCode(code, reason)
    outbox.add(diagnosticCode, attemptId)
    if (!diagnostic) diagnostic = code === 1008 ? 'rejected' : 'connection_closed'
    if (stableTimer) { clearTimeout(stableTimer); stableTimer = null }
    if (!shuttingDown) reconnectAttempts += 1
    const delay = reconnectDelay(reconnectAttempts)
    nextRetryAt = shuttingDown ? null : new Date(Date.now() + delay).toISOString()
    lastDisconnectedAt = new Date().toISOString()
    lastDisconnectCode = code
    lastDisconnectReason = reason || null
    connectedAt = null
    diagnostics.warn('agent.websocket.closed', { code, diagnosticCode, guidance: catalog[diagnosticCode], attemptId, reason: reason || null, reconnectInMs: shuttingDown ? null : delay, reconnectAttempt: reconnectAttempts, activeConnections: connections.size, lastPingAgeMs: lastPingAt ? Date.now() - new Date(lastPingAt).getTime() : null, message: shuttingDown ? `Conexão encerrada (${code})` : `Conexão encerrada (${code}). Reconectando em ${delay}ms` })
    destroyAllConnections()
    writeStatus(shuttingDown ? 'stopped' : 'disconnected')
    if (values.check) process.exit(2)
    if (!shuttingDown) reconnectTimer = setTimeout(connect, delay)
  })

  ws.on('error', (err) => {
    diagnosticCode = errorCode(err)
    const code = String(err.code || '')
    diagnostic = /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code) ? 'tls'
      : /ENOTFOUND|EAI_AGAIN/.test(code) ? 'dns'
      : /ECONNREFUSED/.test(code) ? 'refused'
      : /401|403/.test(err.message) ? 'rejected'
      : /Unexpected server response/.test(err.message) ? 'http' : 'network'
    // 'close' dispara em seguida — só loga
    lastError = { code: code || null, message: err.message, at: new Date().toISOString() }
    diagnostics.error('agent.websocket.error', { error: err, diagnostic })
    writeStatus()
  })
}

function targetFailure(ws, connectionId, code, message) {
  outbox.add(code, attemptId, connectionId)
  diagnostics.warn('agent.target.failure', { connectionId, attemptId, code, guidance: catalog[code] })
  sendControl(ws, { type: 'error', connectionId, code, message })
}

// ── Control message handler ───────────────────────────────────────────────────

async function handleControl(ws, msg) {
  switch (msg.type) {
    case 'registered':
      if (msg.accessMode !== 'managed_acl') { diagnostic = 'rejected'; writeStatus('disconnected'); ws.close(1008, 'Gateway ACL authorization required'); return }
      if (ws.agentRegistered) return
      platformConnectionId = typeof msg.connectionId === 'string' ? msg.connectionId : null
      ws.agentRegistered = true
      ws.health?.registered()
      stableTimer = setTimeout(() => { reconnectAttempts = 0; writeStatus() }, CONNECTION_STABLE_MS)
      diagnosticCode = null
      nextRetryAt = null
      diagnostic = null
      registeredName = msg.name
      lastError = null
      writeStatus('connected')
      if (values.check) {
        clearTimeout(checkTimer)
        ws.terminate()
        process.exit(0)
      }
      outbox.add('CONNECTED', attemptId)
      const report = () => { const events = outbox.batch(); if (events.length) sendControl(ws, { type: 'diagnostic-report', events }) }
      report()
      ws.reportTimer = setInterval(report, 15_000)
      log('agent.registered', { agentId: msg.agentId, name: msg.name, accessMode: msg.accessMode, attemptId, platformConnectionId })
      break

    case 'connect': {
      const { connectionId, host, port } = msg
      if (typeof connectionId !== 'string' || !/^[a-f0-9-]{36}$/.test(connectionId) || connections.has(connectionId) || connections.size >= 128) { sendControl(ws, { type: 'error', connectionId, message: 'Invalid connection or connection limit' }); return }
      const reservation = { destroy() {} }
      connections.set(connectionId, reservation)
      let address, policyTimeout
      try {
        address = await Promise.race([localPolicy.resolve(host, port), new Promise((_, reject) => { policyTimeout = setTimeout(() => reject(Error('DNS policy timeout')), 5000); policyTimeout.unref() })])
      } catch (error) { if (connections.get(connectionId) === reservation) { connections.delete(connectionId); targetFailure(ws, connectionId, errorCode(error, true), error.message) } return } finally { clearTimeout(policyTimeout) }
      if (ws.readyState !== WebSocket.OPEN || connections.get(connectionId) !== reservation) { if (connections.get(connectionId) === reservation) connections.delete(connectionId); return }
      log('agent.tcp.connecting', { connectionId, host, port, activeConnections: connections.size })

      const sock = new net.Socket()
      let closeReason = 'tcp_close'
      const connectTimeout = setTimeout(() => {
        closeReason = 'tcp_connect_timeout'
        const message = `Timeout TCP conectando ${host}:${port}`
        diagnostics.warn('agent.tcp.connect_timeout', { connectionId, host, port, timeoutMs: TCP_CONNECT_TIMEOUT_MS })
        if (connections.get(connectionId) === sock) connections.delete(connectionId)
        targetFailure(ws, connectionId, 'TCP_TIMEOUT', message)
        sock.destroy()
      }, TCP_CONNECT_TIMEOUT_MS)
      connections.set(connectionId, sock)
      writeStatus()

      sock.connect({ port, host: address.address, family: address.family }, () => {
        clearTimeout(connectTimeout)
        debug('agent.tcp.connected', { connectionId, host, port })
        sendControl(ws, { type: 'connected', connectionId })
      })

      sock.on('data', (chunk) => {
        if (ws.readyState === WebSocket.OPEN) {
          if (ws.bufferedAmount > 2 * 1024 * 1024) { sock.destroy(); return }
          ws.send(buildFrame(connectionId, chunk))
        }
      })

      sock.on('close', () => {
        clearTimeout(connectTimeout)
        debug('agent.tcp.closed', { connectionId, host, port, reason: closeReason })
        if (connections.get(connectionId) === sock) connections.delete(connectionId)
        writeStatus()
        sendControl(ws, { type: 'close', connectionId })
      })

      sock.on('error', (err) => {
        clearTimeout(connectTimeout)
        closeReason = `tcp_error:${err.code || err.message}`
        diagnostics.warn('agent.tcp.error', { connectionId, host, port, error: err })
        if (connections.get(connectionId) === sock) connections.delete(connectionId)
        targetFailure(ws, connectionId, errorCode(err, true), err.message)
      })
      break
    }

    case 'close': {
      const sock = connections.get(msg.connectionId)
      if (sock) {
        debug('agent.tcp.server_close', { connectionId: msg.connectionId })
        sock.destroy()
        connections.delete(msg.connectionId)
      }
      break
    }

    case 'ping':
      ws.health?.ping()
      lastPingAt = new Date().toISOString()
      writeStatus()
      sendControl(ws, { type: 'pong', sentAt: msg.sentAt })
      break

    case 'diagnostic-ack':
      if (Array.isArray(msg.ids)) outbox.acknowledge(msg.ids.filter(id => typeof id === 'string').slice(0, 20))
      break

    case 'error':
      diagnostics.warn('agent.server.error', { message: msg.message, connectionId: msg.connectionId || null })
      break

    default:
      debug('Mensagem desconhecida:', msg)
  }
}

// ── Binary frame handler ──────────────────────────────────────────────────────

function handleBinary(ws, data) {
  const frame = parseFrame(data)
  if (!frame) return
  const sock = connections.get(frame.connectionId)
  if (sock && !sock.destroyed) {
    if (sock.writableLength + frame.payload.length > 2 * 1024 * 1024) { sock.destroy(); return }
  sock.write(frame.payload)
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

log('agent.starting', { version: AGENT_VERSION, server: SERVER_URL, hostname: os.hostname(), platform: process.platform, arch: process.arch, logFileEnabled: !!LOG_FILE })
connect()

process.on('SIGINT',  () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
