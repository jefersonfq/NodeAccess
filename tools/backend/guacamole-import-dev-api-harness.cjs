#!/usr/bin/env node
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..', '..')
const api = process.env.API_BASE || 'http://127.0.0.1:3000/api/v1'

function secret() {
  const env = fs.readFileSync(path.join(repoRoot, 'apps/backend/.env'), 'utf8')
  const match = env.match(/^JWT_SECRET=(.+)$/m)
  if (!match) throw new Error('JWT_SECRET not found')
  return match[1].trim().replace(/^['"]|['"]$/g, '')
}

function token() {
  const now = Math.floor(Date.now() / 1000)
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = encode({ alg: 'HS256', typ: 'JWT' })
  const payload = encode({
    sub: process.env.ADMIN_USER_ID || '1', tenantId: Number(process.env.TENANT_ID || 1),
    email: 'admin@nodeaccess.local', name: 'Guacamole API Harness', role: 'admin',
    isPlatformAdmin: false, canManageHosts: true, canViewLiveSessions: true,
    forcePasswordChange: false, stage: 'authenticated', iat: now, exp: now + 900,
  })
  return `${header}.${payload}.${crypto.createHmac('sha256', secret()).update(`${header}.${payload}`).digest('base64url')}`
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json', ...options.headers },
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(`${response.status} ${url}: ${text}`)
  return { response, body }
}

async function main() {
  const health = await fetch(api.replace('/api/v1', '/health/ready')).then(response => response.json())
  const inventory = (await request(`${api}/inventory`)).body
  const destination = inventory.find(node => node.type === 'ROOT' || node.type === 'FOLDER')
  if (!destination) throw new Error('No visible inventory destination')

  const payload = {
    destinationId: destination.id,
    preserveHierarchy: true,
    hosts: [
      { sourceId: 'dev-api-ssh', name: 'Preview SSH', ip: '192.0.2.10', port: 22, accessProtocol: 'ssh', sshUser: 'preview', folderPath: ['Guacamole Preview', 'Produção'], warnings: [] },
      { sourceId: 'dev-api-rdp', name: 'Preview RDP', ip: '192.0.2.20', port: 3389, accessProtocol: 'rdp', sshUser: '', folderPath: ['Guacamole Preview'], warnings: ['parameters-not-supported'] },
    ],
    aclMappings: [],
    sourceStats: { invalidConnections: 1, unsupportedProtocols: ['kubernetes'], unmappedPermissions: 2 },
  }
  const preview = (await request(`${api}/host-imports/guacamole/preview`, {
    method: 'POST', body: JSON.stringify(payload),
  })).body
  if (preview.summary.ready !== 2 || preview.summary.foldersToCreate < 1) {
    throw new Error(`Unexpected preview summary: ${JSON.stringify(preview.summary)}`)
  }

  console.log(JSON.stringify({
    status: 'passed',
    mode: 'development',
    health: health.status,
    dependencies: health.checks.map(check => `${check.name}:${check.status}`),
    destination: { id: destination.id, type: destination.type },
    previewIdCreated: Boolean(preview.previewId),
    readyHosts: preview.summary.ready,
    foldersToCreate: preview.summary.foldersToCreate,
    commitExecuted: false,
    persistentDataCreated: false,
  }, null, 2))
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
