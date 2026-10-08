import { z } from 'zod'
import { agentDiagnosticCatalog } from '@nodeaccess/shared'
const event = z.object({
  id: z.string().uuid(),
  attemptId: z.string().uuid(),
  targetConnectionId: z.string().uuid().optional(),
  code: z.string().max(64).refine(code => Object.hasOwn(agentDiagnosticCatalog, code)),
  at: z.string().datetime(),
})
export const agentDiagnosticReport = z.object({ type: z.literal('diagnostic-report'), events: z.array(event).min(1).max(20) })
export type AgentReportedEvent = z.infer<typeof event>
