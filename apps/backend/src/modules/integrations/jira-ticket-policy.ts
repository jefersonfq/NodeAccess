import type { StoredJiraConfig } from './jira.service.js'

export function jiraTicketPolicyRequiresTicket(config: StoredJiraConfig, context: { userId: number; groupIds: number[]; inventoryAncestorIds: number[] }): boolean {
  const mode = jiraTicketEnforcementMode(config)
  if (mode === 'off') return false
  if (mode === 'tenant') return true
  return (config.ticketUserIds ?? []).includes(context.userId)
    || context.groupIds.some((id) => (config.ticketGroupIds ?? []).includes(id))
    || context.inventoryAncestorIds.some((id) => (config.ticketInventoryFolderIds ?? []).includes(id))
}

export function jiraTicketEnforcementMode(config: StoredJiraConfig): 'off' | 'tenant' | 'selected' {
  return config.ticketEnforcementMode ?? (config.ticketRequirement === 'required' ? 'tenant' : 'off')
}
