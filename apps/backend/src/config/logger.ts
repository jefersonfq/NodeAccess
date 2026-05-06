import pino from 'pino'
import { env } from './env.js'

export function sanitizeLogUrl(value: string): string {
  return value.replace(/([?&](?:token|accessToken|refreshToken)=)[^&]+/gi, '$1[REDACTED]')
}

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.query.token',
      'req.query.accessToken',
      'req.query.refreshToken',
      'token',
      'accessToken',
      'refreshToken',
    ],
    censor: '[REDACTED]',
  },
  serializers: {
    req(request) {
      const serialized = pino.stdSerializers.req(request)
      if (typeof serialized.url === 'string') {
        serialized.url = sanitizeLogUrl(serialized.url)
      }
      return serialized
    },
  },
  ...(env.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
    },
  }),
})
