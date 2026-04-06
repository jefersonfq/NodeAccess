import api from './api'

export interface FolderPublic {
  id:        number
  name:      string
  userId:    number
  tenantId:  number
  createdAt: string
}

export const folderService = {
  list:   ()                         => api.get<FolderPublic[]>('/folders'),
  create: (name: string)             => api.post<FolderPublic>('/folders', { name }),
  update: (id: number, name: string) => api.patch<FolderPublic>(`/folders/${id}`, { name }),
  delete: (id: number)               => api.delete(`/folders/${id}`),
}
