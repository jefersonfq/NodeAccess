import api from './api'

export type SessionCommandPolicyDefaultAction = 'allow' | 'block'
export type SessionCommandPolicyRuleAction = 'allow' | 'block'
export type SessionCommandPolicyRuleType = 'regex' | 'contains' | 'prefix' | 'exact'
export type SessionCommandPolicyBindingTargetType = 'global' | 'user' | 'user_group' | 'host' | 'host_group'

export interface SessionCommandPolicyGroup {
  id: number
  tenantId: number
  name: string
  description: string | null
  enabled: boolean
  priority: number
  defaultAction: SessionCommandPolicyDefaultAction
  createdAt: string
  updatedAt: string
}

export interface SessionCommandPolicyRule {
  id: string
  policyGroupId: number
  type: SessionCommandPolicyRuleType
  pattern: string
  action: SessionCommandPolicyRuleAction
  message: string | null
  priority: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface SessionCommandPolicyBinding {
  id: number
  policyGroupId: number
  targetType: SessionCommandPolicyBindingTargetType
  targetId: number | null
  createdAt: string
}

export interface CreateSessionCommandPolicyGroupDto {
  name: string
  description?: string | null
  enabled?: boolean
  priority?: number
  defaultAction?: SessionCommandPolicyDefaultAction
}

export type UpdateSessionCommandPolicyGroupDto = Partial<CreateSessionCommandPolicyGroupDto>

export interface CreateSessionCommandPolicyRuleDto {
  type: SessionCommandPolicyRuleType
  pattern: string
  action: SessionCommandPolicyRuleAction
  message?: string | null
  priority?: number
  enabled?: boolean
}

export interface CreateSessionCommandPolicyBindingDto {
  targetType: SessionCommandPolicyBindingTargetType
  targetId?: number | null
}

export interface EvaluateSessionCommandPolicyDto {
  command: string
  userId: number
  hostId: number
}

export interface EvaluateSessionCommandPolicyResponse {
  command: string
  action: SessionCommandPolicyRuleAction
  source: 'rule' | 'runtime_default'
  defaultAction: SessionCommandPolicyRuleAction
  matchedRule: null | {
    id: string
    type: SessionCommandPolicyRuleType
    pattern: string
    action: SessionCommandPolicyRuleAction
    message?: string
    priority: number
  }
  message?: string
  rulesEvaluated: number
}

export const sessionCommandPolicyService = {
  list: () => api.get<SessionCommandPolicyGroup[]>('/session-command-policies'),
  evaluate: (dto: EvaluateSessionCommandPolicyDto) =>
    api.post<EvaluateSessionCommandPolicyResponse>('/session-command-policies/evaluate', dto),
  create: (dto: CreateSessionCommandPolicyGroupDto) =>
    api.post<SessionCommandPolicyGroup>('/session-command-policies', dto),
  update: (policyGroupId: number, dto: UpdateSessionCommandPolicyGroupDto) =>
    api.patch<SessionCommandPolicyGroup>(`/session-command-policies/${policyGroupId}`, dto),
  delete: (policyGroupId: number) =>
    api.delete(`/session-command-policies/${policyGroupId}`),
  listRules: (policyGroupId: number) =>
    api.get<SessionCommandPolicyRule[]>(`/session-command-policies/${policyGroupId}/rules`),
  createRule: (policyGroupId: number, dto: CreateSessionCommandPolicyRuleDto) =>
    api.post<SessionCommandPolicyRule>(`/session-command-policies/${policyGroupId}/rules`, dto),
  deleteRule: (policyGroupId: number, ruleId: string | number) =>
    api.delete(`/session-command-policies/${policyGroupId}/rules/${ruleId}`),
  listBindings: (policyGroupId: number) =>
    api.get<SessionCommandPolicyBinding[]>(`/session-command-policies/${policyGroupId}/bindings`),
  createBinding: (policyGroupId: number, dto: CreateSessionCommandPolicyBindingDto) =>
    api.post<SessionCommandPolicyBinding>(`/session-command-policies/${policyGroupId}/bindings`, dto),
  deleteBinding: (policyGroupId: number, bindingId: number) =>
    api.delete(`/session-command-policies/${policyGroupId}/bindings/${bindingId}`),
}
