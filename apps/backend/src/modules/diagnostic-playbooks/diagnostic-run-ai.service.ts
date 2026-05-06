import { z } from 'zod'
import { env } from '../../config/env.js'
import { logger } from '../../config/logger.js'
import type { IntegrationRepository } from '../integrations/integration.repository.js'
import type { OpenAiIntegrationService } from '../integrations/openai.service.js'
import type { LocalAiIntegrationService, StoredLocalAiConfig } from '../integrations/local-ai.service.js'
import type { DiagnosticRunRepository } from './diagnostic-run.repository.js'

type DiagnosticAiProvider = 'openai' | 'ollama' | 'openai_compatible'
type DiagnosticAiPreference = 'automatic' | 'openai' | 'local_ai'

const DiagnosticRunSummaryResultSchema = z.object({
  summary: z.string(),
  riskLevel: z.enum(['low', 'medium', 'high']),
  keyFindings: z.array(z.string()).max(10).default([]),
  nextActions: z.array(z.string()).max(10).default([]),
  confidence: z.enum(['low', 'medium', 'high']).default('medium'),
})

interface OpenAiConfigSnapshot {
  apiKeyEncrypted?: string
  apiKeyIv?: string
  baseUrl?: string
  defaultModel?: string
  auditInstructions?: string
}

type ResolvedDiagnosticAiProvider =
  | {
    provider: 'openai'
    model: string
    config: OpenAiConfigSnapshot
  }
  | {
    provider: 'ollama' | 'openai_compatible'
    model: string
    config: StoredLocalAiConfig
  }

export class DiagnosticRunAiService {
  constructor(
    private readonly integrationRepository: IntegrationRepository,
    private readonly runRepository: DiagnosticRunRepository,
    private readonly openAi: OpenAiIntegrationService,
    private readonly localAi: LocalAiIntegrationService,
  ) {}

  async requestAutomaticSummary(runId: number, tenantId: number): Promise<boolean> {
    if (!env.FEATURE_SESSION_AUDIT_AI_SUMMARY) return false

    const licensed = await this.integrationRepository.isSessionAuditAiLicensed(tenantId)
    if (!licensed) return false

    const license = await this.integrationRepository.findLicenseSnapshot(tenantId)
    if (license?.featureEntitlements?.sessionAuditAiAutoSummary !== true) return false

    return this.startSummary(runId, tenantId)
  }

  async requestSummary(runId: number, tenantId: number): Promise<boolean> {
    if (!env.FEATURE_SESSION_AUDIT_AI_SUMMARY) return false

    const licensed = await this.integrationRepository.isSessionAuditAiLicensed(tenantId)
    if (!licensed) return false

    return this.startSummary(runId, tenantId)
  }

  private async startSummary(runId: number, tenantId: number): Promise<boolean> {
    const resolved = await this.resolveProvider(tenantId)
    if (!resolved) return false

    const run = await this.runRepository.findDetailById(runId, tenantId)
    if (!run || run.commands.length === 0) return false

    await this.runRepository.markAiSummaryProcessing(runId)
    void this.runSummary(runId, tenantId, resolved, run)
    return true
  }

  private async runSummary(
    runId: number,
    tenantId: number,
    resolved: ResolvedDiagnosticAiProvider,
    run: NonNullable<Awaited<ReturnType<DiagnosticRunRepository['findDetailById']>>>,
  ): Promise<void> {
    try {
      const context = {
        run: {
          id: run.id,
          hostId: run.hostId,
          playbookName: run.playbookName,
          status: run.status,
          errorMessage: run.errorMessage,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
        },
        commands: run.commands.slice(0, 20).map((command) => ({
          commandId: command.commandId,
          command: command.command,
          status: command.status,
          exitCode: command.exitCode,
          redactionApplied: command.redactionApplied,
          output: normalizeDiagnosticOutputForAi(command.outputBody ?? command.outputPreview ?? '', command.exitCode).slice(0, 2000),
        })),
      }

      const result = resolved.provider === 'openai'
        ? await this.summarizeWithOpenAi(resolved, context)
        : await this.summarizeWithLocalProvider(resolved, context)

      const summaryText = [
        result.summary.trim(),
        result.keyFindings.length ? `Achados: ${result.keyFindings.join(' | ')}` : null,
        result.nextActions.length ? `Proximos passos: ${result.nextActions.join(' | ')}` : null,
        `Risco: ${result.riskLevel}. Confianca: ${result.confidence}.`,
      ].filter(Boolean).join('\n\n')

      await this.runRepository.markAiSummaryReady(runId, {
        summaryText,
        findingsJson: JSON.stringify({
          riskLevel: result.riskLevel,
          confidence: result.confidence,
          keyFindings: result.keyFindings,
          nextActions: result.nextActions,
        }),
      })
    } catch (error) {
      logger.warn({ err: error, runId, tenantId }, 'Diagnostic run AI summary failed')
      const message = error instanceof Error ? error.message.slice(0, 1000) : 'Falha ao gerar resumo por IA'
      await this.runRepository.markAiSummaryFailed(runId, message)
    }
  }

  private async resolveProvider(tenantId: number): Promise<ResolvedDiagnosticAiProvider | null> {
    const license = await this.integrationRepository.findLicenseSnapshot(tenantId)
    const preference = normalizePreference(license?.sessionAuditAiProvider)

    if (preference === 'openai') {
      return this.resolveOpenAiProvider(tenantId)
    }

    if (preference === 'local_ai') {
      return this.resolveLocalProvider(tenantId)
    }

    return (await this.resolveOpenAiProvider(tenantId)) ?? (await this.resolveLocalProvider(tenantId))
  }

  private async resolveOpenAiProvider(tenantId: number): Promise<{
    provider: 'openai'
    model: string
    config: OpenAiConfigSnapshot
  } | null> {
    const integration = await this.integrationRepository.findByProvider(tenantId, 'openai')
    if (!integration?.enabled || !integration.config) return null

    const config = parseOpenAiConfig(integration.config)
    if (!config.apiKeyEncrypted || !config.apiKeyIv) return null

    return {
      provider: 'openai',
      model: config.defaultModel ?? 'gpt-5-mini',
      config,
    }
  }

  private async resolveLocalProvider(tenantId: number): Promise<{
    provider: 'ollama' | 'openai_compatible'
    model: string
    config: StoredLocalAiConfig
  } | null> {
    if (!env.FEATURE_LOCAL_AI) return null
    const integration = await this.integrationRepository.findByProvider(tenantId, 'local_ai')
    if (!integration?.enabled || !integration.config) return null

    const config = this.localAi.parseConfig(integration.config)
    const provider = this.localAi.resolveSummaryProvider(config)
    if (!provider) return null

    return {
      provider,
      model: this.localAi.resolveSummaryModel(provider, config),
      config,
    }
  }

  private async summarizeWithOpenAi(
    resolved: { provider: 'openai'; model: string; config: OpenAiConfigSnapshot },
    context: { run: Record<string, unknown>; commands: Array<Record<string, unknown>> },
  ): Promise<z.infer<typeof DiagnosticRunSummaryResultSchema>> {
    const response = await fetch(`${this.openAi.normalizeBaseUrl(resolved.config.baseUrl)}/responses`, {
      method: 'POST',
      signal: AbortSignal.timeout(env.SESSION_AUDIT_AI_REQUEST_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.openAi.decryptApiKey(resolved.config)}`,
      },
      body: JSON.stringify({
        model: resolved.model,
        instructions: buildDiagnosticInstructions(resolved.config.auditInstructions),
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: [
                  'Analise este diagnostico de host e produza um resumo JSON em português do Brasil.',
                  JSON.stringify(context),
                ].join('\n\n'),
              },
            ],
          },
        ],
        max_output_tokens: 1200,
        text: {
          format: {
            type: 'json_schema',
            name: 'diagnostic_run_summary',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                summary: { type: 'string' },
                riskLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
                keyFindings: { type: 'array', items: { type: 'string' } },
                nextActions: { type: 'array', items: { type: 'string' } },
                confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
              },
              required: ['summary', 'riskLevel', 'keyFindings', 'nextActions', 'confidence'],
            },
          },
        },
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Diagnostic OpenAI HTTP ${response.status}: ${body.slice(0, 500)}`)
    }

    const payload = await response.json() as {
      output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>
      status?: string
    }
    const text = extractOpenAiResponseText(payload)
    if (!text) {
      throw new Error(`Diagnostic OpenAI returned no output text (status: ${payload.status ?? 'unknown'})`)
    }

    return DiagnosticRunSummaryResultSchema.parse(JSON.parse(text))
  }

  private async summarizeWithLocalProvider(
    resolved: { provider: 'ollama' | 'openai_compatible'; model: string; config: StoredLocalAiConfig },
    context: { run: Record<string, unknown>; commands: Array<Record<string, unknown>> },
  ): Promise<z.infer<typeof DiagnosticRunSummaryResultSchema>> {
    if (resolved.provider === 'ollama') {
      const response = await fetch(`${this.localAi.normalizeBaseUrl(resolved.config.localBaseUrl)!}/api/generate`, {
        method: 'POST',
        signal: AbortSignal.timeout(env.SESSION_AUDIT_AI_REQUEST_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          model: resolved.model,
          stream: false,
          format: 'json',
          system: buildDiagnosticInstructions(resolved.config.auditInstructions ?? null),
          prompt: [
            'Analise este diagnostico de host e responda apenas com JSON válido em português do Brasil.',
            JSON.stringify(context),
          ].join('\n\n'),
          options: { temperature: 0.1 },
        }),
      })

      if (!response.ok) {
        const body = await response.text()
        throw new Error(`Diagnostic Ollama HTTP ${response.status}: ${body.slice(0, 500)}`)
      }

      const payload = await response.json() as { response?: string }
      return parseDiagnosticSummary(payload.response?.trim() ?? '', 'Diagnostic Ollama')
    }

    const response = await fetch(`${this.localAi.normalizeBaseUrl(resolved.config.networkBaseUrl)!}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(env.SESSION_AUDIT_AI_REQUEST_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${this.localAi.decryptApiKey(resolved.config)}`,
      },
      body: JSON.stringify({
        model: resolved.model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildDiagnosticInstructions(resolved.config.auditInstructions ?? null) },
          {
            role: 'user',
            content: [
              'Analise este diagnostico de host e responda apenas com JSON válido em português do Brasil.',
              JSON.stringify(context),
            ].join('\n\n'),
          },
        ],
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Diagnostic network AI HTTP ${response.status}: ${body.slice(0, 500)}`)
    }

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    return parseDiagnosticSummary(payload.choices?.[0]?.message?.content?.trim() ?? '', 'Diagnostic network AI')
  }
}

function buildDiagnosticInstructions(auditInstructions?: string | null): string {
  const base = [
    'You analyze host diagnostic command results for operations and troubleshooting review.',
    'Write all natural-language fields in Brazilian Portuguese (pt-BR).',
    'Keep commands, service names, file names, paths, hostnames, addresses, and literals exactly as observed.',
    'Return valid JSON only.',
    'Use this exact shape: {"summary":"...","riskLevel":"low|medium|high","keyFindings":["..."],"nextActions":["..."],"confidence":"low|medium|high"}.',
    'Be concise, factual, and avoid speculation beyond the available evidence.',
    'Focus on failures, degraded services, unusual resource usage, connectivity problems, and actionable next checks.',
    'Use low risk for benign or healthy results, medium for operational attention, and high only for clearly dangerous or critical evidence.',
  ]

  const customInstructions = normalizeAuditInstructions(auditInstructions)
  if (customInstructions) {
    base.push('Additional tenant instructions:')
    base.push(customInstructions)
  }

  return base.join(' ')
}

function normalizeDiagnosticOutputForAi(output: string, exitCode: number | null): string {
  if (!output) return ''

  let normalized = output

  // Profile/login banners can emit stderr noise unrelated to the diagnostic command itself.
  // Keep raw persisted output intact for operators, but remove this known noise from the AI prompt
  // when the command completed successfully.
  if (exitCode === 0) {
    normalized = normalized
      .split('\n')
      .filter((line) => !isIgnorableShellProfileNoise(line))
      .join('\n')
  }

  return normalized.replace(/\n{3,}/g, '\n\n').trim()
}

function isIgnorableShellProfileNoise(line: string): boolean {
  const normalized = line.trim()
  if (!normalized) return false

  return /^\/etc\/profile\.d\/[^:\s]+\.sh: line \d+: \[: .*: integer expression expected$/i.test(normalized)
}

function parseOpenAiConfig(value: string): OpenAiConfigSnapshot {
  try {
    return JSON.parse(value) as OpenAiConfigSnapshot
  } catch {
    return {}
  }
}

function normalizePreference(value: string | null | undefined): DiagnosticAiPreference {
  if (value === 'openai' || value === 'local_ai') return value
  return 'automatic'
}

function normalizeAuditInstructions(value?: string | null): string | null {
  const normalized = value?.trim()
  if (!normalized) return null
  return normalized.slice(0, 4000)
}

function extractOpenAiResponseText(payload: {
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>
}): string | null {
  for (const item of payload.output ?? []) {
    if (item.type !== 'message') continue
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && typeof content.text === 'string') {
        return content.text
      }
    }
  }
  return null
}

function parseDiagnosticSummary(text: string, providerLabel: string): z.infer<typeof DiagnosticRunSummaryResultSchema> {
  if (!text) {
    throw new Error(`${providerLabel} returned no output text`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(extractJsonObject(text))
  } catch {
    throw new Error(`${providerLabel} returned invalid JSON`)
  }

  return DiagnosticRunSummaryResultSchema.parse(normalizeDiagnosticSummary(parsed))
}

function normalizeDiagnosticSummary(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value

  const record = value as Record<string, unknown>
  const nested = firstObject(record.result, record.data, record.output, record.response)

  return {
    ...record,
    ...nested,
    summary: firstString(record.summary, record.message, record.text, nested?.summary, nested?.message, nested?.text) ?? 'Resumo indisponivel',
    riskLevel: normalizeRiskLevel(firstString(record.riskLevel, record.risk_level, record.risk, nested?.riskLevel, nested?.risk_level, nested?.risk)) ?? 'medium',
    keyFindings: normalizeStringArray(record.keyFindings, record.key_findings, record.findings, nested?.keyFindings, nested?.key_findings, nested?.findings),
    nextActions: normalizeStringArray(record.nextActions, record.next_actions, record.actions, record.recommendations, nested?.nextActions, nested?.next_actions, nested?.actions, nested?.recommendations),
    confidence: normalizeRiskLevel(firstString(record.confidence, nested?.confidence)) ?? 'medium',
  }
}

function firstObject(...values: unknown[]): Record<string, unknown> | null {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  }
  return null
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
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
    if (items.length) return items
  }
  return []
}

function normalizeRiskLevel(value: string | undefined): 'low' | 'medium' | 'high' | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') return normalized
  if (['baixo', 'baixa'].includes(normalized)) return 'low'
  if (['medio', 'médio', 'media', 'média'].includes(normalized)) return 'medium'
  if (['alto', 'alta'].includes(normalized)) return 'high'
  return undefined
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fencedMatch?.[1]) return fencedMatch[1].trim()

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)

  return trimmed
}
