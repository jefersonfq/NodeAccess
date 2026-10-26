export interface TrialExperience {
  demoHostAddresses?: string[]
  experience?: 'full' | 'guided'
  expiresAt?: string
  expiryNoticeHours?: number
  resources: string[]
}
/** Missing experience deliberately retains the historical guided restrictions. */
export function isGuidedTrial(trial: TrialExperience | null | undefined): boolean {
  return !!trial && trial.experience !== 'full'
}
export function trialExpiryNotice(trial: TrialExperience | null | undefined, now: number): string | null {
  if (!trial?.expiresAt) return null
  const remaining = Date.parse(trial.expiresAt) - now
  const hours = trial.expiryNoticeHours ?? 24
  if (!Number.isFinite(remaining) || remaining > hours * 3600000) return null
  if (remaining <= 0) return 'Período de teste encerrado'
  return `Teste termina em até ${Math.max(1, Math.ceil(remaining / 3600000))} h`
}
