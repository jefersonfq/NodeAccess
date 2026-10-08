import { BoundedRedis } from '../shared/bounded-redis.js'
import { env } from './env.js'

export const redis = new BoundedRedis(env.REDIS_URL, {
  password: env.REDIS_PASSWORD ?? undefined,
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  connectTimeout: 5_000,
  commandTimeout: 2_000,
  socketTimeout: 5_000,
  enableOfflineQueue: false,
  autoResendUnfulfilledCommands: false,
})

redis.on('error', (err: Error) => {
  // Apenas loga — não encerra o processo; a reconexão é automática
  console.error('[Redis] Erro de conexão:', err.message)
})
