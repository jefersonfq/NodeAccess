import { describe, expect, it } from 'vitest'
import { jiraTicketPolicyRequiresTicket } from './jira-ticket-policy.js'

describe('Jira ticket enforcement scope', () => {
  const context = { userId: 10, groupIds: [20], inventoryAncestorIds: [30, 31] }

  it('migrates legacy required to tenant and optional to off', () => {
    expect(jiraTicketPolicyRequiresTicket({ ticketRequirement: 'required' }, context)).toBe(true)
    expect(jiraTicketPolicyRequiresTicket({ ticketRequirement: 'optional' }, context)).toBe(false)
  })

  it('matches selected users, groups or corporate folder ancestors with OR semantics', () => {
    expect(jiraTicketPolicyRequiresTicket({ ticketEnforcementMode: 'selected', ticketUserIds: [10] }, context)).toBe(true)
    expect(jiraTicketPolicyRequiresTicket({ ticketEnforcementMode: 'selected', ticketGroupIds: [20] }, context)).toBe(true)
    expect(jiraTicketPolicyRequiresTicket({ ticketEnforcementMode: 'selected', ticketInventoryFolderIds: [30] }, context)).toBe(true)
    expect(jiraTicketPolicyRequiresTicket({ ticketEnforcementMode: 'selected', ticketUserIds: [99], ticketGroupIds: [98], ticketInventoryFolderIds: [97] }, context)).toBe(false)
  })
})
