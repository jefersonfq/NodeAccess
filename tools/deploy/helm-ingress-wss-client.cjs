#!/usr/bin/env node

const fs = require('node:fs')
const WebSocket = require('ws')

const profilePath = process.env.PROFILE_FILE
const ingressPort = process.env.INGRESS_PORT
const ingressHost = process.env.INGRESS_HOST
const caFile = process.env.INGRESS_CA_FILE
const commandCount = Number(process.env.COMMAND_COUNT || 5)

if (!profilePath || !ingressPort || !ingressHost || !caFile) {
  throw new Error('PROFILE_FILE, INGRESS_PORT, INGRESS_HOST and INGRESS_CA_FILE are required')
}

const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'))
const user = profile.users?.[0]
const host = profile.hosts?.[0]
if (!user?.accessToken || !host?.id) throw new Error('Profile requires one user token and one host')

const url = `wss://127.0.0.1:${ingressPort}/ws/ssh/${host.id}?token=${encodeURIComponent(user.accessToken)}&cols=100&rows=30`
const ws = new WebSocket(url, {
  ca: fs.readFileSync(caFile),
  servername: ingressHost,
  headers: { Host: ingressHost },
})
let connected = false
let commandsSent = 0
let outputMessages = 0
let interval

const timeout = setTimeout(() => finish(false, 1006, 'timeout'), 20_000)

function finish(ok, code, reason) {
  clearInterval(interval)
  clearTimeout(timeout)
  const result = { ok, connected, commandsSent, outputMessages, code, reason }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exit(ok ? 0 : 1)
}

ws.on('message', (data, isBinary) => {
  if (isBinary) {
    outputMessages += 1
    if (commandsSent >= commandCount && outputMessages >= commandCount) {
      ws.close(1000, 'ingress test complete')
    }
    return
  }
  let message
  try { message = JSON.parse(data.toString()) } catch { return }
  if (message.type === 'connected') {
    connected = true
    interval = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN || commandsSent >= commandCount) return
      ws.send(Buffer.from('whoami\r'), { binary: true })
      commandsSent += 1
    }, 250)
  }
  if (message.type === 'error') finish(false, 1011, `${message.code || 'ERROR'}: ${message.message}`)
})
ws.on('error', (error) => finish(false, 1006, error.message))
ws.on('close', (code, reason) => finish(
  connected && commandsSent === commandCount && outputMessages >= commandCount && code === 1000,
  code,
  reason.toString(),
))
