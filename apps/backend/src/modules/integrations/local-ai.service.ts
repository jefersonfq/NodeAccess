import { z } from 'zod'
import { env } from '../../config/env.js'
import { decrypt, encrypt } from '../../shared/crypto.js'
import { createNetworkProvider } from '../local-ai/providers/network-provider.factory.js'

export const LOCAL_AI_DEFAULTS = {
  mode: 'read_only',
  routingPolicy: 'local_only',
  localProvider: 'ollama',
  localBaseUrl: 'http://localhost:11434',
  localModel: 'qwen2.5-coder:3b',
  networkProvider: 'openai_compatible',
} as const

export type StoredLocalAiConfig = {
  mode?: 'read_only' | 'low_impact' | 'full_control'
  routingPolicy?: 'local_only' | 'network_only' | 'prefer_local' | 'prefer_network'
  localProvider?: string
  localBaseUrl?: string
  localModel?: string
  networkProvider?: string
  networkBaseUrl?: string
  networkModel?: string
  networkApiKeyEncrypted?: string
  networkApiKeyIv?: string
  auditInstructions?: string
  assistantInstructions?: string
  monthlyRequestLimit?: number | null
  interactionRetentionDays?: number | null
  healthStatus?: 'unknown' | 'healthy' | 'unhealthy'
  healthMessage?: string | null
  lastCheckedAt?: string | null
}

type SessionAuditAiPromptTemplate = 'summary-v1' | 'cab-v1' | 'risk-v1'

type LocalAiSummaryProviderKey = 'ollama' | 'openai_compatible'

const SessionAuditSummaryResultSchema = z.object({
  summary: z.string(),
  riskLevel: z.enum(['low', 'medium', 'high']),
  keyFindings: z.array(z.string()).max(10).default([]),
  nextActions: z.array(z.string()).max(10).default([]),
  confidence: z.enum(['low', 'medium', 'high']).default('medium'),
  observedFacts: z.array(z.string()).max(10).default([]),
  hypotheses: z.array(z.string()).max(10).default([]),
  evidenceCommandIndexes: z.array(z.number().int().positive()).max(20).default([]),
})

export class LocalAiIntegrationService {
  encryptApiKey(apiKey: string): { encrypted: string; iv: string } {
    return encrypt(apiKey)
  }

  normalizeBaseUrl(value?: string | null): string | undefined {
    if (!value) return undefined
    return value.replace(/\/+$/, '')
  }

  async proxyLocalEndpoint(baseUrl: string, path = '/'): Promise<{
    statusCode: number
    contentType: string
    body: string
  }> {
    const normalizedPath = normalizeProxyPath(path)
    const response = await fetch(`${this.normalizeBaseUrl(baseUrl)}${normalizedPath}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
      },
    })

    return {
      statusCode: response.status,
      contentType: response.headers.get('content-type') ?? 'text/plain; charset=utf-8',
      body: await response.text(),
    }
  }

  decryptApiKey(config: StoredLocalAiConfig): string {
    return decrypt({
      encrypted: config.networkApiKeyEncrypted!,
      iv: config.networkApiKeyIv!,
    })
  }

  parseConfig(raw?: string | null): StoredLocalAiConfig {
    if (!raw) return {}
    try {
      return JSON.parse(raw) as StoredLocalAiConfig
    } catch {
      return {}
    }
  }

  resolveSummaryProvider(config: StoredLocalAiConfig): LocalAiSummaryProviderKey | null {
    const localReady = !!(config.localProvider && config.localBaseUrl && config.localModel)
    const networkReady = !!(config.networkProvider && config.networkBaseUrl && config.networkModel && config.networkApiKeyEncrypted && config.networkApiKeyIv)

    switch (config.routingPolicy ?? LOCAL_AI_DEFAULTS.routingPolicy) {
      case 'local_only':
        return localReady ? 'ollama' : null
      case 'network_only':
        return networkReady ? 'openai_compatible' : null
      case 'prefer_local':
        return localReady ? 'ollama' : networkReady ? 'openai_compatible' : null
      case 'prefer_network':
        return networkReady ? 'openai_compatible' : localReady ? 'ollama' : null
      default:
        return null
    }
  }

  resolveSummaryModel(provider: LocalAiSummaryProviderKey, config: StoredLocalAiConfig): string {
    return provider === 'ollama'
      ? (config.localModel ?? LOCAL_AI_DEFAULTS.localModel)
      : (config.networkModel ?? 'gpt-5-mini')
  }

  async summarizeSessionAudit(input: {
    provider: LocalAiSummaryProviderKey
    config: StoredLocalAiConfig
    model: string
    template: SessionAuditAiPromptTemplate
    sessionContext: {
      session: Record<string, unknown>
      commands: Array<Record<string, unknown>>
      preview: Array<Record<string, unknown>>
    }
  }): Promise<z.infer<typeof SessionAuditSummaryResultSchema>> {
    if (input.provider === 'ollama') {
      return this.summarizeSessionAuditWithOllama(
        input.config,
        input.model,
        input.template,
        input.config.auditInstructions ?? null,
        input.sessionContext,
      )
    }

    return this.summarizeSessionAuditWithNetworkProvider(
      input.config,
      input.model,
      input.template,
      input.config.auditInstructions ?? null,
      input.sessionContext,
    )
  }

  async testConnection(config: StoredLocalAiConfig): Promise<{
    ok: boolean
    healthStatus: 'healthy' | 'unhealthy'
    healthMessage: string | null
  }> {
    const routingPolicy = config.routingPolicy ?? LOCAL_AI_DEFAULTS.routingPolicy

    const localReady = !!(config.localProvider && config.localBaseUrl && config.localModel)
    const networkReady = !!(config.networkProvider && config.networkBaseUrl && config.networkModel && config.networkApiKeyEncrypted && config.networkApiKeyIv)

    if (routingPolicy === 'local_only') {
      if (!localReady) return { ok: false, healthStatus: 'unhealthy', healthMessage: 'Provider local não configurado' }
      return this.testLocal(config.localBaseUrl!, config.localModel!)
    }

    if (routingPolicy === 'network_only') {
      if (!networkReady) return { ok: false, healthStatus: 'unhealthy', healthMessage: 'Provider de rede não configurado' }
      return this.testNetwork(config.networkProvider, config.networkBaseUrl!, this.decryptApiKey(config), config.networkModel!)
    }

    if (routingPolicy === 'prefer_local') {
      if (localReady) return this.testLocal(config.localBaseUrl!, config.localModel!)
      if (networkReady) return this.testNetwork(config.networkProvider, config.networkBaseUrl!, this.decryptApiKey(config), config.networkModel!)
      return { ok: false, healthStatus: 'unhealthy', healthMessage: 'Nenhum provider compatível configurado' }
    }

    if (networkReady) return this.testNetwork(config.networkProvider, config.networkBaseUrl!, this.decryptApiKey(config), config.networkModel!)
    if (localReady) return this.testLocal(config.localBaseUrl!, config.localModel!)
    return { ok: false, healthStatus: 'unhealthy', healthMessage: 'Nenhum provider compatível configurado' }
  }

  private async testLocal(baseUrl: string, model: string): Promise<{
    ok: boolean
    healthStatus: 'healthy' | 'unhealthy'
    healthMessage: string | null
  }> {
    try {
      const response = await fetch(`${this.normalizeBaseUrl(baseUrl)}/api/tags`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })
      const body = await response.text()
      if (!response.ok) {
        return {
          ok: false,
          healthStatus: 'unhealthy',
          healthMessage: `Ollama respondeu HTTP ${response.status}: ${body.slice(0, 200)}`,
        }
      }

      const parsed = JSON.parse(body) as { models?: Array<{ name?: string; model?: string }> }
      const found = parsed.models?.some((item) => item.name === model || item.model === model) ?? false
      if (!found) {
        return {
          ok: false,
          healthStatus: 'unhealthy',
          healthMessage: `Modelo local não encontrado no Ollama: ${model}`,
        }
      }

      const generationResponse = await fetch(`${this.normalizeBaseUrl(baseUrl)}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          model,
          stream: false,
          prompt: 'Responda apenas com OK',
          options: {
            temperature: 0,
            num_predict: 8,
          },
        }),
      })

      const generationBody = await generationResponse.text()
      if (!generationResponse.ok) {
        return {
          ok: false,
          healthStatus: 'unhealthy',
          healthMessage: `Ollama listou o modelo, mas a geração falhou com HTTP ${generationResponse.status}: ${generationBody.slice(0, 200)}`,
        }
      }

      const generationPayload = JSON.parse(generationBody) as { response?: string }
      if (!generationPayload.response?.trim()) {
        return {
          ok: false,
          healthStatus: 'unhealthy',
          healthMessage: 'Ollama respondeu sem texto na geração de teste',
        }
      }

      return {
        ok: true,
        healthStatus: 'healthy',
        healthMessage: `Ollama acessível, modelo ${model} disponível e geração curta validada`,
      }
    } catch (error) {
      return {
        ok: false,
        healthStatus: 'unhealthy',
        healthMessage: error instanceof Error ? error.message : 'Falha ao testar provider local',
      }
    }
  }

  private async testNetwork(providerKind: string | undefined, baseUrl: string, apiKey: string, model: string): Promise<{
    ok: boolean
    healthStatus: 'healthy' | 'unhealthy'
    healthMessage: string | null
  }> {
    try {
      const generated = await createNetworkProvider(providerKind, this.normalizeBaseUrl(baseUrl)!, apiKey).chat({ model, systemPrompt: 'Responda apenas com OK', userMessage: 'Teste rápido de conectividade' })
      if (!generated.answer.trim()) throw new Error('Provider de rede respondeu sem texto na geração de teste')

      return {
        ok: true,
        healthStatus: 'healthy',
        healthMessage: `Provider de rede acessível, modelo ${model} disponível e geração curta validada`,
      }
    } catch (error) {
      return {
        ok: false,
        healthStatus: 'unhealthy',
        healthMessage: error instanceof Error ? error.message : 'Falha ao testar provider de rede',
      }
    }
  }

  private async summarizeSessionAuditWithOllama(
    config: StoredLocalAiConfig,
    model: string,
    template: SessionAuditAiPromptTemplate,
    auditInstructions: string | null,
    sessionContext: {
      session: Record<string, unknown>
      commands: Array<Record<string, unknown>>
      preview: Array<Record<string, unknown>>
    },
  ): Promise<z.infer<typeof SessionAuditSummaryResultSchema>> {
    const response = await fetch(`${this.normalizeBaseUrl(config.localBaseUrl)!}/api/generate`, {
      method: 'POST',
      signal: AbortSignal.timeout(env.SESSION_AUDIT_AI_REQUEST_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        system: buildSummaryInstructions(template, auditInstructions),
        prompt: [
          'Analise este contexto de auditoria SSH e responda apenas com JSON válido em português do Brasil.',
          JSON.stringify(sessionContext),
        ].join('\n\n'),
        options: {
          temperature: 0.1,
        },
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Ollama summary HTTP ${response.status}: ${body.slice(0, 500)}`)
    }

    const payload = await response.json() as { response?: string }
    const text = payload.response?.trim()
    if (!text) {
      throw new Error('Ollama summary returned no output text')
    }

    return parseSessionAuditSummary(text, 'Ollama')
  }

  private async summarizeSessionAuditWithNetworkProvider(
    config: StoredLocalAiConfig,
    model: string,
    template: SessionAuditAiPromptTemplate,
    auditInstructions: string | null,
    sessionContext: {
      session: Record<string, unknown>
      commands: Array<Record<string, unknown>>
      preview: Array<Record<string, unknown>>
    },
  ): Promise<z.infer<typeof SessionAuditSummaryResultSchema>> {
    const generated = await createNetworkProvider(config.networkProvider, this.normalizeBaseUrl(config.networkBaseUrl)!, this.decryptApiKey(config)).chat({
      model,
      systemPrompt: buildSummaryInstructions(template, auditInstructions),
      userMessage: ['Analise este contexto de auditoria SSH e responda apenas com JSON válido em português do Brasil.', JSON.stringify(sessionContext)].join('\n\n'),
      signal: AbortSignal.timeout(env.SESSION_AUDIT_AI_REQUEST_TIMEOUT_MS),
    })
    const text = generated.answer.trim()
    if (!text) {
      throw new Error('Network audit AI returned no output text')
    }

    return parseSessionAuditSummary(text, 'Network audit AI')
  }
}

function normalizeProxyPath(path: string): string {
  const trimmed = path.trim() || '/'
  if (!['/', '/api/tags', '/api/version'].includes(trimmed)) {
    throw new Error('Caminho de diagnóstico não permitido')
  }
  return trimmed
}

function buildSummaryInstructions(template: SessionAuditAiPromptTemplate, auditInstructions?: string | null): string {
  const base = [
    'You analyze SSH audited sessions for security and operations review.',
    'Write all natural-language fields in Brazilian Portuguese (pt-BR).',
    'Keep commands, service names, file names, paths, hostnames, and literals exactly as observed.',
    'Return valid JSON only.',
    'Use this exact shape: {"summary":"...","riskLevel":"low|medium|high","keyFindings":["..."],"nextActions":["..."],"confidence":"low|medium|high","observedFacts":["..."],"hypotheses":["..."],"evidenceCommandIndexes":[1]}.',
    'Do not wrap the answer in markdown, prose, or code fences.',
    'Do not use keys like "message", "text", "analysis", or "response" as the top-level result.',
    'Always include all eight keys even when the evidence is sparse.',
    'If uncertain, set riskLevel to "medium", confidence to "medium", and use empty arrays for keyFindings or nextActions.',
    'If you would normally answer with {"message":"..."}, copy that text into "summary" instead and still return the full schema.',
    'Prefer the fields "riskSignals", "commandHighlights", and "commands" over raw preview noise when forming the summary.',
    'Prioritize criticalEvents, service state changes, destructive file operations, and final observed system state.',
    'Mention concrete commands and affected services/files when evidence exists.',
    'Be concise, factual, and avoid speculation beyond the available session evidence.',
    'Put only directly observed statements in observedFacts. Put uncertain interpretations in hypotheses. Reference only command indexes that exist in the supplied commands array.',
    'Use low risk when activity is clearly benign, medium when there is operational impact or uncertainty, and high only for clearly dangerous or destructive behavior.',
  ]

  if (template === 'cab-v1') {
    base.push(
      'Focus on CAB-style change communication.',
      'The summary should read like a concise change summary for operators and stakeholders.',
      'Key findings should emphasize what changed, where, and visible effects.',
      'Next actions should emphasize validation, rollback considerations, and follow-up checks.',
    )
  } else if (template === 'risk-v1') {
    base.push(
      'Focus on security and operational risk assessment.',
      'The summary should highlight potentially destructive or sensitive actions first.',
      'Key findings should emphasize risky commands, privilege use, configuration changes, and ambiguous actions.',
      'Next actions should emphasize mitigation, verification, and escalation if needed.',
    )
  } else {
    base.push(
      'Focus on a balanced operational summary.',
      'Key findings should emphasize the most relevant actions and observed outcomes.',
      'Next actions should be pragmatic and short.',
    )
  }

  const customInstructions = normalizeAuditInstructions(auditInstructions)
  if (customInstructions) {
    base.push('Additional tenant instructions:')
    base.push(customInstructions)
  }

  return base.join(' ')
}

function normalizeAuditInstructions(value?: string | null): string | null {
  const normalized = value?.trim()
  if (!normalized) return null
  return normalized.slice(0, 4000)
}

function parseSessionAuditSummary(
  text: string,
  providerLabel: string,
): z.infer<typeof SessionAuditSummaryResultSchema> {
  let parsed: unknown
  try {
    parsed = JSON.parse(extractJsonObject(text))
  } catch {
    throw new Error(`${providerLabel} summary returned invalid JSON`)
  }

  try {
    return SessionAuditSummaryResultSchema.parse(normalizeSessionAuditSummary(parsed))
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(`${providerLabel} summary returned incomplete JSON: ${text.slice(0, 500)}`)
    }
    throw err
  }
}

function normalizeSessionAuditSummary(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value

  const record = value as Record<string, unknown>
  const nested = firstObject(
    record.result,
    record.data,
    record.output,
    record.response,
  )

  const summary = firstString(
    record.summary,
    record.message,
    record.text,
    record.content,
    record.resumo,
    record.overview,
    record.description,
    record.analysis,
    nested?.message,
    nested?.text,
    nested?.content,
    nested?.summary,
    nested?.resumo,
    nested?.overview,
    nested?.description,
    nested?.analysis,
  )

  const riskLevel = normalizeRiskLevel(
    firstString(
      record.riskLevel,
      record.risk_level,
      record.risk,
      record.risco,
      record.nivelRisco,
      nested?.riskLevel,
      nested?.risk_level,
      nested?.risk,
      nested?.risco,
      nested?.nivelRisco,
    ),
  )

  return {
    ...record,
    ...nested,
    summary: summary ?? buildFallbackSummary(record, nested),
    riskLevel: riskLevel ?? 'medium',
    keyFindings: normalizeStringArray(
      record.keyFindings,
      record.key_findings,
      record.findings,
      record.highlights,
      nested?.keyFindings,
      nested?.key_findings,
      nested?.findings,
      nested?.highlights,
    ),
    nextActions: normalizeStringArray(
      record.nextActions,
      record.next_actions,
      record.actions,
      record.recommendations,
      nested?.nextActions,
      nested?.next_actions,
      nested?.actions,
      nested?.recommendations,
    ),
    confidence: normalizeRiskLevel(
      firstString(
        record.confidence,
        record.confidenceLevel,
        nested?.confidence,
        nested?.confidenceLevel,
      ),
    ) ?? 'medium',
  }
}

function firstObject(...values: unknown[]): Record<string, unknown> | null {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  }
  return null
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return undefined
}

function normalizeStringArray(...values: unknown[]): string[] {
  for (const value of values) {
    if (!Array.isArray(value)) continue
    const items = value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 10)
    if (items.length > 0) return items
  }
  return []
}

function normalizeRiskLevel(value: string | undefined): 'low' | 'medium' | 'high' | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized
  }
  if (['baixo', 'baixa'].includes(normalized)) return 'low'
  if (['medio', 'médio', 'media', 'média'].includes(normalized)) return 'medium'
  if (['alto', 'alta'].includes(normalized)) return 'high'
  return undefined
}

function buildFallbackSummary(
  record: Record<string, unknown>,
  nested: Record<string, unknown> | null,
): string | undefined {
  const candidates = normalizeStringArray(
    record.keyFindings,
    record.key_findings,
    record.findings,
    record.highlights,
    nested?.keyFindings,
    nested?.key_findings,
    nested?.findings,
    nested?.highlights,
  )

  if (candidates.length > 0) {
    return candidates[0]
  }

  return firstString(
    record.message,
    record.text,
    record.content,
    record.overview,
    record.description,
    record.analysis,
    nested?.message,
    nested?.text,
    nested?.content,
    nested?.overview,
    nested?.description,
    nested?.analysis,
  )
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return trimmed
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim()
  }

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1)
  }

  return trimmed
}
