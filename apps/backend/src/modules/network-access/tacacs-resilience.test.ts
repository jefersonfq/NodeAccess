import { afterEach, describe, expect, it, vi } from 'vitest'
import { connect, type Socket } from 'node:net'
import { createTacacsServer } from './tacacs-server.js'
import { cryptBody, type Header } from './tacacs-protocol.js'

const secret = 'disposable-resilience-secret-at-least-32-characters'
const device = { id: 1, hostId: 1, tenantId: 1, secret }
const runtimes: ReturnType<typeof createTacacsServer>[] = []
const clients = new Set<Socket>()
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
afterEach(async () => {
  for (const socket of clients) socket.destroy()
  clients.clear()
  vi.restoreAllMocks()
  await Promise.all(runtimes.splice(0).map(runtime => runtime.close()))
})
async function setup(overrides = {}, limits = { connections: 64, perSource: 64, operations: 32, timeoutMs: 1000 }) {
  const backend = {
    device: vi.fn().mockResolvedValue(device),
    authenticate: vi.fn().mockResolvedValue(true),
    authorize: vi.fn().mockResolvedValue(true),
    event: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  const runtime = createTacacsServer(backend, limits)
  runtimes.push(runtime)
  await new Promise<void>(resolve => runtime.server.listen(0, '127.0.0.1', resolve))
  return { runtime, backend, port: (runtime.server.address() as { port: number }).port }
}
function packet(type = 2, body = argsBody(), sequence = 1, sessionId = 12345, key = secret) {
  const version = type === 1 && sequence === 1 && body[2] === 2 ? 0xc1 : 0xc0
  const header: Header = { version, type, sequence, sessionId, flags: 0, length: body.length }
  const wire = Buffer.alloc(12)
  wire[0] = version; wire[1] = type; wire[2] = sequence
  wire.writeUInt32BE(sessionId, 4); wire.writeUInt32BE(body.length, 8)
  return Buffer.concat([wire, cryptBody(header, body, key)])
}
function start(username = 'alice', password = 'valid-password-123', ascii = false) {
  return Buffer.concat([Buffer.from([1, 1, ascii ? 1 : 2, 1, Buffer.byteLength(username), 0, 0, Buffer.byteLength(password)]), Buffer.from(username + password)])
}
function continuation(value: string, abort = false) {
  const header = Buffer.alloc(5); header.writeUInt16BE(Buffer.byteLength(value)); header[4] = abort ? 1 : 0
  return Buffer.concat([header, Buffer.from(value)])
}
function argsBody(username = 'alice', args = ['service=shell', 'cmd=show', 'cmd-arg=version'], accounting = false) {
  return Buffer.concat([Buffer.from([...(accounting ? [2] : []), 6, 1, 1, 1, Buffer.byteLength(username), 0, 0, args.length]), Buffer.from(args.map(a => Buffer.byteLength(a))), Buffer.from(username + args.join(''))])
}
function decoded(wire: Buffer, key = secret) {
  expect(wire.length).toBeGreaterThanOrEqual(12)
  const h = { version: wire[0]!, type: wire[1]!, sequence: wire[2]!, flags: wire[3]!, sessionId: wire.readUInt32BE(4), length: wire.readUInt32BE(8) }
  expect(wire.length).toBe(12 + h.length)
  return { header: h, body: cryptBody(h, wire.subarray(12), key) }
}
// Frame accumulation is deliberate: TCP data events are not protocol frame boundaries.
async function client(port: number) {
  const socket = connect(port, '127.0.0.1'); clients.add(socket)
  const frames: Buffer[] = []; let buffer = Buffer.alloc(0)
  const closed = new Promise<void>(resolve => socket.once('close', () => { clients.delete(socket); resolve() }))
  socket.on('error', () => {})
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 12 && buffer.length >= 12 + buffer.readUInt32BE(8)) {
      const size = 12 + buffer.readUInt32BE(8)
      frames.push(buffer.subarray(0, size)); buffer = buffer.subarray(size)
    }
  })
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject) })
  return { socket, frames, closed, async frame() {
    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0), { timeout: 2000, interval: 5 })
    return frames.shift()!
  } }
}
async function exchange(port: number, data = packet()) {
  const c = await client(port); c.socket.write(data)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([c.closed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Test client deadline exceeded')), 2500) })])
    return c.frames
  } finally { clearTimeout(timer) }
}
async function healthy(port: number) { expect(decoded((await exchange(port))[0]!).body[0]).toBe(1) }

describe('TACACS+ fault injection and concurrent recovery', () => {
  it('keeps session IDs, identities and results isolated during 24 overlapping authorizations', async () => {
    let active = 0, peak = 0
    const { port, backend } = await setup({ authorize: vi.fn(async (_d: unknown, username: string) => {
      active++; peak = Math.max(peak, active)
      await delay(10 + (Number(username.slice(1)) % 4) * 5)
      active--; return Number(username.slice(1)) % 3 !== 0
    }) })
    const responses = await Promise.all(Array.from({ length: 24 }, (_, i) => exchange(port, packet(2, argsBody('u' + i), 1, 100 + i))))
    responses.forEach((frames, i) => {
      expect(frames).toHaveLength(1)
      const r = decoded(frames[0]!); expect(r.header.sessionId).toBe(100 + i)
      expect(r.body[0]).toBe(i % 3 === 0 ? 16 : 1)
    })
    expect(peak).toBeGreaterThan(1); expect(backend.authorize).toHaveBeenCalledTimes(24)
    await healthy(port)
  })

  it('isolates PAP, authorization and accounting successes, denials and dependency errors concurrently', async () => {
    const { port, runtime } = await setup({
      authenticate: vi.fn(async (_d: unknown, username: string) => { await delay(10); if (username === 'fault') throw Error('authentication unavailable'); return username !== 'deny' }),
      authorize: vi.fn(async (_d: unknown, username: string) => { await delay(15); if (username === 'fault') throw Error('ACL unavailable'); return username !== 'deny' }),
      event: vi.fn(async (_d: unknown, username: string) => { await delay(5); if (username === 'fault') throw Error('audit unavailable') }),
    })
    await Promise.all([1, 2, 3].flatMap(type => ['allow', 'deny', 'fault'].map(async username => {
      const body = type === 1 ? start(username) : argsBody(username, undefined, type === 3)
      const response = decoded((await exchange(port, packet(type, body)))[0]!).body
      const expected = type === 1 ? (username === 'fault' ? 7 : username === 'deny' ? 2 : 1) : type === 2 ? (username === 'fault' ? 17 : username === 'deny' ? 16 : 1) : username === 'fault' ? 2 : 1
      expect(response[type === 3 ? 4 : 0]).toBe(expected)
    })))
    expect(runtime.stats.errors).toBe(3); await healthy(port)
  })

  it.each(['device', 'authenticate', 'authorize', 'event'] as const)('releases capacity after %s rejects and accepts the next request', async method => {
    const { port, backend } = await setup()
    backend[method].mockRejectedValueOnce(Error('Injected dependency outage'))
    const type = method === 'authenticate' ? 1 : method === 'event' ? 3 : 2
    const responses = await exchange(port, packet(type, type === 1 ? start() : argsBody('alice', undefined, type === 3)))
    if (method === 'device') expect(responses).toHaveLength(0)
    else expect(decoded(responses[0]!).body[type === 3 ? 4 : 0]).toBe(type === 1 ? 7 : type === 3 ? 2 : 17)
    await healthy(port)
  })

  it.each(['device', 'authenticate', 'authorize', 'event'] as const)('does not release pending %s capacity prematurely after timeout, then recovers', async method => {
    const gate = deferred<any>(), entered = deferred<void>()
    const { port, backend, runtime } = await setup({}, { connections: 4, perSource: 4, operations: 1, timeoutMs: 80 })
    backend[method].mockImplementationOnce(() => { entered.resolve(); return gate.promise })
    const type = method === 'authenticate' ? 1 : method === 'event' ? 3 : 2
    const first = exchange(port, packet(type, type === 1 ? start() : argsBody('alice', undefined, type === 3)))
    await entered.promise
    expect(await first).toHaveLength(0)
    expect(await exchange(port)).toHaveLength(0)
    expect(runtime.stats.rejected).toBe(1)
    gate.resolve(method === 'device' ? device : true)
    await delay(10)
    await healthy(port)
  })

  it.each([{ connections: 2, perSource: 8 }, { connections: 8, perSource: 2 }])('enforces connection/source limits %j and reuses released slots', async limits => {
    const { port, runtime, backend } = await setup({}, { ...limits, operations: 8, timeoutMs: 1000 })
    const a = await client(port), b = await client(port)
    expect(await exchange(port)).toHaveLength(0)
    expect(runtime.stats.rejected).toBe(1); expect(backend.authorize).not.toHaveBeenCalled()
    a.socket.destroy(); b.socket.destroy(); await Promise.all([a.closed, b.closed])
    await delay(10); await healthy(port)
  })

  it('expires idle and truncated-header/body clients without dispatching backend work', async () => {
    const { port, backend } = await setup({}, { connections: 8, perSource: 8, operations: 8, timeoutMs: 60 })
    const peers = await Promise.all([client(port), client(port), client(port)])
    peers[1]!.socket.write(packet().subarray(0, 7)); peers[2]!.socket.write(packet().subarray(0, 15))
    await Promise.all(peers.map(p => p.closed))
    expect(backend.device).not.toHaveBeenCalled()
    peers.forEach(p => expect(p.frames).toHaveLength(0)); await healthy(port)
  })

  it('accepts frames fragmented into single bytes', async () => {
    const { port, backend } = await setup(); const c = await client(port)
    for (const byte of packet()) { c.socket.write(Buffer.from([byte])); await delay(1) }
    expect(decoded(await c.frame()).body[0]).toBe(1)
    expect(backend.authorize).toHaveBeenCalledTimes(1)
  })

  it('rejects coalesced pipelining without executing either request', async () => {
    const { port, backend } = await setup()
    expect(await exchange(port, Buffer.concat([packet(), packet()]))).toHaveLength(0)
    expect(backend.authorize).not.toHaveBeenCalled(); await healthy(port)
  })

  it('does not execute a second packet while the first operation is pending', async () => {
    const entered = deferred<void>(), gate = deferred<boolean>()
    const { port, backend } = await setup({ authorize: vi.fn().mockImplementationOnce(() => { entered.resolve(); return gate.promise }).mockResolvedValue(true) })
    const c = await client(port); c.socket.write(packet()); await entered.promise
    c.socket.write(packet()); await c.closed
    gate.resolve(true); await delay(10)
    expect(c.frames).toHaveLength(0); expect(backend.authorize).toHaveBeenCalledTimes(1)
    await healthy(port)
  })

  it('survives client disconnect during a pending operation without sending a late reply', async () => {
    const entered = deferred<void>(), gate = deferred<boolean>()
    const { port, backend } = await setup({ authorize: vi.fn().mockImplementationOnce(() => { entered.resolve(); return gate.promise }).mockResolvedValue(true) })
    const c = await client(port); c.socket.write(packet()); await entered.promise
    c.socket.destroy(); await c.closed; gate.resolve(true); await delay(10)
    expect(c.frames).toHaveLength(0); expect(backend.authorize).toHaveBeenCalledTimes(1)
    await healthy(port)
  })

  it.each(['revocation', 'key rotation', 'abort', 'session mismatch', 'sequence mismatch'])('fails an ASCII continuation after %s and keeps the listener healthy', async scenario => {
    const { port, backend } = await setup(); const c = await client(port)
    c.socket.write(packet(1, start('alice', '', true)))
    expect(decoded(await c.frame()).body[0]).toBe(5)
    if (scenario === 'revocation') backend.device.mockResolvedValueOnce(null)
    if (scenario === 'key rotation') backend.device.mockResolvedValueOnce({ ...device, secret: secret + '-rotated' })
    c.socket.write(packet(1, continuation('valid-password-123', scenario === 'abort'), scenario === 'sequence mismatch' ? 5 : 3, scenario === 'session mismatch' ? 999 : 12345))
    await c.closed; expect(c.frames).toHaveLength(0); expect(backend.authenticate).not.toHaveBeenCalled()
    await healthy(port)
  })

  it('allows independent concurrent ASCII conversations with no username crossover', async () => {
    const { port, backend } = await setup({ authenticate: vi.fn(async (_d: unknown, u: string, p: string) => p === 'password-for-' + u) })
    await Promise.all(Array.from({ length: 8 }, async (_, i) => {
      const c = await client(port), id = 200 + i
      c.socket.write(packet(1, start('', '', true), 1, id))
      expect(decoded(await c.frame()).body[0]).toBe(4)
      c.socket.write(packet(1, continuation('user' + i), 3, id))
      const challenge = decoded(await c.frame()); expect(challenge.body[0]).toBe(5); expect(challenge.body[1]).toBe(1)
      c.socket.write(packet(1, continuation('password-for-user' + i), 5, id))
      const success = decoded(await c.frame()); expect(success.header.sessionId).toBe(id); expect(success.body[0]).toBe(1)
      await c.closed
    }))
    expect(backend.authenticate).toHaveBeenCalledTimes(8)
  })

  it('closes malformed length fields, argument counts, UTF-8 and control characters without authorizing', async () => {
    const { port, backend } = await setup()
    const badLength = argsBody(); badLength[4] = 255
    const badCount = argsBody(); badCount[7] = 65
    const badUtf8 = argsBody(); badUtf8[11] = 0xff
    for (const body of [Buffer.alloc(0), badLength, badCount, badUtf8, argsBody('ali\nce'), Buffer.concat([argsBody(), Buffer.from([1])])]) {
      expect(await exchange(port, packet(2, body))).toHaveLength(0)
    }
    expect(backend.authorize).not.toHaveBeenCalled(); await healthy(port)
  })

  it('acknowledges accounting only after persistence resolves', async () => {
    const entered = deferred<void>(), persisted = deferred<void>()
    const { port } = await setup({ event: vi.fn(() => { entered.resolve(); return persisted.promise }) })
    const c = await client(port); c.socket.write(packet(3, argsBody('alice', undefined, true)))
    await entered.promise; await delay(15)
    expect(c.frames).toHaveLength(0)
    persisted.resolve()
    expect(decoded(await c.frame()).body[4]).toBe(1)
    await c.closed
  })

  it('keeps valid requests working alongside concurrent malformed traffic', async () => {
    const { port, backend } = await setup()
    await Promise.all(Array.from({ length: 20 }, async (_, i) => {
      const frames = await exchange(port, i % 2 ? packet() : packet(2, Buffer.alloc(0)))
      if (i % 2) expect(decoded(frames[0]!).body[0]).toBe(1)
      else expect(frames).toHaveLength(0)
    }))
    expect(backend.authorize).toHaveBeenCalledTimes(10); await healthy(port)
  })

  it('expires the authentication rate window without blocking authorization traffic', async () => {
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const { port, backend } = await setup({ authenticate: vi.fn().mockResolvedValue(false) })
    for (let i = 0; i < 60; i++) expect(decoded((await exchange(port, packet(1, start())))[0]!).body[0]).toBe(2)
    expect(await exchange(port, packet(1, start()))).toHaveLength(0)
    await healthy(port)
    now += 60001; backend.authenticate.mockResolvedValue(true)
    expect(decoded((await exchange(port, packet(1, start())))[0]!).body[0]).toBe(1)
    expect(backend.authenticate).toHaveBeenCalledTimes(61)
  })

  it('shuts down idle sockets and in-flight work without acknowledging pending accounting', async () => {
    const gate = deferred<void>(), entered = deferred<void>()
    const { port, runtime } = await setup({ event: vi.fn(() => { entered.resolve(); return gate.promise }) })
    const idle = await client(port), pending = await client(port)
    pending.socket.write(packet(3, argsBody('alice', undefined, true))); await entered.promise
    await runtime.close(); runtimes.splice(runtimes.indexOf(runtime), 1)
    await Promise.all([idle.closed, pending.closed]); gate.resolve(); await delay(10)
    expect(pending.frames).toHaveLength(0); expect(runtime.server.listening).toBe(false)
  })
})
