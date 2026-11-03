import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import jwt from 'jsonwebtoken'
import { runInNewContext } from 'node:vm'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { env } from '../../config/env.js'
import { WebAccessService } from './web-access.service.js'

vi.mock('../../config/logger.js', () => ({ logger: { info: vi.fn() } }))
let sequence = 100
const servers: http.Server[] = []
function setup(port = 1) {
  const id = ++sequence
  const target = { id, hostId: id + 1, hostName: 'fixture', description: null as string | null, remoteHost: 'fixture.internal', remotePort: 8080, webProtocol: 'http' as 'http' | 'https', webEnabled: true }
  const forwards = { getWebTarget: vi.fn().mockResolvedValue(target) }
  const tunnel = { id: `tunnel-${id}`, hostId: target.hostId, localPort: port, assignedLocalPort: port, requestedLocalPort: 0, usedPortFallback: false }
  const tunnels = { create: vi.fn().mockResolvedValue(tunnel), close: vi.fn().mockResolvedValue(undefined) }
  const logs = { logAdminEvent: vi.fn().mockResolvedValue(undefined) }
  const events = { record: vi.fn().mockResolvedValue(undefined) }
  const service = new WebAccessService(forwards as never, tunnels as never, logs as never, events as never)
  const token = (claims = {}, expiresIn = 300) => jwt.sign({ sub: '9', tenantId: 7, role: 'user', forwardingId: id, stage: 'web_access', ...claims }, env.JWT_SECRET, { expiresIn })
  return { service, forwards, target, tunnels, tunnel, logs, events, token }
}
function request(body?: unknown, method = 'GET', suffix = '') {
  return { method, url: `/api/v1/web-access/proxy/${suffix}?token=not-upstream&q=hello+world`, params: { '*': suffix }, headers: { authorization: 'Bearer app-secret', host: 'nodeaccess.internal', 'x-test': 'kept', connection: 'close', absent: undefined }, body, raw: Readable.from([]) } as unknown as FastifyRequest
}
function reply() {
  const headers: Record<string, unknown> = {}
  const result = { status: 0, body: Buffer.alloc(0) }
  const response = { code: vi.fn((code: number) => { result.status = code; return response }), header: vi.fn((name: string, value: unknown) => { headers[name] = value; return response }), send: vi.fn((body: Buffer) => { result.body = body }) }
  return { response: response as unknown as FastifyReply, headers, result }
}
async function upstream(handler: http.RequestListener) {
  const server = http.createServer(handler)
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return (server.address() as { port: number }).port
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }) })
afterEach(async () => {
  if (vi.isFakeTimers()) await vi.runAllTimersAsync()
  vi.useRealTimers()
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections() })))
  vi.restoreAllMocks()
})

describe('WebAccessService contracts', () => {
  it('creates a five-minute scoped link, loopback tunnel and audit event', async () => {
    const s = setup(45678)
    const result = await s.service.createLink(s.target.id, 7, 9, 'user', 'https://app.example.invalid/')
    const url = new URL(result.url)
    const payload = jwt.verify(url.searchParams.get('token')!, env.JWT_SECRET) as jwt.JwtPayload
    expect(url.origin).toBe('https://app.example.invalid')
    expect(payload).toMatchObject({ sub: '9', tenantId: 7, role: 'user', forwardingId: s.target.id, stage: 'web_access' })
    expect(payload.exp! - payload.iat!).toBe(300)
    expect(result).toMatchObject({ expiresIn: '5m', assignedLocalPort: 45678, requestedLocalPort: 0, usedPortFallback: false })
    expect(s.forwards.getWebTarget).toHaveBeenCalledWith(s.target.id, 7, 9, 'user')
    expect(s.tunnels.create).toHaveBeenCalledWith(9, 7, 'user', s.target.hostId, 0, 'fixture.internal', 8080, { bindAddress: '127.0.0.1', portForwardingId: s.target.id, description: 'Web access: fixture:8080', recordSshTunnel: false })
    expect(s.logs.logAdminEvent).toHaveBeenCalledWith({ adminId: 9, action: 'USER_WEB_ACCESS_OPENED', targetType: 'PortForwarding', targetId: s.target.id })
    expect(s.events.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 7, userId: 9, eventType: 'WEB', localPort: 45678 }))
    expect(s.tunnels.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_001)
    expect(s.tunnels.close).toHaveBeenCalledWith(s.tunnel.id)
  })
  it('uses configured app URL and tolerates analytics and close failures', async () => {
    const s = setup(); s.target.description = 'Management UI'
    s.events.record.mockRejectedValue(new Error('analytics offline')); s.tunnels.close.mockRejectedValue(new Error('already closed'))
    const result = await s.service.createLink(s.target.id, 7, 9, 'admin')
    expect(result.url).toContain(`${env.APP_URL.replace(/\/$/, '')}/api/v1/web-access/proxy?token=`)
    expect(s.tunnels.create.mock.calls[0]?.[7]).toMatchObject({ description: 'Management UI' })
    await vi.runAllTimersAsync()
    expect(s.tunnels.close).toHaveBeenCalledOnce()
  })
  it('rejects disabled forwarding before audit/tunnel creation', async () => {
    const s = setup(); s.target.webEnabled = false
    await expect(s.service.createLink(s.target.id, 7, 9, 'user')).rejects.toMatchObject({ code: 'WEB_ACCESS_DISABLED' })
    expect(s.logs.logAdminEvent).not.toHaveBeenCalled(); expect(s.tunnels.create).not.toHaveBeenCalled()
  })
  it('propagates access denial and audit failure before opening a tunnel', async () => {
    const s = setup(); s.forwards.getWebTarget.mockRejectedValueOnce(new Error('denied'))
    await expect(s.service.createLink(s.target.id, 7, 9, 'user')).rejects.toThrow('denied')
    s.logs.logAdminEvent.mockRejectedValueOnce(new Error('audit offline'))
    await expect(s.service.createLink(s.target.id, 7, 9, 'user')).rejects.toThrow('audit offline')
    expect(s.tunnels.create).not.toHaveBeenCalled()
  })
  it.each(['malformed', 'expired', 'stage', 'signature'])('rejects %s tokens before looking up target', async kind => {
    const s = setup()
    const token = kind === 'malformed' ? 'bad' : kind === 'expired' ? s.token({}, -1) : kind === 'stage' ? s.token({ stage: 'login' }) : jwt.sign({ stage: 'web_access' }, 'different-secret')
    await expect(s.service.proxy(token, request(), reply().response)).rejects.toMatchObject({ code: 'WEB_ACCESS_TOKEN_INVALID' })
    expect(s.forwards.getWebTarget).not.toHaveBeenCalled(); expect(s.tunnels.create).not.toHaveBeenCalled()
  })
  it('rechecks forwarding access and enabled state on each request', async () => {
    const s = setup(); s.target.webEnabled = false
    await expect(s.service.proxy(s.token(), request(), reply().response)).rejects.toMatchObject({ code: 'WEB_ACCESS_DISABLED' })
    expect(s.forwards.getWebTarget).toHaveBeenCalledWith(s.target.id, 7, 9, 'user')
    expect(s.tunnels.create).not.toHaveBeenCalled()
  })
  it('forwards real HTTP with query, strips application credentials and hop headers', async () => {
    let seen: { url?: string; headers: http.IncomingHttpHeaders } | undefined
    const port = await upstream((req, res) => { seen = { url: req.url, headers: req.headers }; res.writeHead(201, { 'content-type': 'application/json', connection: 'close', 'x-upstream': 'yes' }); res.end('{"ok":true}') })
    const s = setup(port), r = reply()
    await s.service.proxy(s.token(), request(undefined, 'GET', 'status'), r.response)
    expect(seen?.url).toBe('/status?q=hello+world')
    expect(seen?.headers.authorization).toBeUndefined()
    expect(seen?.headers).toMatchObject({ host: 'fixture.internal:8080', 'x-test': 'kept', 'x-forwarded-host': 'fixture.internal', 'x-forwarded-port': '8080', 'x-forwarded-proto': 'http' })
    expect(r.result).toEqual({ status: 201, body: Buffer.from('{"ok":true}') })
    expect(r.headers['x-upstream']).toBe('yes'); expect(r.headers.connection).toBeUndefined()
  })
  it.each([['string', 'message', 'message'], ['buffer', Buffer.from('bytes'), 'bytes'], ['json', { ok: true }, '{"ok":true}']] as const)('forwards %s request body', async (_name, body, expected) => {
    let received = ''
    const port = await upstream((req, res) => { req.on('data', (chunk: Buffer) => { received += chunk.toString() }); req.on('end', () => { res.end('accepted') }) })
    const s = setup(port), r = reply()
    await s.service.proxy(s.token(), request(body, 'POST', 'submit'), r.response)
    expect(received).toBe(expected); expect(r.result.body.toString()).toBe('accepted')
  })
  it('reads a raw stream body and preserves binary response without content type', async () => {
    let received = ''
    const port = await upstream((req, res) => { req.on('data', (chunk: Buffer) => { received += chunk.toString() }); req.on('end', () => { res.end(Buffer.from([0, 1, 255])) }) })
    const s = setup(port), r = reply(), req = request(undefined, 'PATCH')
    Object.assign(req, { raw: Readable.from(['one', Buffer.from('two')]) })
    await s.service.proxy(s.token(), req, r.response)
    expect(received).toBe('onetwo'); expect(r.result.body).toEqual(Buffer.from([0, 1, 255]))
  })
  it('propagates a raw body stream failure and still releases tunnel', async () => {
    const s = setup(), req = request(undefined, 'POST')
    Object.assign(req, { raw: new Readable({ read() { this.destroy(new Error('client disconnected')) } }) })
    await expect(s.service.proxy(s.token(), req, reply().response)).rejects.toThrow('client disconnected')
    await vi.runAllTimersAsync(); expect(s.tunnels.close).toHaveBeenCalledWith(s.tunnel.id)
  })
  it('maps upstream connection failure to 502 and releases tunnel', async () => {
    const port = await upstream((_req, res) => { res.end() })
    const server = servers.pop()!
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()) })
    const s = setup(port)
    await expect(s.service.proxy(s.token(), request(), reply().response)).rejects.toMatchObject({ statusCode: 502, code: 'WEB_ACCESS_PROXY_FAILED' })
    await vi.runAllTimersAsync(); expect(s.tunnels.close).toHaveBeenCalledOnce()
  })
  it('retries tunnel creation after a failed opening instead of caching rejection', async () => {
    const s = setup(); s.tunnels.create.mockRejectedValueOnce(new Error('SSH unavailable'))
    await expect(s.service.createLink(s.target.id, 7, 9, 'user')).rejects.toThrow('SSH unavailable')
    await expect(s.service.createLink(s.target.id, 7, 9, 'user')).resolves.toHaveProperty('url')
    expect(s.tunnels.create).toHaveBeenCalledTimes(2)
  })
  it('shares pending/open tunnels for the same link and resets idle close', async () => {
    const s = setup()
    let resolveTunnel!: (value: typeof s.tunnel) => void
    s.tunnels.create.mockImplementationOnce(() => new Promise(resolve => { resolveTunnel = resolve }))
    const first = s.service.createLink(s.target.id, 7, 9, 'user')
    const second = s.service.createLink(s.target.id, 7, 9, 'user')
    await vi.waitFor(() => expect(s.tunnels.create).toHaveBeenCalledOnce())
    resolveTunnel(s.tunnel)
    const [a, b] = await Promise.all([first, second]); expect(a.url).toBe(b.url)
    await vi.advanceTimersByTimeAsync(5000)
    // Existing JWT differs if time moves; use the same signed link for proxy requests.
    const port = await upstream((_req, res) => { res.end('ok') }); s.tunnel.localPort = port
    const token = new URL(a.url).searchParams.get('token')!
    await s.service.proxy(token, request(), reply().response)
    expect(s.tunnels.create).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(5001); expect(s.tunnels.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5000); expect(s.tunnels.close).toHaveBeenCalledOnce()
  })
  it.each([
    ['/login', '/api/v1/web-access/proxy/login?token='],
    ['http://fixture.internal:8080/login', '/api/v1/web-access/proxy/login?token='],
    ['https://elsewhere.invalid/login', 'https://elsewhere.invalid/login'],
    ['relative-login', 'relative-login'],
  ])('rewrites only target redirects: %s', async (location, expected) => {
    const port = await upstream((_req, res) => { res.writeHead(302, { location }); res.end() })
    const s = setup(port), r = reply()
    await s.service.proxy(s.token(), request(), r.response)
    expect(r.result.status).toBe(302); expect(r.headers.location).toEqual(expect.stringContaining(expected))
  })
  it('limits upstream cookies to proxy path and preserves explicit SameSite', async () => {
    const port = await upstream((_req, res) => { res.setHeader('set-cookie', ['a=1; Domain=fixture.internal; Path=/admin; HttpOnly', 'b=2; SameSite=Strict']); res.end('ok') })
    const s = setup(port), r = reply()
    await s.service.proxy(s.token(), request(), r.response)
    expect(r.headers['set-cookie']).toEqual(['a=1; Path=/api/v1/web-access/proxy; HttpOnly; SameSite=Lax', 'b=2; SameSite=Strict; Path=/api/v1/web-access/proxy'])
  })
  it.each(['<html><head></head><body>CONTENT</body></html>', '<body>CONTENT</body>', 'CONTENT'])('rewrites HTML resources and injects compatibility script in supported documents', async template => {
    const html = template.replace('CONTENT', '<img src="/image.png"><a href="https://external.invalid/">External</a><form action=/save></form><style>.x{background:url(/bg.png)}</style>')
    const port = await upstream((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(html) })
    const s = setup(port), r = reply(), token = s.token()
    await s.service.proxy(token, request(), r.response)
    const body = r.result.body.toString()
    expect(body).toContain(`/api/v1/web-access/proxy/image.png?token=${token}`)
    expect(body).toContain(`/api/v1/web-access/proxy/save?token=${token}`)
    expect(body).toContain(`/api/v1/web-access/proxy/bg.png?token=${token}`)
    expect(body).toContain('href="https://external.invalid/"'); expect(body).toContain('var originalFetch = window.fetch')
  })
  it('rewrites root CSS URLs/imports while preserving external references', async () => {
    const port = await upstream((_req, res) => { res.setHeader('content-type', 'text/css'); res.end('@import "/main.css"; .a{background:url("/image.png")} .b{background:url(https://cdn.invalid/x)}') })
    const s = setup(port), r = reply(), token = s.token()
    await s.service.proxy(token, request(), r.response)
    expect(r.result.body.toString()).toBe(`@import "/api/v1/web-access/proxy/main.css?token=${token}"; .a{background:url("/api/v1/web-access/proxy/image.png?token=${token}")} .b{background:url(https://cdn.invalid/x)}`)
  })
  it('keeps a tunnel alive during concurrent requests and closes after the final response', async () => {
    const pending: http.ServerResponse[] = []
    const port = await upstream((_req, res) => { pending.push(res) })
    const s = setup(port), token = s.token()
    const first = s.service.proxy(token, request(), reply().response)
    const second = s.service.proxy(token, request(), reply().response)
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    expect(s.tunnels.create).toHaveBeenCalledOnce()
    pending[0]!.end('first'); await first
    await vi.advanceTimersByTimeAsync(11_000)
    expect(s.tunnels.close).not.toHaveBeenCalled()
    pending[1]!.end('second'); await second
    await vi.advanceTimersByTimeAsync(10_001)
    expect(s.tunnels.close).toHaveBeenCalledOnce()
  })
  it('closes after an active response finishes when its token has expired', async () => {
    let pending: http.ServerResponse | undefined
    const port = await upstream((_req, res) => { pending = res })
    const s = setup(port)
    const operation = s.service.proxy(s.token({}, 1), request(), reply().response)
    await vi.waitFor(() => expect(pending).toBeDefined())
    await vi.advanceTimersByTimeAsync(1500)
    expect(s.tunnels.close).not.toHaveBeenCalled()
    pending!.end('done'); await operation
    await vi.runAllTimersAsync()
    expect(s.tunnels.close).toHaveBeenCalledWith(s.tunnel.id)
  })
  it('never shares tunnels between different tenant tokens', async () => {
    const port = await upstream((_req, res) => { res.end('ok') })
    const s = setup(port)
    await s.service.proxy(s.token({ tenantId: 7 }), request(), reply().response)
    await s.service.proxy(s.token({ tenantId: 8 }), request(), reply().response)
    expect(s.tunnels.create).toHaveBeenCalledTimes(2)
    expect(s.tunnels.create.mock.calls.map(call => call[1] as number)).toEqual([7, 8])
  })
  it('ignores parsed body on HEAD requests', async () => {
    let body = '', method: string | undefined
    const port = await upstream((req, res) => { method = req.method; req.on('data', (chunk: Buffer) => { body += chunk.toString() }); req.on('end', () => { res.end() }) })
    const s = setup(port), r = reply()
    await s.service.proxy(s.token(), request('must not forward', 'HEAD'), r.response)
    expect(method).toBe('HEAD'); expect(r.result.status).toBe(200); expect(body).toBe('')
  })

  it.each(['/login?next=%2Fdashboard#details', 'http://fixture.internal:8080/login?next=%2Fdashboard#details'])('preserves query and fragment in redirect %s', async location => {
    const port = await upstream((_req, res) => { res.writeHead(302, { location }); res.end() })
    const s = setup(port), r = reply(), token = s.token()
    await s.service.proxy(token, request(), r.response)
    const rewritten = new URL(r.headers.location as string, 'http://app.invalid')
    expect(rewritten.pathname).toBe('/api/v1/web-access/proxy/login')
    expect(rewritten.searchParams.get('next')).toBe('/dashboard')
    expect(rewritten.searchParams.get('token')).toBe(token)
    expect(rewritten.hash).toBe('#details')
  })
  it.each(['text/html', 'text/css'])('preserves repeated query and replaces upstream token in %s resource', async contentType => {
    const path = '/asset?v=1&v=2&token=upstream-token#fragment'
    const port = await upstream((_req, res) => { res.setHeader('content-type', contentType); res.end(contentType === 'text/html' ? `<img src="${path}">` : `a{background:url("${path}")}`) })
    const s = setup(port), r = reply(), token = s.token()
    await s.service.proxy(token, request(), r.response)
    const resource = r.result.body.toString().match(/(?:src="|url\(")(.*?)"/)
    expect(resource).not.toBeNull()
    const rewritten = new URL(resource![1]!, 'http://app.invalid')
    expect(rewritten.pathname).toBe('/api/v1/web-access/proxy/asset')
    expect(rewritten.searchParams.getAll('v')).toEqual(['1', '2'])
    expect(rewritten.searchParams.getAll('token')).toEqual([token])
    expect(rewritten.hash).toBe('#fragment')
  })

  it('preserves query and fragment for dynamically fetched root-relative URLs', async () => {
    const port = await upstream((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<html><head></head><body></body></html>') })
    const s = setup(port), r = reply(), token = s.token()
    await s.service.proxy(token, request(), r.response)
    const script = r.result.body.toString().match(/<script>([\s\S]*?)<\/script>/)![1]!
    const fetch = vi.fn(), open = vi.fn()
    class Element { setAttribute = vi.fn() }
    class Form extends Element { submit = vi.fn() }
    const context = { URLSearchParams, window: { fetch }, XMLHttpRequest: { prototype: { open } }, HTMLFormElement: Form, Element,
      HTMLImageElement: class extends Element {}, HTMLScriptElement: class extends Element {}, HTMLIFrameElement: class extends Element {}, HTMLLinkElement: class extends Element {}, HTMLAnchorElement: class extends Element {}, document: { addEventListener: vi.fn() } }
    runInNewContext(script, context, { timeout: 1000 })
    context.window.fetch('/api?tag=a&tag=b&token=old#section')
    const rewritten = new URL(fetch.mock.calls[0]![0] as string, 'http://app.invalid')
    expect(rewritten.pathname).toBe('/api/v1/web-access/proxy/api')
    expect(rewritten.searchParams.getAll('tag')).toEqual(['a', 'b'])
    expect(rewritten.searchParams.getAll('token')).toEqual([token])
    expect(rewritten.hash).toBe('#section')
    context.window.fetch('//external.invalid/path?x=1#hash')
    expect(fetch.mock.calls[1]![0]).toBe('//external.invalid/path?x=1#hash')
    context.window.fetch(`/api/v1/web-access/proxy/already?token=${token}`)
    expect(fetch.mock.calls[2]![0]).toBe(`/api/v1/web-access/proxy/already?token=${token}`)
  })

  it.runIf(process.env.RUN_WEB_PROXY_BROWSER === '1')('runs compatibility rewrites in Chromium without duplicate query tokens', async () => {
    vi.useRealTimers()
    const port = await upstream((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<html><head><meta charset="utf-8"><title>Proxy fixture</title></head><body><h1>Proxy web — laboratório</h1><p id="result">Validando link dinâmico...</p></body></html>') })
    const s = setup(port), r = reply(), token = s.token()
    await s.service.proxy(token, request(), r.response)
    const { chromium } = await import('playwright')
    const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] })
    try {
      const page = await browser.newPage({ viewport: { width: 1100, height: 500 } })
      const requests: string[] = [], errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: r.result.body.toString() })
        requests.push(url.toString())
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
      })
      await page.goto('http://fixture.invalid/')
      await page.evaluate(async () => {
        const result = await fetch('/api?tag=a&tag=b&token=old#section')
        const data = await result.json() as { ok: boolean }
        const dom = (globalThis as unknown as { document: { querySelector(selector: string): { textContent: string } | null } }).document
        dom.querySelector('#result')!.textContent = data.ok ? 'Reescrita dinâmica validada no Chromium.' : 'Falha'
      })
      const rewritten = new URL(requests[0]!)
      expect(rewritten.pathname).toBe('/api/v1/web-access/proxy/api')
      expect(rewritten.searchParams.getAll('tag')).toEqual(['a', 'b'])
      expect(rewritten.searchParams.getAll('token')).toEqual([token])
      expect(errors).toEqual([])
      expect(await page.locator('h1').textContent()).toBe('Proxy web — laboratório')
      expect(await page.locator('#result').textContent()).toBe('Reescrita dinâmica validada no Chromium.')
      if (process.env.WEB_PROXY_SCREENSHOT) await page.screenshot({ path: process.env.WEB_PROXY_SCREENSHOT, fullPage: true })
    } finally { await browser.close() }
  }, 30_000)

})
