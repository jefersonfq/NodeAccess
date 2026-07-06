import { createHmac, timingSafeEqual } from 'node:crypto'

export class InboundWebhookSignatureService {
  sign(secret: string, payload: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex')
  }

  verify(secret: string, payload: string, signatureHeader?: string): boolean {
    if (!signatureHeader) return false

    const expected = this.sign(secret, payload)
    const received = signatureHeader.startsWith('sha256=')
      ? signatureHeader.slice('sha256='.length)
      : signatureHeader

    if (!/^[a-f0-9]{64}$/i.test(received)) return false

    const expectedBuffer = Buffer.from(expected, 'hex')
    const receivedBuffer = Buffer.from(received, 'hex')
    if (expectedBuffer.length !== receivedBuffer.length) return false

    return timingSafeEqual(expectedBuffer, receivedBuffer)
  }
}
