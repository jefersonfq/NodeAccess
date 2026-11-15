import type { JwtPayload } from '../../shared/guards.js'
import { AppError, UnauthorizedError } from '../../shared/errors.js'

export interface CurrentSessionState {
  tenantId: number
  active: boolean
  deletedAt: Date | null
  tenantActive: boolean
  targetTenantActive: boolean
  sessionVersion: number
  role: 'ADMIN' | 'USER'
  isPlatformAdmin: boolean
  canManageHosts: boolean
  canViewLiveSessions: boolean
}
export type CurrentSessionReader = (userId: number, targetTenantId: number) => Promise<CurrentSessionState | null>
let readSession: CurrentSessionReader | undefined

/** Installed once for both API and gateway. Missing storage wiring must never accept a JWT. */
export function configureCurrentSessionReader(reader: CurrentSessionReader | undefined): void {
  readSession = reader
}

function validId(value: number): boolean { return Number.isSafeInteger(value) && value > 0 }

async function currentState(userId: number, tenantId: number, version: number | undefined): Promise<CurrentSessionState> {
  if (!validId(userId) || !validId(tenantId) || (version !== undefined && (!Number.isSafeInteger(version) || version < 0))) throw new UnauthorizedError()
  if (!readSession) throw new AppError('Validação de sessão indisponível', 503, 'SESSION_VALIDATION_UNAVAILABLE')
  let state: CurrentSessionState | null
  try { state = await readSession(userId, tenantId) } catch {
    throw new AppError('Validação de sessão indisponível', 503, 'SESSION_VALIDATION_UNAVAILABLE')
  }
  if (!state?.active || state.deletedAt || !state.tenantActive || !state.targetTenantActive || state.sessionVersion !== (version ?? 0)) throw new UnauthorizedError()
  return state
}

/** Native sessions keep the version captured at authentication; recheck before admission. */
export async function assertCurrentUserVersion(userId: number, tenantId: number, version: number | undefined): Promise<CurrentSessionState> {
  const state = await currentState(userId, tenantId, version)
  if (state.tenantId !== tenantId) throw new UnauthorizedError()
  return state
}

export async function assertCurrentUserSession(payload: JwtPayload): Promise<void> {
  const userId = Number(payload.sub)
  const state = await currentState(userId, payload.tenantId, payload.sessionVersion)
  const delegated = payload.platformTenantId !== undefined || payload.actingTenantId !== undefined || payload.impersonatedByUserId !== undefined
  if (delegated) {
    if (state.isPlatformAdmin !== true || payload.isPlatformAdmin !== true || payload.platformTenantId !== state.tenantId
      || payload.actingTenantId !== payload.tenantId || payload.impersonatedByUserId !== userId
      || payload.role !== 'admin' || payload.canManageHosts !== true || payload.canViewLiveSessions !== true) throw new UnauthorizedError()
    return
  }
  if (state.tenantId !== payload.tenantId || payload.role !== (state.role === 'ADMIN' ? 'admin' : 'user')
    || payload.isPlatformAdmin !== state.isPlatformAdmin || payload.canManageHosts !== state.canManageHosts
    || payload.canViewLiveSessions !== state.canViewLiveSessions) throw new UnauthorizedError()
}

/** Validate event origin against persisted identity, including disabled/deleted users. */
export async function isSessionRevocationCurrent(authTenantId: number, userId: number, sessionVersion: number): Promise<boolean> {
  if (!validId(authTenantId) || !validId(userId) || !Number.isSafeInteger(sessionVersion) || sessionVersion < 0) return false
  if (!readSession) throw new AppError('Validação de sessão indisponível', 503, 'SESSION_VALIDATION_UNAVAILABLE')
  let state: CurrentSessionState | null
  try { state = await readSession(userId, authTenantId) } catch {
    throw new AppError('Validação de sessão indisponível', 503, 'SESSION_VALIDATION_UNAVAILABLE')
  }
  return !!state && state.tenantId === authTenantId && state.sessionVersion >= sessionVersion
}
