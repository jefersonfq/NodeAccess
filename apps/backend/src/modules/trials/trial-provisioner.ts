import type { ReadableStreamDefaultReader } from 'node:stream/web'
import { labSchema, validateLab, type TrialProfile, type TrialLab } from './trial-contract.js'

export interface TrialProvisioner {
  ensure(id: string, profile: TrialProfile): Promise<TrialLab>
  remove(id: string): Promise<void>
}
/** Internal, operator-configured endpoint only. No request chooses a URL or image. */
export class HttpTrialProvisioner implements TrialProvisioner {
  constructor(private readonly url: string, private readonly token: string) {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('INVALID_PROVISIONER_URL')
  }
  private async request(id: string, method: string, body?: unknown): Promise<unknown> {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('INVALID_TRIAL_ID')
    const response = await fetch(`${this.url.replace(/\/$/, '')}/v1/labs/${id}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', 'idempotency-key': id },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) throw new Error('PROVISIONER_UNAVAILABLE')
    const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined
    if (!reader) throw new Error('PROVISIONER_EMPTY_RESPONSE')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 32768) throw new Error('PROVISIONER_RESPONSE_LIMIT')
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => undefined) }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  }
  async ensure(id: string, profile: TrialProfile): Promise<TrialLab> {
    const lab = labSchema.parse(await this.request(id, 'PUT', {
      templateId: profile.templateId, machineCount: profile.machineCount,
      networkCidr: profile.networkCidr, maxSessions: profile.maxSessions,
    }))
    validateLab(lab, id, profile)
    return lab
  }
  async remove(id: string): Promise<void> {
    const lab = labSchema.parse(await this.request(id, 'DELETE'))
    if (lab.trialId !== id || lab.state !== 'removed' || lab.hosts.length) throw new Error('LAB_REMOVAL_NOT_CONFIRMED')
  }
}
