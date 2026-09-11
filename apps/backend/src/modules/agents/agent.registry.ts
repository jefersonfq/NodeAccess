import { agentAccessDenied, type AgentAccessRequest, type AgentAccessService } from './agent-access.service.js'
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
  credentialHash?: string
  agentId:     number
  userId:      number
  tenantId:    number
  name:        string
  agentType:   'PROXY_AGENT' | 'PRIVATE_ACCESS_CONNECTOR'
  agentMode:   'USER_BOUND' | 'SERVICE_BOUND'
  isDefault:   boolean
  poolName?:   string | null
  priority?:   number
  ws:          WebSocket
  connectedAt: Date
  version?:    string
  hostname?:   string
  platform?:   string
  arch?:       string
  remoteIp?:   string
  tlsMode?:    'verified' | 'insecure'
  lastPongAt?: Date
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
  agent: ActiveAgent
  agentId: number
  stream: AgentBridgeStream
}

// Resolve callbacks aguardando confirmação de conexão TCP remota
type ResolveCallback = (err?: string) => void

// ---------------------------------------------------------------------------
// AgentRegistry — singleton compartilhado entre gateway e SSH gateway
// ---------------------------------------------------------------------------

export class AgentRegistry extends EventEmitter {
  // userId → ActiveAgent
  private byUser           = new Map<number, ActiveAgent>()
  // tenantId → ActiveAgent (isDefault SERVICE_BOUND tem prioridade; fallback = último registrado)
  private byTenant         = new Map<number, ActiveAgent>()
  // tenantId → ActiveAgent isDefault SERVICE_BOUND
  private byTenantDefault  = new Map<number, ActiveAgent>()
  private serviceByTenant  = new Map<number, ActiveAgent[]>()
  // tenantId → private access connectors SERVICE_BOUND
  private privateAccessByTenant = new Map<number, ActiveAgent[]>()
  // agentId → último motivo de desconexão (memória)
  private offlineReasons   = new Map<number, OfflineInfo>()
  // connectionId → resolve callback (aguardando 'connected' | 'error' do agente)
  private pending  = new Map<string, ResolveCallback>()
  // connectionId → stream local (lado NodeAccess da ponte)
  private sockets  = new Map<string, BridgeEntry>()
  private maintenance = new Set<number>()
  private instances = new Set<ActiveAgent>()
  private publications = new Map<number, Set<string>>()
  registerPublication(agentId: number, id: string): () => void {
    const set = this.publications.get(agentId) ?? new Set<string>()
    set.add(id); this.publications.set(agentId, set)
    return () => { set.delete(id); if (!set.size) this.publications.delete(agentId) }
  }

  // ── Registro ────────────────────────────────────────────────────────────────

  isRegistered(agent: ActiveAgent): boolean { return this.instances.has(agent) }

  register(agent: ActiveAgent): void {
    for (const previous of this.instances) {
      if (previous.agentId === agent.agentId || (agent.agentMode === 'USER_BOUND' && previous.agentMode === 'USER_BOUND' && previous.userId === agent.userId)) {
        this.unregister(previous, 'Agente substituído por nova conexão')
        try { previous.ws.close(1008, 'registration replaced') } catch {}
      }
    }
    this.instances.add(agent)
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
    if (agent.agentType === 'PROXY_AGENT' && agent.agentMode === 'SERVICE_BOUND') {
      const services = this.serviceByTenant.get(agent.tenantId) ?? []
      this.serviceByTenant.set(agent.tenantId, [agent, ...services.filter(item => item.agentId !== agent.agentId)])
    }
    if (agent.agentType === 'PRIVATE_ACCESS_CONNECTOR' && agent.agentMode === 'SERVICE_BOUND') {
      const connectors = this.privateAccessByTenant.get(agent.tenantId) ?? []
      this.privateAccessByTenant.set(agent.tenantId, [agent, ...connectors.filter((item) => item.agentId !== agent.agentId)])
    }
    logger.info({ agentId: agent.agentId, name: agent.name, userId: agent.userId, agentType: agent.agentType, agentMode: agent.agentMode, isDefault: agent.isDefault }, 'Agent registrado')

    let rateStart = Date.now(), frames = 0
    agent.ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (!this.instances.has(agent)) return
      if (Date.now() - rateStart >= 1000) { rateStart = Date.now(); frames = 0 }
      if (data.length > 262144 || ++frames > 2000) { this.disconnectById(agent.agentId, 'Agent frame budget exceeded'); return }
      if (isBinary) {
        this.handleBinary(agent, data)
      } else {
        try { this.handleControl(agent, JSON.parse(data.toString())) } catch { /* ignore */ }
      }
    })

    agent.ws.on('close', (code: number) => this.unregister(agent, `ws closed (${code})`))
    agent.ws.on('error', (err: Error) => this.unregister(agent, err.message))
  }

  unregister(agent: ActiveAgent, reason = 'disconnected'): void {
    this.instances.delete(agent)
    if (this.byUser.get(agent.userId) === agent) this.byUser.delete(agent.userId)
    if (this.byTenant.get(agent.tenantId) === agent) this.byTenant.delete(agent.tenantId)
    if (this.byTenantDefault.get(agent.tenantId) === agent) this.byTenantDefault.delete(agent.tenantId)
    const services = this.serviceByTenant.get(agent.tenantId)?.filter(item => item !== agent) ?? []
    if (services.length) this.serviceByTenant.set(agent.tenantId, services)
    else this.serviceByTenant.delete(agent.tenantId)
    const privateConnectors = this.privateAccessByTenant.get(agent.tenantId)
    if (privateConnectors) {
      const next = privateConnectors.filter((item) => item !== agent)
      if (next.length > 0) this.privateAccessByTenant.set(agent.tenantId, next)
      else this.privateAccessByTenant.delete(agent.tenantId)
    }
    this.offlineReasons.set(agent.agentId, { reason, at: new Date() })
    // Fechar apenas as pontes desse agente
    this.sockets.forEach((entry, connectionId) => {
      if (entry.agent !== agent) return
      entry.stream.remoteError('Agente desconectado')
      this.sockets.delete(connectionId)
    })
    logger.info({ agentId: agent.agentId, name: agent.name, reason }, 'Agent desconectado')
  }

  // ── Lookup ──────────────────────────────────────────────────────────────────

  getForUser(userId: number): ActiveAgent | undefined {
    const agent = this.byUser.get(userId)
    return agent && !this.maintenance.has(agent.agentId) ? agent : undefined
  }

  getForTenant(tenantId: number): ActiveAgent | undefined {
    return (this.serviceByTenant.get(tenantId) ?? [])
      .filter(agent => !this.maintenance.has(agent.agentId))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || (a.priority ?? 100) - (b.priority ?? 100))[0]
  }

  getPrivateAccessForTenant(tenantId: number): ActiveAgent | undefined {
    return this.privateAccessByTenant.get(tenantId)?.find(agent => !this.maintenance.has(agent.agentId))
  }

  setMaintenance(agentId: number, enabled: boolean): void {
    if (enabled) this.maintenance.add(agentId)
    else this.maintenance.delete(agentId)
  }

  activeConnectionsForAgent(agentId: number): number {
    let count = this.publications.get(agentId)?.size ?? 0
    this.sockets.forEach(entry => { if (entry.agentId === agentId) count += 1 })
    return count
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
    const connectors = (this.privateAccessByTenant.get(tenantId) ?? []).filter(agent => !this.maintenance.has(agent.agentId))
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
    for (const services of this.serviceByTenant.values()) {
      for (const a of services) if (a.agentId === agentId) return a
    }
    for (const connectors of this.privateAccessByTenant.values()) {
      for (const a of connectors) {
        if (a.agentId === agentId) return a
      }
    }
    return undefined
  }

  disconnectById(agentId: number, reason = 'agent revoked'): boolean {
    const agents = [...this.instances].filter(agent => agent.agentId === agentId)
    for (const agent of agents) {
      this.unregister(agent, reason)
      try { agent.ws.close(1008, reason) } catch {}
    }
    return agents.length > 0
  }

  private accessService: AgentAccessService | undefined
  setAccessService(service: AgentAccessService): void { this.accessService = service }

  async createAuthorizedConnection(agent: ActiveAgent, id: string, host: string, port: number, request: AgentAccessRequest): Promise<AgentBridgeStream> {
    const service = this.accessService
    if (!service) throw agentAccessDenied()
    const check = async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([service.authorize(agent, host, port, request), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 3000) })])
      } catch { return false } finally { clearTimeout(timer) }
    }
    if (!await check()) throw agentAccessDenied()
    const stream = await this.createConnection(agent, id, host, port)
    // Recheck after TCP establishment: ACLs can change while the agent connects.
    if (!await check() || stream.destroyed) { stream.destroy(); throw agentAccessDenied() }
    let checking = false
    const timer = setInterval(async () => {
      if (checking || stream.destroyed) return
      checking = true
      try {
        if (!await check() && !stream.destroyed) {
          stream.destroy(agentAccessDenied())
          void service.auditRevocation(agent, request, id).catch(error => logger.error({ error, agentId: agent.agentId, connectionId: id }, 'Failed to audit agent access revocation'))
        }
      } finally { checking = false }
    }, 5000)
    timer.unref()
    stream.once('close', () => clearInterval(timer))
    return stream
  }

  createConnection(agent: ActiveAgent, connectionId: string, host: string, port: number): Promise<AgentBridgeStream> {
    if (!/^[a-f0-9-]{36}$/.test(connectionId) || this.sockets.has(connectionId) || this.pending.has(connectionId)) return Promise.reject(new Error('Invalid or duplicate connection ID'))
    if (!this.instances.has(agent) || this.activeConnectionsForAgent(agent.agentId) >= 128) return Promise.reject(new Error('Agente offline ou limite de conexões atingido'))
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
          for (let offset = 0; offset < chunk.length; offset += 65536) {
            if (agent.ws.bufferedAmount > 2 * 1024 * 1024) throw new Error('Agent outbound buffer limit exceeded')
            agent.ws.send(buildFrame(connectionId, chunk.subarray(offset, offset + 65536)))
          }
        },
        () => {
          this.sockets.delete(connectionId)
          closeRemote()
        },
      )
      this.sockets.set(connectionId, { agent, agentId: agent.agentId, stream: local })

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

  private handleControl(agent: ActiveAgent, msg: { type: string; connectionId?: string; message?: string }): void {
    if (!msg.connectionId || this.sockets.get(msg.connectionId)?.agent !== agent) return
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

  private handleBinary(agent: ActiveAgent, data: Buffer): void {
    if (data.length < CONN_ID_LEN) return
    const connectionId = data.subarray(0, CONN_ID_LEN).toString('utf8').trim()
    if (this.sockets.get(connectionId)?.agent !== agent) return
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
  if (allowedCidrs.length === 0 && allowedHostnames.length === 0) return false
  return allowedCidrs.some((cidr) => isIpv4InCidr(normalizedHost, cidr))
}

function isPrivateAccessPortAllowed(agent: ActiveAgent, port: number): boolean {
  if (agent.agentType !== 'PRIVATE_ACCESS_CONNECTOR') return false
  const allowedPorts = agent.privateAccess?.allowedPorts ?? []
  return allowedPorts.includes(port)
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
