import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }))

vi.mock('./api', () => ({
  default: { get: apiGet },
}))

import { mcpService, runMcpReadOnlyProbe } from './mcp.service'

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

function parseBody(body: RequestInit['body']): Record<string, unknown> {
  if (typeof body !== 'string') throw new Error('Expected JSON request body')
  const parsed: unknown = JSON.parse(body)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected JSON object')
  return parsed as Record<string, unknown>
}

function mockServer(overrides: Record<string, unknown> = {}) {
  return vi.fn((url: string, init: RequestInit): Promise<Response> => {
    if (url.endsWith('/capabilities')) return Promise.resolve(new Response(JSON.stringify({ capabilities: [] }), { status: 200 }))
    const { id, method } = parseBody(init.body)
    if (typeof method !== 'string') throw new Error('Expected RPC method')
    if (method === 'notifications/initialized') return Promise.resolve(new Response(null, { status: 202 }))
    const values: Record<string, unknown> = {
      initialize: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'nodeaccess', version: '1' } },
      'tools/list': { tools: [{ name: 'search_hosts', inputSchema: { type: 'object' } }] },
      'resources/list': { resources: [] }, 'prompts/list': { prompts: [] },
      'tools/call': { content: [{ type: 'text', text: '{}' }] }, ...overrides,
    }
    return Promise.resolve(new Response(JSON.stringify({ jsonrpc: '2.0', id, result: values[method] }), { status: 200 }))
  })
}

describe('runMcpReadOnlyProbe', () => {
  it('completes the handshake and read-only query without cookies or redirects', async () => {
    const fetcher = mockServer()
    const steps = await runMcpReadOnlyProbe('secret-token', '/api/v1', ['search_hosts'], fetcher as typeof fetch)
    expect(steps.map((step) => step.status)).toEqual(Array(6).fill('passed'))
    expect(fetcher).toHaveBeenCalledTimes(7)
    for (const [, init] of fetcher.mock.calls) {
      expect(init.credentials).toBe('omit')
      expect(init.redirect).toBe('error')
      expect(init.cache).toBe('no-store')
      expect(init.headers).toMatchObject({ Authorization: 'Bearer secret-token', Accept: 'application/json, text/event-stream' })
    }
    const notification = parseBody(fetcher.mock.calls[2][1].body)
    expect(notification).toEqual({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(JSON.stringify(steps)).not.toContain('secret-token')
  })

  it.each([
    ['tools/call', { isError: true, content: [{ type: 'text', text: 'private error' }] }, 'read_only_tool'],
    ['initialize', { protocolVersion: 'wrong', serverInfo: {}, capabilities: {} }, 'initialize'],
    ['tools/list', { tools: [{ name: 'search_hosts', inputSchema: null }] }, 'tools'],
    ['resources/list', { resources: [{ name: 'invalid' }] }, 'resources'],
    ['prompts/list', { prompts: null }, 'prompts'],
    ['tools/call', { structuredContent: {} }, 'read_only_tool'],
  ])('rejects invalid %s result', async (method, result, key) => {
    const steps = await runMcpReadOnlyProbe('secret-token', '/api/v1', [], mockServer({ [method]: result }) as typeof fetch)
    expect(steps.at(-1)).toMatchObject({ key, status: 'failed' })
    expect(JSON.stringify(steps)).not.toContain('private error')
  })

  it.each(['https://evil.test/api/v1', '/api/v1?target=evil', '/other', 'http://user:pass@localhost/api/v1'])('never transmits a token to %s', async (base) => {
    const fetcher = mockServer()
    const steps = await runMcpReadOnlyProbe('secret-token', base, [], fetcher as typeof fetch)
    expect(fetcher).not.toHaveBeenCalled()
    expect(steps[0].status).toBe('failed')
  })

  it.each([{ allowed: ['search_snippets'] }, { allowed: [] }])('skips when allowlist or discovery excludes the tool', async ({ allowed }) => {
    const fetcher = mockServer(allowed.length ? {} : { 'tools/list': { tools: [] } })
    const steps = await runMcpReadOnlyProbe('secret-token', '/api/v1', allowed, fetcher as typeof fetch)
    expect(steps.at(-1)).toMatchObject({ key: 'read_only_tool', status: 'skipped' })
    expect(fetcher).toHaveBeenCalledTimes(6)
  })

  it.each([200, 204])('requires notification HTTP202, rejecting %s', async (status) => {
    const fetcher = mockServer()
    const wrapped = (url: string, init: RequestInit): Promise<Response> => typeof init.body === 'string' && parseBody(init.body).method === 'notifications/initialized'
      ? Promise.resolve(new Response(null, { status })) : fetcher(url, init)
    const steps = await runMcpReadOnlyProbe('secret-token', '/api/v1', [], wrapped as typeof fetch)
    expect(steps.at(-1)).toMatchObject({ key: 'initialize', status: 'failed' })
  })

  it.each([
    { jsonrpc: '2.0', id: 'wrong', result: {} },
    { jsonrpc: '1.0', id: 'nodeaccess-ui-probe-init', result: {} },
    { jsonrpc: '2.0', id: 'nodeaccess-ui-probe-init', error: { message: 'private error' }, result: {} },
  ])('rejects malformed JSON-RPC envelope', async (payload) => {
    const fetcher = mockServer().mockResolvedValueOnce(new Response(JSON.stringify({ capabilities: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload)))
    const steps = await runMcpReadOnlyProbe('secret-token', '/api/v1', [], fetcher as typeof fetch)
    expect(steps.at(-1)).toMatchObject({ key: 'initialize', status: 'failed' })
    expect(JSON.stringify(steps)).not.toContain('private error')
  })

  it.each([401, 403, 404, 429, 503])('sanitizes HTTP%s and stops immediately', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private token body', { status }))
    const steps = await runMcpReadOnlyProbe('secret-token', '/api/v1', [], fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(steps).toHaveLength(1)
    expect(steps[0].status).toBe('failed')
    expect(JSON.stringify(steps)).not.toContain('private token body')
  })
})
