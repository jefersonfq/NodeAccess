/** NA-0069: cross-feature guards must keep trial metadata authoritative after integration. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyReply, FastifyRequest } from 'fastify'
const fixture = vi.hoisted(() => ({ authenticate: vi.fn(), touch: vi.fn(), query: vi.fn(), tenant: vi.fn(), user: vi.fn() }))
vi.mock('../../config/database.js', () => ({ prisma: { $queryRaw: fixture.query, tenant: { findUnique: fixture.tenant }, user: { findFirst: fixture.user } } }))
vi.mock('../../config/redis.js', () => ({ redis: {} }))
vi.mock('../../config/env.js', () => ({ env: { FEATURE_MCP: true, MCP_STATIC_TOKEN: 'synthetic-static-token', MCP_STATIC_TENANT_SLUG: 'fixture' } }))
vi.mock('../../shared/guards.js', () => ({ requireAuth: () => Promise.reject(Error('Not a JWT')) }))
vi.mock('../mcp/mcp-token.repository.js', () => ({ McpTokenRepository: class { authenticate = fixture.authenticate; touchLastUsed = fixture.touch } }))
import { requireMcpAuth } from '../mcp/mcp.guard.js'
import { assertTrialHttpAccess, configureTrialPolicy } from './trial-policy.js'
const trial = { status: 'ACTIVE', expiresAt: new Date(Date.now()+3600000), profileJson: { resources: ['ssh','sftp','sharing'], allowCustomHosts: true } }
function request(token = 'synthetic-persisted-token'): FastifyRequest { return { headers: { authorization: `Bearer ${token}` } } as FastifyRequest }
beforeEach(() => {
  vi.clearAllMocks()
  configureTrialPolicy(() => Promise.resolve(trial))
  fixture.query.mockResolvedValue([{ featureEntitlementsJson: { mcp: true } }])
  fixture.tenant.mockResolvedValue({ id: 7, active: true })
  fixture.user.mockResolvedValue({ id: 9, email: 'fixture@example.test', canManageHosts: true, forcePasswordChange: false, isPlatformAdmin: false })
  fixture.authenticate.mockResolvedValue({ id: 3, tenantId: 7, allowedCapabilities: ['search_hosts'], allowedHostIds: [1], createdBy: { id: 9, email: 'fixture@example.test', active: true, role: 'admin' } })
  fixture.touch.mockResolvedValue(undefined)
})
afterEach(() => configureTrialPolicy(() => Promise.resolve(null)))
describe('integrated MCP alternate credentials versus trial metadata', () => {
  for (const status of ['ACTIVE','EXPIRED','REMOVED']) it(`denies persisted token for ${status} trial even when MCP licensing is enabled`, async () => {
    configureTrialPolicy(() => Promise.resolve({ ...trial, status }))
    await expect(requireMcpAuth(request(), {} as FastifyReply)).rejects.toMatchObject({ code: 'TRIAL_FEATURE_DISABLED' })
    expect(fixture.touch).not.toHaveBeenCalled()
  })
  it('denies the configured static token when its selected tenant is a trial', async () => {
    fixture.authenticate.mockResolvedValue(null)
    await expect(requireMcpAuth(request('synthetic-static-token'), {} as FastifyReply)).rejects.toMatchObject({ code: 'TRIAL_FEATURE_DISABLED' })
  })
  it('preserves licensed normal tenant persisted-token access', async () => {
    configureTrialPolicy(() => Promise.resolve(null))
    const req = request()
    await expect(requireMcpAuth(req, {} as FastifyReply)).resolves.toBeUndefined()
    expect(req.mcpAuth?.mode).toBe('persisted_token');expect(fixture.touch).toHaveBeenCalledWith(3)
  })
  it('preserves licensed normal tenant static-token access', async () => {
    configureTrialPolicy(() => Promise.resolve(null));fixture.authenticate.mockResolvedValue(null)
    const req = request('synthetic-static-token')
    await expect(requireMcpAuth(req, {} as FastifyReply)).resolves.toBeUndefined()
    expect(req.mcpAuth?.mode).toBe('static_token')
  })
})
describe('new integrated HTTP feature boundaries', () => {
  const routes = [['POST','/api/v1/local-ai/terminal-assist'],['POST','/api/v1/host-imports/preview'],['POST','/api/v1/host-imports/commit'],['POST','/api/v1/snippets'],['PUT','/api/v1/snippets/4'],['POST','/api/v1/mcp/jsonrpc'],['POST','/api/v1/hosts']] as const
  for(const [method,path] of routes) it(`keeps normal access policy and rejects trial ${method} ${path}`, async () => {
    await expect(assertTrialHttpAccess(7,method,path)).rejects.toMatchObject({ code:'TRIAL_FEATURE_DISABLED' })
    configureTrialPolicy(() => Promise.resolve(null))
    await expect(assertTrialHttpAccess(7,method,path)).resolves.toBeUndefined()
  })
  it('allows bounded library, host-card and SFTP reads needed by trial macro use', async () => {
    for(const path of ['/api/v1/snippets','/api/v1/hosts/1','/api/v1/sftp/1/read']) await expect(assertTrialHttpAccess(7,'GET',path)).resolves.toBeUndefined()
  })
})
