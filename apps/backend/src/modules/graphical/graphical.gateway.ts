import jwt from 'jsonwebtoken'
import type { WebSocket } from 'ws'
import { canOpenInWebTerminal, getHostAccessProtocolCapabilities } from '@nodeaccess/shared'
import { env } from '../../config/env.js'
import { logger } from '../../config/logger.js'
import type { JwtPayload } from '../../shared/guards.js'
import type { SshRepository } from '../ssh/ssh.repository.js'
import type { SessionAuditPublisher } from '../session-audit/session-audit.publisher.js'
import type { SessionAuditPolicyService } from '../session-audit/session-audit-policy.service.js'
import {
  graphicalConnectionMethod,
  type GraphicalSessionAdapter,
  type GraphicalSessionAdapterResult,
  type GraphicalSessionTransport,
} from './graphical-session.adapter.js'
import type { GraphicalRuntimeCloseReason, GraphicalSessionRuntimeRegistry } from './graphical-session-runtime.registry.js'

interface GraphicalGatewayMeta {
  clientIp?: string
  userAgent?: string
  initialWidth?: number
  initialHeight?: number
  initialDpi?: number
  rdpCredentialMode?: 'remote-login' | 'session'
}

interface GraphicalConnectionPrincipal {
  userId: number
  tenantId: number
  role: 'admin' | 'user'
}

interface GraphicalClientGuacdMessage {
  type: 'guacd'
  data: string
}

interface GraphicalClientDisconnectMessage {
  type: 'graphical_disconnect'
}

interface GraphicalClientDebugMessage {
  type: 'graphical_debug'
  event: string
  payload?: Record<string, unknown>
}

interface GraphicalClientCredentialsMessage {
  type: 'graphical_credentials'
  username: string
  password: string
  domain?: string
}

type GraphicalClientMessage = GraphicalClientGuacdMessage | GraphicalClientDisconnectMessage | GraphicalClientDebugMessage

const WS_OPEN = 1
const RDP_CREDENTIAL_TIMEOUT_MS = 120_000
const GRAPHICAL_SESSION_HEARTBEAT_MS = 30_000
const GRAPHICAL_SESSION_TOUCH_MIN_INTERVAL_MS = 5_000

function send(ws: WebSocket, msg: object): void {
  ws.send(JSON.stringify(msg))
}

function closeWithError(ws: WebSocket, message: string, wsCode = 1008, errorCode?: string): void {
  send(ws, { type: 'error', message, ...(errorCode && { code: errorCode }) })
  ws.close(wsCode)
}

export class GraphicalGateway {
  constructor(
    private readonly sshRepo: SshRepository,
    private readonly sessionAuditPublisher: SessionAuditPublisher,
    private readonly sessionAuditPolicyService: SessionAuditPolicyService,
    private readonly adapter: GraphicalSessionAdapter,
    private readonly runtimeRegistry?: GraphicalSessionRuntimeRegistry,
  ) {}

  async handleConnection(ws: WebSocket, token: string | undefined, hostId: number, meta: GraphicalGatewayMeta = {}): Promise<void> {
    if (!token) return closeWithError(ws, 'Token obrigatório')

    let principal: GraphicalConnectionPrincipal
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload
      if (payload.stage !== 'authenticated') throw new Error('Invalid stage')
      principal = {
        userId: Number(payload.sub),
        tenantId: payload.tenantId,
        role: payload.role,
      }
    } catch {
      return closeWithError(ws, 'Token inválido ou expirado')
    }

    const host = await this.sshRepo.findHostWithCredentials(hostId, principal.tenantId)
    if (!host) return closeWithError(ws, 'Host não encontrado')

    if (principal.role !== 'admin') {
      if (host.scope === 'PERSONAL' && host.ownerId !== principal.userId) {
        return closeWithError(ws, 'Sem acesso a este host')
      }
      if (host.scope === 'TEAM') {
        const userGroupIds = await this.sshRepo.getUserGroupIds(principal.userId)
        if (!host.groupId || !userGroupIds.includes(host.groupId)) {
          return closeWithError(ws, 'Sem acesso a este host')
        }
      }
    }

    const accessProtocol = host.accessProtocol.toLowerCase() as 'ssh' | 'rdp' | 'telnet' | 'vnc' | 'serial'
    const capabilities = getHostAccessProtocolCapabilities(accessProtocol)

    if (canOpenInWebTerminal(accessProtocol)) {
      return closeWithError(ws, 'Este protocolo usa o terminal textual', 1008, 'TEXT_TERMINAL_PROTOCOL')
    }

    if (capabilities.terminalMode !== 'graphical') {
      return closeWithError(ws, 'Este protocolo ainda não possui gateway gráfico planejado', 1008, 'GRAPHICAL_GATEWAY_NOT_APPLICABLE')
    }
    if (accessProtocol !== 'rdp' && accessProtocol !== 'vnc') {
      return closeWithError(ws, 'Este protocolo ainda não possui gateway gráfico planejado', 1008, 'GRAPHICAL_GATEWAY_NOT_APPLICABLE')
    }
    let rdpCredentials: GraphicalClientCredentialsMessage | undefined
    const rdpMissingStoredCredentials = accessProtocol === 'rdp' && (!host.sshUser?.trim() || !host.passwordEncrypted)
    if (rdpMissingStoredCredentials && meta.rdpCredentialMode === 'session') {
      logger.info({
        event: 'graphical.gateway.rdp.session_credentials',
        hostId: host.id,
        tenantId: principal.tenantId,
        userId: principal.userId,
        hasUsername: Boolean(host.sshUser?.trim()),
        hasPassword: Boolean(host.passwordEncrypted),
      }, 'RDP host credentials missing; requesting session-only credentials')
      rdpCredentials = await requestRdpCredentials(ws) ?? undefined
      if (!rdpCredentials) return
    } else if (rdpMissingStoredCredentials) {
      logger.info({
        event: 'graphical.gateway.rdp.remote_login',
        hostId: host.id,
        tenantId: principal.tenantId,
        userId: principal.userId,
        hasUsername: Boolean(host.sshUser?.trim()),
        hasPassword: Boolean(host.passwordEncrypted),
      }, 'RDP host credentials missing; delegating login to remote RDP screen')
    }

    const connectionMethod = graphicalConnectionMethod(accessProtocol)
    const userGroupIds = principal.role === 'admin'
      ? []
      : await this.sshRepo.getUserGroupIds(principal.userId)
    const sessionId = await this.sshRepo.startSession(principal.userId, host.id, {
      clientIp: meta.clientIp,
      userAgent: meta.userAgent,
      connectionMethod,
    })
    const userSnapshot = await this.sshRepo.findUserSnapshot(principal.userId, principal.tenantId)
    const auditContext = {
      sessionId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      hostId: host.id,
    }
    logger.info({
      event: 'graphical.gateway.session.start',
      sessionId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      hostId: host.id,
      protocol: accessProtocol,
      connectionMethod,
      initialWidth: meta.initialWidth ?? null,
      initialHeight: meta.initialHeight ?? null,
      initialDpi: meta.initialDpi ?? null,
    }, 'graphical gateway session starting')
    const auditEnabledForSession = await this.sessionAuditPolicyService.shouldAuditSession(
      principal.tenantId,
      principal.userId,
      userGroupIds,
    )
    const publishAudit = (type: 'session_started' | 'session_ended', payload: Record<string, unknown>) => {
      if (!auditEnabledForSession) return Promise.resolve()
      return this.sessionAuditPublisher.publish(type, auditContext, payload)
    }
    await publishAudit('session_started', {
      userName: userSnapshot?.name ?? `user #${principal.userId}`,
      userEmail: userSnapshot?.email ?? null,
      hostName: host.name,
      hostIp: host.ip,
      clientIp: meta.clientIp ?? null,
      userAgent: meta.userAgent ?? null,
      connectionMethod,
      accessProtocol,
      gatewayStatus: 'pending',
    }).catch(() => { /* ignore */ })

    let adapterResult: GraphicalSessionAdapterResult
    try {
      adapterResult = await this.adapter.open({
        sessionId,
        tenantId: principal.tenantId,
        userId: principal.userId,
        host,
        protocol: accessProtocol,
        connectionMethod,
        ...(meta.clientIp && { clientIp: meta.clientIp }),
        ...(meta.userAgent && { userAgent: meta.userAgent }),
        ...(meta.initialWidth && { initialWidth: meta.initialWidth }),
        ...(meta.initialHeight && { initialHeight: meta.initialHeight }),
        ...(meta.initialDpi && { initialDpi: meta.initialDpi }),
        ...(rdpCredentials && {
          rdpCredentials: {
            username: rdpCredentials.username,
            password: rdpCredentials.password,
            ...(rdpCredentials.domain?.trim() && { domain: rdpCredentials.domain.trim() }),
          },
        }),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao preparar gateway gráfico'
      logger.warn({
        event: 'graphical.gateway.adapter.failed',
        sessionId,
        hostId: host.id,
        protocol: accessProtocol,
        errorMessage: message,
      }, 'graphical gateway adapter failed')
      await this.sshRepo.endSession(sessionId, { endedReason: 'graphical_gateway_pending' }).catch(() => { /* best-effort */ })
      await publishAudit('session_ended', {
        reason: 'graphical_gateway_adapter_failed',
        gatewayStatus: 'failed',
        errorMessage: message,
      }).catch(() => { /* ignore */ })
      if (auditEnabledForSession) this.sessionAuditPublisher.clearSession(sessionId)
      return closeWithError(ws, 'Falha ao preparar gateway gráfico', 1011, 'GRAPHICAL_GATEWAY_CONNECT_FAILED')
    }

    logger.info({
      event: 'graphical.gateway.adapter.result',
      sessionId,
      hostId: host.id,
      protocol: accessProtocol,
      status: adapterResult.status,
      code: adapterResult.code,
    }, 'graphical gateway adapter result')

    send(ws, {
      type: adapterResult.status === 'connected' ? 'graphical_gateway_connected' : 'graphical_gateway_pending',
      code: adapterResult.code,
      sessionId,
      connectionMethod,
      protocol: accessProtocol,
      hostId: host.id,
      hostName: host.name,
      message: adapterResult.message,
    })

    if (adapterResult.status === 'connected') {
      this.bridgeGraphicalTransport(ws, adapterResult.transport, {
        sessionId,
        hostId: host.id,
        protocol: accessProtocol,
        auditEnabledForSession,
        publishAudit,
      })
      return
    }

    await this.sshRepo.endSession(sessionId, { endedReason: 'graphical_gateway_pending' }).catch(() => { /* best-effort */ })
    await publishAudit('session_ended', {
      reason: 'graphical_gateway_pending',
      gatewayStatus: 'pending',
    }).catch(() => { /* ignore */ })
    if (auditEnabledForSession) this.sessionAuditPublisher.clearSession(sessionId)
    ws.close(1000)
  }

  private bridgeGraphicalTransport(
    ws: WebSocket,
    transport: GraphicalSessionTransport,
    context: {
      sessionId: number
      hostId: number
      protocol: string
      auditEnabledForSession: boolean
      publishAudit: (type: 'session_started' | 'session_ended', payload: Record<string, unknown>) => Promise<unknown>
    },
  ): void {
    let closed = false
    let clientMessageCount = 0
    let clientInputForwardedCount = 0
    let remoteFrameCount = 0
    let remoteBytes = 0
    let lastRemoteOpcode: string | null = null
    let lastClientOpcode: string | null = null
    let lastCloseSource: 'ws' | 'transport' | 'transport_error' | 'user' | 'registry' | null = null
    let lastTouchAt = 0
    let touchInFlight = false
    const touchSession = (force = false) => {
      if (closed) return
      const now = Date.now()
      if (!force && (touchInFlight || now - lastTouchAt < GRAPHICAL_SESSION_TOUCH_MIN_INTERVAL_MS)) return
      lastTouchAt = now
      touchInFlight = true
      this.sshRepo.touchSession(context.sessionId)
        .catch(() => { /* best-effort heartbeat */ })
        .finally(() => {
          touchInFlight = false
        })
    }
    touchSession(true)
    const heartbeatTimer = setInterval(() => {
      touchSession(true)
    }, GRAPHICAL_SESSION_HEARTBEAT_MS)
    heartbeatTimer.unref?.()
    const finish = async (reason: 'socket_closed' | 'remote_closed' | 'user_closed' | 'admin_closed', gatewayStatus: 'closed' | 'failed', errorMessage?: string) => {
      if (closed) return
      closed = true
      clearInterval(heartbeatTimer)
      logger.warn({
        event: 'graphical.gateway.session.finish',
        sessionId: context.sessionId,
        hostId: context.hostId,
        protocol: context.protocol,
        reason,
        gatewayStatus,
        errorMessage,
        closeSource: lastCloseSource,
        remoteFrameCount,
        remoteBytes,
        lastRemoteOpcode,
        clientMessageCount,
        clientInputForwardedCount,
        lastClientOpcode,
      }, 'graphical gateway session finished')
      this.runtimeRegistry?.unregister(context.sessionId)
      transport.close()
      try {
        await this.sshRepo.endSession(context.sessionId, {
          endedReason: reason,
          ...(errorMessage && { errorMessage }),
        })
        logger.info({
          event: 'graphical.gateway.session.end.persisted',
          sessionId: context.sessionId,
          hostId: context.hostId,
          protocol: context.protocol,
          reason,
        }, 'graphical gateway session end persisted')
      } catch (err) {
        logger.error({
          event: 'graphical.gateway.session.end.failed',
          sessionId: context.sessionId,
          hostId: context.hostId,
          protocol: context.protocol,
          reason,
          errorMessage: err instanceof Error ? err.message : String(err),
        }, 'failed to persist graphical gateway session end')
      }
      await context.publishAudit('session_ended', {
        reason,
        gatewayStatus,
        ...(errorMessage && { errorMessage }),
      }).catch(() => { /* ignore */ })
      if (context.auditEnabledForSession) this.sessionAuditPublisher.clearSession(context.sessionId)
      if (ws.readyState === WS_OPEN) {
        send(ws, { type: 'closed', reason })
        ws.close(1000)
      }
    }
    this.runtimeRegistry?.register(context.sessionId, {
      close: (reason: GraphicalRuntimeCloseReason) => {
        lastCloseSource = 'registry'
        void finish(reason, 'closed')
      },
    })

    transport.onData((data) => {
      if (closed) return
      const text = data.toString('utf8')
      remoteFrameCount += 1
      remoteBytes += data.byteLength
      lastRemoteOpcode = parseGuacdOpcode(text)
      touchSession()
      if (shouldLogGraphicalBridgeFrame(remoteFrameCount, lastRemoteOpcode)) {
        logger.debug({
          event: 'graphical.gateway.remote.data',
          sessionId: context.sessionId,
          hostId: context.hostId,
          protocol: context.protocol,
          frameCount: remoteFrameCount,
          bytes: data.byteLength,
          totalBytes: remoteBytes,
          opcode: lastRemoteOpcode,
        }, 'graphical gateway received guacd data')
      }
      if (graphicalFrameDebugEnabled() && shouldLogGraphicalBridgeFrame(remoteFrameCount, lastRemoteOpcode)) {
        logger.debug({
          event: 'graphical.gateway.remote.debug',
          sessionId: context.sessionId,
          hostId: context.hostId,
          protocol: context.protocol,
          frameCount: remoteFrameCount,
          bytes: data.byteLength,
          instructions: summarizeGuacdInstructions(text),
        }, 'graphical gateway remote guacd debug')
      }
      respondToSyncImmediately(text, transport)
      if (ws.readyState !== WS_OPEN) return
      send(ws, { type: 'guacd', data: text })
    })
    transport.onClose(() => {
      lastCloseSource = 'transport'
      logger.warn({
        event: 'graphical.gateway.transport.close',
        sessionId: context.sessionId,
        hostId: context.hostId,
        protocol: context.protocol,
        remoteFrameCount,
        remoteBytes,
        lastRemoteOpcode,
        clientMessageCount,
        clientInputForwardedCount,
        lastClientOpcode,
      }, 'graphical transport closed')
      void finish('remote_closed', 'closed')
    })
    transport.onError((err) => {
      lastCloseSource = 'transport_error'
      logger.warn({
        event: 'graphical.gateway.transport.error',
        sessionId: context.sessionId,
        hostId: context.hostId,
        protocol: context.protocol,
        errorMessage: err.message,
        remoteFrameCount,
        remoteBytes,
        lastRemoteOpcode,
        clientMessageCount,
        clientInputForwardedCount,
        lastClientOpcode,
      }, 'graphical transport error')
      void finish('remote_closed', 'failed', err.message)
    })
    ws.on('message', (raw) => {
      if (closed) return
      const msg = parseClientMessage(raw)
      if (!msg) return
      if (msg.type === 'graphical_disconnect') {
        lastCloseSource = 'user'
        logger.info({
          event: 'graphical.gateway.client.disconnect',
          sessionId: context.sessionId,
          hostId: context.hostId,
          protocol: context.protocol,
          remoteFrameCount,
          clientMessageCount,
          clientInputForwardedCount,
          lastClientOpcode,
        }, 'graphical client requested disconnect')
        void finish('user_closed', 'closed')
        return
      }
      if (msg.type === 'graphical_debug') {
        if (graphicalFrameDebugEnabled()) {
          logger.debug({
            event: 'graphical.gateway.frontend.debug',
            sessionId: context.sessionId,
            hostId: context.hostId,
            protocol: context.protocol,
            frontendEvent: msg.event,
            payload: sanitizeFrontendDebugPayload(msg.payload),
          }, 'graphical frontend debug')
        }
        return
      }
      transport.write(msg.data)
      const lastOpcode = parseGuacdOpcode(msg.data)
      lastClientOpcode = lastOpcode
      clientMessageCount += 1
      touchSession()
      if (shouldLogGraphicalBridgeFrame(clientMessageCount, lastOpcode)) {
        logger.debug({
          event: 'graphical.gateway.client.message',
          sessionId: context.sessionId,
          hostId: context.hostId,
          protocol: context.protocol,
          count: clientMessageCount,
          bytes: msg.data.length,
          opcode: lastOpcode,
        }, 'graphical gateway forwarded client message')
      }
      if (graphicalFrameDebugEnabled() && shouldLogClientGuacdDebug(clientMessageCount, msg.data, lastOpcode)) {
        logger.debug({
          event: 'graphical.gateway.client.debug',
          sessionId: context.sessionId,
          hostId: context.hostId,
          protocol: context.protocol,
          count: clientMessageCount,
          opcode: lastOpcode,
          args: parseSingleGuacdInstruction(msg.data)?.args ?? [],
        }, 'graphical gateway client guacd debug')
      }
      if (!isClientUserInputOpcode(lastOpcode)) return
      clientInputForwardedCount += 1
      if (shouldLogGraphicalBridgeFrame(clientInputForwardedCount, lastOpcode)) {
        logger.debug({
          event: 'graphical.gateway.client.input',
          sessionId: context.sessionId,
          hostId: context.hostId,
          protocol: context.protocol,
          count: clientInputForwardedCount,
          bytes: msg.data.length,
          opcode: lastOpcode,
        }, 'graphical gateway forwarded client input')
      }
      if (ws.readyState === WS_OPEN && shouldReportClientInput(clientInputForwardedCount, msg.data, lastOpcode)) {
        send(ws, {
          type: 'graphical_gateway_input_forwarded',
          count: clientInputForwardedCount,
          lastOpcode,
        })
      }
    })
    ws.once('close', (code, reasonBuffer) => {
      lastCloseSource = 'ws'
      logger.warn({
        event: 'graphical.gateway.ws.close',
        sessionId: context.sessionId,
        hostId: context.hostId,
        protocol: context.protocol,
        remoteFrameCount,
        remoteBytes,
        lastRemoteOpcode,
        clientMessageCount,
        clientInputForwardedCount,
        lastClientOpcode,
        wsCloseCode: code,
        wsCloseReason: formatWsCloseReason(reasonBuffer),
      }, 'graphical websocket closed')
      void finish('socket_closed', 'closed')
    })
  }
}

function formatWsCloseReason(value: unknown): string | null {
  if (!value) return null
  if (Buffer.isBuffer(value)) return value.toString('utf8') || null
  if (typeof value === 'string') return value || null
  return String(value) || null
}

function requestRdpCredentials(ws: WebSocket): Promise<GraphicalClientCredentialsMessage | null> {
  if (ws.readyState !== WS_OPEN) return Promise.resolve(null)
  send(ws, {
    type: 'graphical_credentials_required',
    code: 'RDP_CREDENTIALS_REQUIRED',
    message: 'Informe usuário e senha RDP para abrir esta sessão.',
  })

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup()
      closeWithError(ws, 'Tempo esgotado aguardando credenciais RDP', 1008, 'RDP_CREDENTIALS_TIMEOUT')
      resolve(null)
    }, RDP_CREDENTIAL_TIMEOUT_MS)
    const cleanup = () => {
      clearTimeout(timer)
      ws.off('message', onMessage)
      ws.off('close', onClose)
      ws.off('error', onError)
    }
    const onClose = () => {
      cleanup()
      resolve(null)
    }
    const onError = () => {
      cleanup()
      resolve(null)
    }
    const onMessage = (raw: unknown) => {
      const credentials = parseCredentialsMessage(raw)
      if (!credentials) {
        cleanup()
        closeWithError(ws, 'Credenciais RDP inválidas', 1008, 'RDP_CREDENTIALS_INVALID')
        resolve(null)
        return
      }
      cleanup()
      resolve(credentials)
    }
    ws.on('message', onMessage)
    ws.once('close', onClose)
    ws.once('error', onError)
  })
}

function parseCredentialsMessage(raw: unknown): GraphicalClientCredentialsMessage | null {
  const text = rawClientMessageToString(raw)
  if (text === null) return null
  try {
    const parsed = JSON.parse(text) as Partial<GraphicalClientCredentialsMessage>
    if (parsed.type !== 'graphical_credentials') return null
    if (typeof parsed.username !== 'string' || !parsed.username.trim()) return null
    if (typeof parsed.password !== 'string' || !parsed.password) return null
    if (parsed.domain !== undefined && typeof parsed.domain !== 'string') return null
    return {
      type: 'graphical_credentials',
      username: parsed.username.trim(),
      password: parsed.password,
      ...(parsed.domain?.trim() && { domain: parsed.domain.trim() }),
    }
  } catch {
    return null
  }
}

function isClientUserInputOpcode(opcode: string | null): boolean {
  return opcode === 'mouse' || opcode === 'key' || opcode === 'clipboard' || opcode === 'blob' || opcode === 'end'
}

function shouldReportClientInput(count: number, data: string, opcode: string | null): boolean {
  if (count <= 3 || count % 25 === 0) return true
  if (opcode === 'key') return true
  if (opcode !== 'mouse') return false
  return !data.endsWith(',1.0;')
}

function shouldLogClientGuacdDebug(count: number, data: string, opcode: string | null): boolean {
  if (opcode === 'key' || opcode === 'size') return true
  if (opcode !== 'mouse') return false
  if (count <= 5 || count % 50 === 0) return true
  const args = parseSingleGuacdInstruction(data)?.args ?? []
  return Number(args.at(-1) ?? 0) !== 0
}

function shouldLogGraphicalBridgeFrame(count: number, opcode: string | null): boolean {
  if (count <= 5 || count % 50 === 0) return true
  return opcode !== 'sync' && opcode !== 'mouse'
}

function graphicalFrameDebugEnabled(): boolean {
  return process.env.GRAPHICAL_DEBUG_FRAMES === 'true' || process.env.GRAPHICAL_DEBUG_FRAMES === '1'
}

function parseGuacdOpcode(data: string): string | null {
  const dotIndex = data.indexOf('.')
  if (dotIndex === -1) return null
  const length = Number(data.slice(0, dotIndex))
  if (!Number.isInteger(length) || length <= 0) return null
  return data.slice(dotIndex + 1, dotIndex + 1 + length) || null
}

function summarizeGuacdInstructions(data: string, limit = 12): Array<{ opcode: string; args: string[]; truncated?: boolean }> {
  const summaries: Array<{ opcode: string; args: string[]; truncated?: boolean }> = []
  let rest = data
  while (rest && summaries.length < limit) {
    const parsed = parseSingleGuacdInstruction(rest)
    if (!parsed) break
    summaries.push({
      opcode: parsed.opcode,
      args: sanitizeGuacdInstructionArgs(parsed.opcode, parsed.args),
    })
    rest = parsed.rest
  }
  if (rest) summaries.push({ opcode: '...', args: [], truncated: true })
  return summaries
}

function parseSingleGuacdInstruction(data: string): { opcode: string; args: string[]; rest: string } | null {
  const values: string[] = []
  let offset = 0
  while (offset < data.length) {
    const dotIndex = data.indexOf('.', offset)
    if (dotIndex === -1) return null
    const length = Number(data.slice(offset, dotIndex))
    if (!Number.isInteger(length) || length < 0) return null
    const valueStart = dotIndex + 1
    const valueEnd = valueStart + length
    if (data.length <= valueEnd) return null
    values.push(data.slice(valueStart, valueEnd))
    const separator = data[valueEnd]
    if (separator === ';') {
      const [opcode, ...args] = values
      return opcode ? { opcode, args, rest: data.slice(valueEnd + 1) } : null
    }
    if (separator !== ',') return null
    offset = valueEnd + 1
  }
  return null
}

function sanitizeGuacdInstructionArgs(opcode: string, args: string[]): string[] {
  if (opcode === 'blob') return [args[0] ?? '', `[${args[1]?.length ?? 0} chars]`]
  if (opcode === 'png' || opcode === 'jpeg') return [...args.slice(0, 5), `[${args[5]?.length ?? 0} chars]`]
  return args.slice(0, 8)
}

function parseClientMessage(raw: unknown): GraphicalClientMessage | null {
  const text = rawClientMessageToString(raw)
  if (text === null) return null
  try {
    const parsed = JSON.parse(text) as Partial<GraphicalClientGuacdMessage | GraphicalClientDisconnectMessage | GraphicalClientDebugMessage>
    if (parsed.type === 'graphical_disconnect') return { type: 'graphical_disconnect' }
    if (parsed.type === 'graphical_debug' && typeof parsed.event === 'string') {
      const payload = isPlainRecord(parsed.payload) ? parsed.payload : undefined
      return {
        type: 'graphical_debug',
        event: parsed.event.slice(0, 80),
        ...(payload && { payload }),
      }
    }
    if (parsed.type !== 'guacd' || typeof parsed.data !== 'string') return null
    return { type: 'guacd', data: parsed.data }
  } catch {
    return null
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeFrontendDebugPayload(payload: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!payload) return undefined
  return sanitizeDebugValue(payload, 0) as Record<string, unknown>
}

function sanitizeDebugValue(value: unknown, depth: number): unknown {
  if (depth > 4) return '[max-depth]'
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}...[${value.length} chars]` : value
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeDebugValue(item, depth + 1))
  if (!isPlainRecord(value)) return String(value)
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 40)
      .map(([key, item]) => [key, sanitizeDebugValue(item, depth + 1)]),
  )
}

const SYNC_RE = /4\.sync,\d+\.[^;]+;/g

function respondToSyncImmediately(text: string, transport: GraphicalSessionTransport): void {
  SYNC_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SYNC_RE.exec(text)) !== null) {
    transport.write(match[0])
  }
}

function rawClientMessageToString(raw: unknown): string | null {
  if (typeof raw === 'string') return raw
  if (Buffer.isBuffer(raw)) return raw.toString('utf8')
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8')
  if (ArrayBuffer.isView(raw)) return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8')
  if (Array.isArray(raw) && raw.every(Buffer.isBuffer)) return Buffer.concat(raw).toString('utf8')
  return null
}
