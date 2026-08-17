export function normalizeTerminalText(value: string | null, maxLength: number): string | null {
  if (!value) return null
  const normalized = redactTerminalSecrets(value)
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!normalized) return null
  return normalized.length <= maxLength ? normalized : normalized.slice(-maxLength)
}

function redactTerminalSecrets(value: string): string {
  return value
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi, '[REDACTED_PRIVATE_KEY]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '[REDACTED_AWS_KEY]')
    .replace(/\b(password|passwd|pwd|token|api[_-]?key|secret)\s*[:=]\s*([^\s;]+)/gi, '$1=[REDACTED]')
}
