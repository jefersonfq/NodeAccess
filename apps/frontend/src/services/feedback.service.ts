import type { FeedbackPublic, FeedbackStatus, FeedbackType } from '@nodeaccess/shared'
import api from './api'

export interface CreateFeedbackPayload {
  type: FeedbackType
  title: string
  message: string
  contextRoute?: string | null
  contextScreen?: string | null
}

export interface AdminFeedbackFilters {
  status?: FeedbackStatus
  type?: FeedbackType
  userId?: number
}

export interface UpdateFeedbackPayload {
  status: FeedbackStatus
  adminResponse?: string | null
}

export const feedbackService = {
  create(payload: CreateFeedbackPayload) {
    return api.post<FeedbackPublic>('/feedback', payload)
  },

  listMine() {
    return api.get<FeedbackPublic[]>('/feedback/mine')
  },

  listForAdmin(filters: AdminFeedbackFilters = {}) {
    return api.get<FeedbackPublic[]>('/feedback/admin', { params: filters })
  },

  update(id: number, payload: UpdateFeedbackPayload) {
    return api.patch<FeedbackPublic>(`/feedback/admin/${id}`, payload)
  },

  remove(id: number) {
    return api.delete<FeedbackPublic>(`/feedback/admin/${id}`)
  },
}
