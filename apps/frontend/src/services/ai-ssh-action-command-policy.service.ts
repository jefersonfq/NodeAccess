import api from './api'
import { cacheTtls } from './cache-ttl.service'
import { createTimedPromiseCache } from './service-cache'

export interface AiSshActionCommandPolicy {
  safePatterns: string[]
  approvalPatterns: string[]
  blockedPatterns: string[]
}

export interface AiSshActionCommandPolicyEvaluation {
  command: string
  risk: 'safe' | 'approval_required' | 'blocked'
}

const policyCache = createTimedPromiseCache<{ data: AiSshActionCommandPolicy }>(cacheTtls.aiSshCommandPolicy, { name: 'settings:ai-ssh-command-policy' })

export const aiSshActionCommandPolicyService = {
  get: () => policyCache.get(() => api.get<AiSshActionCommandPolicy>('/ai-ssh-action-command-policy')),
  update: (payload: AiSshActionCommandPolicy) => api.put<AiSshActionCommandPolicy>('/ai-ssh-action-command-policy', payload).then((response) => {
    policyCache.set(response, 'ai-ssh-command-policy:update')
    return response
  }),
  evaluate: (command: string) => api.post<AiSshActionCommandPolicyEvaluation>('/ai-ssh-action-command-policy/evaluate', { command }),
}
