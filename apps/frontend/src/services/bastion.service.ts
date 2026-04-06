import api from './api'
import type { BastionPublic, CreateBastionDto, UpdateBastionDto } from '@nodeaccess/shared'

export const bastionService = {
  list:   ()                            => api.get<BastionPublic[]>('/bastions'),
  get:    (id: number)                  => api.get<BastionPublic>(`/bastions/${id}`),
  create: (dto: CreateBastionDto)       => api.post<BastionPublic>('/bastions', dto),
  update: (id: number, dto: UpdateBastionDto) => api.patch<BastionPublic>(`/bastions/${id}`, dto),
  delete: (id: number)                  => api.delete(`/bastions/${id}`),
}
