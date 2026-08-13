#!/usr/bin/env node

const fs = require('node:fs')
const WebSocket = require('ws')

const profilePath = process.env.PROFILE_FILE
const wsPort = process.env.GATEWAY_LOCAL_PORT || '13001'
const markerDir = process.env.DRAIN_MARKER_DIR
const commandTarget = Number(process.env.DRAIN_COMMAND_COUNT || 20)
if (!profilePath || !markerDir) throw new Error('PROFILE_FILE and DRAIN_MARKER_DIR are required')

const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'))
const user = profile.users?.[0]
const host = profile.hosts?.[0]
if (!user?.accessToken || !host?.id) throw new Error('Profile requires one user token and one host')

const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/ws/ssh/${host.id}?token=${encodeURIComponent(user.accessToken)}&cols=100&rows=30`)
let connected = false
let rolloutObserved = false
let commandsAfterRollout = 0
let outputAfterRollout = 0
let interval

const timeout = setTimeout(() => finish(false, 1006, 'timeout'), 60_000)

function finish(ok, code, reason) {
  clearInterval(interval)
  clearTimeout(timeout)
  process.stdout.write(`${JSON.stringify({ ok, connected, rolloutObserved, commandsAfterRollout, outputAfterRollout, code, reason })}\n`)
  process.exit(ok ? 0 : 1)
}

ws.on('message', (data, isBinary) => {
  if (isBinary) {
    if (rolloutObserved) outputAfterRollout += 1
    return
  }
  let message
  try { message = JSON.parse(data.toString()) } catch { return }
  if (message.type === 'connected') {
    connected = true
    fs.writeFileSync(`${markerDir}/connected`, 'connected')
    interval = setInterval(() => {
      if (fs.existsSync(`${markerDir}/rollout-started`)) rolloutObserved = true
      if (ws.readyState !== WebSocket.OPEN) return
      ws.send(Buffer.from('whoami\r'), { binary: true })
      if (rolloutObserved) commandsAfterRollout += 1
      if (rolloutObserved && commandsAfterRollout >= commandTarget && outputAfterRollout >= commandTarget) {
        ws.close(1000, 'drain test complete')
      }
    }, 500)
  }
  if (message.type === 'error') finish(false, 1011, `${message.code || 'ERROR'}: ${message.message}`)
})
ws.on('error', (error) => finish(false, 1006, error.message))
ws.on('close', (code, reason) => finish(
  connected && rolloutObserved && commandsAfterRollout >= commandTarget && outputAfterRollout >= commandTarget && code === 1000,
  code,
  reason.toString(),
))
