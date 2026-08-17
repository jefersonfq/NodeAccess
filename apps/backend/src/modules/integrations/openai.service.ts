import { z } from 'zod'
import { env } from '../../config/env.js'
import { encrypt, decrypt } from '../../shared/crypto.js'

type SessionAuditAiPromptTemplate = 'summary-v1' | 'cab-v1' | 'risk-v1'

interface StoredOpenAiConfig {
  apiKeyEncrypted?: string
  apiKeyIv?: string
  baseUrl?: string
  defaultModel?: string
  auditInstructions?: string
  healthStatus?: 'unknown' | 'healthy' | 'unhealthy'
  healthMessage?: string | null
  lastCheckedAt?: string | null
}

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

interface SessionAuditSummaryInput {
  apiKey: string
  baseUrl?: string | null
  model: string
  template: SessionAuditAiPromptTemplate
  auditInstructions?: string | null
  sessionContext: {
    session: Record<string, unknown>
    commands: Array<Record<string, unknown>>
    preview: Array<Record<string, unknown>>
  }
}

export class OpenAiIntegrationService {
  private readonly defaultBaseUrl = 'https://api.openai.com/v1'

  encryptApiKey(apiKey: string): { encrypted: string; iv: string } {
    return encrypt(apiKey)
  }

  decryptApiKey(config: StoredOpenAiConfig): string {
    if (!config.apiKeyEncrypted || !config.apiKeyIv) {
      throw new Error('API key da integração OpenAI não configurada')
    }
    return decrypt({ encrypted: config.apiKeyEncrypted, iv: config.apiKeyIv })
  }

  normalizeBaseUrl(value?: string | null): string {
    if (!value) return this.defaultBaseUrl
    return value.replace(/\/+$/, '')
  }

  async testConnection(input: {
    apiKey: string
    baseUrl?: string | null
    defaultModel?: string | null
  }): Promise<{ ok: boolean; healthStatus: 'healthy' | 'unhealthy'; healthMessage: string | null }> {
    const baseUrl = this.normalizeBaseUrl(input.baseUrl)
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
      },
    })

    if (!response.ok) {
      const body = await response.text()
      return {
        ok: false,
        healthStatus: 'unhealthy',
        healthMessage: `HTTP ${response.status}: ${body.slice(0, 200)}`,
      }
    }

    if (input.defaultModel) {
      const data = await response.json() as { data?: Array<{ id?: string }> }
      const hasModel = (data.data ?? []).some((item) => item.id === input.defaultModel)
      if (!hasModel) {
        return {
          ok: false,
          healthStatus: 'unhealthy',
          healthMessage: `Modelo padrão não encontrado: ${input.defaultModel}`,
        }
      }
    }

    return {
      ok: true,
      healthStatus: 'healthy',
      healthMessage: null,
    }
  }

  async summarizeSessionAudit(input: SessionAuditSummaryInput): Promise<z.infer<typeof SessionAuditSummaryResultSchema>> {
    const baseUrl = this.normalizeBaseUrl(input.baseUrl)
    const instructions = buildSummaryInstructions(input.template, input.auditInstructions)
    const response = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      signal: AbortSignal.timeout(env.SESSION_AUDIT_AI_REQUEST_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        instructions,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: [
                  'Analise este contexto de auditoria SSH e produza um resumo JSON em português do Brasil.',
                  JSON.stringify(input.sessionContext),
                ].join('\n\n'),
              },
            ],
          },
        ],
        max_output_tokens: 1200,
        text: {
          format: {
            type: 'json_schema',
            name: 'session_audit_summary',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                summary: { type: 'string' },
                riskLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
                keyFindings: {
                  type: 'array',
                  items: { type: 'string' },
                },
                nextActions: {
                  type: 'array',
                  items: { type: 'string' },
                },
                confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
                observedFacts: { type: 'array', items: { type: 'string' } },
                hypotheses: { type: 'array', items: { type: 'string' } },
                evidenceCommandIndexes: { type: 'array', items: { type: 'integer', minimum: 1 } },
              },
              required: ['summary', 'riskLevel', 'keyFindings', 'nextActions', 'confidence', 'observedFacts', 'hypotheses', 'evidenceCommandIndexes'],
            },
          },
        },
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`OpenAI summary HTTP ${response.status}: ${body.slice(0, 500)}`)
    }

    const payload = await response.json() as OpenAiResponsesCreateResponse
    const text = extractResponseText(payload)
    if (!text) {
      throw new Error(`OpenAI summary returned no output text (status: ${payload.status ?? 'unknown'})`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('OpenAI summary returned invalid JSON')
    }

    return SessionAuditSummaryResultSchema.parse(parsed)
  }
}

export type { StoredOpenAiConfig }

interface OpenAiResponsesCreateResponse {
  status?: string
  output?: Array<{
    type?: string
    content?: Array<{
      type?: string
      text?: string
    }>
  }>
}

function extractResponseText(payload: OpenAiResponsesCreateResponse): string | null {
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

function buildSummaryInstructions(template: SessionAuditAiPromptTemplate, auditInstructions?: string | null): string {
  const base = [
    'You analyze SSH audited sessions for security and operations review.',
    'Write all natural-language fields in Brazilian Portuguese (pt-BR).',
    'Keep commands, service names, file names, paths, hostnames, and literals exactly as observed.',
    'Return valid JSON that matches the provided schema.',
    'Prefer the fields "riskSignals", "commandHighlights", and "commands" over raw preview noise when forming the summary.',
    'Prioritize criticalEvents, service state changes, destructive file operations, and final observed system state.',
    'Mention concrete commands and affected services/files when evidence exists.',
    'Be concise, factual, and avoid speculation beyond the available session evidence.',
    'Separate directly observed statements into observedFacts and uncertain interpretations into hypotheses. evidenceCommandIndexes must contain only indexes present in the supplied commands.',
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
