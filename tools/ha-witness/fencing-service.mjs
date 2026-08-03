#!/usr/bin/env node

import { createServer } from 'node:http'
import { get as httpsGet } from 'node:https'
import { get as httpGet } from 'node:http'
import { randomBytes, randomUUID, sign, timingSafeEqual } from 'node:crypto'
import { appendFile, mkdir, open, readFile, rm, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const configPath = resolve(process.argv[2] || process.env.NODEACCESS_FENCING_CONFIG || './fencing.config.json')
const config = JSON.parse(await readFile(configPath, 'utf8'))
const listenHost = config.listenHost || '127.0.0.1'
const listenPort = Number(config.listenPort || 9419)
const mode = config.mode === 'enforce' ? 'enforce' : 'observe-only'
const requestTimeoutMs = Number(config.requestTimeoutMs || 2500)
const failureThreshold = Number(config.failureThreshold || 6)
const failureIntervalMs = Number(config.failureIntervalMs || 5000)
const evidenceTtlSeconds = Number(config.evidenceTtlSeconds || 300)
const stateDir = resolve(config.stateDir || './state')
const journalPath = resolve(stateDir, 'fencing-journal.jsonl')
const leasePath = resolve(stateDir, 'active-fence.lock')
const privateKey = resolve(config.privateKey)
const vboxManage = config.vboxManage
const nodes = new Map((config.nodes || []).map((node) => [node.id, node]))
const authToken = String(process.env.NODEACCESS_FENCING_TOKEN || config.authToken || '')

if (!authToken || authToken.length < 24) throw new Error('NODEACCESS_FENCING_TOKEN deve ter pelo menos 24 caracteres')
if (!vboxManage) throw new Error('vboxManage é obrigatório')
if (nodes.size !== 2) throw new Error('O fencing v1 exige exatamente dois nós configurados')
if (!Number.isInteger(failureThreshold) || failureThreshold < 2 || failureThreshold > 60) {
  throw new Error('failureThreshold deve estar entre 2 e 60')
}
if (!Number.isInteger(failureIntervalMs) || failureIntervalMs < 1000 || failureIntervalMs > 60000) {
  throw new Error('failureIntervalMs deve estar entre 1000 e 60000')
}

await mkdir(stateDir, { recursive: true, mode: 0o700 })
await stat(privateKey)
const witnessPrivateKey = await readFile(privateKey)

function writeJson(response, statusCode, body) {
  const payload = JSON.stringify(body)
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  response.end(payload)
}

function tokenMatches(header = '') {
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : ''
  const left = Buffer.from(supplied)
  const right = Buffer.from(authToken)
  return left.length === right.length && timingSafeEqual(left, right)
}

async function journal(event, details = {}) {
  await appendFile(journalPath, `${JSON.stringify({
    contract: 'nodeaccess-ha-fencing-journal-v1',
    event,
    mode,
    observedAt: new Date().toISOString(),
    ...details,
  })}\n`, { mode: 0o600 })
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

async function probe(node) {
  return new Promise((resolveProbe) => {
    const url = new URL(node.healthUrl)
    const requestFn = url.protocol === 'https:' ? httpsGet : httpGet
    const request = requestFn(url, {
      timeout: requestTimeoutMs,
      rejectUnauthorized: node.allowSelfSignedTls === true ? false : undefined,
      headers: { 'user-agent': 'nodeaccess-fencing-service/1' },
    }, (response) => {
      response.resume()
      resolveProbe(Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 300))
    })
    request.once('timeout', () => {
      request.destroy()
      resolveProbe(false)
    })
    request.once('error', () => resolveProbe(false))
  })
}

async function run(command, args, env = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', rejectRun)
    child.on('close', (code) => {
      if (code === 0) resolveRun({ stdout, stderr })
      else rejectRun(new Error(`${command} terminou com código ${code}: ${stderr || stdout}`))
    })
  })
}

async function vmState(vm) {
  const { stdout } = await run(vboxManage, ['showvminfo', vm, '--machinereadable'])
  return stdout.match(/^VMState="([^"]+)"/m)?.[1] || 'unknown'
}

async function acquireLease(operationId) {
  try {
    const handle = await open(leasePath, 'wx', 0o600)
    await handle.writeFile(`${operationId}\n`)
    await handle.close()
    return true
  } catch (error) {
    if (error?.code === 'EEXIST') return false
    throw error
  }
}

async function readBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 16 * 1024) throw new Error('payload excede 16 KiB')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function confirmFailure(requester, target) {
  const samples = []
  for (let attempt = 1; attempt <= failureThreshold; attempt += 1) {
    const [requesterHealthy, targetHealthy] = await Promise.all([
      probe(requester),
      probe(target),
    ])
    samples.push({ attempt, requesterHealthy, targetHealthy, observedAt: new Date().toISOString() })
    if (!requesterHealthy || targetHealthy) return { confirmed: false, samples }
    if (attempt < failureThreshold) await delay(failureIntervalMs)
  }
  return { confirmed: true, samples }
}

async function emitEvidence(operationId, targetNodeId, requesterNodeId) {
  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAt = issuedAt + evidenceTtlSeconds
  const nonce = randomBytes(24).toString('hex')
  const evidence = Buffer.from([
    'contract=nodeaccess-ha-fencing-v1',
    `primary_node_id=${targetNodeId}`,
    `standby_node_id=${requesterNodeId}`,
    'isolation=confirmed',
    `issued_at=${issuedAt}`,
    `expires_at=${expiresAt}`,
    `nonce=${nonce}`,
    '',
  ].join('\n'))
  const signature = sign('sha256', evidence, witnessPrivateKey)
  return {
    evidenceBase64: evidence.toString('base64'),
    signatureBase64: signature.toString('base64'),
    expiresInSeconds: evidenceTtlSeconds,
  }
}

async function handleFence(request, response) {
  if (!tokenMatches(request.headers.authorization)) {
    await journal('authentication-refused', { remoteAddress: request.socket.remoteAddress })
    return writeJson(response, 401, { status: 'refused', reason: 'unauthorized' })
  }

  const body = await readBody(request)
  const operationId = String(body.operationId || '')
  const requesterNodeId = String(body.requesterNodeId || '')
  const targetNodeId = String(body.targetNodeId || '')
  const requestedMode = String(body.requestedMode || 'observe-only')
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(operationId)) {
    return writeJson(response, 400, { status: 'refused', reason: 'invalid_operation_id' })
  }
  const requester = nodes.get(requesterNodeId)
  const target = nodes.get(targetNodeId)
  if (!requester || !target || requesterNodeId === targetNodeId) {
    return writeJson(response, 400, { status: 'refused', reason: 'invalid_topology' })
  }
  if (!await acquireLease(operationId)) {
    return writeJson(response, 409, { status: 'refused', reason: 'fence_in_progress' })
  }

  try {
    await journal('assessment-started', { operationId, requesterNodeId, targetNodeId })
    const assessment = await confirmFailure(requester, target)
    await journal('assessment-completed', { operationId, requesterNodeId, targetNodeId, ...assessment })
    if (!assessment.confirmed) {
      return writeJson(response, 409, {
        status: 'refused',
        reason: 'failure_not_confirmed',
        samples: assessment.samples,
      })
    }
    if (requestedMode !== 'enforce') {
      await journal('fence-observed', {
        operationId,
        requesterNodeId,
        targetNodeId,
        reason: 'requester_observe_only',
      })
      return writeJson(response, 202, {
        status: 'observed',
        reason: 'requester_observe_only',
        samples: assessment.samples,
      })
    }
    if (mode !== 'enforce') {
      await journal('fence-observed', { operationId, requesterNodeId, targetNodeId })
      return writeJson(response, 202, {
        status: 'observed',
        reason: 'observe_only',
        samples: assessment.samples,
      })
    }

    const before = await vmState(target.vm)
    if (before === 'running' || before === 'paused') {
      await journal('poweroff-requested', { operationId, targetNodeId, vm: target.vm, before })
      await run(vboxManage, ['controlvm', target.vm, 'poweroff'])
    }
    let after = await vmState(target.vm)
    for (let attempt = 0; attempt < 10 && after !== 'poweroff' && after !== 'aborted'; attempt += 1) {
      await delay(1000)
      after = await vmState(target.vm)
    }
    if (after !== 'poweroff' && after !== 'aborted') {
      throw new Error(`fencing não confirmado; estado final da VM: ${after}`)
    }

    const evidence = await emitEvidence(operationId, targetNodeId, requesterNodeId)
    await journal('fence-confirmed', { operationId, requesterNodeId, targetNodeId, vm: target.vm, before, after })
    return writeJson(response, 200, { status: 'fenced', operationId, ...evidence })
  } finally {
    await rm(leasePath, { force: true })
  }
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/health') {
      return writeJson(response, 200, {
        status: 'ok',
        contract: 'nodeaccess-ha-fencing-service-v1',
        mode,
        configuredNodes: nodes.size,
      })
    }
    if (request.method === 'POST' && request.url === '/v1/fence') {
      return await handleFence(request, response)
    }
    return writeJson(response, 404, { status: 'not_found' })
  } catch (error) {
    const incidentId = randomUUID()
    await journal('request-failed', { incidentId, message: String(error?.message || error) })
    return writeJson(response, 500, { status: 'error', incidentId })
  }
})

server.listen(listenPort, listenHost, async () => {
  await journal('service-started', { listenHost, listenPort, configPath })
  process.stdout.write(`[nodeaccess-fencing] ${mode} em http://${listenHost}:${listenPort}\n`)
})
