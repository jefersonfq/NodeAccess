import jwt from 'jsonwebtoken'
import type { WebSocket } from 'ws'
import { env } from '../../config/env.js'
import type { JwtPayload } from '../../shared/guards.js'
import { logger } from '../../config/logger.js'
import type { SharedSessionBroker } from './shared-session.broker.js'
import type { SharedSessionService } from './shared-session.service.js'

interface PingMsg { type: 'ping' }
type SharedSessionControlMsg = PingMsg

function send(ws: WebSocket, msg: object): void {
  ws.send(JSON.stringify(msg))
}

function closeWithError(ws: WebSocket, message: string, code = 1008): void {
  send(ws, { type: 'error', message })
  ws.close(code)
}

function toBuffer(raw: Buffer | ArrayBuffer | Buffer[]): Buffer {
  if (Buffer.isBuffer(raw)) return raw
  if (raw instanceof ArrayBuffer) return Buffer.from(raw)
  return Buffer.concat(raw.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
}

export class SharedSessionGateway {
  constructor(
    private readonly service: SharedSessionService,
    private readonly broker: SharedSessionBroker,
  ) {}

  async handleConnection(ws: WebSocket, token: string | undefined, sharedSessionId: number): Promise<void> {
    if (!token) return closeWithError(ws, 'Token obrigatório')

    let user: JwtPayload
    try {
      user = jwt.verify(token, env.JWT_SECRET) as JwtPayload
      if (user.stage !== 'authenticated') throw new Error('Invalid stage')
    } catch {
      return closeWithError(ws, 'Token inválido ou expirado')
    }

    const joined = await this.service.joinChannel(
      sharedSessionId,
      user.tenantId,
      Number(user.sub),
      user.role === 'admin' ? 'ADMIN' : 'USER',
    )

    this.broker.registerSharedSession(
      joined.sharedSession.id,
      joined.sessionId,
      joined.sharedSession.owner.userId,
      joined.sharedSession.activeControlLease ?? null,
    )
    this.broker.subscribe(joined.sharedSession.id, {
      ws,
    })

    this.broker.publishSnapshot(joined.sharedSession.id, {
      sharedSessionId: joined.sharedSession.id,
      hostId: joined.sharedSession.hostId,
      hostName: joined.sharedSession.hostName,
      owner: joined.sharedSession.owner,
      participants: joined.sharedSession.participants,
      role: joined.role,
      status: joined.sharedSession.status,
      expiresAt: joined.sharedSession.expiresAt,
      pendingControlRequestUserIds: joined.sharedSession.pendingControlRequestUserIds ?? [],
    })
    this.broker.sendInitialSnapshot(joined.sharedSession.id, ws)

    if (joined.role === 'viewer') {
      const participant = joined.sharedSession.participants.find((item) => item.userId === Number(user.sub))
      if (participant) {
        this.broker.publishParticipantJoined(joined.sharedSession.id, participant)
      }
    }

    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (isBinary) {
        const input = toBuffer(raw)
        void (async () => {
          let accepted = this.broker.forwardViewerInput(joined.sharedSession.id, Number(user.sub), input)

          if (!accepted) {
            const latest = await this.service.getById(
              joined.sharedSession.id,
              user.tenantId,
              Number(user.sub),
              user.role === 'admin' ? 'ADMIN' : 'USER',
            ).catch(() => null)

            if (latest?.activeControlLease?.controllerUserId === Number(user.sub)) {
              this.broker.registerSharedSession(
                joined.sharedSession.id,
                joined.sessionId,
                joined.sharedSession.owner.userId,
                latest.activeControlLease,
              )
              accepted = this.broker.forwardViewerInput(joined.sharedSession.id, Number(user.sub), input)
            }
          }

          if (!accepted) send(ws, { type: 'shared_session_input_blocked' })
        })()
        return
      }
      try {
        const msg = JSON.parse(raw.toString()) as SharedSessionControlMsg
        if (msg.type === 'ping') {
          void this.service.touchChannelParticipant(joined.sharedSession.id, Number(user.sub))
          send(ws, { type: 'pong' })
        }
      } catch {
        // ignore malformed control message
      }
    })

    let cleanedUp = false
    const cleanup = async () => {
      if (cleanedUp) return
      cleanedUp = true
      this.broker.unsubscribe(joined.sharedSession.id, ws)

      if (joined.role === 'viewer') {
        await this.service.leaveChannel(joined.sharedSession.id, Number(user.sub)).catch((err) => {
          logger.warn({ err, sharedSessionId: joined.sharedSession.id, userId: Number(user.sub) }, 'Falha ao encerrar participante viewer')
        })
        this.broker.publishParticipantLeft(joined.sharedSession.id, { userId: Number(user.sub) })
      }
    }

    ws.on('close', cleanup)
    ws.on('error', cleanup)
  }
}
