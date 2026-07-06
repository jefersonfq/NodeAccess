import http from 'node:http'
import https from 'node:https'
import jwt from 'jsonwebtoken'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { env } from '../../config/env.js'
import { logger } from '../../config/logger.js'
import { AppError } from '../../shared/errors.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { SshTunnelEventService } from '../port-forwardings/ssh-tunnel-event.service.js'
import type { PortForwardingService } from '../port-forwardings/port-forwarding.service.js'
import type { TunnelInfo, TunnelService } from '../tunnels/tunnel.service.js'

type UserRole = 'admin' | 'user'
const WEB_ACCESS_TUNNEL_IDLE_MS = 10_000

interface WebAccessTokenPayload {
  sub: string
  tenantId: number
  role: UserRole
  forwardingId: number
  stage: 'web_access'
  iat?: number
  exp?: number
}

interface SharedWebAccessTunnel {
  key: string
  tunnel: TunnelInfo
  refs: number
  idleTimer?: NodeJS.Timeout
  expiresAt: number
  lastUsedAt: number
}

const sharedTunnels = new Map<string, SharedWebAccessTunnel>()
const pendingSharedTunnels = new Map<string, Promise<SharedWebAccessTunnel>>()

export class WebAccessService {
  constructor(
    private readonly portForwardingService: PortForwardingService,
    private readonly tunnelService: TunnelService,
    private readonly logRepository: LogRepository,
    private readonly sshTunnelEvents?: SshTunnelEventService,
  ) {}

  async createLink(
    forwardingId: number,
    tenantId: number,
    userId: number,
    role: UserRole,
  ): Promise<{
    url: string
    expiresIn: string
    assignedLocalPort: number
    requestedLocalPort: number
    usedPortFallback: boolean
  }> {
    const forwarding = await this.portForwardingService.getWebTarget(forwardingId, tenantId, userId, role)
    if (!forwarding.webEnabled) {
      throw new AppError('Este forwarding não está habilitado para acesso web', 409, 'WEB_ACCESS_DISABLED')
    }

    await this.logRepository.logAdminEvent({
      adminId: userId,
      action: 'USER_WEB_ACCESS_OPENED',
      targetType: 'PortForwarding',
      targetId: forwardingId,
    })

    const token = jwt.sign(
      {
        sub: String(userId),
        tenantId,
        role,
        forwardingId,
        stage: 'web_access',
      } satisfies WebAccessTokenPayload,
      env.JWT_SECRET,
      { expiresIn: '5m' },
    )

    const payload = this.verifyToken(token)
    const cacheKey = buildSharedTunnelKey(token, payload.forwardingId)
    const sharedTunnel = await this.acquireSharedTunnel(cacheKey, payload, forwarding)
    this.releaseSharedTunnel(cacheKey)

    await this.sshTunnelEvents?.record({
      tenantId,
      userId,
      eventType: 'WEB',
      forwardingId,
      hostId: forwarding.hostId,
      label: forwarding.description,
      hostName: forwarding.hostName,
      remoteHost: forwarding.remoteHost,
      remotePort: forwarding.remotePort,
      localPort: sharedTunnel.tunnel.assignedLocalPort,
      usedPortFallback: sharedTunnel.tunnel.usedPortFallback,
    }).catch(() => { /* best-effort analytics */ })

    return {
      url: `${env.APP_URL.replace(/\/$/, '')}/api/v1/web-access/proxy?token=${encodeURIComponent(token)}`,
      expiresIn: '5m',
      assignedLocalPort: sharedTunnel.tunnel.assignedLocalPort,
      requestedLocalPort: sharedTunnel.tunnel.requestedLocalPort,
      usedPortFallback: sharedTunnel.tunnel.usedPortFallback,
    }
  }

  async proxy(token: string, request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const payload = this.verifyToken(token)
    const forwarding = await this.portForwardingService.getWebTarget(
      payload.forwardingId,
      payload.tenantId,
      Number(payload.sub),
      payload.role,
    )

    if (!forwarding.webEnabled) {
      throw new AppError('Este forwarding não está habilitado para acesso web', 409, 'WEB_ACCESS_DISABLED')
    }

    const cacheKey = buildSharedTunnelKey(token, payload.forwardingId)
    const sharedTunnel = await this.acquireSharedTunnel(cacheKey, payload, forwarding)

    try {
      const proxyResponse = await this.forwardRequest(request, forwarding, sharedTunnel.tunnel.localPort)
      const proxyBody = rewriteResponseBodyIfNeeded(proxyResponse.body, proxyResponse.headers['content-type'], token)
      reply.code(proxyResponse.statusCode)

      for (const [name, value] of Object.entries(proxyResponse.headers)) {
        if (value === undefined) continue
        if (isHopByHopHeader(name)) continue
        if (name.toLowerCase() === 'location') {
          reply.header(name, rewriteLocationHeader(value, forwarding.webProtocol, forwarding.remoteHost, forwarding.remotePort, token))
          continue
        }
        if (name.toLowerCase() === 'set-cookie') {
          reply.header(name, rewriteSetCookieHeader(value, token))
          continue
        }
        reply.header(name, value)
      }

      return reply.send(proxyBody)
    } finally {
      this.releaseSharedTunnel(cacheKey)
    }
  }

  private verifyToken(token: string): WebAccessTokenPayload {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as WebAccessTokenPayload
      if (payload.stage !== 'web_access') throw new Error('Invalid token stage')
      return payload
    } catch {
      throw new AppError('Link de acesso web inválido ou expirado', 401, 'WEB_ACCESS_TOKEN_INVALID')
    }
  }

  private async forwardRequest(
    request: FastifyRequest,
    forwarding: { webProtocol: 'http' | 'https'; remoteHost: string; remotePort: number },
    localPort: number,
  ): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
    const pathSuffix = this.getProxyPath(request)
    const path = buildUpstreamPath(request.url, pathSuffix || '/')
    const body = await readRequestBody(request)
    const headers = sanitizeRequestHeaders(request.headers, forwarding.remoteHost, forwarding.remotePort, forwarding.webProtocol)
    const client = forwarding.webProtocol === 'https' ? https : http

    return new Promise((resolve, reject) => {
      const req = client.request(
        {
          host: '127.0.0.1',
          port: localPort,
          method: request.method,
          path,
          headers,
          rejectUnauthorized: false,
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode ?? 502,
              headers: res.headers,
              body: Buffer.concat(chunks),
            })
          })
        },
      )

      req.on('error', (err) => reject(new AppError(`Falha ao acessar o serviço web: ${err.message}`, 502, 'WEB_ACCESS_PROXY_FAILED')))

      if (body.length > 0) req.write(body)
      req.end()
    })
  }

  private getProxyPath(request: FastifyRequest): string {
    const params = request.params as { '*': string }
    const wildcard = params['*']
    return wildcard ? `/${wildcard}` : '/'
  }

  private async acquireSharedTunnel(
    cacheKey: string,
    payload: WebAccessTokenPayload,
    forwarding: {
      id: number
      hostId: number
      hostName: string
      description: string | null
      remoteHost: string
      remotePort: number
    },
  ): Promise<SharedWebAccessTunnel> {
    const now = Date.now()
    const existing = sharedTunnels.get(cacheKey)
    if (existing && existing.expiresAt > now) {
      if (existing.idleTimer) {
        clearTimeout(existing.idleTimer)
        delete existing.idleTimer
      }
      existing.refs += 1
      existing.lastUsedAt = now
      logger.info({
        cacheKey,
        tunnelId: existing.tunnel.id,
        localPort: existing.tunnel.localPort,
        refs: existing.refs,
      }, 'Web access tunnel reused')
      return existing
    }

    if (existing) {
      sharedTunnels.delete(cacheKey)
      this.scheduleTunnelClose(existing.tunnel.id, 0)
    }

    const pending = pendingSharedTunnels.get(cacheKey)
    if (pending) {
      const shared = await pending
      if (shared.idleTimer) {
        clearTimeout(shared.idleTimer)
        delete shared.idleTimer
      }
      shared.refs += 1
      return shared
    }

    const expiresAt = Math.max(now, (payload.exp ?? Math.ceil(now / 1000)) * 1000)
    const created = this.tunnelService.create(
      Number(payload.sub),
      payload.tenantId,
      payload.role,
      forwarding.hostId,
      0,
      forwarding.remoteHost,
      forwarding.remotePort,
      {
        bindAddress: '127.0.0.1',
        portForwardingId: forwarding.id,
        description: forwarding.description ?? `Web access: ${forwarding.hostName}:${forwarding.remotePort}`,
        recordSshTunnel: false,
      },
    ).then((tunnel) => {
      const shared: SharedWebAccessTunnel = {
        key: cacheKey,
        tunnel,
        refs: 0,
        expiresAt,
        lastUsedAt: now,
      }
      sharedTunnels.set(cacheKey, shared)
      pendingSharedTunnels.delete(cacheKey)
      logger.info({
        cacheKey,
        tunnelId: tunnel.id,
        hostId: tunnel.hostId,
        localPort: tunnel.localPort,
        expiresAt,
      }, 'Web access tunnel created')
      return shared
    }).catch((error) => {
      pendingSharedTunnels.delete(cacheKey)
      throw error
    })

    pendingSharedTunnels.set(cacheKey, created)
    const shared = await created
    shared.refs += 1
    shared.lastUsedAt = Date.now()
    return shared
  }

  private releaseSharedTunnel(cacheKey: string): void {
    const shared = sharedTunnels.get(cacheKey)
    if (!shared) return
    shared.refs = Math.max(0, shared.refs - 1)
    if (shared.refs > 0) return

    const now = Date.now()
    const maxIdleMs = Math.max(0, shared.expiresAt - now)
    const idleMs = Math.min(WEB_ACCESS_TUNNEL_IDLE_MS, maxIdleMs)
    if (idleMs === 0) {
      sharedTunnels.delete(cacheKey)
      logger.info({
        cacheKey,
        tunnelId: shared.tunnel.id,
        refs: shared.refs,
      }, 'Web access tunnel closing immediately')
      this.scheduleTunnelClose(shared.tunnel.id, 0)
      return
    }

    shared.idleTimer = setTimeout(() => {
      const current = sharedTunnels.get(cacheKey)
      if (!current || current.refs > 0) return
      sharedTunnels.delete(cacheKey)
      logger.info({
        cacheKey,
        tunnelId: current.tunnel.id,
        idleMs,
        lastUsedAt: current.lastUsedAt,
      }, 'Web access tunnel closed after idle timeout')
      this.scheduleTunnelClose(current.tunnel.id, 0)
    }, idleMs)
  }

  private scheduleTunnelClose(tunnelId: string, delayMs: number): void {
    setTimeout(() => {
      this.tunnelService.close(tunnelId).catch(() => { /* ignore */ })
    }, delayMs)
  }
}

function buildSharedTunnelKey(token: string, forwardingId: number): string {
  return `${forwardingId}:${token}`
}

function isHopByHopHeader(name: string): boolean {
  return ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'].includes(name.toLowerCase())
}

async function readRequestBody(request: FastifyRequest): Promise<Buffer> {
  if (request.method === 'GET' || request.method === 'HEAD') return Buffer.alloc(0)

  if (request.body !== undefined && request.body !== null) {
    if (Buffer.isBuffer(request.body)) return request.body
    if (typeof request.body === 'string') return Buffer.from(request.body)
    return Buffer.from(JSON.stringify(request.body))
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.raw.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    request.raw.on('end', () => resolve(Buffer.concat(chunks)))
    request.raw.on('error', reject)
  })
}

function sanitizeRequestHeaders(
  headers: http.IncomingHttpHeaders,
  remoteHost: string,
  remotePort: number,
  protocol: 'http' | 'https',
): http.OutgoingHttpHeaders {
  const next: http.OutgoingHttpHeaders = {}

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    if (isHopByHopHeader(name)) continue
    if (name.toLowerCase() === 'host') continue
    if (name.toLowerCase() === 'authorization') continue
    next[name] = value
  }

  next.host = `${remoteHost}:${remotePort}`
  next['x-forwarded-host'] = remoteHost
  next['x-forwarded-port'] = String(remotePort)
  next['x-forwarded-proto'] = protocol
  return next
}

function rewriteLocationHeader(
  value: string | string[],
  protocol: 'http' | 'https',
  remoteHost: string,
  remotePort: number,
  token: string,
): string | string[] {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteLocationHeader(item, protocol, remoteHost, remotePort, token) as string)
  }

  if (value.startsWith('/')) {
    return buildProxyUrl(token, value)
  }

  try {
    const target = new URL(value)
    const sameOrigin = target.protocol === `${protocol}:` && target.hostname === remoteHost && Number(target.port || defaultPortForProtocol(protocol)) === remotePort
    if (!sameOrigin) return value

    const path = `${target.pathname}${target.search}${target.hash}`
    return buildProxyUrl(token, path)
  } catch {
    return value
  }
}

function rewriteSetCookieHeader(value: string | string[], token: string): string[] {
  const cookies = Array.isArray(value) ? value : [value]
  return cookies.map((cookie) => {
    let next = cookie
    next = next.replace(/;\s*Domain=[^;]+/i, '')
    if (/;\s*Path=/i.test(next)) {
      next = next.replace(/;\s*Path=[^;]*/i, `; Path=/api/v1/web-access/proxy`)
    } else {
      next = `${next}; Path=/api/v1/web-access/proxy`
    }
    if (!/;\s*SameSite=/i.test(next)) next = `${next}; SameSite=Lax`
    return next
  })
}

function defaultPortForProtocol(protocol: 'http' | 'https'): number {
  return protocol === 'https' ? 443 : 80
}

function buildProxyUrl(token: string, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `/api/v1/web-access/proxy${normalizedPath}?token=${encodeURIComponent(token)}`
}

function buildUpstreamPath(requestUrl: string, pathSuffix: string): string {
  const url = new URL(requestUrl, 'http://localhost')
  url.searchParams.delete('token')
  const query = url.searchParams.toString()
  return `${pathSuffix}${query ? `?${query}` : ''}`
}

function rewriteResponseBodyIfNeeded(
  body: Buffer,
  contentType: string | string[] | undefined,
  token: string,
): Buffer {
  const type = Array.isArray(contentType) ? contentType[0] : contentType
  if (!type) return body

  const normalized = type.toLowerCase()
  if (normalized.includes('text/html') || normalized.includes('application/xhtml+xml')) {
    const html = body.toString('utf-8')
    const rewritten = injectCompatibilityScript(
      html
        .replace(/\b(src|href|action)\s*=\s*(["'])\/(?!\/)([^"']*)\2/gi, (_m, attr, quote, path) => `${attr}=${quote}${buildProxyUrl(token, `/${path}`)}${quote}`)
        .replace(/\b(src|href|action)\s*=\s*\/([^\s>]+)/gi, (_m, attr, path) => `${attr}="${buildProxyUrl(token, `/${path}`)}"`)
        .replace(/url\((["']?)\/(?!\/)([^)"']*)\1\)/gi, (_m, quote, path) => `url(${quote}${buildProxyUrl(token, `/${path}`)}${quote})`)
        .replace(/(<base\s+href=["'])\/(?!\/)/gi, `$1${buildProxyUrl(token, '/')}`),
      token,
    )

    return Buffer.from(rewritten, 'utf-8')
  }

  if (normalized.includes('text/css')) {
    const css = body.toString('utf-8')
    const rewritten = css
      .replace(/url\((["']?)\/(?!\/)([^)"']*)\1\)/gi, (_m, quote, path) => `url(${quote}${buildProxyUrl(token, `/${path}`)}${quote})`)
      .replace(/@import\s+(["'])\/(?!\/)([^"']*)\1/gi, (_m, quote, path) => `@import ${quote}${buildProxyUrl(token, `/${path}`)}${quote}`)

    return Buffer.from(rewritten, 'utf-8')
  }

  return body
}

function injectCompatibilityScript(html: string, token: string): string {
  const script = `
<script>
(function(){
  var token = ${JSON.stringify(token)};
  function rewrite(url) {
    if (!url || typeof url !== 'string') return url;
    if (!url.startsWith('/')) return url;
    if (url.startsWith('//')) return url;
    if (url.startsWith('/api/v1/web-access/proxy')) return url;
    var joiner = url.indexOf('?') === -1 ? '?' : '&';
    return '/api/v1/web-access/proxy' + url + joiner + 'token=' + encodeURIComponent(token);
  }
  function patchAttributeSetter(proto, attrName) {
    if (!proto || typeof proto.setAttribute !== 'function') return;
    var originalSetAttribute = proto.setAttribute;
    proto.setAttribute = function(name, value) {
      if (typeof name === 'string' && name.toLowerCase() === attrName && typeof value === 'string') {
        value = rewrite(value);
      }
      return originalSetAttribute.call(this, name, value);
    };
  }
  function patchPropertySetter(proto, propName) {
    if (!proto) return;
    var descriptor = Object.getOwnPropertyDescriptor(proto, propName);
    if (!descriptor || typeof descriptor.set !== 'function') return;
    Object.defineProperty(proto, propName, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set: function(value) {
        if (typeof value === 'string') {
          value = rewrite(value);
        }
        return descriptor.set.call(this, value);
      }
    });
  }
  var originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function(input, init) {
      if (typeof input === 'string') {
        input = rewrite(input);
      } else if (input && typeof input.url === 'string') {
        input = new Request(rewrite(input.url), input);
      }
      return originalFetch.call(this, input, init);
    };
  }
  var originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    arguments[1] = rewrite(url);
    return originalOpen.apply(this, arguments);
  };
  var originalSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function() {
    if (this.action) this.action = rewrite(this.action);
    return originalSubmit.call(this);
  };
  document.addEventListener('submit', function(event) {
    var form = event.target;
    if (form && form.action) form.action = rewrite(form.action);
  }, true);
  patchAttributeSetter(Element.prototype, 'src');
  patchAttributeSetter(Element.prototype, 'href');
  patchAttributeSetter(Element.prototype, 'action');
  patchPropertySetter(HTMLImageElement && HTMLImageElement.prototype, 'src');
  patchPropertySetter(HTMLScriptElement && HTMLScriptElement.prototype, 'src');
  patchPropertySetter(HTMLIFrameElement && HTMLIFrameElement.prototype, 'src');
  patchPropertySetter(HTMLLinkElement && HTMLLinkElement.prototype, 'href');
  patchPropertySetter(HTMLAnchorElement && HTMLAnchorElement.prototype, 'href');
  patchPropertySetter(HTMLFormElement && HTMLFormElement.prototype, 'action');
})();
</script>`

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, script + '</head>')
  }
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body[^>]*>/i, function(match) { return match + script })
  }
  return script + html
}
