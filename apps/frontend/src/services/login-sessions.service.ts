/** NA-0187 — tenant admin view of login sessions (who is online, from which IP) and disconnection. */
import api from './api'

export interface LoginSession {
  ref: string; authMethod: string; ip: string | null; lastIp: string | null; userAgent: string | null
  createdAt: number; lastSeenAt: number; current: boolean
}
export interface OnlineUser { userId: number; sessions: number; lastSeenAt: number }

export const loginSessionsService = {
  online: async (): Promise<OnlineUser[]> => (await api.get<{ data: OnlineUser[] }>('/users/online')).data.data,
  list: async (userId: number): Promise<LoginSession[]> => (await api.get<{ data: LoginSession[] }>(`/users/${userId}/login-sessions`)).data.data,
  revoke: (userId: number, ref: string): Promise<unknown> => api.delete(`/users/${userId}/login-sessions/${encodeURIComponent(ref)}`),
  revokeAll: (userId: number): Promise<unknown> => api.post(`/users/${userId}/login-sessions/revoke-all`, {}),
}
