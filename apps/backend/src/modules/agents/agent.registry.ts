// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WebSocket = any
import { EventEmitter } from 'node:events'
import { isIP } from 'node:net'
import { logger } from '../../config/logger.js'
import { AgentBridgeStream } from './agent-bridge-stream.js'

// ---------------------------------------------------------------------------
// Frame format (binary):
//   [16 bytes: connectionId UTF-8 padded] + [N bytes: payload]
//
// Control messages are JSON text frames (não binário).
// ---------------------------------------------------------------------------

const CONN_ID_LEN = 36 // UUID length

export interface ActiveAgent {
  agentId:     number
  userId:      number
  tenantId:    number
  name:        string
  agentType:   'PROXY_AGENT' | 'PRIVATE_ACCESS_CONNECTOR'
  agentMode:   'USER_BOUND' | 'SERVICE_BOUND'
  isDefault:   boolean
  ws:          WebSocket
  connectedAt: Date
  version?:    string
  hostname?:   string
  platform?:   string
  arch?:       string
  remoteIp?:   string
  privateAccess?: {
    siteName?: string | null
    environment?: string | null
    allowedCidrs?: string[]
    allowedHostnames?: string[]
    allowedPorts?: number[]
    allowedHostTags?: string[]
    allowFallback?: boolean
  } | null
}

export interface OfflineInfo {
  reason: string
  at:     Date
}

export type AgentRouteSource = 'user' | 'tenant'
export type AgentConnectionMode = 'DIRECT' | 'AGENT' | 'AGENT_USER' | 'AGENT_TENANT_FALLBACK' | 'PRIVATE_ACCESS_CONNECTOR' | 'AUTO'

export interface ResolvedAgentRoute {
  agent: ActiveAgent
  source: AgentRouteSource
}

interface BridgeEntry {
  agentId: number
  stream: AgentBridgeStream
}

// Resolve callbacks aguardando confirmação de conexão TCP remota
type ResolveCallback = (err?: string) => void

// ---------------------------------------------------------------------------
// AgentRegistry — singleton compartilhado entre gateway e SSH gateway
// ---------------------------------------------------------------------------

class AgentRegistry extends EventEmitter {
  // userId → ActiveAgent
  private byUser           = new Map<number, ActiveAgent>()
  // tenantId → ActiveAgent (isDefault SERVICE_BOUND tem prioridade; fallback = último registrado)
  private byTenant         = new Map<number, ActiveAgent>()
  // tenantId → ActiveAgent isDefault SERVICE_BOUND
  private byTenantDefault  = new Map<number, ActiveAgent>()
  // tenantId → private access connectors SERVICE_BOUND
  private privateAccessByTenant = new Map<number, ActiveAgent[]>()
  // agentId → último motivo de desconexão (memória)
  private offlineReasons   = new Map<number, OfflineInfo>()
  // connectionId → resolve callback (aguardando 'connected' | 'error' do agente)
  private pending  = new Map<string, ResolveCallback>()
  // connectionId → stream local (lado NodeAccess da ponte)
  private sockets  = new Map<string, BridgeEntry>()

  // ── Registro ────────────────────────────────────────────────────────────────

  register(agent: ActiveAgent): void {
    if (agent.agentType === 'PROXY_AGENT' && agent.agentMode === 'USER_BOUND') {
      this.byUser.set(agent.userId, agent)
    }
    // SERVICE_BOUND isDefault → slot dedicado; demais → só se não houver um isDefault ocupando
    if (agent.agentType === 'PROXY_AGENT' && agent.agentMode === 'SERVICE_BOUND' && agent.isDefault) {
      this.byTenantDefault.set(agent.tenantId, agent)
    }
    if (agent.agentType === 'PROXY_AGENT' && agent.agentMode === 'SERVICE_BOUND' && !this.byTenantDefault.has(agent.tenantId)) {
      this.byTenant.set(agent.tenantId, agent)
    }
    if (agent.agentType === 'PRIVATE_ACCESS_CONNECTOR' && agent.agentMode === 'SERVICE_BOUND') {
      const connectors = this.privateAccessByTenant.get(agent.tenantId) ?? []
      this.privateAccessByTenant.set(agent.tenantId, [agent, ...connectors.filter((item) => item.agentId !== agent.agentId)])
    }
    logger.info({ agentId: agent.agentId, name: agent.name, userId: agent.userId, agentType: agent.agentType, agentMode: agent.agentMode, isDefault: agent.isDefault }, 'Agent registrado')

    agent.ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        this.handleBinary(data)
      } else {
        try { this.handleControl(JSON.parse(data.toString())) } catch { /* ignore */ }
      }
    })

    agent.ws.on('close', (code: number) => this.unregister(agent, `ws closed (${code})`))
    agent.ws.on('error', (err: Error) => this.unregister(agent, err.message))
  }

  unregister(agent: ActiveAgent, reason = 'disconnected'): void {
    if (this.byUser.get(agent.userId) === agent) this.byUser.delete(agent.userId)
    if (this.byTenant.get(agent.tenantId) === agent) this.byTenant.delete(agent.tenantId)
    if (this.byTenantDefault.get(agent.tenantId) === agent) this.byTenantDefault.delete(agent.tenantId)
    const privateConnectors = this.privateAccessByTenant.get(agent.tenantId)
    if (privateConnectors) {
      const next = privateConnectors.filter((item) => item !== agent)
      if (next.length > 0) this.privateAccessByTenant.set(agent.tenantId, next)
      else this.privateAccessByTenant.delete(agent.tenantId)
    }
    this.offlineReasons.set(agent.agentId, { reason, at: new Date() })
    // Fechar apenas as pontes desse agente
    this.sockets.forEach((entry, connectionId) => {
      if (entry.agentId !== agent.agentId) return
      entry.stream.remoteError('Agente desconectado')
      this.sockets.delete(connectionId)
    })
    logger.info({ agentId: agent.agentId, name: agent.name, reason }, 'Agent desconectado')
  }

  // ── Lookup ──────────────────────────────────────────────────────────────────

  getForUser(userId: number): ActiveAgent | undefined {
    return this.byUser.get(userId)
  }

  getForTenant(tenantId: number): ActiveAgent | undefined {
    return this.byTenantDefault.get(tenantId) ?? this.byTenant.get(tenantId)
  }

  getPrivateAccessForTenant(tenantId: number): ActiveAgent | undefined {
    return this.privateAccessByTenant.get(tenantId)?.[0]
  }

  getLastOfflineReason(agentId: number): OfflineInfo | undefined {
    return this.offlineReasons.get(agentId)
  }

  resolveForConnectionMode(mode: AgentConnectionMode, userId: number, tenantId: number): ResolvedAgentRoute | null {
    if (mode === 'DIRECT') return null
    if (mode === 'PRIVATE_ACCESS_CONNECTOR') return null

    const userAgent = this.getForUser(userId)
    if (userAgent) {
      return { agent: userAgent, source: 'user' }
    }

    if (mode === 'AGENT_USER') return null

    const tenantAgent = this.getForTenant(tenantId)
    if (tenantAgent) {
      return { agent: tenantAgent, source: 'tenant' }
    }

    return null
  }

  resolvePrivateAccessConnector(tenantId: number, host: string, port: number, preferredAgentId?: number | null): ResolvedAgentRoute | null {
    const connectors = this.privateAccessByTenant.get(tenantId) ?? []
    const candidates = preferredAgentId
      ? connectors.filter((agent) => agent.agentId === preferredAgentId)
      : connectors
    const connector = candidates.find((agent) => isPrivateAccessAllowed(agent, host, port))
    return connector ? { agent: connector, source: 'tenant' } : null
  }

  describePrivateAccessResolution(tenantId: number, host: string, port: number, preferredAgentId?: number | null): { message: string; errorCode: string } {
    const connectors = this.privateAccessByTenant.get(tenantId) ?? []
    if (connectors.length === 0) {
      return {
        message: 'Este host exige um conector de acesso privado, mas nenhum conector privado está online neste gateway',
        errorCode: 'PRIVATE_ACCESS_CONNECTOR_OFFLINE',
      }
    }

    const candidates = preferredAgentId
      ? connectors.filter((agent) => agent.agentId === preferredAgentId)
      : connectors

    if (preferredAgentId && candidates.length === 0) {
      return {
        message: 'O conector de acesso privado selecionado para este host não está online neste gateway',
        errorCode: 'PRIVATE_ACCESS_CONNECTOR_OFFLINE',
      }
    }

    const portAllowed = candidates.some((agent) => isPrivateAccessPortAllowed(agent, port))
    if (!portAllowed) {
      return {
        message: `Nenhum conector de acesso privado online permite a porta ${port}`,
        errorCode: 'PRIVATE_ACCESS_PORT_NOT_ALLOWED',
      }
    }

    return {
      message: `Nenhum conector de acesso privado online possui escopo para ${host}:${port}`,
      errorCode: 'PRIVATE_ACCESS_SCOPE_MISMATCH',
    }
  }

  isOnline(agentId: number): boolean {
    for (const a of this.byUser.values()) {
      if (a.agentId === agentId) return true
    }
    return false
  }

  getActiveById(agentId: number): ActiveAgent | undefined {
    for (const a of this.byUser.values()) {
      if (a.agentId === agentId) return a
    }
    for (const a of this.byTenant.values()) {
      if (a.agentId === agentId) return a
    }
    for (const a of this.byTenantDefault.values()) {
      if (a.agentId === agentId) return a
    }
    for (const connectors of this.privateAccessByTenant.values()) {
      for (const a of connectors) {
        if (a.agentId === agentId) return a
      }
    }
    return undefined
  }

  disconnectById(agentId: number, reason = 'agent revoked'): boolean {
    const agent = this.getActiveById(agentId)
    if (!agent) return false

    this.unregister(agent, reason)
    try {
      if (agent.ws.readyState === agent.ws.OPEN) {
        agent.ws.send(JSON.stringify({ type: 'error', message: reason }))
      }
      agent.ws.close(1008, reason)
    } catch {
      // best-effort: unregister already removed active routes and bridges.
    }
    return true
  }

  // ── Criar conexão TCP via agente ────────────────────────────────────────────

  /**
   * Solicita ao agente que conecte TCP em host:port.
   * Retorna um stream local que faz relay bidirecional pelo WebSocket do agente.
   */
  createConnection(agent: ActiveAgent, connectionId: string, host: string, port: number): Promise<AgentBridgeStream> {
    return new Promise((resolve, reject) => {
      const closeRemote = () => {
        if (agent.ws.readyState === agent.ws.OPEN) {
          agent.ws.send(JSON.stringify({ type: 'close', connectionId }))
        }
      }
      const local = new AgentBridgeStream(
        (chunk) => {
          if (agent.ws.readyState !== agent.ws.OPEN) {
            throw new Error('Agente offline')
          }
          agent.ws.send(buildFrame(connectionId, chunk))
        },
        () => {
          this.sockets.delete(connectionId)
          closeRemote()
        },
      )
      this.sockets.set(connectionId, { agentId: agent.agentId, stream: local })

      // Timeout de 15s para o agente confirmar conexão
      const timeout = setTimeout(() => {
        this.pending.delete(connectionId)
        this.sockets.delete(connectionId)
        closeRemote()
        local.remoteError(`Agent timeout conectando ${host}:${port}`)
        reject(new Error(`Agent timeout conectando ${host}:${port}`))
      }, 15_000)

      // Registrar callback de resolve
      this.pending.set(connectionId, (err?: string) => {
        clearTimeout(timeout)
        this.pending.delete(connectionId)
        if (err) {
          this.sockets.delete(connectionId)
          local.remoteError(err)
          reject(new Error(err))
          return
        }
        logger.info({ agentId: agent.agentId, connectionId, host, port }, 'Ponte TCP via agente confirmada')
        resolve(local)
      })

      // Solicitar conexão ao agente
      logger.info({ agentId: agent.agentId, connectionId, host, port }, 'Solicitando TCP via agente')
      agent.ws.send(JSON.stringify({ type: 'connect', connectionId, host, port }))
    })
  }

  // ── Handlers internos ────────────────────────────────────────────────────────

  private handleControl(msg: { type: string; connectionId?: string; message?: string }): void {
    if (msg.type === 'connected' && msg.connectionId) {
      this.pending.get(msg.connectionId)?.()
    } else if (msg.type === 'error' && msg.connectionId) {
      const pending = this.pending.get(msg.connectionId)
      if (pending) {
        pending(msg.message ?? 'Erro desconhecido')
        return
      }
      this.sockets.get(msg.connectionId)?.stream.remoteError(msg.message ?? 'Erro desconhecido')
      this.sockets.delete(msg.connectionId)
    } else if (msg.type === 'close' && msg.connectionId) {
      this.sockets.get(msg.connectionId)?.stream.remoteClose()
      this.sockets.delete(msg.connectionId)
    }
  }

  private handleBinary(data: Buffer): void {
    if (data.length < CONN_ID_LEN) return
    const connectionId = data.subarray(0, CONN_ID_LEN).toString('utf8').trim()
    const payload      = data.subarray(CONN_ID_LEN)
    const bridge = this.sockets.get(connectionId)?.stream
    if (bridge && !bridge.destroyed) bridge.pushInbound(payload)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildFrame(connectionId: string, payload: Buffer): Buffer {
  // Pad connectionId to CONN_ID_LEN bytes
  const id = Buffer.alloc(CONN_ID_LEN, ' ')
  id.write(connectionId, 'utf8')
  return Buffer.concat([id, payload])
}

function isPrivateAccessAllowed(agent: ActiveAgent, host: string, port: number): boolean {
  if (agent.agentType !== 'PRIVATE_ACCESS_CONNECTOR') return false
  const scope = agent.privateAccess
  if (!scope) return false

  if (!isPrivateAccessPortAllowed(agent, port)) return false

  const normalizedHost = host.trim().toLowerCase()
  const allowedHostnames = (scope.allowedHostnames ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean)
  if (allowedHostnames.length > 0 && allowedHostnames.includes(normalizedHost)) return true

  const allowedCidrs = scope.allowedCidrs ?? []
  if (allowedCidrs.length === 0 && allowedHostnames.length === 0) return true
  return allowedCidrs.some((cidr) => isIpv4InCidr(normalizedHost, cidr))
}

function isPrivateAccessPortAllowed(agent: ActiveAgent, port: number): boolean {
  if (agent.agentType !== 'PRIVATE_ACCESS_CONNECTOR') return false
  const allowedPorts = agent.privateAccess?.allowedPorts ?? []
  return allowedPorts.length === 0 || allowedPorts.includes(port)
}

function isIpv4InCidr(host: string, cidr: string): boolean {
  if (isIP(host) !== 4) return false
  const [range, prefixText] = cidr.split('/')
  if (!range || isIP(range) !== 4) return false
  const prefix = prefixText === undefined ? 32 : Number(prefixText)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (ipv4ToNumber(host) & mask) === (ipv4ToNumber(range) & mask)
}

function ipv4ToNumber(value: string): number {
  return value
    .split('.')
    .reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0)
}

// Exportar instância singleton
export const agentRegistry = new AgentRegistry()
