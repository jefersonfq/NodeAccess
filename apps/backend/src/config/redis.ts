import { Redis } from 'ioredis'
import { env } from './env.js'

export const redis = new Redis(env.REDIS_URL, {
  password: env.REDIS_PASSWORD ?? undefined,
  lazyConnect: true,
  maxRetriesPerRequest: 3,
})

redis.on('error', (err: Error) => {
  // Apenas loga — não encerra o processo; a reconexão é automática
  console.error('[Redis] Erro de conexão:', err.message)
})
