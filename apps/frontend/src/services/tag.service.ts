import api from './api'
import type { TagPublic } from '@nodeaccess/shared'

export const tagService = {
  list: () => api.get<TagPublic[]>('/tags'),
}
