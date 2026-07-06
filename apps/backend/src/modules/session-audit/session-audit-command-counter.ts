import type { SessionAuditPreviewEvent } from '@nodeaccess/shared'
import { buildCommandTimeline, parsePreviewLine } from './session-audit-normalizer.js'

export function countSessionAuditCommands(events: SessionAuditPreviewEvent[]): number {
  return buildCommandTimeline(events).length
}

export function parseSessionAuditEventsFromJsonl(content: string): SessionAuditPreviewEvent[] {
  const events: SessionAuditPreviewEvent[] = []

  for (const line of content.split('\n')) {
    if (!line) continue
    const event = parsePreviewLine(line)
    if (event) events.push(event)
  }

  return events
}
