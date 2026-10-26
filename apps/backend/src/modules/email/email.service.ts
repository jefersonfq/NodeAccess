import { connect, type Socket } from 'node:net'
import { assertTrialIntegration, resolveTrialOutboundHost } from '../trials/trial-outbound.js'
import { monitorTrialAccess } from '../trials/trial-policy.js'
import { TooManyRequestsError } from '../../shared/errors.js'
import nodemailer, { type Transporter } from 'nodemailer'

export interface EmailTransportConfig {
  tenantId?: number
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  fromName: string
}

export interface SendEmailOptions {
  to: string
  subject: string
  text: string
}

function resolveHostPort(provider: string, host?: string | null, port?: number | null): { host: string; port: number } {
  if (provider === 'gmail')   return { host: 'smtp.gmail.com',      port: 587 }
  if (provider === 'outlook') return { host: 'smtp.office365.com',  port: 587 }
  return { host: host ?? '', port: port ?? 587 }
}

export class EmailService {
  private buildTransporter(config: EmailTransportConfig): Transporter {
    return nodemailer.createTransport({
      host:   config.host,
      port:   config.port,
      secure: config.secure,
      auth:   { user: config.user, pass: config.password },
    })
  }

  private async guardedTransport(config: EmailTransportConfig): Promise<{ transporter: Transporter; cleanup: () => void; trial: boolean }> {
    const trial = config.tenantId === undefined ? null : await assertTrialIntegration(config.tenantId, 'smtp')
    if (!trial) return { transporter: this.buildTransporter(config), cleanup: (): void => {}, trial: false }
    const address = await resolveTrialOutboundHost(config.host)
    const sockets = new Set<Socket>()
    let closed = false
    const close = (): void => { closed = true; for (const socket of sockets) socket.destroy(); sockets.clear() }
    const stop = monitorTrialAccess(config.tenantId!, trial, close)
    const timer = setTimeout(close, 30_000)
    const transporter = nodemailer.createTransport({
      host: config.host, port: config.port, secure: config.secure, requireTLS: true,
      tls: { rejectUnauthorized: true, servername: config.host },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
      auth: { user: config.user, pass: config.password }, disableFileAccess: true, disableUrlAccess: true,
      getSocket: (_options: unknown, callback: (error: Error | null, options?: { connection: Socket }) => void): void => {
        if (closed) { callback(new Error('Teste encerrado')); return }
        const socket = connect({ host: address, port: config.port }); sockets.add(socket)
        let delivered = false
        const finish = (error: Error | null): void => {
          if (delivered) return
          delivered = true
          if (error) callback(error)
          else callback(null, { connection: socket })
        }
        const error = (error: Error): void => { sockets.delete(socket); finish(error) }
        socket.once('error', error)
        socket.once('connect', () => { socket.removeListener('error', error); if (closed) { socket.destroy(); finish(new Error('Teste encerrado')); return }; finish(null) })
        socket.once('close', () => { sockets.delete(socket); finish(new Error('Conexão encerrada')) })
      },
    })
    return { transporter, trial: true, cleanup: (): void => { clearTimeout(timer); stop(); close(); transporter.close() } }
  }

  async send(config: EmailTransportConfig, options: SendEmailOptions): Promise<void> {
    const guarded = await this.guardedTransport(config)
    try {
      if (guarded.trial) {
        const { redis } = await import('../../config/redis.js')
        const count = Number(await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n", 1, `trial:smtp:${config.tenantId}`))
        if (!Number.isSafeInteger(count) || count > 30) throw new TooManyRequestsError('Limite de envios do teste atingido')
        await assertTrialIntegration(config.tenantId!, 'smtp')
      }
      await guarded.transporter.sendMail({ from: `"${config.fromName}" <${config.user}>`, to: options.to, subject: options.subject, text: options.text })
    } finally { guarded.cleanup() }
  }

  async testConnection(config: EmailTransportConfig): Promise<void> {
    const guarded = await this.guardedTransport(config)
    try { await guarded.transporter.verify() } finally { guarded.cleanup() }
  }

  static resolveHostPort = resolveHostPort
}
