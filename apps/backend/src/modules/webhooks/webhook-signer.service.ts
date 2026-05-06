import { createHmac, randomBytes } from 'node:crypto'

export class WebhookSignerService {
  generateSecret(): string {
    return randomBytes(32).toString('hex')
  }

  sign(secret: string, deliveryId: string | number, timestamp: number, rawBody: string): string {
    const payload = `${timestamp}.${deliveryId}.${rawBody}`
    const sig = createHmac('sha256', secret).update(payload).digest('hex')
    return `sha256=${sig}`
  }

  buildHeaders(eventType: string, deliveryId: string | number, signature: string, timestamp: number) {
    return {
      'X-NodeAccess-Event':     eventType,
      'X-NodeAccess-Delivery':  String(deliveryId),
      'X-NodeAccess-Timestamp': String(timestamp),
      'X-NodeAccess-Signature': signature,
    }
  }
}
