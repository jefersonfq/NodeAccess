import api from './api'
export interface SupervisionSession { id: number; hostId: number; startedAt: string; host: { name: string }; user: { name: string } }
export const supervisionService = {
  permission: () => api.get<{ enabled: boolean }>('/session-supervision/permission'),
  list: () => api.get<SupervisionSession[]>('/session-supervision'),
  userPermission: (id: number) => api.get<{ enabled: boolean }>(`/session-supervision/permissions/${id}`),
  setPermission: (id: number, enabled: boolean) => api.put(`/session-supervision/permissions/${id}`, { enabled }),
}
