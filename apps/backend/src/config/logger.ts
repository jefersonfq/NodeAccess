import pino from 'pino'
import { createHash } from 'node:crypto'
import { env } from './env.js'

export const LOGGER_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.query.token',
  'req.query.accessToken',
  'req.query.refreshToken',
  'req.query.code',
  'req.query.state',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.clientSecret',
  'req.body.credential',
  'req.body.code',
  'req.body.token',
  'req.body.tempToken',
  'req.body.setupToken',
  'req.body.refreshToken',
  'token',
  'accessToken',
  'refreshToken',
  'tempToken',
  'setupToken',
  'idToken',
  'id_token',
  'access_token',
  'refresh_token',
  'clientSecret',
  'credential',
  'authorizationCode',
  'state',
  'nonce',
  'assertion',
  'privateKey',
  'claims',
  'identity.claims',
] as const

export function sanitizeLogUrl(value: string): string {
  return value.replace(/([?&](?:token|accessToken|refreshToken|tempToken|setupToken|id_token|code|state|nonce)=)[^&]+/gi, '$1[REDACTED]')
}

export function opaqueLogId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: [...LOGGER_REDACT_PATHS],
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
