import api from './api'

export interface AiSshActionCommandPolicy {
  safePatterns: string[]
  approvalPatterns: string[]
  blockedPatterns: string[]
}

export interface AiSshActionCommandPolicyEvaluation {
  command: string
  risk: 'safe' | 'approval_required' | 'blocked'
}

export const aiSshActionCommandPolicyService = {
  get: () => api.get<AiSshActionCommandPolicy>('/ai-ssh-action-command-policy'),
  update: (payload: AiSshActionCommandPolicy) => api.put<AiSshActionCommandPolicy>('/ai-ssh-action-command-policy', payload),
  evaluate: (command: string) => api.post<AiSshActionCommandPolicyEvaluation>('/ai-ssh-action-command-policy/evaluate', { command }),
}
