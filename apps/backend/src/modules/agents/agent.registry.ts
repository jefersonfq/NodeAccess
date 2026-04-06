// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WebSocket = any
import { EventEmitter } from 'node:events'
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
  agentId:   number
  userId:    number
  tenantId:  number
  name:      string
  ws:        WebSocket
  connectedAt: Date
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
  // userId → AgentEntry
  private byUser  = new Map<number, ActiveAgent>()
  // tenantId → AgentEntry (agente padrão do tenant — último registrado)
  private byTenant = new Map<number, ActiveAgent>()
  // connectionId → resolve callback (aguardando 'connected' | 'error' do agente)
  private pending  = new Map<string, ResolveCallback>()
  // connectionId → stream local (lado NodeAccess da ponte)
  private sockets  = new Map<string, BridgeEntry>()

  // ── Registro ────────────────────────────────────────────────────────────────

  register(agent: ActiveAgent): void {
    this.byUser.set(agent.userId, agent)
    this.byTenant.set(agent.tenantId, agent)
    logger.info({ agentId: agent.agentId, name: agent.name, userId: agent.userId }, 'Agent registrado')

    agent.ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        this.handleBinary(data)
      } else {
        try { this.handleControl(JSON.parse(data.toString())) } catch { /* ignore */ }
      }
    })

    agent.ws.on('close', () => this.unregister(agent))
    agent.ws.on('error', () => this.unregister(agent))
  }

  unregister(agent: ActiveAgent): void {
    if (this.byUser.get(agent.userId) === agent) this.byUser.delete(agent.userId)
    if (this.byTenant.get(agent.tenantId) === agent) this.byTenant.delete(agent.tenantId)
    // Fechar apenas as pontes desse agente
    this.sockets.forEach((entry, connectionId) => {
      if (entry.agentId !== agent.agentId) return
      entry.stream.remoteError('Agente desconectado')
      this.sockets.delete(connectionId)
    })
    logger.info({ agentId: agent.agentId, name: agent.name }, 'Agent desconectado')
  }

  // ── Lookup ──────────────────────────────────────────────────────────────────

  getForUser(userId: number): ActiveAgent | undefined {
    return this.byUser.get(userId)
  }

  getForTenant(tenantId: number): ActiveAgent | undefined {
    return this.byTenant.get(tenantId)
  }

  isOnline(agentId: number): boolean {
    for (const a of this.byUser.values()) {
      if (a.agentId === agentId) return true
    }
    return false
  }

  // ── Criar conexão TCP via agente ────────────────────────────────────────────

  /**
   * Solicita ao agente que conecte TCP em host:port.
   * Retorna um stream local que faz relay bidirecional pelo WebSocket do agente.
   */
  createConnection(agent: ActiveAgent, connectionId: string, host: string, port: number): Promise<AgentBridgeStream> {
    return new Promise((resolve, reject) => {
      const local = new AgentBridgeStream(
        (chunk) => {
          if (agent.ws.readyState !== agent.ws.OPEN) {
            throw new Error('Agente offline')
          }
          agent.ws.send(buildFrame(connectionId, chunk))
        },
        () => {
          this.sockets.delete(connectionId)
          if (agent.ws.readyState === agent.ws.OPEN) {
            agent.ws.send(JSON.stringify({ type: 'close', connectionId }))
          }
        },
      )
      this.sockets.set(connectionId, { agentId: agent.agentId, stream: local })

      // Timeout de 15s para o agente confirmar conexão
      const timeout = setTimeout(() => {
        this.pending.delete(connectionId)
        this.sockets.delete(connectionId)
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

// Exportar instância singleton
export const agentRegistry = new AgentRegistry()
