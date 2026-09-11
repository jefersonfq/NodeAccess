// Opt-in laboratory only. Requires a disposable SSH server on loopback.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:https'
import { WebSocketServer } from 'ws'
import { Client } from 'ssh2'
import { PrismaClient } from '@prisma/client'
import Redis from 'ioredis'
import { AgentService } from '../../apps/backend/src/modules/agents/agent.service.ts'
import { AgentGateway } from '../../apps/backend/src/modules/agents/agent.gateway.ts'
import { AgentRegistry } from '../../apps/backend/src/modules/agents/agent.registry.ts'
import { AgentAccessService } from '../../apps/backend/src/modules/agents/agent-access.service.ts'
import { SshRepository } from '../../apps/backend/src/modules/ssh/ssh.repository.ts'
import { InventoryAclRepository } from '../../apps/backend/src/modules/inventory/inventory-acl.repository.ts'
import { AgentRevocationBus } from '../../apps/backend/src/modules/agents/agent-revocation.bus.ts'
if (process.env.RUN_AGENT_SECURITY_LIVE !== 'true') throw Error('Set RUN_AGENT_SECURITY_LIVE=true and use a disposable SSH host')
const port = Number(process.env.AGENT_TEST_SSH_PORT || 2249)
const root = mkdtempSync(join(tmpdir(), 'agent-security-live-'))
const db = new PrismaClient(), registry = new AgentRegistry()
const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', { lazyConnect: true, maxRetriesPerRequest: 1 })
const publisher = new AgentRevocationBus(redis, new AgentRegistry()), subscriber = new AgentRevocationBus(redis, registry)
let tenant, user, record, child, server, wss, ssh, host, node, acl
const until = async predicate => { for (let n = 0; n < 150; n++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)) } throw Error('Laboratory state timeout') }
const hash = token => createHash('sha256').update(token).digest('hex')
try {
  tenant = await db.tenant.create({ data: { name: 'Disposable agent security', slug: 'agent-security-' + randomUUID() } })
  user = await db.user.create({ data: { name: 'Disposable agent owner', email: randomUUID() + '@example.test', tenantId: tenant.id } })
  const service = new AgentService(db, { requireFeature: async () => {} }, id => publisher.invalidate(id))
  const created = await service.create(user.id, tenant.id, { name: 'Disposable security agent', agentMode: 'USER_BOUND' })
  const token = created.token
  record = await db.agent.findUniqueOrThrow({ where: { id: created.agent.id } })
  assert.equal(await db.adminLog.count({ where: { targetType: 'agent', targetId: record.id, action: { in: ['agent_created', 'agent_token_issued'] } } }), 2)
  host = await db.host.create({ data: { tenantId: tenant.id, name: 'Disposable ACL target', ip: '127.0.0.1', port, sshUser: 'lab', authType: 'PASSWORD', scope: 'GLOBAL' } })
  node = await db.inventoryNode.create({ data: { tenantId: tenant.id, hostId: host.id, name: host.name, type: 'HOST', path: '/lab/' + randomUUID(), createdById: user.id } })
  registry.setAccessService(new AgentAccessService(db, new SshRepository(db, new InventoryAclRepository(db))))
  const request = { userId: user.id, tenantId: tenant.id, hostId: host.id, purpose: 'connect' }
  const brokenDb = new Proxy(db, { get(target, property) {
    if (property === '$transaction') return operation => target.$transaction(tx => operation(new Proxy(tx, { get(t, p) { return p === 'adminLog' ? { create: async () => { throw Error('Simulated audit failure') } } : Reflect.get(t, p) } })))
    return Reflect.get(target, property)
  } })
  const brokenService = new AgentService(brokenDb, { requireFeature: async () => {} })
  await assert.rejects(brokenService.revoke(record.id, user.id, tenant.id), /Simulated audit failure/)
  assert.equal((await db.agent.findUniqueOrThrow({ where: { id: record.id } })).active, true, 'audit failure must roll back revocation')
  assert.ok(await service.authenticate(token))
  await db.user.update({ where: { id: user.id }, data: { active: false } })
  assert.equal(await service.authenticate(token), null)
  await db.agent.update({ where: { id: record.id }, data: { agentMode: 'SERVICE_BOUND' } })
  assert.ok(await service.authenticate(token), 'institutional identity survives creator inactivity')
  await db.tenant.update({ where: { id: tenant.id }, data: { active: false } })
  assert.equal(await service.authenticate(token), null)
  await db.tenant.update({ where: { id: tenant.id }, data: { active: true } })
  await db.user.update({ where: { id: user.id }, data: { active: true } })
  await db.agent.update({ where: { id: record.id }, data: { agentMode: 'USER_BOUND' } })
  const key = join(root, 'tls.key'), cert = join(root, 'tls.crt')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' })
  server = createServer({ key: readFileSync(key), cert: readFileSync(cert) })
  wss = new WebSocketServer({ server, maxPayload: 262144 })
  const gateway = new AgentGateway({ authenticate: (...args) => service.authenticate(...args), markConnected: async () => {}, markDisconnected: async () => {}, logConnected: async () => {}, logDisconnected: async () => {}, touch: async () => {} }, registry)
  wss.on('connection', (socket, request) => {
    assert.equal(new URL(request.url, 'https://localhost').searchParams.has('token'), false)
    void gateway.handleConnection(socket, request.headers.authorization?.slice(7) || '').catch(() => socket.close())
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  await redis.connect(); await subscriber.start()
  const executable = process.env.AGENT_TEST_EXECUTABLE || process.execPath
  const args = process.env.AGENT_TEST_EXECUTABLE ? [] : ['apps/agent/src/index.js']
  child = spawn(executable, [...args, '--server', `wss://127.0.0.1:${server.address().port}`, '--token', token, '--ca', cert], { stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''; child.stdout.on('data', data => { logs += data }); child.stderr.on('data', data => { logs += data })
  await until(() => registry.getActiveById(record.id))
  const active = registry.getActiveById(record.id)
  await assert.rejects(registry.createAuthorizedConnection(active, randomUUID(), '127.0.0.1', port, request), error => error.code === 'AGENT_ACCESS_DENIED')
  acl = await db.resourceAclEntry.create({ data: { tenantId: tenant.id, inventoryNodeId: node.id, principalType: 'USER', principalId: user.id, canView: true, canConnect: true, createdById: user.id } })
  await assert.rejects(registry.createAuthorizedConnection(active, randomUUID(), '127.0.0.1', port + 1, request), error => error.code === 'AGENT_ACCESS_DENIED')
  const stream = await registry.createAuthorizedConnection(active, randomUUID(), '127.0.0.1', port, request)
  ssh = new Client()
  await new Promise((resolve, reject) => { ssh.once('ready', resolve); ssh.once('error', reject); ssh.connect({ sock: stream, username: 'lab', password: 'disposable-test-only', readyTimeout: 5000 }) })
  const output = await new Promise((resolve, reject) => ssh.exec('printf agent-security-ok', (error, channel) => { if (error) return reject(error); let text = ''; channel.on('data', value => { text += value }); channel.once('close', () => resolve(text)) }))
  assert.equal(output, 'agent-security-ok')
  await db.resourceAclEntry.update({ where: { id: acl.id }, data: { canConnect: false } })
  await until(() => stream.destroyed)
  assert.equal(active.ws.readyState, 1, 'ACL revocation must preserve the agent itself')
  await until(async () => (await db.adminLog.count({ where: { targetId: record.id, targetType: 'agent', action: 'agent_connection_access_revoked' } })) === 1)
  await db.resourceAclEntry.update({ where: { id: acl.id }, data: { canConnect: true } })
  const replacement = await registry.createAuthorizedConnection(active, randomUUID(), '127.0.0.1', port, request)
  const started = Date.now()
  const { token: nextToken } = await service.rotateToken(record.id, user.id, tenant.id)
  await until(() => replacement.destroyed)
  assert.ok(Date.now() - started < 2000, 'Redis must invalidate a remote registry promptly')
  assert.equal(await service.authenticate(token), null)
  assert.ok(await service.authenticate(nextToken))
  assert.equal(logs.includes(token), false)
  await service.setMaintenance(record.id, user.id, tenant.id, false, true)
  await service.permanentDelete(record.id, user.id, tenant.id)
  const history = await service.history(record.id, user.id, tenant.id)
  for (const action of ['agent_created', 'agent_token_issued', 'agent_connection_access_revoked', 'agent_token_rotated', 'agent_drain_started', 'agent_deleted']) assert.ok(history.events.some(event => event.action === action), action)
  assert.equal(JSON.stringify(history).includes(token), false)
  assert.equal(JSON.stringify(history).includes(hash(token)), false)
  console.log(JSON.stringify({ ok: true, noPolicyFile: true, verifiedWss: true, realSshRelay: true, aclGrantRevokeRegrant: true, remoteRedisRevocation: true, auditedLifecycle: true, auditFailureRollback: true, historyAfterDeletion: true }))
} finally {
  child?.kill('SIGTERM'); ssh?.end()
  for (const client of wss?.clients || []) client.terminate()
  wss?.close(); server?.close(); subscriber.stop(); publisher.stop(); redis.disconnect()
  if (tenant) await db.resourceAclEntry.deleteMany({ where: { tenantId: tenant.id } })
  if (node) await db.inventoryNode.delete({ where: { id: node.id } })
  if (host) await db.host.delete({ where: { id: host.id } })
  if (user) await db.adminLog.deleteMany({ where: { adminId: user.id } })
  if (record) await db.agent.delete({ where: { id: record.id } })
  if (user) await db.user.delete({ where: { id: user.id } })
  if (tenant) await db.tenant.delete({ where: { id: tenant.id } })
  await db.$disconnect(); rmSync(root, { recursive: true, force: true })
}
