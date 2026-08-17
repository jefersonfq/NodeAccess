import { describe, expect, it } from 'vitest'
import { selectLocalAiReadTools } from './local-ai-tool-registry.js'

const noExplicitContext = {
  hostId: false,
  sessionId: false,
  ticketKey: false,
  groupName: false,
  bastionName: false,
}

describe('selectLocalAiReadTools', () => {
  it('uses only the platform snapshot for a generic product question', () => {
    expect([...selectLocalAiReadTools('Quais recursos estão habilitados?', noExplicitContext)])
      .toEqual(['platform_snapshot'])
  })

  it('selects only relevant read tools for operational context', () => {
    const selected = selectLocalAiReadTools('Mostre os hosts e sessões recentes com risco', noExplicitContext)
    expect(selected).toEqual(new Set([
      'platform_snapshot',
      'search_hosts',
      'list_recent_sessions',
      'search_session_audits',
    ]))
    expect(selected.has('search_knowledge_base')).toBe(false)
  })

  it('adds explicit scoped lookups without enabling write tools', () => {
    const selected = selectLocalAiReadTools('Detalhe solicitado', {
      hostId: true,
      sessionId: true,
      ticketKey: true,
      groupName: true,
      bastionName: true,
    })
    expect(selected).toEqual(new Set([
      'platform_snapshot',
      'get_host_summary',
      'get_session_summary',
      'get_session_audit_summary',
      'get_ticket_audit_summary',
      'get_group_summary',
      'get_bastion_summary',
    ]))
  })
})
