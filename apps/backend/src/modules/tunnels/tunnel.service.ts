import net from 'node:net'
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

export interface TunnelTargetTestResult {
  success: boolean
  message: string
  latencyMs: number | null
  connectionMethod: 'direct' | 'user_agent' | 'tenant_agent' | 'private_access_connector'
}

interface LiveTunnel extends TunnelInfo {
  server: net.Server
  ssh:    Client
  userRole: 'ADMIN' | 'USER'
  agentSock?: Duplex
}

// In-memory store: tunnelId → LiveTunnel
const tunnels = new Map<string, LiveTunnel>()

export class TunnelService {
  constructor(
    private readonly sshRepo:      SshRepository,
    private readonly onePassword:  OnePasswordService,
    private readonly logRepository: LogRepository,
    private readonly sshTunnelEvents?: SshTunnelEventService,
  ) {}

  // ── Listar túneis ativos do usuário ─────────────────────────────────────────

  listForUser(userId: number): TunnelInfo[] {
    return [...tunnels.values()]
      .filter(t => t.userId === userId)
      .map(({ server: _, ssh: __, userRole: ___, ...info }) => info)
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
          agentSock = await agentRegistry.createConnection(resolvedAgent.agent, connectionId, host.ip, host.port)
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
          if (!allowsDirectFallback) {
            throw new AppError('Falha ao conectar ao host via agente para abrir o tunnel', 502, 'AGENT_TUNNEL_CONNECT_FAILED')
          }
          delete sshConfig.sock
          connectionMethod = 'direct'
        }
      }
    }

    // 5. Conectar ao SSH
    const ssh = new Client()
    try {
      await new Promise<void>((resolve, reject) => {
        ssh
          .on('ready', resolve)
          .on('error', reject)
          .connect(sshConfig)
      })
    } catch (err) {
      try { ssh.end() } catch { /* ignore */ }
      try { sshConfig.sock?.destroy() } catch { /* ignore */ }
      throw err
    }

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
      ...(agentSock !== undefined && { agentSock }),
    })

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

    // Cleanup on SSH disconnect
    ssh.on('end', () => this.close(tunnelId).catch(() => { /* ignore */ }))
    ssh.on('error', () => this.close(tunnelId).catch(() => { /* ignore */ }))

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
            agentSock = await agentRegistry.createConnection(resolvedAgent.agent, connectionId, host.ip, host.port)
            sshConfig.sock = agentSock
            connectionMethod = wantsPrivateAccess
              ? 'private_access_connector'
              : resolvedAgent.source === 'user' ? 'user_agent' : 'tenant_agent'
          } catch (err) {
            if (!allowsDirectFallback) {
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

      ssh = new Client()
      await new Promise<void>((resolve, reject) => {
        ssh!
          .once('ready', resolve)
          .once('error', reject)
          .connect(sshConfig)
      })

      await new Promise<void>((resolve, reject) => {
        ssh!.forwardOut('127.0.0.1', 0, remoteHost, remotePort, (err, stream) => {
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
    logger.info({ tunnelId }, 'Tunnel encerrado')
  }

  async closeForUser(tunnelId: string, userId: number): Promise<void> {
    const tunnel = tunnels.get(tunnelId)
    if (!tunnel) throw new AppError('Túnel não encontrado', 404, 'TUNNEL_NOT_FOUND')
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
    const forwardings = await this.sshRepo.getAutoStartForwardings(hostId)
    const ok: TunnelInfo[] = []
    const errors: TunnelStartupError[] = []

    for (const fw of forwardings) {
      try {
        const t = await this.create(userId, tenantId, role, hostId, fw.localPort, fw.remoteHost, fw.remotePort, {
          sessionId,
          portForwardingId: fw.id,
          bindAddress: fw.bindAddress,
          ...(fw.description !== null && { description: fw.description }),
        })
        ok.push(t)
      } catch (err) {
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
  }

  async closeForSession(sessionId: string): Promise<void> {
    const toClose = [...tunnels.values()].filter(t => t.sessionId === sessionId)
    await Promise.all(toClose.map(t => this.close(t.id).catch(() => { /* ignore */ })))
    logger.info({ sessionId, count: toClose.length }, 'Tuneis da sessão encerrados')
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
    pemKey?: { encryptedKey: string; iv: string } | null,
  ): ConnectConfig {
    const config: ConnectConfig = { host, port, username, readyTimeout: 15_000 }

    if ((authType === 'PASSWORD' || authType === 'PEM_PASSWORD') && passwordEncrypted) {
      const payload = JSON.parse(passwordEncrypted) as EncryptedPayload
      config.password = decrypt(payload)
    }

    if ((authType === 'PEM' || authType === 'PEM_PASSWORD') && pemKey) {
      config.privateKey = decrypt({ encrypted: pemKey.encryptedKey, iv: pemKey.iv })
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
