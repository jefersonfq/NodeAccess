import { createHash } from 'node:crypto'
import { AppError } from './errors.js'

export type SshHostKeyStep = 'target' | 'bastion'

export class HostKeyVerificationError extends AppError {
  constructor(
    public readonly reason: 'unknown' | 'changed',
    public readonly presentedFingerprint: string,
    public readonly trustedFingerprint: string | null,
    public readonly step: SshHostKeyStep = 'target',
  ) {
    const subject = step === 'bastion' ? 'bastion' : 'host'
    const instruction = step === 'bastion'
      ? 'Valide a identidade do Host de origem do bastion pelo terminal antes de conectar.'
      : 'Valide a identidade do host pelo terminal antes de conectar.'
    super(`${reason === 'changed' ? 'A chave SSH mudou' : 'Chave SSH ainda não confiável'} (${subject}). ${instruction}`,
      409, `${step === 'bastion' ? 'BASTION_' : ''}${reason === 'changed' ? 'HOST_KEY_CHANGED' : 'HOST_KEY_VERIFICATION_REQUIRED'}`)
    this.name = 'HostKeyVerificationError'
  }
}

/** Absence never opts out of trust: only the explicitly stored SHA256 key is accepted. */
export function createHostKeyVerifier(
  trustedFingerprint: string | null | undefined,
  step: SshHostKeyStep,
  onResult: (error: HostKeyVerificationError | null) => void,
): (key: Buffer) => boolean {
  return (key) => {
    const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64')}`
    if (trustedFingerprint === fingerprint) { onResult(null); return true }
    onResult(new HostKeyVerificationError(trustedFingerprint ? 'changed' : 'unknown', fingerprint, trustedFingerprint || null, step))
    return false
  }
}
