import type { FastifyInstance } from 'fastify'
import { env } from '../../config/env.js'
import { getClientIpInfo } from '../../shared/request-ip.js'
import type { GraphicalGateway } from './graphical.gateway.js'

export async function graphicalRoutes(app: FastifyInstance, gateway: GraphicalGateway): Promise<void> {
  /**
   * GET /ws/graphical/:hostId?token=<accessToken>
   *
   * Endpoint reservado ao gateway gráfico (RDP/VNC). Hoje valida o contrato
   * e encerra com GRAPHICAL_GATEWAY_PENDING até a implementação de streaming.
   */
  app.get<{
    Params:      { hostId: string }
    Querystring: { token?: string; width?: string; height?: string; dpi?: string; credentialMode?: string }
  }>(
    '/graphical/:hostId',
    { websocket: true },
    (socket, request) => {
      const hostId = Number(request.params.hostId)
      const token = request.query.token
      const ipInfo = getClientIpInfo(request, env.TRUST_PROXY)
      const userAgent = request.headers['user-agent']

      if (Number.isNaN(hostId)) {
        socket.send(JSON.stringify({ type: 'error', message: 'hostId inválido' }))
        socket.close(1008)
        return
      }

      gateway.handleConnection(socket, token, hostId, {
        ...(ipInfo.clientIp !== null && { clientIp: ipInfo.clientIp }),
        ...(typeof userAgent === 'string' && { userAgent }),
        ...optionalGraphicalNumber('initialWidth', normalizeGraphicalQueryNumber(request.query.width, 640, 3840)),
        ...optionalGraphicalNumber('initialHeight', normalizeGraphicalQueryNumber(request.query.height, 480, 2160)),
        ...optionalGraphicalNumber('initialDpi', normalizeGraphicalQueryNumber(request.query.dpi, 72, 192)),
        ...(request.query.credentialMode === 'session' && { rdpCredentialMode: 'session' as const }),
      }).catch((err) => {
        app.log.error(err, 'Unhandled error in graphical gateway')
        socket.close(1011)
      })
    },
  )
}

function normalizeGraphicalQueryNumber(value: string | undefined, min: number, max: number): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(min, Math.min(max, Math.round(parsed)))
}

function optionalGraphicalNumber<K extends 'initialWidth' | 'initialHeight' | 'initialDpi'>(
  key: K,
  value: number | undefined,
): Partial<Record<K, number>> {
  return value === undefined ? {} : { [key]: value } as Record<K, number>
}
