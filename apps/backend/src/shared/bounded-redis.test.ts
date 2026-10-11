import { createServer } from 'node:net'
import type { Socket } from 'node:net'
import { expect, it } from 'vitest'
import { BoundedRedis } from './bounded-redis.js'

it('bounds commands to a silent TCP peer, fails offline, and releases the socket', async () => {
  const sockets = new Set<Socket>()
  const server = createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('data', () => {}) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const redis = new BoundedRedis({ port: address.port, host: '127.0.0.1', lazyConnect: true, enableReadyCheck: false, disableClientInfo: true,
    enableOfflineQueue: false, commandTimeout: 80, socketTimeout: 150, retryStrategy: () => null, autoResendUnfulfilledCommands: false })
  redis.on('error', () => {})
  try {
    await redis.connect()
    const commands = Array.from({ length: 1100 }, () => redis.get('test').catch((error: Error) => error.message))
    const results = await Promise.all(commands)
    expect(results.filter(result => result === 'REDIS_CAPACITY_EXCEEDED')).toHaveLength(76)
    expect(results.some(result => String(result).includes('Command timed out'))).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 180))
    expect(redis.commandQueue.length).toBe(0)
    await expect(redis.get('offline')).rejects.toThrow()
    expect((redis.offlineQueue as { length: number }).length).toBe(0)
  } finally {
    redis.disconnect()
    for (const socket of sockets) socket.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
