import type {
  EffectiveHostInventoryPermissions,
  EffectiveInventoryPermissions,
  InventoryAclImpactPreviewDto,
  InventoryAclImpactPreviewResult,
  InventoryAclEntryPublic,
  InventoryIntegrityRepairResult,
  InventoryIntegrityReport,
  InventoryNodePublic,
  UpsertInventoryAclEntryDto,
} from '@nodeaccess/shared'
import api from './api'
import { hostService } from './host.service'

export const inventoryAclService = {
  getHostNode: (hostId: number) =>
    api.get<InventoryNodePublic>(`/inventory/hosts/${hostId}/node`),

  integrity: () =>
    api.get<InventoryIntegrityReport>('/inventory/integrity'),

  repairIntegrity: () =>
    api.post<InventoryIntegrityRepairResult>('/inventory/integrity/repair').then((res) => {
      hostService.clear('inventory-integrity:repair')
      return res
    }),

  list: (inventoryNodeId: number) =>
    api.get<InventoryAclEntryPublic[]>(`/inventory/nodes/${inventoryNodeId}/acl`),

  effective: (inventoryNodeId: number, userId: number) =>
    api.get<EffectiveInventoryPermissions>(`/inventory/nodes/${inventoryNodeId}/effective-permissions/users/${userId}`),

  effectiveHost: (hostId: number, userId: number) =>
    api.get<EffectiveHostInventoryPermissions>(`/inventory/hosts/${hostId}/effective-permissions/users/${userId}`),

  previewImpact: (inventoryNodeId: number, dto: InventoryAclImpactPreviewDto) =>
    api.post<InventoryAclImpactPreviewResult>(`/inventory/nodes/${inventoryNodeId}/acl/impact-preview`, dto),

  upsert: (inventoryNodeId: number, dto: UpsertInventoryAclEntryDto) =>
    api.put<InventoryAclEntryPublic[]>(`/inventory/nodes/${inventoryNodeId}/acl`, dto).then((res) => {
      hostService.clear('inventory-acl:upsert')
      return res
    }),

  delete: (
    inventoryNodeId: number,
    principalType: UpsertInventoryAclEntryDto['principalType'],
    principalId: number,
  ) => api.delete(`/inventory/nodes/${inventoryNodeId}/acl/${principalType}/${principalId}`).then((res) => {
    hostService.clear('inventory-acl:delete')
    return res
  }),
}
