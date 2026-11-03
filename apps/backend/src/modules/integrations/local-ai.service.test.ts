import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalAiIntegrationService, type StoredLocalAiConfig } from './local-ai.service.js'
const io = vi.hoisted(() => ({ fetch: vi.fn<(tenant: number | undefined, url: string, init?: RequestInit) => Promise<Response>>(), chat: vi.fn<(input: { signal?: AbortSignal; model: string; systemPrompt: string; userMessage: string }) => Promise<{ answer: string }>>(), provider: vi.fn() }))
vi.mock('../trials/trial-outbound.js', () => ({ trialAiFetch: io.fetch }))
vi.mock('../local-ai/providers/network-provider.factory.js', () => ({ createNetworkProvider: io.provider }))
const service = new LocalAiIntegrationService()
const local: StoredLocalAiConfig = { localProvider: 'ollama', localBaseUrl: 'http://127.0.0.1:11434///', localModel: 'fixture-model' }
const context = { session: { id: 'synthetic' }, commands: [{ index: 1, command: 'pwd' }], preview: [] }
const summary = { summary: 'Comando de consulta observado', riskLevel: 'low', observedFacts: ['pwd'], evidenceCommandIndexes: [1] }
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
function network(): StoredLocalAiConfig {
  const key = service.encryptApiKey('synthetic-provider-token')
  return { networkProvider: 'openai_compatible', networkBaseUrl: 'https://provider.example.test///', networkModel: 'fixture-network', networkApiKeyEncrypted: key.encrypted, networkApiKeyIv: key.iv }
}
function summarize(text: string, template: 'summary-v1' | 'cab-v1' | 'risk-v1' = 'summary-v1', config = local) {
  io.fetch.mockResolvedValueOnce(response({ response: text }))
  return service.summarizeSessionAudit({ tenantId: 3, provider: 'ollama', config, model: 'fixture-model', template, sessionContext: context })
}
beforeEach(() => { vi.resetAllMocks(); io.provider.mockReturnValue({ chat: io.chat }); io.chat.mockResolvedValue({ answer: 'OK' }) })

describe('LocalAiIntegrationService provider boundaries', () => {
  it('round-trips authenticated encryption and rejects tampering', () => {
    const config = network()
    expect(service.decryptApiKey(config)).toBe('synthetic-provider-token')
    expect(config.networkApiKeyEncrypted).not.toContain('synthetic-provider-token')
    expect(() => service.decryptApiKey({ ...config, networkApiKeyEncrypted: 'invalid' })).toThrow()
    expect(service.parseConfig(null)).toEqual({}); expect(service.parseConfig('broken')).toEqual({})
    expect(service.parseConfig('{"mode":"read_only"}')).toEqual({ mode: 'read_only' })
    expect(service.normalizeBaseUrl(null)).toBeUndefined()
    expect(service.normalizeBaseUrl('https://example.test///')).toBe('https://example.test')
  })
  for (const routingPolicy of ['local_only', 'network_only', 'prefer_local', 'prefer_network'] as const) {
    for (const readiness of ['none', 'local', 'network', 'both'] as const) {
      it(`routes ${routingPolicy} with ${readiness} configuration without implicit unconfigured fallback`, async () => {
        const config = { ...(readiness === 'local' || readiness === 'both' ? local : {}), ...(readiness === 'network' || readiness === 'both' ? network() : {}), routingPolicy }
        const localReady = readiness === 'local' || readiness === 'both', networkReady = readiness === 'network' || readiness === 'both'
        const expected = routingPolicy === 'local_only' ? localReady ? 'ollama' : null : routingPolicy === 'network_only' ? networkReady ? 'openai_compatible' : null
          : routingPolicy === 'prefer_local' ? localReady ? 'ollama' : networkReady ? 'openai_compatible' : null
            : networkReady ? 'openai_compatible' : localReady ? 'ollama' : null
        expect(service.resolveSummaryProvider(config)).toBe(expected)
        io.fetch.mockResolvedValueOnce(response({ models: [{ name: local.localModel }] })).mockResolvedValueOnce(response({ response: 'OK' }))
        const result = await service.testConnection(config, 3)
        expect(result.ok).toBe(expected !== null)
        if (expected === 'openai_compatible') expect(io.provider).toHaveBeenCalledWith('openai_compatible', 'https://provider.example.test', 'synthetic-provider-token', 3)
        if (expected === 'ollama') expect(io.fetch).toHaveBeenCalledWith(3, 'http://127.0.0.1:11434/api/tags', expect.any(Object))
        if (!expected) { expect(io.fetch).not.toHaveBeenCalled(); expect(io.chat).not.toHaveBeenCalled() }
      })
    }
  }
  it('uses explicit model/default selection and rejects unknown routing for summaries', () => {
    expect(service.resolveSummaryProvider(local)).toBe('ollama')
    expect(service.resolveSummaryProvider({ routingPolicy: 'unknown' } as never)).toBeNull()
    expect(service.resolveSummaryModel('ollama', {})).toBe('qwen2.5-coder:3b')
    expect(service.resolveSummaryModel('openai_compatible', {})).toBe('gpt-5-mini')
    expect(service.resolveSummaryModel('ollama', local)).toBe('fixture-model')
    expect(service.resolveSummaryModel('openai_compatible', network())).toBe('fixture-network')
  })
  it.each(['/', '/api/tags', '/api/version', '  '])('diagnostic proxy permits only fixed read-only path %s', async path => {
    io.fetch.mockResolvedValueOnce(new Response('fixture', { status: 202, headers: { 'content-type': 'application/custom' } }))
    expect(await service.proxyLocalEndpoint(local.localBaseUrl!, path, 3)).toEqual({ statusCode: 202, contentType: 'application/custom', body: 'fixture' })
    expect(io.fetch).toHaveBeenCalledWith(3, 'http://127.0.0.1:11434' + (path.trim() || '/'), expect.objectContaining({ method: 'GET' }))
  })
  it('rejects arbitrary proxy paths before outbound I/O', async () => {
    for (const path of ['/api/generate', '//evil.test', '/api/tags?token=hidden', '/../admin']) await expect(service.proxyLocalEndpoint(local.localBaseUrl!, path)).rejects.toThrow('não permitido')
    expect(io.fetch).not.toHaveBeenCalled()
    const noContentType = new Response('OK'); noContentType.headers.delete('content-type')
    io.fetch.mockResolvedValueOnce(noContentType)
    expect((await service.proxyLocalEndpoint(local.localBaseUrl!)).contentType).toBe('text/plain; charset=utf-8')
  })
  it.each([
    ['list HTTP failure', () => response({ error: 'down' }, 503), undefined, 'HTTP 503'],
    ['missing model', () => response({ models: [] }), undefined, 'não encontrado'],
    ['missing models property', () => response({}), undefined, 'não encontrado'],
    ['generation HTTP failure', () => response({ models: [{ model: local.localModel }] }), () => response({}, 502), 'HTTP 502'],
    ['empty generated text', () => response({ models: [{ name: local.localModel }] }), () => response({ response: ' ' }), 'sem texto'],
    ['malformed payload', () => new Response('{broken'), undefined, 'JSON'],
  ] as const)('reports unhealthy for %s', async (_name, tags, generated, message) => {
    io.fetch.mockResolvedValueOnce(tags())
    if (generated) io.fetch.mockResolvedValueOnce(generated())
    const result = await service.testConnection(local)
    expect(result).toMatchObject({ ok: false, healthStatus: 'unhealthy' }); expect(result.healthMessage).toContain(message)
  })
  it.each([new Error('offline'), 'untyped failure'])('handles local and network transport failures without healthy status', async error => {
    io.fetch.mockRejectedValue(error)
    expect((await service.testConnection(local)).ok).toBe(false)
    io.chat.mockRejectedValue(error)
    expect((await service.testConnection({ ...network(), routingPolicy: 'network_only' })).ok).toBe(false)
  })
  it('does not consider an empty network answer healthy', async () => {
    io.chat.mockResolvedValue({ answer: ' ' })
    const result = await service.testConnection({ ...network(), routingPolicy: 'network_only' })
    expect(result.ok).toBe(false); expect(result.healthMessage).toContain('sem texto')
  })
})

describe('LocalAiIntegrationService audit summary contracts', () => {
  it.each(['summary-v1', 'cab-v1', 'risk-v1'] as const)('sends bounded tenant instructions and facts with %s template and deadline', async template => {
    const result = await summarize(JSON.stringify(summary), template, { ...local, auditInstructions: 'x'.repeat(4500) })
    expect(result).toMatchObject({ ...summary, nextActions: [], keyFindings: [], confidence: 'medium' })
    const [tenant, url, init] = io.fetch.mock.calls[0]!
    expect(tenant).toBe(3); expect(url).toBe('http://127.0.0.1:11434/api/generate')
    const body = JSON.parse(init!.body as string) as { system: string; prompt: string }
    expect(body).toMatchObject({ stream: false, format: 'json', model: 'fixture-model' })
    expect(body.system).toContain('x'.repeat(4000)); expect(body.system).not.toContain('x'.repeat(4001))
    expect(body.prompt).toContain(JSON.stringify(context)); expect(init!.signal).toBeInstanceOf(AbortSignal)
  })
  it.each([
    ['```json\n' + JSON.stringify(summary) + '\n```', 'low'],
    ['prefix ' + JSON.stringify(summary) + ' suffix', 'low'],
    [JSON.stringify({ result: { resumo: 'Observado', risco: 'alto', findings: ['  item ', '', 2], actions: [' Validar '] } }), 'high'],
    [JSON.stringify({ data: { message: 'Observado', risk_level: 'baixo', confidence: 'médio' } }), 'low'],
    [JSON.stringify({ output: { description: 'Observado', risk: 'media' } }), 'medium'],
    [JSON.stringify({ response: { overview: 'Observado', nivelRisco: 'alta' } }), 'high'],
    [JSON.stringify({ highlights: ['Primeiro achado'], risk: 'unrecognized', confidenceLevel: 'unknown' }), 'medium'],
  ])('normalizes supported provider envelope without inventing high confidence: %s', async (text, riskLevel) => {
    const result = await summarize(text)
    expect(result.summary).toBeTruthy(); expect(result.riskLevel).toBe(riskLevel)
  })
  it.each(['not JSON', '[]', 'null', '{}', '{"summary":3}', JSON.stringify({ ...summary, evidenceCommandIndexes: [0] })])('rejects malformed or incomplete response %s', async text => {
    await expect(summarize(text)).rejects.toThrow(/invalid JSON|incomplete JSON/)
  })
  it('limits normalized findings/actions to ten while retaining valid evidence', async () => {
    const result = await summarize(JSON.stringify({ ...summary, keyFindings: Array.from({ length: 15 }, (_, i) => `item ${i}`), nextActions: [' ', null, ' act '] }))
    expect(result.keyFindings).toHaveLength(10); expect(result.nextActions).toEqual(['act'])
  })
  it('rejects HTTP failures and empty local answers explicitly', async () => {
    io.fetch.mockResolvedValueOnce(response({ error: 'down' }, 503))
    await expect(service.summarizeSessionAudit({ provider: 'ollama', config: local, model: 'fixture', template: 'summary-v1', sessionContext: context })).rejects.toThrow('HTTP 503')
    await expect(summarize(' ')).rejects.toThrow('no output text')
    io.fetch.mockResolvedValueOnce(response({}))
    await expect(service.summarizeSessionAudit({ provider: 'ollama', config: local, model: 'fixture', template: 'summary-v1', sessionContext: context })).rejects.toThrow('no output text')
  })
  it('uses decrypted network credential only at provider boundary with tenant and cancellation', async () => {
    const config = { ...network(), auditInstructions: '  ' }
    io.chat.mockResolvedValueOnce({ answer: JSON.stringify(summary) }).mockResolvedValueOnce({ answer: ' ' })
    const input = { tenantId: 3, provider: 'openai_compatible' as const, config, model: 'fixture', template: 'risk-v1' as const, sessionContext: context }
    expect((await service.summarizeSessionAudit(input)).summary).toBe(summary.summary)
    expect(io.provider).toHaveBeenCalledWith(config.networkProvider, 'https://provider.example.test', 'synthetic-provider-token', 3)
    expect(io.chat.mock.calls[0]![0].signal).toBeInstanceOf(AbortSignal)
    expect(JSON.stringify(io.chat.mock.calls)).not.toContain('synthetic-provider-token')
    await expect(service.summarizeSessionAudit(input)).rejects.toThrow('no output text')
  })
})
