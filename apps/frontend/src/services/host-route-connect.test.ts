import { describe, expect, it, vi } from 'vitest'
import { createHostRouteConnector, hostRouteContentKey, routeConnectHostId } from './host-route-connect'
import { buildAuthRedirectQuery, getSafeRedirectTarget } from './auth-redirect.service'

describe('host connection navigation', () => {
  it('keeps the mounted host view when consuming or adding only the explicit connection marker', () => {
    expect(hostRouteContentKey('/hosts?hostId=42&connect=1')).toBe(hostRouteContentKey('/hosts?hostId=42'))
    expect(hostRouteContentKey('/hosts?connect=1&hostId=42&search=a%20b#details')).toBe(hostRouteContentKey('/hosts?hostId=42&search=a%20b#details'))
  })
  it('still changes view identity for another host, filter, anchor or route', () => {
    const key = hostRouteContentKey('/hosts?hostId=42&search=a&connect=1#details')
    for (const path of ['/hosts?hostId=43&search=a#details', '/hosts?hostId=42&search=b#details',
      '/hosts?hostId=42&search=a#other', '/other?hostId=42&search=a#details']) expect(hostRouteContentKey(path)).not.toBe(key)
  })
  it('does not treat encoded query values as connection markers', () => {
    expect(hostRouteContentKey('/hosts?hostId=42&search=x%26connect%3D1&connect=1')).toBe('/hosts?hostId=42&search=x%26connect%3D1')
  })
  it('accepts only an explicit singular positive decimal host action', () => {
    expect(routeConnectHostId({ hostId: '42', connect: '1' })).toBe(42)
    for (const hostId of [undefined, '0', '-1', '1.0', '1e2', ' 1', ['1'], '99999999999']) {
      expect(routeConnectHostId({ hostId, connect: '1' })).toBeNull()
    }
    for (const connect of [undefined, true, ['1'], 'true', '0']) {
      expect(routeConnectHostId({ hostId: '42', connect })).toBeNull()
    }
  })
  it('preserves the complete action across login using the existing redirect service', () => {
    const fullPath = '/hosts?hostId=42&connect=1'
    expect(getSafeRedirectTarget(buildAuthRedirectQuery({ fullPath }))).toBe(fullPath)
  })
  function fixture() {
    const host = { id: 42 }
    const ports = {
      consume: vi.fn(() => Promise.resolve(true)), current: vi.fn(() => true),
      load: vi.fn(() => Promise.resolve(host)), prepare: vi.fn(() => Promise.resolve()),
      connect: vi.fn(() => Promise.resolve()), unavailable: vi.fn(),
    }
    return { ports, run: createHostRouteConnector(ports), host }
  }
  it('consumes before lookup and connects once despite concurrent/repeated invocations', async () => {
    const { ports, run, host } = fixture()
    await Promise.all([run(42), run(42)])
    await run(42)
    expect(ports.consume).toHaveBeenCalledTimes(1)
    expect(ports.consume.mock.invocationCallOrder[0]).toBeLessThan(ports.load.mock.invocationCallOrder[0])
    expect(ports.connect).toHaveBeenCalledExactlyOnceWith(host)
  })
  it('does not fetch when URL consumption fails', async () => {
    const { ports, run } = fixture()
    ports.consume.mockResolvedValue(false)
    await run(42)
    expect(ports.load).not.toHaveBeenCalled()
  })
  it.each([403, 404, 500])('uses identical feedback for lookup error %s without connecting or retrying', async (status) => {
    const { ports, run } = fixture()
    ports.load.mockRejectedValue({ status, message: 'private detail' })
    await run(42); await run(42)
    expect(ports.unavailable).toHaveBeenCalledExactlyOnceWith()
    expect(ports.connect).not.toHaveBeenCalled()
    expect(ports.load).toHaveBeenCalledTimes(1)
  })
  it('cancels a lookup after route, user or tenant context changes', async () => {
    const { ports, run } = fixture()
    ports.load.mockImplementation(() => { ports.current.mockReturnValue(false); return Promise.resolve({ id: 42 }) })
    await run(42)
    expect(ports.prepare).not.toHaveBeenCalled()
    expect(ports.connect).not.toHaveBeenCalled()
  })
  it('cancels after agent preparation and suppresses stale error messages', async () => {
    const { ports, run } = fixture()
    ports.prepare.mockImplementation(() => { ports.current.mockReturnValue(false); return Promise.reject(new Error()) })
    await run(42)
    expect(ports.connect).not.toHaveBeenCalled()
    expect(ports.unavailable).not.toHaveBeenCalled()
  })
})
