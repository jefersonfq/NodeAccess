import nodemailer, { type Transporter } from 'nodemailer'

export interface EmailTransportConfig {
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

  async send(config: EmailTransportConfig, options: SendEmailOptions): Promise<void> {
    const transporter = this.buildTransporter(config)
    await transporter.sendMail({
      from:    `"${config.fromName}" <${config.user}>`,
      to:      options.to,
      subject: options.subject,
      text:    options.text,
    })
  }

  async testConnection(config: EmailTransportConfig): Promise<void> {
    const transporter = this.buildTransporter(config)
    await transporter.verify()
  }

  static resolveHostPort = resolveHostPort
}
