import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import { expect, it, vi } from 'vitest'
import { AgentGateway } from './agent.gateway.js'
import { AgentRegistry } from './agent.registry.js'
import { AgentService } from './agent.service.js'

it.runIf(process.env.RUN_AGENT_DIAGNOSTICS_REAL === '1')('real agent delivers offline observations through the gateway and removes only acknowledged events', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-roundtrip-'))
  const rows: Array<{ details: string; action: string }> = []
  const db = { adminLog: {
    findFirst: vi.fn(({ where }: { where: { details: string } }) => Promise.resolve(rows.find(row => row.details === where.details))),
    create: vi.fn(({ data }: { data: { details: string; action: string } }) => { rows.push(data); return Promise.resolve(data) }),
  } }
  const service = new AgentService(db as never, {} as never)
  const fake = {
    authenticate: () => Promise.resolve({ id: 1, createdById: 2, tenantId: 3, name: 'Roundtrip', agentType: 'PROXY_AGENT', agentMode: 'SERVICE_BOUND', isDefault: false }),
    markConnected: async () => {}, markDisconnected: async () => {}, touch: async () => {},
    logConnected: service.logConnected.bind(service), logDisconnected: service.logDisconnected.bind(service), logReportedEvents: service.logReportedEvents.bind(service),
  }
  const gateway = new AgentGateway(fake as never, new AgentRegistry(), 1000, 5000)
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>(r => server.once('listening', r))
  const sockets: WebSocket[] = []
  server.on('connection', socket => { sockets.push(socket); void gateway.handleConnection(socket, 'roundtrip-token') })
  const port = (server.address() as { port: number }).port
  const child = spawn(process.execPath, [resolve('apps/agent/src/index.js'), '--development', '--server', `ws://127.0.0.1:${port}`, '--token', 'roundtrip-token', '--status-file', join(root, 'status.json')], { stdio: 'ignore' })
  const until = async (predicate: () => boolean) => { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 25)) }; throw Error('Roundtrip timeout') }
  try {
    await until(() => rows.some(row => row.action === 'agent_diagnostic_reported'))
    sockets[0]!.terminate()
    await until(() => sockets.length === 2 && rows.some(row => row.action === 'agent_diagnostic_reported' && (JSON.parse(row.details) as { code?: string }).code === 'CONNECTION_LOST'))
    await until(() => (JSON.parse(readFileSync(join(root, 'status.json.events.json'), 'utf8')) as { events: unknown[] }).events.length === 0)
    const status = JSON.parse(readFileSync(join(root, 'status.json'), 'utf8')) as { state: string; diagnosticCode: string | null; platformConnectionId: string }
    expect(status.state).toBe('connected')
    expect(status.diagnosticCode).toBeNull()
    expect(rows.some(row => row.action === 'agent_connected' && (JSON.parse(row.details) as { connectionId?: string }).connectionId === status.platformConnectionId)).toBe(true)
    expect(JSON.stringify(rows)).not.toContain('roundtrip-token')
  } finally {
    child.kill('SIGTERM')
    await new Promise<void>(r => { if (child.exitCode !== null) r(); else child.once('exit', () => r()) })
    for (const socket of sockets) socket.terminate()
    await new Promise<void>(r => server.close(() => r()))
    rmSync(root, { recursive: true, force: true })
  }
}, 15_000)
