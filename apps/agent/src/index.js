#!/usr/bin/env node
// NodeAccess Agent — proxy reverso SSH via VPN local
// Uso: nodeaccess-agent --server wss://meuserver.com --token na_agent_xxx

'use strict'

const { WebSocket } = require('ws')
const net           = require('net')
const { parseArgs } = require('util')

// ── CLI args ─────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    server:  { type: 'string',  short: 's' },
    token:   { type: 'string',  short: 't' },
    verbose: { type: 'boolean', short: 'v', default: false },
  },
  strict: false,
})

if (!values.server || !values.token) {
  console.error('Uso: nodeaccess-agent --server <url> --token <token>')
  console.error('  -s, --server   URL do servidor NodeAccess (http:// ou https:// ou ws:// ou wss://)')
  console.error('  -t, --token    Token do agente (gerado no painel)')
  console.error('  -v, --verbose  Log detalhado')
  process.exit(1)
}

const SERVER_URL = values.server.replace(/^http/, 'ws').replace(/\/$/, '')
const TOKEN      = values.token
const VERBOSE    = values.verbose

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

// ── Logging ───────────────────────────────────────────────────────────────────

function log(...args)   { console.log(`[${new Date().toISOString()}]`, ...args) }
function debug(...args) { if (VERBOSE) log('[DEBUG]', ...args) }

// ── WebSocket connection ──────────────────────────────────────────────────────

function connect() {
  const url = `${SERVER_URL}/ws/agent?token=${encodeURIComponent(TOKEN)}`
  log(`Conectando a ${SERVER_URL}...`)

  const ws = new WebSocket(url, {
    rejectUnauthorized: false, // permite certificados self-signed em dev
  })

  ws.on('open', () => {
    log('Conectado ao servidor NodeAccess.')
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
    log(`Conexão encerrada (${code}). Reconectando em 5s...`)
    for (const sock of connections.values()) sock.destroy()
    connections.clear()
    setTimeout(connect, 5_000)
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
      connections.set(connectionId, sock)

      sock.connect(port, host, () => {
        debug(`TCP conectado: ${host}:${port}`)
        ws.send(JSON.stringify({ type: 'connected', connectionId }))
      })

      sock.on('data', (chunk) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(buildFrame(connectionId, chunk))
        }
      })

      sock.on('close', () => {
        debug(`TCP fechado: ${connectionId}`)
        connections.delete(connectionId)
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'close', connectionId }))
        }
      })

      sock.on('error', (err) => {
        log(`Erro TCP (${connectionId}): ${err.message}`)
        connections.delete(connectionId)
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'error', connectionId, message: err.message }))
        }
      })
      break
    }

    case 'close': {
      const sock = connections.get(msg.connectionId)
      if (sock) {
        sock.destroy()
        connections.delete(msg.connectionId)
      }
      break
    }

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }))
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

log('NodeAccess Agent iniciando...')
log(`Servidor: ${SERVER_URL}`)
connect()

process.on('SIGINT',  () => { log('Encerrando...'); process.exit(0) })
process.on('SIGTERM', () => { log('Encerrando...'); process.exit(0) })
