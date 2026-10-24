/** Opt-in real API/gateway/MySQL/SSH. Own disposable rows; no signup or provider claim.
 * Start a second linuxserver/openssh-server container named na0068-ssh-expiry,
 * internal network na0068-lab IP10.206.8.11, USER_NAME=trial,
 * USER_PASSWORD=Transport-Fixture-2026, PASSWORD_ACCESS=true.
 * Run with --env-file=/tmp/na0068-live/test.env, TRIAL_TRANSPORT_REAL=1,
 * and TRIAL_TRANSPORT_API_PID set to the verified API listener PID (never gateway).
 */
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient, Prisma } from '@prisma/client'
import jwt from 'jsonwebtoken'
import { Client } from 'ssh2'
import WebSocket from 'ws'
import { encrypt } from '../../shared/crypto.js'

const enabled = process.env.TRIAL_TRANSPORT_REAL === '1'
describe.skipIf(!enabled)('real trial transport isolation', () => {
  const db = new PrismaClient()
  const tenants: number[] = []
  const sockets: WebSocket[] = []
  const trialId = randomUUID()
  let trial: { tenantId: number; userId: number; hostId: number; token: string }
  let normal: typeof trial
  let paused = false
  const apiPid = Number(process.env.TRIAL_TRANSPORT_API_PID)
  const apiPort = Number(process.env.TRIAL_TRANSPORT_API_PORT ?? 3190)
  const password = 'Transport-Fixture-2026'
  async function seed(isTrial: boolean, fingerprint: string) {
    const tenantId = (await db.tenant.create({ data: { name: 'Transport fixture', slug: `transport-${randomUUID()}` } })).id
    tenants.push(tenantId)
    const user = await db.user.create({ data: { tenantId, name: 'Transport fixture', email: `${randomUUID()}@example.test`, active: true, forcePasswordChange: false } })
    await db.$executeRaw(Prisma.sql`INSERT INTO inventory_nodes (tenant_id, root_tenant_id, type, name, path, depth, updated_at) VALUES (${tenantId}, ${tenantId}, 'ROOT', '__root__', '/', 0, CURRENT_TIMESTAMP(3))`)
    await db.$executeRaw(Prisma.sql`INSERT INTO resource_acl_entries (tenant_id, inventory_node_id, principal_type, principal_id, can_view, can_connect, can_edit, can_admin, inherit_to_children, created_by_id, updated_at) SELECT ${tenantId}, id, 'ROLE', 1, true, true, false, false, true, ${user.id}, CURRENT_TIMESTAMP(3) FROM inventory_nodes WHERE root_tenant_id = ${tenantId}`)
    await db.license.create({ data: { tenantId, maxUsers: 2, maxHosts: 2, active: true, sessionAuditEnabled: false } })
    const host = await db.host.create({ data: { tenantId, name: 'Transport fixture SSH', ip: '10.206.8.11', port: 2222, sshUser: 'trial', authType: 'PASSWORD', passwordEncrypted: JSON.stringify(encrypt(password)), trustedHostKeyFingerprint: fingerprint, scope: 'GLOBAL', ownerId: user.id, operatingSystem: 'LINUX' } })
    await db.$executeRaw(Prisma.sql`INSERT INTO inventory_nodes (tenant_id, parent_id, type, host_id, name, path, depth, updated_at) SELECT ${tenantId}, id, 'HOST', ${host.id}, 'Transport fixture SSH', '', 1, CURRENT_TIMESTAMP(3) FROM inventory_nodes WHERE root_tenant_id = ${tenantId}`)
    await db.$executeRaw(Prisma.sql`UPDATE inventory_nodes node INNER JOIN inventory_nodes parent ON parent.id = node.parent_id SET node.path = CONCAT(parent.path, node.id, '/') WHERE node.host_id = ${host.id}`)
    if (isTrial) await db.trialRegistration.create({ data: { id: trialId, tenantId, name: 'Transport fixture', status: 'ACTIVE', expiresAt: new Date(Date.now()+3600000), privacyVersion: 'fixture', profileJson: { resources: ['ssh','sftp'], maxSessions: 2, networkCidr: '10.206.8.0/24', hostAddresses: ['10.206.8.11'] } } })
    return { tenantId, userId: user.id, hostId: host.id, token: jwt.sign({ sub: String(user.id), email: user.email, role: 'user', tenantId, sessionVersion: user.sessionVersion, stage: 'authenticated', isPlatformAdmin: false }, process.env.JWT_SECRET!, { expiresIn: '10m' }) }
  }
  async function connect(fixture: typeof trial) {
    const ws = new WebSocket(`ws://127.0.0.1:3191/ws/ssh/${fixture.hostId}?token=${fixture.token}`)
    sockets.push(ws)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('SSH readiness timeout')), 10000)
      ws.on('error', () => { clearTimeout(timeout); reject(new Error('SSH transport failed')) })
      ws.on('message', (data, binary) => {
        if (binary) return
        const msg = JSON.parse(data.toString()) as {type: string; message?: string}
        if (msg.type === 'connected') { clearTimeout(timeout); resolve() }
        if (msg.type === 'error') { clearTimeout(timeout); reject(new Error(`SSH rejected: ${msg.message}`)) }
      })
    })
    return ws
  }
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!)
    if (url.hostname !== '127.0.0.1' || url.port !== '32770' || url.pathname !== '/na0068' || !Number.isInteger(apiPid) || apiPid < 2) throw new Error('Verified disposable database and API PID required')
    if (![3190,3193].includes(apiPort)) throw new Error('Disposable API port required')
    const listeners = execFileSync('ss', ['-lptn', `( sport = :${apiPort} )`], { encoding: 'utf8' })
    if (!listeners.includes(`pid=${apiPid},`)) throw new Error('API PID is not the disposable port3190 listener')
    const fixtureIp = execFileSync('docker', ['inspect', 'na0068-ssh-expiry', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'], { encoding: 'utf8' }).trim()
    if (fixtureIp !== '10.206.8.11') throw new Error('Dedicated SSH fixture required')
    // A throttled real SFTP subsystem keeps a bounded 1MiB file in flight.
    execFileSync('docker', ['exec', 'na0068-ssh-expiry', 'sh', '-c', `printf '#!/bin/sh\n/usr/lib/ssh/sftp-server | while dd bs=1024 count=1 2>/dev/null; do sleep 0.1; done\n' > /tmp/slow-sftp; chmod 755 /tmp/slow-sftp; sed -i 's@Subsystem.*sftp.*@Subsystem sftp /tmp/slow-sftp@' /config/sshd/sshd_config; kill -HUP $(pgrep -o sshd.pam)`])
    let fingerprint = ''
    await new Promise<void>((resolve, reject) => {
      const client = new Client()
      client.on('ready', () => { client.end(); resolve() }).on('error', reject)
      client.connect({ host: '10.206.8.11', port: 2222, username: 'trial', password, hostVerifier: key => { fingerprint = `SHA256:${createHash('sha256').update(key as Buffer).digest('base64')}`; return true } })
    })
    trial = await seed(true, fingerprint)
    normal = await seed(false, fingerprint)
  }, 30000)
  afterAll(async () => {
    if (paused) process.kill(apiPid, 'SIGCONT')
    for (const ws of sockets) ws.terminate()
    await delay(300)
    if (tenants.length) {
      await db.session.deleteMany({ where: { host: { tenantId: { in: tenants } } } })
      await db.resourceAclEntry.deleteMany({ where: { tenantId: { in: tenants } } })
      await db.inventoryNode.deleteMany({ where: { tenantId: { in: tenants }, type: 'HOST' } })
      await db.inventoryNode.deleteMany({ where: { tenantId: { in: tenants } } })
      await db.trialRegistration.deleteMany({ where: { id: trialId } })
      await db.host.deleteMany({ where: { tenantId: { in: tenants } } })
      await db.license.deleteMany({ where: { tenantId: { in: tenants } } })
      await db.adminLog.deleteMany({ where: { admin: { tenantId: { in: tenants } } } })
      await db.user.deleteMany({ where: { tenantId: { in: tenants } } })
      await db.tenant.deleteMany({ where: { id: { in: tenants } } })
    }
    await db.$disconnect()
  })
  it('closes trial SSH at persisted deadline with API worker stopped, preserving ordinary SSH', async () => {
    const normalWs = await connect(normal)
    const deadline = Date.now()+12000
    await db.trialRegistration.update({ where: { id: trialId }, data: { expiresAt: new Date(deadline) } })
    const trialWs = await connect(trial)
    const closed = new Promise<number>(resolve => trialWs.once('close', () => resolve(Date.now())))
    process.kill(apiPid, 'SIGSTOP'); paused = true
    const watchdog = setTimeout(() => { if (paused) { process.kill(apiPid, 'SIGCONT'); paused = false } }, 20000)
    try {
      const closedAt = await Promise.race([closed, delay(17000).then(() => { throw new Error('Trial SSH did not close') })])
      expect(closedAt).toBeGreaterThanOrEqual(deadline-150)
      expect(closedAt).toBeLessThan(deadline+2500)
      expect((await db.trialRegistration.findUniqueOrThrow({ where: { id: trialId } })).status).toBe('ACTIVE')
      expect(normalWs.readyState).toBe(WebSocket.OPEN)
      const echo = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Ordinary SSH stopped responding')), 3000)
        normalWs.on('message', data => { if (data.toString().includes('ordinary-survived')) { clearTimeout(timeout); resolve() } })
      })
      normalWs.send(Buffer.from('echo ordinary-survived\n')); await echo
    } finally { clearTimeout(watchdog); if (paused) { process.kill(apiPid, 'SIGCONT'); paused = false } }
  }, 30000)
  it('interrupts a real pending SFTP download after participant cancellation and denies reuse', async () => {
    await db.trialRegistration.update({ where: { id: trialId }, data: { status: 'ACTIVE', expiresAt: new Date(Date.now()+60000) } })
    const normalWs = sockets[0] ?? await connect(normal)
    execFileSync('docker', ['exec', 'na0068-ssh-expiry', 'sh', '-c', 'dd if=/dev/zero of=/tmp/trial-slow bs=1024 count=1024 2>/dev/null; chmod 644 /tmp/trial-slow'])
    const headers = { authorization: `Bearer ${trial.token}` }
    let completed = false
    const request = fetch(`http://127.0.0.1:${apiPort}/api/v1/sftp/${trial.hostId}/download?path=/tmp/trial-slow`, { headers, signal: AbortSignal.timeout(15000) }).then(async response => { await response.arrayBuffer(); completed = true; return response.status })
    await delay(1500)
    expect(completed, `Early SFTP response status: ${completed ? await request : 'pending'}`).toBe(false)
    await db.user.update({ where: { id: trial.userId }, data: { active: false, sessionVersion: { increment: 1 } } })
    expect(await request).toBeGreaterThanOrEqual(400)
    const denied = await fetch(`http://127.0.0.1:${apiPort}/api/v1/sftp/${trial.hostId}/download?path=/tmp/trial-slow`, { headers })
    expect(denied.status).toBe(403)
    expect(normalWs.readyState).toBe(WebSocket.OPEN)
  }, 20000)
  it('interrupts a real SFTP download on host deletion while normal access stays available', async () => {
    await db.trialRegistration.update({ where: { id: trialId }, data: { status: 'ACTIVE', expiresAt: new Date(Date.now()+60000) } })
    await db.user.update({ where: { id: trial.userId }, data: { active: true, sessionVersion: 0 } })
    execFileSync('docker', ['exec', 'na0068-ssh-expiry', 'sh', '-c', 'dd if=/dev/zero of=/tmp/trial-slow bs=1024 count=1024 2>/dev/null; chmod 644 /tmp/trial-slow; echo normal > /tmp/normal-small; chmod 644 /tmp/normal-small'])
    let complete=false
    const request=fetch(`http://127.0.0.1:${apiPort}/api/v1/sftp/${trial.hostId}/download?path=/tmp/trial-slow`,{headers:{authorization:`Bearer ${trial.token}`},signal:AbortSignal.timeout(15000)}).then(async response=>{await response.arrayBuffer();complete=true;return response.status})
    await delay(1500);expect(complete).toBe(false)
    await db.host.update({where:{id:trial.hostId},data:{deletedAt:new Date()}})
    expect(await request).toBeGreaterThanOrEqual(400)
    const normalResponse=await fetch(`http://127.0.0.1:${apiPort}/api/v1/sftp/${normal.hostId}/download?path=/tmp/normal-small`,{headers:{authorization:`Bearer ${normal.token}`}})
    expect(normalResponse.status).toBe(200);expect(await normalResponse.text()).toContain('normal')
  },20000)

})
