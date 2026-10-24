import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { buildMcpAgentSetup } from '../../../../frontend/src/services/mcp-agent-setup.js'

interface RpcEnvelope {
  id: string | number
  result: {
    protocolVersion: string
    serverInfo: { name: string }
    tools: { name: string }[]
    structuredContent: { items: { id: number }[] }
  }
  error: { code: number }
}
interface SdkClient {
  connect(transport: object): Promise<void>
  listTools(): Promise<{ tools: { name: string }[] }>
  listResources(): Promise<{ resources: unknown[] }>
  listPrompts(): Promise<{ prompts: unknown[] }>
  callTool(input: { name: string; arguments: Record<string, unknown> }): Promise<{ structuredContent: { items: { id: number }[] } }>
  ping(): Promise<unknown>
  close(): Promise<void>
}

const fixtures = vi.hoisted(() => ({ authenticate: vi.fn(), hosts: vi.fn(), audit: vi.fn(), license: vi.fn(), touch: vi.fn() }))
vi.mock('../../config/env.js', () => ({ env: {
  FEATURE_MCP: true, APP_URL: 'https://nodeaccess.test', APP_FRONTEND_URL: 'http://localhost:5173',
  MCP_RATE_LIMIT_WINDOW_SECONDS: 60, MCP_RATE_LIMIT_MAX_REQUESTS: 120,
} }))
vi.mock('../../config/database.js', () => ({ prisma: { $queryRaw: fixtures.license, adminLog: { create: fixtures.audit } } }))
vi.mock('../../config/redis.js', () => ({ redis: { incr: vi.fn(() => Promise.resolve(1)), expire: vi.fn() } }))
vi.mock('../../shared/guards.js', () => ({ requireAuth: vi.fn(() => Promise.reject(new Error('Technical token'))) }))
vi.mock('./mcp-token.repository.js', () => ({ McpTokenRepository: class { authenticate = fixtures.authenticate; touchLastUsed = fixtures.touch } }))
import { McpService } from './mcp.service.js'
import { McpController } from './mcp.controller.js'
import { mcpRoutes } from './mcp.routes.js'
import { env } from '../../config/env.js'
const headers = { authorization: 'Bearer disposable', accept: 'application/json, text/event-stream', 'content-type': 'application/json' }
let app: FastifyInstance
const principal = {
  id: 9, tenantId: 3, allowedCapabilities: ['search_hosts'], allowedActionModes: ['read_only'], allowedHostIds: [42],
  createdBy: { id: 7, email: 'test@example.test', role: 'admin', active: true, isPlatformAdmin: false, canManageHosts: true, forcePasswordChange: false },
}
function rpc(method: string, params = {}, extraHeaders = {}) {
  return app.inject({ method: 'POST', url: '/jsonrpc', headers: { ...headers, ...extraHeaders }, payload: { jsonrpc: '2.0', id: 'test', method, params } })
}
beforeEach(async () => {
  vi.clearAllMocks()
  env.FEATURE_MCP = true
  fixtures.authenticate.mockImplementation((token: string) => Promise.resolve(token === 'disposable' ? principal : null))
  fixtures.license.mockResolvedValue([{ featureEntitlementsJson: { mcp: true } }])
  fixtures.audit.mockResolvedValue(undefined)
  fixtures.hosts.mockResolvedValue([42, 43].map(id => ({ id, name: `host-${id}`, ip: '192.0.2.1', port: 22, sshUser: 'test', scope: 'GLOBAL', connectionMode: 'DIRECT', group: null, bastion: null })))
  const service = new McpService(
    { host: { findMany: fixtures.hosts } } as never, {} as never, {} as never, {} as never,
    {} as never, {} as never, { logAdminEvent: fixtures.audit } as never, {} as never,
    { findHostIdsWithEffectivePermission: () => Promise.resolve(new Set([42, 43])) } as never,
  )
  app = Fastify({ logger: false })
  await mcpRoutes(app, new McpController(service))
})
afterEach(async () => { await app.close() })
describe('MCP stateless HTTP with real routes, controller, service and guards', () => {
  it.runIf(process.env.MCP_SDK_ROOT)('connects the independent MCP SDK and calls a read-only tool over HTTP', async () => {
    const root = process.env.MCP_SDK_ROOT
    const { Client } = await import(/* @vite-ignore */ `${root}/dist/esm/client/index.js`) as { Client: new (info: { name: string; version: string }) => SdkClient }
    const { StreamableHTTPClientTransport } = await import(/* @vite-ignore */ `${root}/dist/esm/client/streamableHttp.js`) as { StreamableHTTPClientTransport: new (url: URL, options: { requestInit: RequestInit }) => object }
    const base = await app.listen({ host: '127.0.0.1', port: 0 })
    const client = new Client({ name: 'na0057-disposable-sdk', version: '1' })
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/jsonrpc`), { requestInit: { headers: { authorization: headers.authorization } } }))
      expect((await client.listTools()).tools.map((tool: { name: string }) => tool.name)).toEqual(['search_hosts'])
      expect((await client.listResources()).resources).toEqual([])
      expect((await client.listPrompts()).prompts).toEqual([])
      expect((await client.callTool({ name: 'search_hosts', arguments: { query: 'host' } })).structuredContent.items.map((host: { id: number }) => host.id)).toEqual([42])
      await client.ping()
    } finally { await client.close() }
  })
  it.runIf(process.env.MCP_CLI_SMOKE)('loads generated presets in installed Codex and Claude with disposable Claude settings', async () => {
    const exec = promisify(execFile)
    const base = await app.listen({ host: '127.0.0.1', port: 0 })
    const endpoint = `${base}/jsonrpc`
    const dir = await mkdtemp(join(tmpdir(), 'na0057-cli-'))
    try {
      const codex = await exec('codex', ['-c', `mcp_servers.na0057_test.url=${JSON.stringify(endpoint)}`, '-c', 'mcp_servers.na0057_test.bearer_token_env_var="NODEACCESS_MCP_TOKEN"', 'mcp', 'get', 'na0057_test', '--json'], { cwd: dir, timeout: 15000 })
      expect((JSON.parse(codex.stdout) as { transport: { url: string } }).transport.url).toBe(endpoint)
      const preset = buildMcpAgentSetup(endpoint, 'claude')
      await writeFile(join(dir, '.mcp.json'), preset.config)
      await writeFile(join(dir, '.claude.json'), JSON.stringify({ projects: { [dir]: { hasTrustDialogAccepted: true, enabledMcpjsonServers: ['nodeaccess'] } } }))
      const claude = await exec('claude', ['mcp', 'list'], { cwd: dir, env: { ...process.env, CLAUDE_CONFIG_DIR: dir, NODEACCESS_MCP_TOKEN: 'disposable', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }, timeout: 30000 })
      expect(claude.stdout).toMatch(/nodeaccess.*Connected/)
    } finally { await rm(dir, { recursive: true, force: true }) }
  }, 45000)

  it.runIf(process.env.MCP_GEMINI_BIN)('connects Gemini CLI using the generated HTTP preset in disposable settings', async () => {
    const exec = promisify(execFile)
    const methods: string[] = []
    app.addHook('preHandler', async request => {
      const body = request.body as { method?: string } | undefined
      if (body?.method) methods.push(body.method)
      await Promise.resolve()
    })
    const base = await app.listen({ host: '127.0.0.1', port: 0 })
    const dir = await mkdtemp(join(tmpdir(), 'na0057-gemini-'))
    try {
      await mkdir(join(dir, '.gemini'))
      await writeFile(join(dir, '.gemini', 'settings.json'), buildMcpAgentSetup(`${base}/jsonrpc`, 'gemini').config)
      await writeFile(join(dir, 'trustedFolders.json'), JSON.stringify({ [dir]: 'TRUST_FOLDER' }))
      const result = await exec(process.execPath, [process.env.MCP_GEMINI_BIN!, 'mcp', 'list'], {
        cwd: dir, env: { ...process.env, GEMINI_CLI_HOME: dir, GEMINI_CLI_SYSTEM_SETTINGS_PATH: join(dir, 'absent-system-settings.json'), GEMINI_CLI_TRUSTED_FOLDERS_PATH: join(dir, 'trustedFolders.json'), NODEACCESS_MCP_TOKEN: 'disposable' }, timeout: 30000,
      })
      expect(result.stdout + result.stderr).toMatch(/nodeaccess.*Connected/i)
      expect(methods).toContain('initialize')
      expect(methods).toContain('notifications/initialized')
    } finally { await rm(dir, { recursive: true, force: true }) }
  }, 45000)

  it('negotiates versions, acknowledges initialized with empty 202 and responds to ping', async () => {
    for (const version of ['2025-03-26', '2025-06-18']) {
      const response = await rpc('initialize', { protocolVersion: version })
      expect(response.json<RpcEnvelope>().result.protocolVersion).toBe(version)
      expect(response.headers['mcp-session-id']).toBeUndefined()
    }
    const notification = await app.inject({ method: 'POST', url: '/jsonrpc', headers, payload: { jsonrpc: '2.0', method: 'notifications/initialized' } })
    expect(notification.statusCode).toBe(202)
    expect(notification.body).toBe('')
    expect((await rpc('ping')).json()).toEqual({ jsonrpc: '2.0', id: 'test', result: {} })
  })
  it('discovers only allowed tools and filters query by tenant and token hosts', async () => {
    expect((await rpc('tools/list')).json<RpcEnvelope>().result.tools.map((tool: { name: string }) => tool.name)).toEqual(['search_hosts'])
    const result = (await rpc('tools/call', { name: 'search_hosts', arguments: { query: 'host' } })).json<RpcEnvelope>().result
    expect(result.structuredContent.items.map((host: { id: number }) => host.id)).toEqual([42])
    expect(fixtures.hosts).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 3, id: { in: [42] } }) as unknown }))
    expect((await rpc('tools/call', { name: 'run_host_operation', arguments: {} })).statusCode).toBe(403)
    expect((await rpc(' tools/call ', { name: 'run_host_operation', arguments: {} })).statusCode).toBe(403)
    expect((await rpc('tools/call', { name: ' run_host_operation ', arguments: {} })).statusCode).toBe(403)
    expect((await rpc(' resources/read ', { uri: ' nodeaccess://hosts/42/dashboard ' })).statusCode).toBe(403)
  })
  it.each(['invalid', 'expired', 'revoked'])('refuses %s credentials before dispatch', async (token) => {
    expect((await rpc('initialize', {}, { authorization: `Bearer ${token}` })).statusCode).toBe(401)
    expect(fixtures.hosts).not.toHaveBeenCalled()
  })
  it('refuses disabled module, missing license and inactive owner', async () => {
    env.FEATURE_MCP = false
    expect((await rpc('initialize')).statusCode).toBe(403)
    env.FEATURE_MCP = true
    fixtures.license.mockResolvedValue([])
    expect((await rpc('initialize')).statusCode).toBe(403)
    fixtures.authenticate.mockResolvedValue({ ...principal, createdBy: { ...principal.createdBy, active: false } })
    expect((await rpc('initialize')).statusCode).toBe(401)
  })
  it('validates configured origins without trusting Host', async () => {
    expect((await rpc('ping', {}, { origin: 'https://nodeaccess.test' })).statusCode).toBe(200)
    expect((await rpc('ping', {}, { origin: 'http://localhost:5173' })).statusCode).toBe(200)
    for (const origin of ['null', 'https://evil.test', 'https://nodeaccess.test.evil.test']) {
      expect((await rpc('ping', {}, { origin, host: 'evil.test' })).statusCode).toBe(403)
    }
  })
  it('validates Accept and protocol version', async () => {
    for (const accept of ['*/*', 'application/json', 'application/json, text/event-stream;q=0']) {
      expect((await rpc('ping', {}, { accept })).statusCode).toBe(406)
    }
    expect((await rpc('ping', {}, { 'mcp-protocol-version': 'future' })).statusCode).toBe(400)
    expect((await rpc('unknown')).json<RpcEnvelope>().error.code).toBe(-32601)
  })
  it('refuses malformed messages and operation notifications without executing anything', async () => {
    for (const payload of [[], {}, { jsonrpc: '2.0', method: 'tools/call', params: { name: 'search_hosts' } }, { jsonrpc: '2.0', id: null, method: 'ping' }, { jsonrpc: '2.0', id: false, method: 'ping' }, { jsonrpc: '2.0', id: 1, method: 123 }, { jsonrpc: '2.0', id: 1, method: 'ping', params: [] }, { jsonrpc: '2.0', id: 1, result: {} }]) {
      expect((await app.inject({ method: 'POST', url: '/jsonrpc', headers, payload })).statusCode).toBe(400)
    }
    expect(fixtures.hosts).not.toHaveBeenCalled()
  })
  it.each(['GET', 'DELETE'] as const)('returns authenticated 405 for unsupported %s', async method => {
    const response = await app.inject({ method, url: '/jsonrpc', headers: { authorization: headers.authorization } })
    expect(response.statusCode).toBe(405)
    expect(response.headers.allow).toBe('POST')
    expect((await app.inject({ method, url: '/jsonrpc' })).statusCode).toBe(401)
  })
  it('completes initialization and concurrent discovery over a real loopback HTTP socket', async () => {
    const base = await app.listen({ host: '127.0.0.1', port: 0 })
    const send = (body: unknown) => fetch(`${base}/jsonrpc`, { method: 'POST', headers, body: JSON.stringify(body) })
    const initialized = await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'disposable-client', version: '1' } } })
    expect((await initialized.json() as RpcEnvelope).result.serverInfo.name).toBe('nodeaccess-mcp')
    const notification = await send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(notification.status).toBe(202)
    expect(await notification.text()).toBe('')
    const results = await Promise.all(Array.from({ length: 8 }, (_, id) => send({ jsonrpc: '2.0', id, method: 'tools/list' }).then(async r => await r.json() as RpcEnvelope)))
    expect(results.map(r => r.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(results.every(r => r.result.tools.length === 1)).toBe(true)
  })
})
