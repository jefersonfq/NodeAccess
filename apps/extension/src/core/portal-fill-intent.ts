import type { ExtensionFailure } from './client'

/** Public metadata only. The worker retains authorization/device and document bindings. */
export interface PendingFillIntent {
  reference: string
  siteId: number
  version: number
  origin: string
  expiresAt: number
  action: 'fill'
}
export type PendingFillStatus = { state: 'none' } | { state: 'pending' | 'ready'; pending: PendingFillIntent }
export interface PendingFillPort {
  get(): Promise<PendingFillIntent | null>
  beginProof(): Promise<{ url: string }>
  check(): Promise<PendingFillStatus>
  consume(reference: string): Promise<{ ok: boolean; reason?: ExtensionFailure }>
  cancel(): Promise<void>
}
/** Single delivery from worker memory; never serialize this draft or persist it. */
export interface CapturedSiteDraft {
  id: string; username: string; password: string; origin: string; expiresAt?: number
  editor?: {
    mode: 'create' | 'update'; siteId?: number; version?: number; kind: 'login' | 'url'; label: string
    origins: string[]; url?: string; scope: 'PERSONAL' | 'GROUP' | 'TENANT'; groupId?: number
    hostId?: number | null; allowFill: boolean
  }
}
export interface CapturedDraftPort { stage(draft: CapturedSiteDraft): Promise<void>; take(): Promise<CapturedSiteDraft | null>; clear(): Promise<void> }
export interface SiteAssistPort {
  enable(options: { capture: boolean }): Promise<{ ok: boolean }>
  cancel(): Promise<void>
}
/** A popup must not offer an expired or malformed reference, even before worker revalidation. */
export function readPendingFill(value: unknown, now = Date.now()): PendingFillIntent | null {
  if (!value || typeof value !== 'object') return null
  const p = value as Record<string, unknown>
  if (typeof p.reference !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(p.reference)
    || !Number.isSafeInteger(p.siteId) || Number(p.siteId) < 1
    || !Number.isSafeInteger(p.version) || Number(p.version) < 1 || p.action !== 'fill'
    || typeof p.expiresAt !== 'number' || !Number.isFinite(p.expiresAt) || p.expiresAt <= now || p.expiresAt > now + 120_000
    || typeof p.origin !== 'string') return null
  try { const url = new URL(p.origin); if (url.protocol !== 'https:' || url.origin !== p.origin || url.username || url.password) return null } catch { return null }
  return { reference: p.reference, siteId: Number(p.siteId), version: Number(p.version), origin: p.origin, expiresAt: p.expiresAt, action: 'fill' }
}
