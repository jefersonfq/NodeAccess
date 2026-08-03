import api from './api'

export type HaStatus = 'PENDING' | 'HEALTHY' | 'DEGRADED' | 'OFFLINE'
export type HaComponentStatus = 'ok' | 'degraded' | 'down' | 'unknown'

export interface HaNodeInventory {
  hostname: string
  operatingSystem: string
  architecture: string
  cpuCores: number
  memoryTotalMb: number
  diskFreeMb: number
  dockerInstalled: boolean
  dockerVersion?: string
  composeInstalled: boolean
}

export interface HaNode {
  id: string
  name: string
  endpoint: string | null
  desiredRole: 'PRIMARY' | 'STANDBY'
  observedRole: 'PRIMARY' | 'STANDBY' | null
  ownsVip: boolean
  virtualIp: string | null
  status: HaStatus
  promotionReady: boolean
  blockers: string[]
  notices: string[]
  heartbeatAgeSeconds: number | null
  heartbeatState: 'CURRENT' | 'DELAYED' | 'STALE'
  components: Record<string, { status: HaComponentStatus; message?: string; lagSeconds?: number }>
  inventory: HaNodeInventory | null
  secureProvisioningReady: boolean
  enrolledAt: string | null
  lastSeenAt: string | null
  createdAt: string
}

export interface HaEnrollment {
  id: string
  token: string
  expiresAt: string
}

export interface HaOperation {
  id: string
  nodeId: string
  nodeName: string
  type: 'PREFLIGHT' | 'PROVISION_PLAN' | 'PROVISIONING' | 'PROMOTION' | 'FAILBACK' | 'ROLE_RECONCILIATION'
  status: 'READY' | 'BLOCKED' | 'RUNNING' | 'FAILED' | 'COMPLETED'
  currentStage: string
  steps: Array<{ key: string; label: string; status: 'ok' | 'failed' | 'required'; message?: string }>
  errorLayer: string | null
  errorMessage: string | null
  initiatedById: number
  startedAt: string
  finishedAt: string | null
}

export const haService = {
  setEntitlement: (enabled: boolean) =>
    api.patch<{ enabled: boolean }>('/ha/entitlement', { enabled }),
  listNodes: () => api.get<HaNode[]>('/ha/nodes'),
  createEnrollment: (payload: {
    name: string
    endpoint?: string
    desiredRole?: 'PRIMARY' | 'STANDBY'
  }) =>
    api.post<HaEnrollment>('/ha/enrollments', payload),
  removeNode: (id: string) => api.delete(`/ha/nodes/${id}`),
  listOperations: () => api.get<HaOperation[]>('/ha/operations'),
  reconcileObservedRoles: () =>
    api.post<HaOperation>('/ha/topology/reconcile-roles', {
      confirmation: 'RECONCILE_OBSERVED_ROLES',
    }),
  runPreflight: (id: string) => api.post<HaOperation>(`/ha/nodes/${id}/preflight`),
  startPlannedSwitchover: (
    id: string,
    payload: { witnessEvidenceFile: string; witnessSignatureFile: string },
  ) =>
    api.post<HaOperation>(`/ha/nodes/${id}/planned-switchover`, {
      confirmation: 'START_PLANNED_SWITCHOVER',
      ...payload,
    }),
  createProvisioningPlan: (id: string) =>
    api.post<HaOperation>(`/ha/nodes/${id}/provisioning-plan`),
  queueInventoryRefresh: (id: string) =>
    api.post<HaOperation>(`/ha/nodes/${id}/inventory-refresh`, {
      confirmation: 'REFRESH_INVENTORY',
    }),
  prepareStorageDirectories: (id: string) =>
    api.post<HaOperation>(`/ha/nodes/${id}/storage/prepare`, {
      confirmation: 'PREPARE_STORAGE_DIRECTORIES',
    }),
  rollbackStorageDirectories: (id: string) =>
    api.post<HaOperation>(`/ha/nodes/${id}/storage/rollback`, {
      confirmation: 'ROLLBACK_STORAGE_DIRECTORIES',
    }),
  validateStorageWriteAccess: (id: string) =>
    api.post<HaOperation>(`/ha/nodes/${id}/storage/validate-write`, {
      confirmation: 'VALIDATE_STORAGE_WRITE_ACCESS',
    }),
  installRelease: (id: string, payload: { releaseUrl: string; sha256: string }) =>
    api.post<HaOperation>(`/ha/nodes/${id}/release/install`, {
      confirmation: 'INSTALL_RELEASE',
      ...payload,
    }),
  applySharedSecrets: (id: string, secrets: Record<string, string>) =>
    api.post<HaOperation>(`/ha/nodes/${id}/configuration/shared-secrets`, {
      confirmation: 'APPLY_SHARED_SECRETS',
      secrets,
    }),
  rollbackSharedSecrets: (id: string) =>
    api.post<HaOperation>(`/ha/nodes/${id}/configuration/shared-secrets/rollback`, {
      confirmation: 'ROLLBACK_SHARED_SECRETS',
    }),
  runRejoinPreflight: (id: string) =>
    api.post<HaOperation>(`/ha/nodes/${id}/rejoin-preflight`),
}
