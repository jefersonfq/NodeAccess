import * as speakeasy from 'speakeasy'
import * as qrcode from 'qrcode'
import { env } from '../../config/env.js'

export interface TotpSetup {
  secret: string   // base32 — salvar cifrado no banco
  qrCode: string   // data URL (png) para exibir no frontend
}

export class TotpService {
  generateSetup(email: string): TotpSetup {
    const generated = speakeasy.generateSecret({
      name:   `${env.TOTP_ISSUER}:${email}`,
      issuer: env.TOTP_ISSUER,
      length: 20,
    })

    return {
      secret: generated.base32 ?? '',
      // otpauth_url gerado pelo speakeasy; convertido para QR em memória (async)
      qrCode: generated.otpauth_url ?? '',
    }
  }

  async toQrDataUrl(otpauthUrl: string): Promise<string> {
    return qrcode.toDataURL(otpauthUrl)
  }

  verify(secret: string, token: string): boolean {
    return speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token,
      window: 1, // tolera 30s de drift
    })
  }
}
