#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const WebSocket = require('ws')

const args = process.argv.slice(2)

function argValue(name, fallback) {
  const index = args.indexOf(name)
  if (index >= 0 && args[index + 1]) return args[index + 1]
  return fallback
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function readProfile(filePath) {
  const resolved = path.resolve(process.cwd(), filePath)
  return JSON.parse(fs.readFileSync(resolved, 'utf8'))
}

const profilePath = argValue('--profile', process.env.PROFILE_FILE || 'tools/load-tests/data/profile.example.json')
const profile = readProfile(profilePath)
const users = Array.isArray(profile.users) ? profile.users : []
const hosts = Array.isArray(profile.hosts) ? profile.hosts : []

const config = {
  wsBaseUrl: (process.env.WS_BASE_URL || 'ws://localhost:3001').replace(/\/$/, ''),
  sshWsPath: process.env.SSH_WS_PATH || '/ws/ssh',
  concurrency: numberEnv('CONCURRENCY', 5),
  holdMs: numberEnv('HOLD_MS', 60_000),
  connectTimeoutMs: numberEnv('CONNECT_TIMEOUT_MS', 30_000),
  commandIntervalMs: numberEnv('COMMAND_INTERVAL_MS', 10_000),
  pingIntervalMs: numberEnv('PING_INTERVAL_MS', 15_000),
  startStaggerMs: numberEnv('START_STAGGER_MS', 250),
  cols: numberEnv('COLS', 100),
  rows: numberEnv('ROWS', 30),
}

function activeUsers() {
  return users.filter((user) => user.accessToken && !String(user.accessToken).startsWith('paste-'))
}

function pickPair(index) {
  const usableUsers = activeUsers()
  if (usableUsers.length === 0) {
    throw new Error('No users with accessToken configured. Use a local profile with test tokens.')
  }
  if (hosts.length === 0) {
    throw new Error('No hosts configured in profile.')
  }

  const user = usableUsers[index % usableUsers.length]
  const ownedHosts = hosts.filter((host) => {
    if (!host.user) return true
    return host.user === user.name || host.user === user.email
  })
  const hostPool = ownedHosts.length > 0 ? ownedHosts : hosts
  const host = hostPool[index % hostPool.length]
  return { user, host }
}

function wsUrl(hostId, token) {
  const pathPrefix = config.sshWsPath.startsWith('/') ? config.sshWsPath : `/${config.sshWsPath}`
  const params = new URLSearchParams({
    token,
    cols: String(config.cols),
    rows: String(config.rows),
  })
  return `${config.wsBaseUrl}${pathPrefix}/${hostId}?${params.toString()}`
}

function percentile(values, p) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))]
}

function runSession(index) {
  return new Promise((resolve) => {
    const { user, host } = pickPair(index)
    const url = wsUrl(host.id, user.accessToken)
    const commands = Array.isArray(host.commands) && host.commands.length > 0
      ? host.commands
      : ['whoami', 'pwd', 'uptime']

    const stats = {
      index,
      user: user.name || user.email || `user-${index}`,
      host: host.name || String(host.id),
      connected: false,
      failed: false,
      error: null,
      bytesIn: 0,
      commandsSent: 0,
      connectMs: null,
      firstOutputMs: null,
    }

    const startedAt = performance.now()
    let commandTimer = null
    let pingTimer = null
    let closeTimer = null
    let commandIndex = 0
    let settled = false

    const ws = new WebSocket(url)

    function cleanup() {
      if (commandTimer) clearInterval(commandTimer)
      if (pingTimer) clearInterval(pingTimer)
      if (closeTimer) clearTimeout(closeTimer)
      if (!settled) {
        settled = true
        resolve(stats)
      }
    }

    const connectTimeout = setTimeout(() => {
      stats.failed = true
      stats.error = `connect timeout after ${config.connectTimeoutMs}ms`
      ws.close()
      cleanup()
    }, config.connectTimeoutMs)

    function sendJson(payload) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload))
    }

    function sendNextCommand() {
      if (ws.readyState !== WebSocket.OPEN || !stats.connected) return
      const command = commands[commandIndex % commands.length]
      ws.send(Buffer.from(`${command}\r`), { binary: true })
      stats.commandsSent += 1
      commandIndex += 1
    }

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        stats.bytesIn += Buffer.byteLength(data)
        if (stats.firstOutputMs === null) {
          stats.firstOutputMs = Math.round(performance.now() - startedAt)
        }
        return
      }

      let message = null
      try {
        message = JSON.parse(data.toString())
      } catch {
        return
      }

      if (message.type === 'connected') {
        clearTimeout(connectTimeout)
        stats.connected = true
        stats.connectMs = Math.round(performance.now() - startedAt)

        sendNextCommand()
        commandTimer = setInterval(sendNextCommand, config.commandIntervalMs)
        pingTimer = setInterval(() => sendJson({ type: 'ping' }), config.pingIntervalMs)
        closeTimer = setTimeout(() => ws.close(1000, 'load-test complete'), config.holdMs)
        return
      }

      if (message.type === 'credentials_required') {
        const username = host.sshUsername || user.sshUsername
        const password = host.sshPassword || user.sshPassword
        sendJson({
          type: 'credentials_response',
          ...(username ? { username } : {}),
          ...(password ? { password } : {}),
        })
        return
      }

      if (message.type === 'error') {
        stats.failed = true
        stats.error = message.code ? `${message.code}: ${message.message}` : message.message
      }
    })

    ws.on('error', (error) => {
      clearTimeout(connectTimeout)
      stats.failed = true
      stats.error = error.message
    })

    ws.on('close', () => {
      clearTimeout(connectTimeout)
      if (!stats.connected && !stats.failed) {
        stats.failed = true
        stats.error = 'closed before connected'
      }
      cleanup()
    })
  })
}

async function main() {
  const sessions = []
  for (let index = 0; index < config.concurrency; index += 1) {
    sessions.push(runSession(index))
    if (config.startStaggerMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.startStaggerMs))
    }
  }

  const results = await Promise.all(sessions)
  const connected = results.filter((item) => item.connected)
  const failed = results.filter((item) => item.failed)
  const connectTimes = connected.map((item) => item.connectMs).filter((value) => typeof value === 'number')
  const firstOutputTimes = connected.map((item) => item.firstOutputMs).filter((value) => typeof value === 'number')

  const summary = {
    profile: profilePath,
    concurrency: config.concurrency,
    connected: connected.length,
    failed: failed.length,
    commandsSent: results.reduce((sum, item) => sum + item.commandsSent, 0),
    bytesIn: results.reduce((sum, item) => sum + item.bytesIn, 0),
    connectMs: {
      p50: percentile(connectTimes, 50),
      p95: percentile(connectTimes, 95),
      max: connectTimes.length ? Math.max(...connectTimes) : 0,
    },
    firstOutputMs: {
      p50: percentile(firstOutputTimes, 50),
      p95: percentile(firstOutputTimes, 95),
      max: firstOutputTimes.length ? Math.max(...firstOutputTimes) : 0,
    },
    failures: failed.map((item) => ({
      index: item.index,
      user: item.user,
      host: item.host,
      error: item.error,
    })),
  }

  console.log(JSON.stringify(summary, null, 2))

  if (failed.length > 0) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
