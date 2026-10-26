import { assertTrialCapability, monitorTrialAccess } from '../trials/trial-policy.js'
import { agentDisconnectCode } from '@nodeaccess/shared'
import { createHash, randomUUID } from 'node:crypto'
import type { WebSocket } from 'ws'
import { agentRegistry, type ActiveAgent } from './agent.registry.js'
import { agentDiagnosticReport } from './agent-diagnostic-report.js'
import type { AgentService } from './agent.service.js'
import { logger } from '../../config/logger.js'

export interface AgentConnectionMeta {
  remoteIp?: string
  version?:  string
  hostname?: string
  desktopEditing?: boolean
  platform?: string
  arch?:     string
  tlsMode?:  'verified' | 'insecure'
}

export class AgentGateway {
  constructor(
    private readonly agentService: AgentService,
    private readonly registry = agentRegistry,
    private readonly heartbeatIntervalMs = 30_000,
    private readonly heartbeatTimeoutMs = 75_000,
  ) {}

  async handleConnection(ws: WebSocket, rawToken: string, meta: AgentConnectionMeta = {}): Promise<void> {
    // Authenticate opaque credential; it is never written to logs.
    const agent = await this.agentService.authenticate(rawToken)
    if (!agent) {
      ws.send(JSON.stringify({ type: 'error', message: 'Token inválido ou agente desativado' }))
      ws.close(1008)
      return
    }

    let trial
    try { trial = await assertTrialCapability(agent.tenantId, 'agents') } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Agentes indisponíveis no teste' }))
      ws.close(1008)
      return
    }

    if (ws.readyState !== ws.OPEN) return

    // 2. Registrar no registry
    const activeAgent: ActiveAgent = {
      connectionId: randomUUID(),
      credentialHash: createHash('sha256').update(rawToken).digest('hex'),
      agentId:     agent.id,
      userId:      agent.createdById,
      tenantId:    agent.tenantId,
      name:        agent.name,
      agentType:   agent.agentType,
      agentMode:   agent.agentMode,
      isDefault:   agent.isDefault,
      poolName:    agent.poolName,
      priority:    agent.priority,
      privateAccess: agent.privateAccess,
      ws,
      connectedAt: new Date(),
      ...(meta.version  !== undefined && { version:  meta.version }),
      ...(meta.hostname !== undefined && { hostname: meta.hostname }),
      desktopEditing: meta.desktopEditing === true && meta.platform === 'win32' && agent.agentMode === 'USER_BOUND',
      ...(meta.platform !== undefined && { platform: meta.platform }),
      ...(meta.arch     !== undefined && { arch:     meta.arch }),
      ...(meta.remoteIp !== undefined && { remoteIp: meta.remoteIp }),
      ...(meta.tlsMode !== undefined && { tlsMode: meta.tlsMode }),
      lastPongAt: new Date(),
    }
    const stopTrial = monitorTrialAccess(agent.tenantId, trial, () => { this.registry.unregister(activeAgent, 'trial expired'); ws.close(1008) }, { id: agent.createdById })
    ws.once('close', stopTrial)
    this.registry.register(activeAgent)

    // 3. Confirmar registro + enviar heartbeat periódico
    ws.send(JSON.stringify({ type: 'registered', agentId: agent.id, name: agent.name, connectionId: activeAgent.connectionId, accessMode: 'managed_acl', tenantId: agent.tenantId, ownerId: agent.createdById, agentMode: agent.agentMode }))
    logger.info({
      agentId: agent.id,
      name: agent.name,
      agentType: agent.agentType,
      remoteIp: meta.remoteIp,
      version: meta.version,
      hostname: meta.hostname,
      platform: meta.platform,
      arch: meta.arch,
    }, 'Agent WebSocket pronto')

    const denyAuthorization = (reason: string): void => { this.registry.unregister(activeAgent, reason); ws.close(1008, reason) }
    let validating = false
    const validateAuthorization = async (): Promise<void> => {
      if (validating || ws.readyState !== ws.OPEN) return
      validating = true
      const timeout = setTimeout(() => denyAuthorization('authorization unavailable'), 3000)
      try {
        const current = await this.agentService.authenticate(rawToken, true)
        if (!current || current.id !== agent.id || current.tenantId !== agent.tenantId) denyAuthorization('authorization revoked')
        else if (this.registry.isRegistered(activeAgent)) {
          this.registry.setMaintenance(agent.id, current.maintenanceMode)
          activeAgent.privateAccess = current.privateAccess
        }
      } catch { denyAuthorization('authorization unavailable') }
      finally { clearTimeout(timeout); validating = false }
    }
    const authorizationTimer = setInterval(() => { void validateAuthorization() }, 5000)
    ws.once('close', () => clearInterval(authorizationTimer))

    // Agent observations are untrusted telemetry: bounded, authenticated and acknowledged only after persistence.
    let reporting = false, lastReportAt = -Infinity
    const handleReport = async (data: Buffer, binary: boolean): Promise<void> => {
      if (binary || data.length > 16_384 || reporting || !this.registry.isRegistered(activeAgent)) return
      let parsed
      try { parsed = agentDiagnosticReport.safeParse(JSON.parse(data.toString())) } catch { return }
      if (!parsed.success || Date.now() - lastReportAt < 10_000) return
      reporting = true
      lastReportAt = Date.now()
      try {
        const ids = await this.agentService.logReportedEvents(agent.id, agent.createdById, parsed.data.events)
        if (this.registry.isRegistered(activeAgent) && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'diagnostic-ack', ids }))
      } catch { /* No ACK: the bounded local outbox retries after recovery. */ }
      finally { reporting = false }
    }
    const receiveReport = (data: Buffer, binary: boolean): void => { void handleReport(data, binary) }
    ws.on('message', receiveReport)
    ws.once('close', () => ws.off('message', receiveReport))

    // Heartbeat a cada 30s para manter conexão viva
    const handlePong = (data: Buffer, isBinary: boolean): void => {
      if (isBinary) return
      try {
        const message = JSON.parse(data.toString()) as { type?: string }
        if (message.type !== 'pong') return
        activeAgent.lastPongAt = new Date()
        void this.agentService.touch(agent.id)
      } catch { /* registry reports malformed frames separately when relevant */ }
    }
    ws.on('message', handlePong)

    const heartbeat = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        if (Date.now() - (activeAgent.lastPongAt?.getTime() ?? activeAgent.connectedAt.getTime()) > this.heartbeatTimeoutMs) {
          this.registry.unregister(activeAgent, 'HEARTBEAT_TIMEOUT')
          ws.close(4000, 'heartbeat timeout')
          return
        }
        ws.send(JSON.stringify({ type: 'ping', sentAt: Date.now() }))
      }
    }, this.heartbeatIntervalMs)

    let connectionWrite: Promise<void> = Promise.resolve()
    let disconnectReason = 'CONNECTION_LOST'
    ws.on('error', (err: Error) => { disconnectReason = agentDisconnectCode(err.message) })
    ws.once('close', (code: number, reason?: Buffer) => {
      disconnectReason = activeAgent.disconnectReason ?? agentDisconnectCode(reason?.toString() || disconnectReason, code)
      clearInterval(heartbeat)
      ws.off?.('message', handlePong)
      void connectionWrite.then(() => {
        if (!this.registry.getActiveById(agent.id)) return this.agentService.markDisconnected(agent.id, disconnectReason, activeAgent.connectedAt)
      }).catch(() => {})
      void this.agentService.logDisconnected(agent.id, agent.name, agent.agentType, agent.agentMode, agent.createdById, disconnectReason, { ...meta, connectionId: activeAgent.connectionId!, closeCode: code, lastHeartbeatAt: activeAgent.lastPongAt?.toISOString() })
    })
    if (ws.readyState === ws.OPEN) {
      // Connection bookkeeping
      connectionWrite = this.agentService.markConnected(agent.id, { ...meta, connectedAt: activeAgent.connectedAt.toISOString() }).catch(() => ws.close(1011, 'bookkeeping unavailable'))
      await connectionWrite
      if (this.registry.isRegistered(activeAgent)) void this.agentService.logConnected(agent.id, agent.name, agent.agentType, agent.agentMode, agent.createdById, { ...meta, connectionId: activeAgent.connectionId! })
    }
  }
}
