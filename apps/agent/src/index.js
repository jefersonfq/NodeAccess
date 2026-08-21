#!/usr/bin/env node
// NodeAccess Agent — proxy reverso SSH via VPN local
// Uso: nodeaccess-agent --server wss://meuserver.com --token na_agent_xxx

'use strict'

const { WebSocket } = require('ws')
const net           = require('net')
const os            = require('os')
const fs            = require('fs')
const { parseArgs } = require('util')
const { version: AGENT_VERSION } = require('../package.json')
const { reconnectDelay, resolveToken } = require('./agent-runtime')

// ── CLI args ─────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    server:  { type: 'string',  short: 's' },
    token:   { type: 'string',  short: 't' },
    'token-file': { type: 'string' },
    ca:      { type: 'string' },
    insecure:{ type: 'boolean', default: false },
    verbose: { type: 'boolean', short: 'v', default: false },
    version: { type: 'boolean' },
  },
  strict: false,
})

if (values.version) {
  console.log(`NodeAccess Agent ${AGENT_VERSION}`)
  process.exit(0)
}

let resolvedToken = ''
try { resolvedToken = resolveToken(values, process.env, fs.readFileSync) } catch (error) {
  console.error(`Não foi possível ler --token-file: ${error.message}`)
  process.exit(1)
}

if (!values.server || !resolvedToken) {
  console.error('Uso: nodeaccess-agent --server <url> (--token <token> | --token-file <arquivo>)')
  console.error('  -s, --server   URL do servidor NodeAccess (http:// ou https:// ou ws:// ou wss://)')
  console.error('  -t, --token    Token do agente (gerado no painel)')
  console.error('      --token-file Arquivo protegido contendo o token')
  console.error('      --ca        Certificado CA adicional em PEM')
  console.error('      --insecure  Desabilita validação TLS (somente diagnóstico)')
  console.error('  -v, --verbose  Log detalhado')
  console.error('      --version  Mostra a versão do agente')
  process.exit(1)
}

const SERVER_URL = values.server.replace(/^http/, 'ws').replace(/\/$/, '')
const TOKEN      = resolvedToken
const VERBOSE    = values.verbose
const INSECURE   = values.insecure === true
const CA_CERT    = values.ca ? fs.readFileSync(values.ca) : undefined
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
let activeWs = null
let reconnectTimer = null
let shuttingDown = false
let reconnectAttempts = 0
let stableTimer = null

// ── Logging ───────────────────────────────────────────────────────────────────

function log(...args)   { console.log(`[${new Date().toISOString()}]`, ...args) }
function debug(...args) { if (VERBOSE) log('[DEBUG]', ...args) }

function agentQuery() {
  const params = new URLSearchParams({
    token: TOKEN,
    version: AGENT_VERSION,
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    tlsMode: INSECURE ? 'insecure' : 'verified',
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
  log(`Encerrando por ${signal}...`)
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
  const url = `${SERVER_URL}/ws/agent?${agentQuery()}`
  log(`Conectando a ${SERVER_URL}...`)

  const ws = new WebSocket(url, {
    rejectUnauthorized: !INSECURE,
    ...(CA_CERT ? { ca: CA_CERT } : {}),
  })
  activeWs = ws

  ws.on('open', () => {
    log('Conectado ao servidor NodeAccess.')
    if (INSECURE) log('AVISO: validação TLS desabilitada por --insecure.')
    stableTimer = setTimeout(() => { reconnectAttempts = 0 }, CONNECTION_STABLE_MS)
  })

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      handleBinary(ws, data)
    } else {
      try {
        handleControl(ws, JSON.parse(data.toString()))
      } catch { /* ignorar JSON inválido */ }
    }
  })

  ws.on('close', (code) => {
    if (stableTimer) { clearTimeout(stableTimer); stableTimer = null }
    if (!shuttingDown) reconnectAttempts += 1
    const delay = reconnectDelay(reconnectAttempts)
    log(`Conexão encerrada (${code}).${shuttingDown ? '' : ` Reconectando em ${delay}ms... tentativa ${reconnectAttempts}`}`)
    destroyAllConnections()
    if (!shuttingDown) reconnectTimer = setTimeout(connect, delay)
  })

  ws.on('error', (err) => {
    // 'close' dispara em seguida — só loga
    log(`Erro WebSocket: ${err.message}`)
  })
}

// ── Control message handler ───────────────────────────────────────────────────

function handleControl(ws, msg) {
  switch (msg.type) {
    case 'registered':
      log(`Agente registrado: "${msg.name}" (id: ${msg.agentId})`)
      break

    case 'connect': {
      const { connectionId, host, port } = msg
      log(`Nova conexão: ${connectionId} → ${host}:${port}`)

      const sock = new net.Socket()
      let closeReason = 'tcp_close'
      const connectTimeout = setTimeout(() => {
        closeReason = 'tcp_connect_timeout'
        const message = `Timeout TCP conectando ${host}:${port}`
        log(`${message} (${connectionId})`)
        connections.delete(connectionId)
        sendControl(ws, { type: 'error', connectionId, message })
        sock.destroy()
      }, TCP_CONNECT_TIMEOUT_MS)
      connections.set(connectionId, sock)

      sock.connect(port, host, () => {
        clearTimeout(connectTimeout)
        debug(`TCP conectado: ${host}:${port}`)
        sendControl(ws, { type: 'connected', connectionId })
      })

      sock.on('data', (chunk) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(buildFrame(connectionId, chunk))
        }
      })

      sock.on('close', () => {
        clearTimeout(connectTimeout)
        debug(`TCP fechado: ${connectionId} (${closeReason})`)
        connections.delete(connectionId)
        sendControl(ws, { type: 'close', connectionId })
      })

      sock.on('error', (err) => {
        clearTimeout(connectTimeout)
        closeReason = `tcp_error:${err.code || err.message}`
        log(`Erro TCP (${connectionId}): ${err.message}`)
        connections.delete(connectionId)
        sendControl(ws, { type: 'error', connectionId, message: err.message })
      })
      break
    }

    case 'close': {
      const sock = connections.get(msg.connectionId)
      if (sock) {
        debug(`Fechamento solicitado pelo servidor: ${msg.connectionId}`)
        sock.destroy()
        connections.delete(msg.connectionId)
      }
      break
    }

    case 'ping':
      sendControl(ws, { type: 'pong', sentAt: msg.sentAt })
      break

    case 'error':
      log(`Erro do servidor: ${msg.message}`)
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
    sock.write(frame.payload)
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

log(`NodeAccess Agent ${AGENT_VERSION} iniciando...`)
log(`Servidor: ${SERVER_URL}`)
log(`Máquina: ${os.hostname()} (${process.platform}/${process.arch})`)
connect()

process.on('SIGINT',  () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
