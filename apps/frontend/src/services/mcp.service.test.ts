import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }))

vi.mock('./api', () => ({
  default: { get: apiGet },
}))

import { buildMcpAgentSetup, mcpService, runMcpReadOnlyProbe } from './mcp.service'

describe('buildMcpAgentSetup', () => {
  it('builds guided commands without embedding a token value', () => {
    const setup = buildMcpAgentSetup('https://nodeaccess.example/api/v1/')

    expect(setup.endpoint).toBe('https://nodeaccess.example/api/v1/mcp/jsonrpc')
    expect(setup.codexRegister).toContain('--bearer-token-env-var NODEACCESS_MCP_TOKEN')
    expect(setup.codexStartBash).toContain('Token MCP:')
    expect(setup.codexStartPowerShell).toContain('Read-Host -MaskInput')
    expect(JSON.stringify(setup)).not.toContain('na_mcp_')
  })
})

function okJson(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => body,
  } as Response)
}

describe('mcpService capability cache', () => {
  beforeEach(() => {
    apiGet.mockReset()
    mcpService.clearCapabilitiesCache()
  })

  it('coalesces concurrent catalog reads and serves the cached value', async () => {
    apiGet.mockResolvedValue({ data: [{ key: 'search_hosts' }] })

    const [first, second] = await Promise.all([
      mcpService.listAdminCapabilities(),
      mcpService.listAdminCapabilities(),
    ])
    const third = await mcpService.listAdminCapabilities()

    expect(first).toBe(second)
    expect(third).toBe(first)
    expect(apiGet).toHaveBeenCalledTimes(1)
  })

  it('refetches after explicit invalidation', async () => {
    apiGet.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [{ key: 'search_hosts' }] })

    await mcpService.listAdminCapabilities()
    mcpService.clearCapabilitiesCache()
    const refreshed = await mcpService.listAdminCapabilities()

    expect(apiGet).toHaveBeenCalledTimes(2)
    expect(refreshed.data).toHaveLength(1)
  })
})

describe('runMcpReadOnlyProbe', () => {
  it('tests authentication, discovery and a read-only tool without session credentials', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => okJson({ capabilities: [] }))
      .mockImplementationOnce(() => okJson({ jsonrpc: '2.0', result: { protocolVersion: '2025-06-18' } }))
      .mockImplementationOnce(() => okJson({ jsonrpc: '2.0', result: { tools: [] } }))
      .mockImplementationOnce(() => okJson({ jsonrpc: '2.0', result: { resources: [] } }))
      .mockImplementationOnce(() => okJson({ jsonrpc: '2.0', result: { prompts: [] } }))
      .mockImplementationOnce(() => okJson({ jsonrpc: '2.0', result: { structuredContent: { items: [] } } }))

    const result = await runMcpReadOnlyProbe('secret-token', '/api/v1', ['search_hosts'], fetcher as typeof fetch)

    expect(result.map((step) => step.status)).toEqual(['passed', 'passed', 'passed', 'passed', 'passed', 'passed'])
    expect(fetcher).toHaveBeenCalledTimes(6)
    for (const [, init] of fetcher.mock.calls) {
      expect(init.credentials).toBe('omit')
      expect(init.cache).toBe('no-store')
      expect(init.headers.Authorization).toBe('Bearer secret-token')
    }
    expect(JSON.stringify(result)).not.toContain('secret-token')
  })

  it('does not call a tool outside the token allowlist', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => okJson({ capabilities: [] }))
      .mockImplementationOnce(() => okJson({ jsonrpc: '2.0', result: { protocolVersion: '2025-06-18' } }))
      .mockImplementationOnce(() => okJson({ jsonrpc: '2.0', result: { tools: [] } }))
      .mockImplementationOnce(() => okJson({ jsonrpc: '2.0', result: { resources: [] } }))
      .mockImplementationOnce(() => okJson({ jsonrpc: '2.0', result: { prompts: [] } }))

    const result = await runMcpReadOnlyProbe('secret-token', '/api/v1', ['search_snippets'], fetcher as typeof fetch)

    expect(fetcher).toHaveBeenCalledTimes(5)
    expect(result.at(-1)).toMatchObject({ key: 'read_only_tool', status: 'skipped' })
  })

  it('rejects a JSON-RPC error even when HTTP succeeds', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(() => okJson({ capabilities: [] }))
      .mockImplementationOnce(() => okJson({ jsonrpc: '2.0', error: { code: -32600, message: 'internal detail' } }))

    const result = await runMcpReadOnlyProbe('secret-token', '/api/v1', ['search_hosts'], fetcher as typeof fetch)

    expect(result).toHaveLength(2)
    expect(result[1]).toMatchObject({ key: 'initialize', status: 'failed' })
    expect(JSON.stringify(result)).not.toContain('internal detail')
  })

  it('stops after authentication failure and returns a sanitized error', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: 'token leaked' }) })

    const result = await runMcpReadOnlyProbe('secret-token', '/api/v1', [], fetcher as typeof fetch)

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ key: 'authentication', status: 'failed' })
    expect(JSON.stringify(result)).not.toContain('secret-token')
    expect(JSON.stringify(result)).not.toContain('token leaked')
  })
})
