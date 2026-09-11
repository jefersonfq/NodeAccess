import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { prisma } from '../../config/database.js'
import { env } from '../../config/env.js'
import { SshRepository } from '../ssh/ssh.repository.js'
import { InventoryAclRepository } from '../inventory/inventory-acl.repository.js'
import { NetworkAccessService } from './network-access.service.js'
import { createTacacsServer } from './tacacs-server.js'
import { TacacsHealthStore, operationalState, requiresSupervisorRestart } from './tacacs-health.js'

if (process.env.NODEACCESS_TACACS_ENABLE !== 'true') throw new Error('Set NODEACCESS_TACACS_ENABLE=true explicitly to start the optional TACACS+ service')
const host = process.env.NODEACCESS_TACACS_BIND ?? '127.0.0.1'
const port = Number(process.env.NODEACCESS_TACACS_PORT ?? 4949)
const healthPort = Number(process.env.NODEACCESS_TACACS_HEALTH_PORT ?? 0)
const stallMs = Number(process.env.NODEACCESS_TACACS_STALL_MS ?? 60000)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid TACACS+ port')
if (!Number.isInteger(healthPort) || healthPort < 0 || healthPort > 65535) throw new Error('Invalid health port')
if (!Number.isInteger(stallMs) || stallMs < 15000 || stallMs > 300000) throw new Error('Stall deadline must be 15000..300000 ms')
const service = new NetworkAccessService(prisma, new SshRepository(prisma, new InventoryAclRepository(prisma)))
const runtime = createTacacsServer(service)
const health = new TacacsHealthStore(env.REDIS_URL, env.REDIS_PASSWORD ?? undefined)
const instanceId = randomUUID()
let closing = false, publishing = false, probing = false, databaseAt = 0, database = false
const heartbeat = () => ({ observedAt: Date.now(), database: database && Date.now() - databaseAt < 20000, runtime: runtime.snapshot() })
function probe() {
  if (probing || closing) return
  probing = true
  void prisma.$queryRaw`SELECT 1`.then(() => { database = true; databaseAt = Date.now() })
    .catch(() => { database = false; databaseAt = Date.now() }).finally(() => { probing = false })
}
async function publish() {
  if (publishing || closing) return
  publishing = true
  try { await health.publish(instanceId, heartbeat()) }
  catch { console.warn('TACACS+ diagnostics unavailable; AAA policy remains unchanged') }
  finally { publishing = false }
}
const diagnostics = createServer((request, response) => {
  if (request.url === '/metrics') {
    const { tenants: _tenants, ...processMetrics } = runtime.snapshot()
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ ...processMetrics, database: heartbeat().database, rssBytes: process.memoryUsage().rss }))
    return
  }
  if (request.url !== '/ready' && request.url !== '/live') { response.writeHead(404).end(); return }
  const ready = !closing && operationalState(heartbeat()) === 'ready'
  response.writeHead(request.url === '/live' ? (closing ? 503 : 200) : ready ? 200 : 503, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ ready, closing }))
})
// Local process metrics contain no tenant breakdown. The authenticated API scopes activity by tenant.
if (healthPort) diagnostics.listen(healthPort, '127.0.0.1')
const probeTimer = setInterval(probe, 5000), publishTimer = setInterval(() => { void publish() }, 5000)
const watchdog = setInterval(() => {
  if (!closing && requiresSupervisorRestart(runtime.snapshot(), stallMs)) {
    console.error('TACACS+ dependency remained pending past stall deadline; supervisor restart required')
    void shutdown(1)
  }
}, 1000)
async function shutdown(code: number) {
  if (closing) return
  closing = true; clearInterval(probeTimer); clearInterval(publishTimer); clearInterval(watchdog)
  const force = setTimeout(() => process.exit(code), 2500); force.unref()
  try {
    if (diagnostics.listening) diagnostics.close()
    if (runtime.server.listening) await runtime.close()
    // Leave a final non-ready observation until expiry rather than falsely reporting ready.
    try { await health.publish(instanceId, heartbeat()) } catch { /* TTL covers store failure */ }
    health.close(); await prisma.$disconnect()
  } finally { process.exit(code) }
}
runtime.server.listen(port, host, () => { console.info(`NodeAccess TACACS+ pilot listening on ${host}:${port}`); probe(); void publish() })
runtime.server.on('error', () => { console.error('TACACS+ listener failed'); void shutdown(1) })
diagnostics.on('error', () => { console.error('TACACS+ local diagnostics failed'); void shutdown(1) })
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void shutdown(0) })
