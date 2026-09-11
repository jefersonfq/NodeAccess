import { isAgentAccessDenied } from '../agents/agent-access.service.js'
import net from 'node:net'
import { openAgentLocalListener } from '../agents/agent-local-listener.js'
import type { TunnelRuntimeRegistry } from './tunnel-runtime.registry.js'
import { connectTunnelSsh } from './tunnel-ssh-connection.js'
import type { Duplex } from 'node:stream'
import { Client, type ConnectConfig } from 'ssh2'
import { randomUUID } from 'node:crypto'
import { decrypt, encrypt, type EncryptedPayload } from '../../shared/crypto.js'
import { logger } from '../../config/logger.js'
import { AppError } from '../../shared/errors.js'
import type { SshRepository } from '../ssh/ssh.repository.js'
import type { OnePasswordService } from '../integrations/onepassword.service.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { SshTunnelEventService } from '../port-forwardings/ssh-tunnel-event.service.js'
import { agentRegistry } from '../agents/agent.registry.js'
import { describeAgentTcpError } from '../agents/agent-error-message.js'

export interface TunnelInfo {
  id:               string
  userId:           number
  tenantId:         number
  hostId:           number
  hostName:         string
  connectionMethod: 'direct' | 'user_agent' | 'tenant_agent' | 'private_access_connector'
  bindAddress:      string
  localPort:        number
  requestedLocalPort: number
  assignedLocalPort: number
  usedPortFallback: boolean
  remoteHost:       string
  remotePort:       number
  createdAt:        Date
  localAgent?: { id: number; name: string; port: number }
  runtimeId?:       string
  sessionId?:       string
  portForwardingId?: number
  description?:     string
}

export interface TunnelStartupError {
  portForwardingId: number
  bindAddress: string
  localPort: number
  code: string
  message: string
}

export function describeConcurrentHostTunnels(
  activeTunnels: TunnelInfo[],
  hostId: number,
  currentSessionId: string,
): string | null {
  const otherSessionTunnels = activeTunnels.filter((tunnel) =>
    tunnel.hostId === hostId && tunnel.sessionId !== undefined && tunnel.sessionId !== currentSessionId,
  )
  if (otherSessionTunnels.length === 0) return null
  const sessionCount = new Set(otherSessionTunnels.map((tunnel) => tunnel.sessionId)).size
  return `${otherSessionTunnels.length} túnel(is) deste host já está(ão) ativo(s) em ${sessionCount} outra(s) aba(s). Esta sessão reutilizará os mesmos túneis enquanto ao menos uma aba permanecer conectada.`
}

export interface TunnelTargetTestResult {
  success: boolean
  message: string
  latencyMs: number | null
  connectionMethod: 'direct' | 'user_agent' | 'tenant_agent' | 'private_access_connector'
}

interface LiveTunnel extends TunnelInfo {
  localListener?: { close: () => void }
  publishingLocal?: boolean
  server: net.Server
  ssh:    Client
  userRole: 'ADMIN' | 'USER'
  sessionIds: Set<string>
  agentSock?: Duplex
}

// In-memory store: tunnelId → LiveTunnel
const tunnels = new Map<string, LiveTunnel>()
const autoTunnelIndex = new Map<string, string>()
const autoTunnelCreations = new Map<string, Promise<TunnelInfo>>()
const pendingSessionStarts = new Map<string, Set<{ closed: boolean }>>()

function autoTunnelKey(tenantId: number, userId: number, hostId: number, portForwardingId: number): string {
  return `${tenantId}:${userId}:${hostId}:${portForwardingId}`
}

function toTunnelInfo(tunnel: LiveTunnel): TunnelInfo {
  const { localListener: _listener, publishingLocal: _publishing, server: _, ssh: __, userRole: ___, sessionIds: ____, agentSock: _____, ...info } = tunnel
  return info
}

export class TunnelService {
  runtimeRegistry?: TunnelRuntimeRegistry
  runtimeSnapshot(): TunnelInfo[] { return [...tunnels.values()].map(toTunnelInfo) }
  async listAcrossRuntimes(userId: number, tenantId: number): Promise<TunnelInfo[]> {
    return this.runtimeRegistry ? this.runtimeRegistry.list(userId, tenantId) : this.listForUser(userId, tenantId)
  }
  async closeAcrossRuntimes(id: string, userId: number, tenantId: number): Promise<void> {
    if (this.runtimeRegistry) return this.runtimeRegistry.close(id, userId, tenantId)
    return this.closeForUser(id, userId, tenantId)
  }

  constructor(
    private readonly sshRepo:      SshRepository,
    private readonly onePassword:  OnePasswordService,
    private readonly logRepository: LogRepository,
    private readonly sshTunnelEvents?: SshTunnelEventService,
  ) {}

  async publishOnPersonalAgent(id: string, userId: number, tenantId: number, agentId: number, port: number): Promise<TunnelInfo> {
    const tunnel = tunnels.get(id)
    if (!tunnel || tunnel.userId !== userId || tunnel.tenantId !== tenantId) throw new AppError('Túnel não encontrado nesta instância', 404, 'TUNNEL_NOT_FOUND')
    const agent = agentRegistry.getActiveById(agentId)
    if (!agent || agentRegistry.getForUser(userId) !== agent || agent.userId !== userId || agent.tenantId !== tenantId || agent.agentMode !== 'USER_BOUND') throw new AppError('Selecione seu agente pessoal online', 403, 'AGENT_FORBIDDEN')
    const version = agent.version?.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
    if (!version || Number(version[1]) < 1 || (Number(version[1]) === 1 && Number(version[2]) < 5)) throw new AppError('Atualize o agente para 1.5.0 ou superior', 409, 'AGENT_UPDATE_REQUIRED')
    if (tunnel.publishingLocal || tunnel.localListener) throw new AppError('Este túnel já possui publicação local ou está sendo publicado', 409, 'TUNNEL_ALREADY_PUBLISHED')
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new AppError('Porta inválida', 422, 'INVALID_PORT')
    await this.assertCanAccessHost({ id: tunnel.hostId, tenantId }, userId, tunnel.userRole === 'ADMIN' ? 'admin' : 'user')
    tunnel.publishingLocal = true
    const releasePublication = agentRegistry.registerPublication(agentId, id)
    try {
      const listener = await openAgentLocalListener(agent, port, tunnel.assignedLocalPort, () => {
        releasePublication()
        delete tunnel.localAgent; delete tunnel.localListener
        void this.logRepository.logAdminEvent({ adminId: userId, action: 'USER_TUNNEL_LOCAL_CLOSED', targetType: 'Host', targetId: tunnel.hostId, details: JSON.stringify({ tunnelId: id, agentId, port, tenantId }) }).catch(() => {})
        void this.runtimeRegistry?.publish().catch(() => {})
      })
      if (!tunnels.has(id) || agentRegistry.getActiveById(agentId) !== agent) { listener.close(); throw new AppError('Túnel ou agente encerrado', 409, 'TUNNEL_CLOSED') }
      try { await this.assertCanAccessHost({ id: tunnel.hostId, tenantId }, userId, tunnel.userRole === 'ADMIN' ? 'admin' : 'user') } catch (error) { listener.close(); throw error }
      tunnel.localListener = listener
      tunnel.localAgent = { id: agentId, name: agent.name, port }
      await this.logRepository.logAdminEvent({ adminId: userId, action: 'USER_TUNNEL_LOCAL_PUBLISHED', targetType: 'Host', targetId: tunnel.hostId, details: JSON.stringify({ tunnelId: id, agentId, port, tenantId }) })
      await this.runtimeRegistry?.publish()
      logger.info({ tunnelId: id, agentId, port }, 'Publicação local confirmada')
      return toTunnelInfo(tunnel)
    } catch (error) { releasePublication(); tunnel.localListener?.close(); throw error }
    finally { delete tunnel.publishingLocal }
  }

  // ── Listar túneis ativos do usuário ─────────────────────────────────────────

  listForUser(userId: number, tenantId?: number): TunnelInfo[] {
    return [...tunnels.values()]
      .filter(t => t.userId === userId && (tenantId === undefined || t.tenantId === tenantId))
      .map(toTunnelInfo)
  }

  // ── Criar túnel ─────────────────────────────────────────────────────────────

  async create(
    userId: number,
    tenantId: number,
    role: 'admin' | 'user',
    hostId: number,
    localPort: number,
    remoteHost: string,
    remotePort: number,
    opts?: { sessionId?: string; portForwardingId?: number; description?: string; bindAddress?: string; recordSshTunnel?: boolean },
  ): Promise<TunnelInfo> {
    // 1. Buscar host
    const host = await this.sshRepo.findHostWithCredentials(hostId, tenantId)
    if (!host) throw new AppError('Host não encontrado', 404, 'HOST_NOT_FOUND')
    await this.assertCanAccessHost(host, userId, role)
    let connectionMethod: TunnelInfo['connectionMethod'] = 'direct'
    const bindAddress = normalizeBindAddress(opts?.bindAddress)

    // 2. Resolver credencial (1Password se configurado)
    let passwordEncrypted = host.passwordEncrypted
    let pemKey            = host.pemKey

    if (host.onePasswordRef) {
      try {
        const secret = await this.onePassword.resolve(tenantId, host.onePasswordRef)
        if (host.authType === 'PASSWORD' || host.authType === 'PEM_PASSWORD') {
          passwordEncrypted = JSON.stringify(encrypt(secret))
        } else {
          const enc = encrypt(secret)
          pemKey            = { encryptedKey: enc.encrypted, iv: enc.iv }
        }
      } catch (err) {
        logger.error({ err, hostId }, 'Tunnel: falha ao resolver credencial 1Password')
        throw new AppError('Falha ao buscar credencial no 1Password', 502, 'CREDENTIAL_ERROR')
      }
    }

    // 3. Construir config SSH
    const sshConfig = this.buildConnectConfig(host.ip, host.port, host.sshUser, host.authType, passwordEncrypted, pemKey)
    let agentSock: Duplex | undefined

    // 4. Resolver caminho de conexão do host
    if (host.connectionMode !== 'DIRECT') {
      const wantsPrivateAccess = host.connectionMode === 'PRIVATE_ACCESS_CONNECTOR'
      const resolvedAgent = wantsPrivateAccess
        ? agentRegistry.resolvePrivateAccessConnector(tenantId, host.ip, host.port, host.privateAccessConnectorId)
        : agentRegistry.resolveForConnectionMode(host.connectionMode, userId, tenantId)
      const allowsDirectFallback = host.connectionMode === 'AUTO'

      if (!resolvedAgent && !allowsDirectFallback) {
        if (wantsPrivateAccess) {
          const diagnostic = agentRegistry.describePrivateAccessResolution(tenantId, host.ip, host.port, host.privateAccessConnectorId)
          throw new AppError(diagnostic.message, 409, diagnostic.errorCode)
        }
        throw new AppError('Este host exige um agente online para abrir o tunnel', 409, 'AGENT_REQUIRED')
      }

      if (resolvedAgent) {
        try {
          const connectionId = randomUUID()
          agentSock = await agentRegistry.createAuthorizedConnection(resolvedAgent.agent, connectionId, host.ip, host.port, { userId, tenantId: tenantId, hostId: host.id, purpose: 'connect' })
          sshConfig.sock = agentSock
          connectionMethod = wantsPrivateAccess
            ? 'private_access_connector'
            : resolvedAgent.source === 'user' ? 'user_agent' : 'tenant_agent'
          logger.info(
            { agentId: resolvedAgent.agent.agentId, agentSource: resolvedAgent.source, hostId, userId, localPort, remoteHost, remotePort },
            'Tunnel roteado via agente',
          )
        } catch (err) {
          logger.warn({ err, hostId, userId }, 'Falha ao abrir bridge do agente para tunnel')
          if (isAgentAccessDenied(err)) throw err
          if (!allowsDirectFallback) {
            throw new AppError('Falha ao conectar ao host via agente para abrir o tunnel', 502, 'AGENT_TUNNEL_CONNECT_FAILED')
          }
          delete sshConfig.sock
          connectionMethod = 'direct'
        }
      }
    }

    // 5. Conectar ao SSH
    const bastionConfig = host.bastion && !sshConfig.sock ? this.buildConnectConfig(host.bastion.ip, host.bastion.port,
      host.bastion.sshUser, host.bastion.authType, host.bastion.passwordEncrypted, host.bastion.pemKey) : undefined
    const ssh = await connectTunnelSsh(sshConfig, host.trustedHostKeyFingerprint, bastionConfig)

    // 6. Criar servidor TCP local
    const tunnelId = randomUUID()
    const server   = net.createServer((sock) => {
      const tunnel = tunnels.get(tunnelId)
      if (!tunnel) { sock.destroy(); return }

      tunnel.ssh.forwardOut(
        sock.remoteAddress ?? '127.0.0.1',
        sock.remotePort ?? 0,
        remoteHost,
        remotePort,
        (err, stream) => {
          if (err) {
            logger.warn({ err, tunnelId }, 'Tunnel: forwardOut error')
            sock.destroy()
            return
          }
          if (sock.destroyed) { stream.close(); return }
          sock.pipe(stream)
          stream.pipe(sock)
          sock.on('close', () => stream.close())
          stream.on('close', () => sock.destroy())
        },
      )
    })

    let assignedLocalPort = localPort

    try {
      await new Promise<void>((resolve, reject) => {
        server.listen(localPort, bindAddress, resolve)
        server.on('error', reject)
      })
    } catch (err) {
      if (isAddressInUseError(err) && localPort > 0) {
        try {
          await new Promise<void>((resolve, reject) => {
            server.removeAllListeners('error')
            server.listen(0, bindAddress, resolve)
            server.on('error', reject)
          })
        } catch (fallbackErr) {
          try { server.close() } catch { /* ignore */ }
          try { ssh.end() } catch { /* ignore */ }
          try { agentSock?.destroy() } catch { /* ignore */ }

          if (isAddressInUseError(fallbackErr)) {
            const existingTunnel = [...tunnels.values()].find((item) => item.bindAddress === bindAddress && item.assignedLocalPort === localPort)
            const detail = existingTunnel
              ? ` pelo host "${existingTunnel.hostName}"${existingTunnel.description ? ` (${existingTunnel.description})` : ''}`
              : ''
            throw new AppError(
              `A porta local ${localPort} ja esta em uso no servidor NodeAccess${detail}`,
              409,
              'TUNNEL_LOCAL_PORT_IN_USE',
            )
          }

          throw fallbackErr
        }
      } else {
      try { server.close() } catch { /* ignore */ }
      try { ssh.end() } catch { /* ignore */ }
      try { agentSock?.destroy() } catch { /* ignore */ }

      if (isAddressInUseError(err)) {
        const existingTunnel = [...tunnels.values()].find((item) => item.bindAddress === bindAddress && item.localPort === localPort)
        const detail = existingTunnel
          ? ` pelo host "${existingTunnel.hostName}"${existingTunnel.description ? ` (${existingTunnel.description})` : ''}`
          : ''
        throw new AppError(
          `A porta local ${localPort} ja esta em uso no servidor NodeAccess${detail}`,
          409,
          'TUNNEL_LOCAL_PORT_IN_USE',
        )
      }

      throw err
      }
    }

    const address = server.address()
    assignedLocalPort =
      typeof address === 'object' && address !== null
        ? address.port
        : localPort

    // Permissions may have changed while SSH and the local listener were opening.
    try { await this.assertCanAccessHost(host, userId, role) }
    catch (error) {
      try { server.close() } catch { /* ignore */ }
      try { ssh.end() } catch { /* ignore */ }
      try { agentSock?.destroy() } catch { /* ignore */ }
      throw error
    }

    // 7. Registrar
    const info: TunnelInfo = {
      id: tunnelId, userId, tenantId, hostId,
      hostName: host.name,
      connectionMethod,
      bindAddress,
      localPort: assignedLocalPort,
      requestedLocalPort: localPort,
      assignedLocalPort,
      usedPortFallback: assignedLocalPort !== localPort,
      remoteHost, remotePort,
      createdAt: new Date(),
      ...(opts?.sessionId        !== undefined && { sessionId:        opts.sessionId }),
      ...(opts?.portForwardingId !== undefined && { portForwardingId: opts.portForwardingId }),
      ...(opts?.description      !== undefined && { description:      opts.description }),
    }
    tunnels.set(tunnelId, {
      ...info,
      server,
      ssh,
      userRole: role === 'admin' ? 'ADMIN' : 'USER',
      sessionIds: new Set(opts?.sessionId ? [opts.sessionId] : []),
      ...(agentSock !== undefined && { agentSock }),
    })
    if (opts?.sessionId !== undefined && opts.portForwardingId !== undefined) {
      autoTunnelIndex.set(autoTunnelKey(tenantId, userId, hostId, opts.portForwardingId), tunnelId)
    }

    // Cleanup on SSH disconnect
    ssh.on('close', () => this.close(tunnelId).catch(() => { /* ignore */ }))
    ssh.on('end', () => this.close(tunnelId).catch(() => { /* ignore */ }))
    ssh.on('error', () => this.close(tunnelId).catch(() => { /* ignore */ }))


    await this.logRepository.logAdminEvent({
      adminId: userId,
      action: 'USER_TUNNEL_OPENED',
      targetType: opts?.portForwardingId ? 'PortForwarding' : 'Host',
      targetId: opts?.portForwardingId ?? hostId,
      details: tunnelLogDetails(info),
    }).catch(() => { /* best-effort */ })

    if (opts?.portForwardingId !== undefined && opts.recordSshTunnel !== false) {
      await this.sshTunnelEvents?.record({
        tenantId,
        userId,
        eventType: 'TUNNEL',
        forwardingId: opts.portForwardingId,
        hostId,
        label: opts.description,
        hostName: host.name,
        remoteHost,
        remotePort,
        localPort: assignedLocalPort,
        usedPortFallback: assignedLocalPort !== localPort,
        metadata: { connectionMethod },
      }).catch(() => { /* best-effort analytics */ })
    }

    if (!tunnels.has(tunnelId)) throw new AppError('A conexão SSH encerrou durante a abertura do túnel', 502, 'TUNNEL_CLOSED_DURING_STARTUP')
    try { await this.runtimeRegistry?.publish() } catch {
      await this.close(tunnelId)
      throw new AppError('Não foi possível registrar o túnel entre instâncias', 503, 'TUNNEL_RUNTIME_UNAVAILABLE')
    }
    logger.info({ tunnelId, hostId, requestedLocalPort: localPort, assignedLocalPort, remoteHost, remotePort }, 'Tunnel criado')
    return info
  }

  async testTarget(
    userId: number,
    tenantId: number,
    role: 'admin' | 'user',
    hostId: number,
    remoteHost: string,
    remotePort: number,
  ): Promise<TunnelTargetTestResult> {
    const startedAt = Date.now()
    let connectionMethod: TunnelTargetTestResult['connectionMethod'] = 'direct'
    let ssh: Client | null = null
    let agentSock: Duplex | undefined

    try {
      const host = await this.sshRepo.findHostWithCredentials(hostId, tenantId)
      if (!host) throw new AppError('Host não encontrado', 404, 'HOST_NOT_FOUND')
      await this.assertCanAccessHost(host, userId, role)

      let passwordEncrypted = host.passwordEncrypted
      let pemKey = host.pemKey

      if (host.onePasswordRef) {
        const secret = await this.onePassword.resolve(tenantId, host.onePasswordRef)
        if (host.authType === 'PASSWORD' || host.authType === 'PEM_PASSWORD') {
          passwordEncrypted = JSON.stringify(encrypt(secret))
        } else {
          const enc = encrypt(secret)
          pemKey = { encryptedKey: enc.encrypted, iv: enc.iv }
        }
      }

      const sshConfig = this.buildConnectConfig(host.ip, host.port, host.sshUser, host.authType, passwordEncrypted, pemKey)

      if (host.connectionMode !== 'DIRECT') {
        const wantsPrivateAccess = host.connectionMode === 'PRIVATE_ACCESS_CONNECTOR'
        const resolvedAgent = wantsPrivateAccess
          ? agentRegistry.resolvePrivateAccessConnector(tenantId, host.ip, host.port, host.privateAccessConnectorId)
          : agentRegistry.resolveForConnectionMode(host.connectionMode, userId, tenantId)
        const allowsDirectFallback = host.connectionMode === 'AUTO'

        if (!resolvedAgent && !allowsDirectFallback) {
          const diagnostic = wantsPrivateAccess
            ? agentRegistry.describePrivateAccessResolution(tenantId, host.ip, host.port, host.privateAccessConnectorId)
            : null
          return {
            success: false,
            message: diagnostic?.message ?? 'Este host exige um agente online para testar o destino interno',
            latencyMs: Date.now() - startedAt,
            connectionMethod: wantsPrivateAccess ? 'private_access_connector' : connectionMethod,
          }
        }

        if (resolvedAgent) {
          try {
            const connectionId = randomUUID()
            agentSock = await agentRegistry.createAuthorizedConnection(resolvedAgent.agent, connectionId, host.ip, host.port, { userId, tenantId: tenantId, hostId: host.id, purpose: 'connect' })
            sshConfig.sock = agentSock
            connectionMethod = wantsPrivateAccess
              ? 'private_access_connector'
              : resolvedAgent.source === 'user' ? 'user_agent' : 'tenant_agent'
          } catch (err) {
            if (!allowsDirectFallback || isAgentAccessDenied(err)) {
              return {
                success: false,
                message: describeAgentTcpError(err, host.ip, host.port),
                latencyMs: Date.now() - startedAt,
                connectionMethod: wantsPrivateAccess
                  ? 'private_access_connector'
                  : resolvedAgent.source === 'user' ? 'user_agent' : 'tenant_agent',
              }
            }
            delete sshConfig.sock
            connectionMethod = 'direct'
          }
        }
      }

      const bastionConfig = host.bastion && !sshConfig.sock ? this.buildConnectConfig(host.bastion.ip, host.bastion.port,
        host.bastion.sshUser, host.bastion.authType, host.bastion.passwordEncrypted, host.bastion.pemKey) : undefined
      ssh = await connectTunnelSsh(sshConfig, host.trustedHostKeyFingerprint, bastionConfig)

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new AppError('Tempo limite ao testar o destino interno', 504, 'TUNNEL_TARGET_TIMEOUT')), 5000)
        ssh!.forwardOut('127.0.0.1', 0, remoteHost, remotePort, (err, stream) => {
          clearTimeout(timeout)
          if (err) {
            reject(err)
            return
          }
          stream.close()
          resolve()
        })
      })

      return {
        success: true,
        message: `Destino interno ${remoteHost}:${remotePort} acessível via SSH`,
        latencyMs: Date.now() - startedAt,
        connectionMethod,
      }
    } catch (err) {
      return {
        success: false,
        message: `Não foi possível acessar ${remoteHost}:${remotePort}: ${err instanceof Error ? err.message : String(err)}`,
        latencyMs: Date.now() - startedAt,
        connectionMethod,
      }
    } finally {
      try { ssh?.end() } catch { /* ignore */ }
      try { agentSock?.destroy() } catch { /* ignore */ }
    }
  }

  // ── Fechar túnel ────────────────────────────────────────────────────────────

  async close(tunnelId: string, reason: 'user_closed' | 'acl_revoked' = 'user_closed'): Promise<void> {
    const tunnel = tunnels.get(tunnelId)
    if (!tunnel) return
    tunnels.delete(tunnelId)
    tunnel.localListener?.close()
    if (tunnel.portForwardingId !== undefined) {
      const key = autoTunnelKey(tunnel.tenantId, tunnel.userId, tunnel.hostId, tunnel.portForwardingId)
      if (autoTunnelIndex.get(key) === tunnelId) autoTunnelIndex.delete(key)
    }
    try { tunnel.server.close() } catch { /* ignore */ }
    try { tunnel.ssh.end() }      catch { /* ignore */ }
    try { tunnel.agentSock?.destroy() } catch { /* ignore */ }
    await this.logRepository.logAdminEvent({
      adminId: tunnel.userId,
      action: 'USER_TUNNEL_CLOSED',
      targetType: tunnel.portForwardingId ? 'PortForwarding' : 'Host',
      targetId: tunnel.portForwardingId ?? tunnel.hostId,
      details: tunnelLogDetails(tunnel, reason),
    }).catch(() => { /* best-effort */ })
    await this.runtimeRegistry?.publish().catch(error => logger.warn({ error }, 'Tunnel snapshot update failed'))
    logger.info({ tunnelId }, 'Tunnel encerrado')
  }

  async closeForUser(tunnelId: string, userId: number, tenantId?: number): Promise<void> {
    const tunnel = tunnels.get(tunnelId)
    if (!tunnel) throw new AppError('Túnel não encontrado', 404, 'TUNNEL_NOT_FOUND')
    if (tenantId !== undefined && tunnel.tenantId !== tenantId) throw new AppError('Túnel não encontrado', 404, 'TUNNEL_NOT_FOUND')
    if (tunnel.userId !== userId) throw new AppError('Sem permissão', 403, 'TUNNEL_FORBIDDEN')
    await this.close(tunnelId)
  }

  async autoStartForSession(
    sessionId: string,
    userId: number,
    tenantId: number,
    hostId: number,
    role: 'admin' | 'user',
  ): Promise<{ ok: TunnelInfo[]; errors: TunnelStartupError[] }> {
    const state = { closed: false }
    const pending = pendingSessionStarts.get(sessionId) ?? new Set<{ closed: boolean }>()
    pending.add(state)
    pendingSessionStarts.set(sessionId, pending)
    try {
    const forwardings = await this.sshRepo.getAutoStartForwardings(hostId)
    const ok: TunnelInfo[] = []
    const errors: TunnelStartupError[] = []

    for (const fw of forwardings) {
      if (state.closed) break
      try {
        const key = autoTunnelKey(tenantId, userId, hostId, fw.id)
        const indexedTunnel = autoTunnelIndex.get(key)
        let live = indexedTunnel ? tunnels.get(indexedTunnel) : undefined
        if (!live) {
          const pending = autoTunnelCreations.get(key)
          if (pending) {
            await pending
            const createdId = autoTunnelIndex.get(key)
            live = createdId ? tunnels.get(createdId) : undefined
          }
        }
        if (state.closed) break
        if (live) {
          live.sessionIds.add(sessionId)
          ok.push({ ...toTunnelInfo(live), sessionId })
          continue
        }
        const creation = this.create(userId, tenantId, role, hostId, fw.localPort, fw.remoteHost, fw.remotePort, {
          sessionId,
          portForwardingId: fw.id,
          bindAddress: fw.bindAddress,
          ...(fw.description !== null && { description: fw.description }),
        })
        autoTunnelCreations.set(key, creation)
        const t = await creation.finally(() => {
          if (autoTunnelCreations.get(key) === creation) autoTunnelCreations.delete(key)
        })
        if (state.closed) {
          await this.closeForSession(sessionId)
          break
        }
        ok.push(t)
      } catch (err) {
        if (state.closed) break
        logger.warn({ err, portForwardingId: fw.id, localPort: fw.localPort }, 'Auto-start tunnel falhou')
        errors.push({
          portForwardingId: fw.id,
          bindAddress: fw.bindAddress,
          localPort: fw.localPort,
          ...describeTunnelStartupError(err),
        })
      }
    }
    return { ok, errors }
    } finally {
      pending.delete(state)
      if (pending.size === 0) pendingSessionStarts.delete(sessionId)
    }
  }

  async closeForSession(sessionId: string): Promise<void> {
    for (const state of pendingSessionStarts.get(sessionId) ?? []) state.closed = true
    const owned = [...tunnels.values()].filter(tunnel => tunnel.sessionIds.has(sessionId))
    let closed = 0
    let retained = 0
    await Promise.all(owned.map(async (tunnel) => {
      tunnel.sessionIds.delete(sessionId)
      if (tunnel.sessionIds.size === 0) {
        closed += 1
        await this.close(tunnel.id).catch(() => { /* ignore */ })
        return
      }
      retained += 1
      if (tunnel.sessionId === sessionId) tunnel.sessionId = tunnel.sessionIds.values().next().value
    }))
    logger.info({ sessionId, owned: owned.length, closed, retained }, 'Tuneis da sessão liberados')
  }

  async closeRevokedByAclChange(tenantId: number): Promise<number> {
    const active = [...tunnels.values()].filter(t => t.tenantId === tenantId)
    const groups = new Map<string, LiveTunnel[]>()

    for (const tunnel of active) {
      const key = `${tunnel.userRole}:${tunnel.userId}`
      const current = groups.get(key) ?? []
      current.push(tunnel)
      groups.set(key, current)
    }

    let closed = 0
    for (const group of groups.values()) {
      const first = group[0]
      if (!first) continue
      const allowedHostIds = await this.sshRepo.findHostIdsWithEffectivePermission(
        [...new Set(group.map((tunnel) => tunnel.hostId))],
        tenantId,
        first.userId,
        'connect',
        first.userRole,
      )
      const revoked = group.filter((tunnel) => !allowedHostIds.has(tunnel.hostId))
      await Promise.all(revoked.map(async (tunnel) => {
        await this.close(tunnel.id, 'acl_revoked')
        closed += 1
      }))
    }

    if (closed > 0) logger.info({ tenantId, count: closed }, 'Tuneis encerrados por revogacao de ACL')
    return closed
  }

  // ── Helper: build ConnectConfig ─────────────────────────────────────────────

  private buildConnectConfig(
    host: string, port: number, username: string,
    authType: 'PEM' | 'PASSWORD' | 'PEM_PASSWORD',
    passwordEncrypted?: string | null,
    pemKey?: { encryptedKey: string; iv: string; encryptedPassphrase?: string | null; passphraseIv?: string | null } | null,
  ): ConnectConfig {
    const config: ConnectConfig = { host, port, username, readyTimeout: 15_000 }

    if ((authType === 'PASSWORD' || authType === 'PEM_PASSWORD') && passwordEncrypted) {
      const payload = JSON.parse(passwordEncrypted) as EncryptedPayload
      config.password = decrypt(payload)
    }

    if ((authType === 'PEM' || authType === 'PEM_PASSWORD') && pemKey) {
      config.privateKey = decrypt({ encrypted: pemKey.encryptedKey, iv: pemKey.iv })
      if (pemKey.encryptedPassphrase && pemKey.passphraseIv) {
        config.passphrase = decrypt({ encrypted: pemKey.encryptedPassphrase, iv: pemKey.passphraseIv })
      }
    }

    return config
  }

  private async assertCanAccessHost(
    host: { id: number; tenantId: number },
    userId: number,
    role: 'admin' | 'user',
  ): Promise<void> {
    const normalizedRole = role === 'admin' ? 'ADMIN' : 'USER'
    const canConnect = await this.sshRepo.hasEffectiveHostPermission(host.id, host.tenantId, userId, 'connect', normalizedRole)
    if (!canConnect) throw new AppError('Sem permissão para conectar a este host', 403, 'HOST_FORBIDDEN')
  }
}

function isAddressInUseError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === 'object' && err !== null && 'code' in err && (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
}

function normalizeBindAddress(bindAddress?: string): string {
  if (bindAddress === undefined || bindAddress === '127.0.0.1') return '127.0.0.1'
  if (bindAddress === '0.0.0.0') return '0.0.0.0'
  throw new AppError('Bind address inválido', 422, 'INVALID_BIND_ADDRESS')
}

function tunnelLogDetails(tunnel: TunnelInfo, reason?: 'user_closed' | 'acl_revoked'): string {
  return JSON.stringify({
    tunnelId: tunnel.id,
    hostId: tunnel.hostId,
    hostName: tunnel.hostName,
    connectionMethod: tunnel.connectionMethod,
    bindAddress: tunnel.bindAddress,
    requestedLocalPort: tunnel.requestedLocalPort,
    assignedLocalPort: tunnel.assignedLocalPort,
    usedPortFallback: tunnel.usedPortFallback,
    remoteHost: tunnel.remoteHost,
    remotePort: tunnel.remotePort,
    ...(reason !== undefined && { reason }),
    ...(tunnel.sessionId !== undefined && { sessionId: tunnel.sessionId }),
    ...(tunnel.portForwardingId !== undefined && { portForwardingId: tunnel.portForwardingId }),
    ...(tunnel.description !== undefined && { description: tunnel.description }),
  })
}

function describeTunnelStartupError(err: unknown): { code: string; message: string } {
  if (err instanceof AppError) {
    return { code: err.code, message: err.message }
  }

  if (err instanceof Error) {
    return { code: 'TUNNEL_START_FAILED', message: err.message }
  }

  return { code: 'TUNNEL_START_FAILED', message: 'Falha ao iniciar túnel' }
}
