import { decrypt } from '../../shared/crypto.js'
import { env } from '../../config/env.js'
import { ForbiddenError } from '../../shared/errors.js'
import type { JwtPayload } from '../../shared/guards.js'
import type { IntegrationRepository } from '../integrations/integration.repository.js'
import type { StoredLocalAiConfig } from '../integrations/local-ai.service.js'
import type { LicenseEntitlementService } from '../license/license-entitlement.service.js'
import type { LocalAiChatResponse, LocalAiStatus } from '@nodeaccess/shared'
import type { LocalAiToolsService } from './local-ai-tools.service.js'
import { OllamaProvider } from './providers/ollama.provider.js'
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider.js'

type ProviderKey = 'ollama' | 'openai_compatible'
type LocalAiChatInput = {
  message: string
  contextRoute?: string | null
  contextScreen?: string | null
  terminalContext?: {
    sessionId?: number | null
    hostId?: number | null
    hostName?: string | null
    hostIp?: string | null
    connectionStatus?: string | null
    selection?: string | null
    recentOutput?: string | null
    bufferTail?: string | null
  } | null
}

export type LocalAiStreamChunk =
  | { type: 'token'; token: string }
  | { type: 'done'; provider: string; mode: string; actionExecutionEnabled: boolean; guardrailMessage: string | null; citations: LocalAiChatResponse['citations'] }

export class LocalAiService {
  constructor(
    private readonly integrations: IntegrationRepository,
    private readonly entitlements: LicenseEntitlementService,
    private readonly tools: LocalAiToolsService,
  ) {}

  async getStatus(user: JwtPayload): Promise<LocalAiStatus> {
    if (!env.FEATURE_LOCAL_AI) {
      return {
        available: false,
        enabled: false,
        mode: null,
        routingPolicy: null,
        localConfigured: false,
        networkConfigured: false,
        effectiveProvider: null,
        actionExecutionEnabled: false,
        guardrailMessage: null,
        message: 'Assistente local desabilitado na instalação',
      }
    }

    const licensed = await this.entitlements.isFeatureEnabled(user.tenantId, 'localAi')
    if (!licensed) {
      return {
        available: false,
        enabled: false,
        mode: null,
        routingPolicy: null,
        localConfigured: false,
        networkConfigured: false,
        effectiveProvider: null,
        actionExecutionEnabled: false,
        guardrailMessage: null,
        message: 'Assistente local não licenciado para este tenant',
      }
    }

    const row = await this.integrations.findByProvider(user.tenantId, 'local_ai')
    const config = this.parseConfig(row?.config)
    const localConfigured = this.isLocalConfigured(config)
    const networkConfigured = this.isNetworkConfigured(config)
    const effectiveProvider = this.resolveProvider(config)
    const mode = config.mode ?? 'read_only'

    return {
      available: row?.enabled === true && effectiveProvider !== null,
      enabled: row?.enabled ?? false,
      mode,
      routingPolicy: config.routingPolicy ?? 'local_only',
      localConfigured,
      networkConfigured,
      effectiveProvider,
      actionExecutionEnabled: false,
      guardrailMessage: mode === 'read_only'
        ? null
        : `O modo ${mode} está registrado como intenção de política, mas a execução de ações ainda não está habilitada nesta versão.`,
      message: row?.enabled
        ? effectiveProvider
          ? null
          : 'Nenhum provider compatível configurado para a política atual'
        : 'Assistente local ainda não habilitado neste tenant',
    }
  }

  async chat(user: JwtPayload, input: LocalAiChatInput): Promise<LocalAiChatResponse> {
    if (!env.FEATURE_LOCAL_AI) {
      throw new ForbiddenError('Assistente local desabilitado na instalação')
    }
    await this.entitlements.requireFeature(user.tenantId, 'localAi', 'Assistente local não licenciado para este tenant')

    const ctx = await this.prepareChatInput(user, input)
    const result = await ctx.provider.chat({ model: ctx.model, systemPrompt: ctx.systemPrompt, userMessage: ctx.message })

    return {
      answer: result.answer,
      provider: ctx.providerKey,
      mode: ctx.mode,
      actionExecutionEnabled: false,
      guardrailMessage: ctx.guardrailMessage,
      citations: ctx.citations,
    }
  }

  async *chatStream(user: JwtPayload, input: LocalAiChatInput): AsyncGenerator<LocalAiStreamChunk> {
    if (!env.FEATURE_LOCAL_AI) {
      throw new ForbiddenError('Assistente local desabilitado na instalação')
    }
    await this.entitlements.requireFeature(user.tenantId, 'localAi', 'Assistente local não licenciado para este tenant')

    const ctx = await this.prepareChatInput(user, input)
    for await (const token of ctx.provider.chatStream({ model: ctx.model, systemPrompt: ctx.systemPrompt, userMessage: ctx.message })) {
      yield { type: 'token', token }
    }
    yield {
      type: 'done',
      provider: ctx.providerKey,
      mode: ctx.mode,
      actionExecutionEnabled: false,
      guardrailMessage: ctx.guardrailMessage,
      citations: ctx.citations,
    }
  }

  private async prepareChatInput(user: JwtPayload, input: LocalAiChatInput) {
    const row = await this.integrations.findByProvider(user.tenantId, 'local_ai')
    if (!row?.enabled) {
      throw new ForbiddenError('Assistente local não habilitado para este tenant')
    }

    const message = input.message.trim()
    const config = this.parseConfig(row.config)
    const providerKey = this.resolveProvider(config)
    if (!providerKey) {
      throw new ForbiddenError('Nenhum provider de IA compatível foi configurado para a política atual')
    }

    const provider = this.instantiateProvider(providerKey, config)
    const explicitHostId = extractHostId(message)
    const explicitSessionId = extractSessionId(message)
    const explicitTicketKey = extractTicketKey(message)
    const explicitGroupName = extractGroupName(message)
    const explicitBastionName = extractBastionName(message)

    const [
      platform,
      matchedHosts,
      recentSessions,
      relatedAudits,
      knowledgeMatches,
      explicitHost,
      explicitSession,
      explicitTicketAudit,
      explicitGroup,
      explicitBastion,
      explicitAudit,
    ] = await Promise.all([
      this.tools.getPlatformSnapshot(user),
      this.tools.searchHosts(user, message, 5),
      this.tools.listRecentSessions(user, 5),
      this.tools.searchSessionAudits(user, message, 3),
      this.tools.searchKnowledgeBase(user, message, 3),
      explicitHostId ? this.tools.getHostSummary(user, explicitHostId) : Promise.resolve(null),
      explicitSessionId ? this.tools.getSessionSummary(user, explicitSessionId) : Promise.resolve(null),
      explicitTicketKey ? this.tools.getTicketAuditSummary(user, explicitTicketKey) : Promise.resolve(null),
      explicitGroupName ? this.tools.getGroupSummary(user, explicitGroupName) : Promise.resolve(null),
      explicitBastionName ? this.tools.getBastionSummary(user, explicitBastionName) : Promise.resolve(null),
      explicitSessionId ? this.tools.getSessionAuditSummary(user, explicitSessionId) : Promise.resolve(null),
    ])

    const terminalContext = normalizeTerminalContext(input.terminalContext ?? null)
    const mode = config.mode ?? 'read_only'

    return {
      providerKey,
      provider,
      model: this.resolveModel(providerKey, config),
      mode,
      message,
      systemPrompt: buildSystemPrompt(
        user,
        mode,
        platform,
        config.assistantInstructions ?? null,
        matchedHosts,
        recentSessions,
        relatedAudits,
        knowledgeMatches,
        explicitHost,
        explicitSession,
        explicitTicketAudit,
        explicitGroup,
        explicitBastion,
        explicitAudit,
        input.contextRoute ?? null,
        input.contextScreen ?? null,
        terminalContext,
      ),
      guardrailMessage: mode === 'read_only'
        ? null
        : `O modo ${mode} está configurado, mas o assistente continua operando sem executar ações.`,
      citations: [
        { kind: 'tenant' as const, label: `Tenant: ${platform.tenantName}` },
        { kind: 'settings' as const, label: `Recursos: ${platform.enabledModules.join(', ') || 'nenhum módulo licenciado'}` },
        { kind: 'hosts' as const, label: `Hosts visíveis: ${platform.visibleHosts}` },
        { kind: 'sessions' as const, label: `Sessões ativas do tenant: ${platform.activeSessions}` },
        ...matchedHosts.slice(0, 3).map((host) => ({
          kind: 'hosts' as const,
          label: `Host encontrado: ${host.name} (${host.ip})${host.groupName ? `, grupo ${host.groupName}` : ''}${host.bastionName ? `, bastion ${host.bastionName}` : ''}`,
        })),
        ...recentSessions.slice(0, 2).map((session) => ({
          kind: 'sessions' as const,
          label: `Sessão recente: ${session.hostName} em ${session.startedAt.toLocaleString()}`,
        })),
        ...relatedAudits.slice(0, 2).map((audit) => ({
          kind: 'sessions' as const,
          label: `Auditoria ${audit.sessionId}: ${audit.hostName} (${audit.status}${audit.riskLevel ? `, risco ${audit.riskLevel}` : ''})`,
        })),
        ...knowledgeMatches.slice(0, 2).map((document) => ({
          kind: 'documents' as const,
          label: `Base de conhecimento: ${document.title}${document.referenceUrl ? ` (${document.referenceUrl})` : ''}`,
        })),
        ...(explicitHost ? [{
          kind: 'hosts' as const,
          label: `Resumo do host ${explicitHost.id}: ${explicitHost.name} (${explicitHost.ip}:${explicitHost.port})`,
        }] : []),
        ...(explicitSession ? [{
          kind: 'sessions' as const,
          label: `Resumo da sessão ${explicitSession.id}: ${explicitSession.hostName} (${explicitSession.active ? 'ativa' : 'encerrada'})`,
        }] : []),
        ...(explicitTicketAudit ? [{
          kind: 'sessions' as const,
          label: `Ticket ${explicitTicketAudit.ticketKey}: sessão ${explicitTicketAudit.sessionId} em ${explicitTicketAudit.hostName}`,
        }] : []),
        ...(explicitGroup ? [{
          kind: 'hosts' as const,
          label: `Grupo ${explicitGroup.name}: ${explicitGroup.visibleHosts.length} host(s) visível(is) no contexto atual`,
        }] : []),
        ...(explicitBastion ? [{
          kind: 'hosts' as const,
          label: `Bastion ${explicitBastion.name}: ${explicitBastion.visibleHosts.length} host(s) visível(is) usando este bastion`,
        }] : []),
        ...(explicitAudit ? [{
          kind: 'sessions' as const,
          label: `Resumo da auditoria ${explicitAudit.sessionId}: ${explicitAudit.summary ?? 'sem resumo de IA disponível'}`,
        }] : []),
        ...(terminalContext ? [{
          kind: 'sessions' as const,
          label: `Terminal atual${terminalContext.hostName ? `: ${terminalContext.hostName}` : ''}${terminalContext.sessionId ? `, sessão ${terminalContext.sessionId}` : ''}${terminalContext.connectionStatus ? `, status ${terminalContext.connectionStatus}` : ''}`,
        }] : []),
      ] satisfies LocalAiChatResponse['citations'],
    }
  }

  private parseConfig(raw: string | null | undefined): StoredLocalAiConfig {
    if (!raw) return {}
    try {
      return JSON.parse(raw) as StoredLocalAiConfig
    } catch {
      return {}
    }
  }

  private isLocalConfigured(config: StoredLocalAiConfig): boolean {
    return !!(config.localProvider && config.localBaseUrl && config.localModel)
  }

  private isNetworkConfigured(config: StoredLocalAiConfig): boolean {
    return !!(config.networkProvider && config.networkBaseUrl && config.networkModel && config.networkApiKeyEncrypted && config.networkApiKeyIv)
  }

  private resolveProvider(config: StoredLocalAiConfig): ProviderKey | null {
    const local = this.isLocalConfigured(config)
    const network = this.isNetworkConfigured(config)
    switch (config.routingPolicy ?? 'local_only') {
      case 'local_only':
        return local ? 'ollama' : null
      case 'network_only':
        return network ? 'openai_compatible' : null
      case 'prefer_local':
        return local ? 'ollama' : network ? 'openai_compatible' : null
      case 'prefer_network':
        return network ? 'openai_compatible' : local ? 'ollama' : null
      default:
        return null
    }
  }

  private instantiateProvider(providerKey: ProviderKey, config: StoredLocalAiConfig) {
    if (providerKey === 'ollama') {
      return new OllamaProvider(config.localBaseUrl!)
    }

    return new OpenAiCompatibleProvider(
      config.networkBaseUrl!,
      decrypt({
        encrypted: config.networkApiKeyEncrypted!,
        iv: config.networkApiKeyIv!,
      }),
    )
  }

  private resolveModel(providerKey: ProviderKey, config: StoredLocalAiConfig): string {
    return providerKey === 'ollama'
      ? (config.localModel ?? 'qwen2.5-coder')
      : (config.networkModel ?? 'gpt-5-mini')
  }

}

type NormalizedTerminalContext = {
  sessionId: number | null
  hostId: number | null
  hostName: string | null
  hostIp: string | null
  connectionStatus: string | null
  selection: string | null
  recentOutput: string | null
  bufferTail: string | null
}

function buildSystemPrompt(user: JwtPayload, mode: 'read_only' | 'low_impact' | 'full_control', context: {
  tenantName: string
  enabledModules: string[]
  visibleHosts: number
  activeSessions: number
}, assistantInstructions: string | null, matchedHosts: Array<{ id: number; name: string; ip: string; scope: string; groupName: string | null; bastionName: string | null }>, recentSessions: Array<{ id: number; hostName: string; hostIp: string; startedAt: Date; active: boolean }>, relatedAudits: Array<{ sessionId: number; hostName: string; hostIp: string; startedAt: Date; status: string; riskLevel: string | null; summary: string | null }>, knowledgeMatches: Array<{ id: number; title: string; sourceType: 'TEXT' | 'LINK' | 'FILE'; referenceUrl: string | null; excerpt: string | null }>, explicitHost: { id: number; name: string; ip: string; port: number; sshUser: string; scope: string; connectionMode: string; bastionName: string | null; groupName: string | null; recentSessions: Array<{ id: number; startedAt: Date; active: boolean; userName: string }> } | null, explicitSession: { id: number; hostName: string; hostIp: string; startedAt: Date; endedAt: Date | null; active: boolean; userName: string } | null, explicitTicketAudit: { sessionId: number; hostName: string; hostIp: string; startedAt: Date; endedAt: Date | null; status: string; riskLevel: string | null; summary: string | null; ticketProvider: string | null; ticketKey: string | null } | null, explicitGroup: { id: number; name: string; description: string | null; bastionName: string | null; visibleHosts: Array<{ id: number; name: string; ip: string; scope: string }> } | null, explicitBastion: { id: number; name: string; ip: string; port: number; sshUser: string; visibleHosts: Array<{ id: number; name: string; ip: string; scope: string; groupName: string | null }>; relatedGroups: string[] } | null, explicitAudit: { sessionId: number; hostName: string; hostIp: string; startedAt: Date; endedAt: Date | null; status: string; riskLevel: string | null; summary: string | null } | null, contextRoute: string | null, contextScreen: string | null, terminalContext: NormalizedTerminalContext | null): string {
  return ([
    'Você é o Assistente local do NodeAccess.',
    'Atue como assistente global da plataforma, ajudando o usuário a entender recursos, módulos e contexto operacional do tenant.',
    'Responda sempre em português do Brasil.',
    'Quando houver contexto explícito do terminal, trate-o como a principal evidência da resposta.',
    'Preserve comandos, caminhos, serviços, arquivos e saídas relevantes literalmente quando isso for útil.',
    'Não invente execução, resultado ou mudança que não esteja sustentado pelo contexto fornecido.',
    `Modo configurado para o assistente: ${mode}.`,
    'Nesta versão, mesmo quando o modo configurado é low_impact ou full_control, a execução de ações ainda não está habilitada.',
    'Você está operando somente em leitura. Não afirme que executou ações em hosts, alterou dados, abriu sessões ou aplicou mudanças.',
    'Se não souber algo com base no contexto fornecido, diga isso claramente.',
    contextScreen ? `Tela atual do usuário: ${contextScreen}.` : null,
    contextRoute ? `Rota atual do usuário: ${contextRoute}.` : null,
    terminalContext
      ? `Contexto explícito do terminal atual: ${describeTerminalContext(terminalContext)}.`
      : null,
    `Tenant atual: ${context.tenantName}.`,
    `Papel do usuário: ${user.role}.`,
    `Módulos licenciados/ativos conhecidos: ${context.enabledModules.join(', ') || 'nenhum módulo específico informado'}.`,
    `Hosts visíveis para o usuário: ${context.visibleHosts}.`,
    `Sessões ativas no tenant: ${context.activeSessions}.`,
    matchedHosts.length > 0
      ? `Hosts encontrados para a consulta atual: ${matchedHosts.map((host) => `${host.name} (${host.ip})${host.groupName ? `, grupo ${host.groupName}` : ''}${host.bastionName ? `, bastion ${host.bastionName}` : ''}`).join('; ')}.`
      : null,
    recentSessions.length > 0
      ? `Sessões recentes visíveis: ${recentSessions.map((session) => `${session.hostName} (${session.hostIp}) em ${session.startedAt.toISOString()}`).join('; ')}.`
      : null,
    relatedAudits.length > 0
      ? `Auditorias relacionadas à consulta: ${relatedAudits.map((audit) => `sessão ${audit.sessionId} em ${audit.hostName} com status ${audit.status}${audit.riskLevel ? ` e risco ${audit.riskLevel}` : ''}`).join('; ')}.`
      : null,
    knowledgeMatches.length > 0
      ? `Documentos da base de conhecimento relacionados: ${knowledgeMatches.map((document) => `${document.title}${document.excerpt ? ` — trecho: ${document.excerpt}` : ''}`).join('; ')}.`
      : null,
    explicitHost
      ? `Host explicitamente solicitado: ID ${explicitHost.id}, nome ${explicitHost.name}, IP ${explicitHost.ip}, porta ${explicitHost.port}, usuário SSH ${explicitHost.sshUser}, escopo ${explicitHost.scope}, modo de conexão ${explicitHost.connectionMode}${explicitHost.groupName ? `, grupo ${explicitHost.groupName}` : ''}${explicitHost.bastionName ? `, bastion ${explicitHost.bastionName}` : ''}. Últimas sessões visíveis neste host: ${explicitHost.recentSessions.length > 0 ? explicitHost.recentSessions.map((session) => `sessão ${session.id} por ${session.userName} em ${session.startedAt.toISOString()} (${session.active ? 'ativa' : 'encerrada'})`).join('; ') : 'nenhuma sessão recente visível'}.`
      : null,
    explicitSession
      ? `Sessão explicitamente solicitada: ID ${explicitSession.id}, host ${explicitSession.hostName} (${explicitSession.hostIp}), usuário ${explicitSession.userName}, iniciada em ${explicitSession.startedAt.toISOString()}, estado ${explicitSession.active ? 'ativa' : 'encerrada'}.`
      : null,
    explicitTicketAudit
      ? `Ticket explicitamente solicitado: ${explicitTicketAudit.ticketKey}, provider ${explicitTicketAudit.ticketProvider ?? 'desconhecido'}, vinculado à sessão ${explicitTicketAudit.sessionId} em ${explicitTicketAudit.hostName}, status ${explicitTicketAudit.status}${explicitTicketAudit.riskLevel ? `, risco ${explicitTicketAudit.riskLevel}` : ''}.`
      : null,
    explicitGroup
      ? `Grupo explicitamente solicitado: ID ${explicitGroup.id}, nome ${explicitGroup.name}${explicitGroup.bastionName ? `, bastion padrão ${explicitGroup.bastionName}` : ''}${explicitGroup.description ? `, descrição: ${explicitGroup.description}` : ''}. Hosts visíveis neste grupo: ${explicitGroup.visibleHosts.length > 0 ? explicitGroup.visibleHosts.map((host) => `${host.name} (${host.ip})`).join('; ') : 'nenhum host visível encontrado'}.`
      : null,
    explicitBastion
      ? `Bastion explicitamente solicitado: ID ${explicitBastion.id}, nome ${explicitBastion.name}, IP ${explicitBastion.ip}, porta ${explicitBastion.port}, usuário SSH ${explicitBastion.sshUser}. Hosts visíveis usando este bastion: ${explicitBastion.visibleHosts.length > 0 ? explicitBastion.visibleHosts.map((host) => `${host.name} (${host.ip})${host.groupName ? `, grupo ${host.groupName}` : ''}`).join('; ') : 'nenhum host visível encontrado'}. Grupos relacionados: ${explicitBastion.relatedGroups.join('; ') || 'nenhum grupo relacionado encontrado'}.`
      : null,
    explicitAudit
      ? `Detalhe da auditoria solicitada: sessão ${explicitAudit.sessionId} em ${explicitAudit.hostName} (${explicitAudit.hostIp}), status ${explicitAudit.status}, resumo: ${explicitAudit.summary ?? 'sem resumo de IA disponível'}.`
      : null,
    assistantInstructions
      ? `Instruções adicionais do tenant para o assistente: ${assistantInstructions}.`
      : null,
  ] as (string | null)[]).filter(Boolean).join(' ')
}

function normalizeTerminalContext(input: LocalAiChatInput['terminalContext']): NormalizedTerminalContext | null {
  if (!input) return null

  const normalized: NormalizedTerminalContext = {
    sessionId: Number.isInteger(input.sessionId) && (input.sessionId ?? 0) > 0 ? input.sessionId ?? null : null,
    hostId: Number.isInteger(input.hostId) && (input.hostId ?? 0) > 0 ? input.hostId ?? null : null,
    hostName: normalizeShortText(input.hostName ?? null, 200),
    hostIp: normalizeShortText(input.hostIp ?? null, 120),
    connectionStatus: normalizeShortText(input.connectionStatus ?? null, 50),
    selection: normalizeTerminalText(input.selection ?? null, 8_000),
    recentOutput: normalizeTerminalText(input.recentOutput ?? null, 12_000),
    bufferTail: normalizeTerminalText(input.bufferTail ?? null, 4_000),
  }

  if (!normalized.sessionId && !normalized.hostId && !normalized.hostName && !normalized.hostIp && !normalized.selection && !normalized.recentOutput && !normalized.bufferTail) {
    return null
  }

  return normalized
}

function normalizeShortText(value: string | null, maxLength: number): string | null {
  if (!value) return null
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, maxLength) : null
}

function normalizeTerminalText(value: string | null, maxLength: number): string | null {
  if (!value) return null
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!normalized) return null
  return normalized.length <= maxLength ? normalized : normalized.slice(-maxLength)
}

function describeTerminalContext(context: NormalizedTerminalContext): string {
  const parts: string[] = []
  if (context.sessionId) parts.push(`sessão ${context.sessionId}`)
  if (context.hostName || context.hostIp) parts.push(`host ${context.hostName ?? 'desconhecido'}${context.hostIp ? ` (${context.hostIp})` : ''}`)
  if (context.connectionStatus) parts.push(`status ${context.connectionStatus}`)
  if (context.selection) parts.push(`seleção atual (${context.selection.length} caracteres): ${context.selection}`)
  if (context.recentOutput) parts.push(`saída recente (${context.recentOutput.length} caracteres): ${context.recentOutput}`)
  if (context.bufferTail) parts.push(`buffer recente (${context.bufferTail.length} caracteres): ${context.bufferTail}`)
  return parts.join('. ')
}

function extractHostId(message: string): number | null {
  const match = message.match(/\bhost\s+#?(\d{1,10})\b/i)
  if (!match) return null
  const value = Number.parseInt(match[1] ?? '', 10)
  return Number.isInteger(value) && value > 0 ? value : null
}

function extractSessionId(message: string): number | null {
  const match = message.match(/\b(?:sess[aã]o|session|auditoria)\s+#?(\d{1,10})\b/i) ?? message.match(/\b#(\d{1,10})\b/)
  if (!match) return null
  const value = Number.parseInt(match[1] ?? '', 10)
  return Number.isInteger(value) && value > 0 ? value : null
}

function extractTicketKey(message: string): string | null {
  const match = message.match(/\b([A-Z][A-Z0-9]{1,19}-\d{1,10})\b/i)
  if (!match) return null
  return (match[1] ?? '').toUpperCase()
}

function extractGroupName(message: string): string | null {
  const match = message.match(/\bgrupo\s+["']?([^"'?.!,\n]+)["']?/i)
  const value = (match?.[1] ?? '').trim()
  return value.length >= 2 ? value : null
}

function extractBastionName(message: string): string | null {
  const match = message.match(/\bbastion\s+["']?([^"'?.!,\n]+)["']?/i)
  const value = (match?.[1] ?? '').trim()
  return value.length >= 2 ? value : null
}
