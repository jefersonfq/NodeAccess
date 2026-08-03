import type { InventoryNodePublic } from '@nodeaccess/shared'
import api from './api'
import { cacheTtls } from './cache-ttl.service'
import { createTimedPromiseCache } from './service-cache'

const inventoryListCache = createTimedPromiseCache<{ data: InventoryNodePublic[] }>(
  cacheTtls.inventoryList,
  { name: 'inventory:list' },
)

function clearInventoryList(reason: string) {
  inventoryListCache.clear(reason)
}

export const inventoryService = {
  list: () => inventoryListCache.get(() => api.get<InventoryNodePublic[]>('/inventory')),
  createFolder: (parentId: number, name: string) =>
    api.post<InventoryNodePublic>('/inventory/folders', { parentId, name }).then((res) => {
      clearInventoryList('inventory:create-folder')
      return res
    }),
  updateFolder: (id: number, name: string) =>
    api.patch<InventoryNodePublic>(`/inventory/folders/${id}`, { name }).then((res) => {
      clearInventoryList('inventory:update-folder')
      return res
    }),
  moveFolder: (id: number, parentId: number) =>
    api.patch<InventoryNodePublic>(`/inventory/folders/${id}/location`, { parentId }).then((res) => {
      clearInventoryList('inventory:move-folder')
      return res
    }),
  deleteFolder: (id: number) =>
    api.delete(`/inventory/folders/${id}`).then((res) => {
      clearInventoryList('inventory:delete-folder')
      return res
    }),
  moveHost: (hostId: number, parentId: number) =>
    api.patch<InventoryNodePublic>(`/inventory/hosts/${hostId}/location`, { parentId }).then((res) => {
      clearInventoryList('inventory:move-host')
      return res
    }),
  clear: clearInventoryList,
}
