import { createHash } from 'node:crypto'

const SECRET_ASSIGNMENT = /\b(password|passwd|pwd|token|secret|api[_-]?key)\s*([=:])\s*([^\s'";]+)/gi
const BEARER_TOKEN = /\b(authorization\s*:\s*bearer)\s+[^\s]+/gi
const PRIVATE_KEY = /(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g

export function sanitizeMcpAuditText(value: string, maxLength = 500): string {
  return value
    .replace(PRIVATE_KEY, '[redacted-private-key]')
    .replace(BEARER_TOKEN, '$1 [redacted-token]')
    .replace(SECRET_ASSIGNMENT, '$1$2[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

export function sha256McpAuditValue(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function buildMcpCommandAuditEvidence(steps: Array<{
  id: string
  label: string
  command: string
  timeoutSeconds: number
}>) {
  return steps.map((step) => ({
    stepId: step.id,
    label: sanitizeMcpAuditText(step.label, 160),
    commandSha256: sha256McpAuditValue(step.command),
    commandLength: step.command.length,
    timeoutSeconds: step.timeoutSeconds,
  }))
}
