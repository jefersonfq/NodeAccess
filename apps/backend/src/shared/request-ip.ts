import type { FastifyRequest } from 'fastify'

interface RequestLike {
  headers: FastifyRequest['headers']
  ip?: string
  raw?: {
    socket: {
      remoteAddress?: string | undefined
    }
  }
}

export interface ClientIpInfo {
  clientIp: string | null
  remoteAddress: string | null
  forwardedFor: string | null
  realIp: string | null
  cfConnectingIp: string | null
  trustedProxy: boolean
}

export function getClientIpInfo(request: RequestLike, trustedProxy: boolean): ClientIpInfo {
  const remoteAddress = normalizeIp(request.raw?.socket?.remoteAddress ?? null)
  const forwardedFor = firstCsvHeader(request.headers['x-forwarded-for'])
  const realIp = firstHeader(request.headers['x-real-ip'])
  const cfConnectingIp = firstHeader(request.headers['cf-connecting-ip'])
  const trustedHeaderIp = trustedProxy
    ? normalizeIp(cfConnectingIp ?? realIp ?? forwardedFor)
    : null
  const requestIp = normalizeIp(request.ip ?? null)

  return {
    clientIp: trustedHeaderIp ?? requestIp ?? remoteAddress,
    remoteAddress,
    forwardedFor: normalizeIp(forwardedFor),
    realIp: normalizeIp(realIp),
    cfConnectingIp: normalizeIp(cfConnectingIp),
    trustedProxy,
  }
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function firstCsvHeader(value: string | string[] | undefined): string | null {
  const raw = firstHeader(value)
  if (!raw) return null
  return raw.split(',')[0]?.trim() || null
}

function normalizeIp(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('::ffff:')) return trimmed.slice('::ffff:'.length)
  return trimmed
}
