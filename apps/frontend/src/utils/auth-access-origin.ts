export type AuthAccessOrigin = 'gateway' | 'web' | 'unknown'

// Legacy evidence only: HTTP User-Agent is client supplied, not a trusted channel.
export function authAccessOrigin(userAgent: string | null | undefined): AuthAccessOrigin {
  const value = userAgent?.trim()
  if (!value) return 'unknown'
  if (value === 'native-ssh-gateway') return 'gateway'
  // Require a recognizable browser signature; API clients/bots remain unidentified.
  if (/bot|crawler|spider|headless/i.test(value)) return 'unknown'
  if (/^Mozilla\/5\.0\s/.test(value)
    && /(?:Firefox|Chrome|Chromium|CriOS|FxiOS|Edg|OPR)\/\d|Version\/\d.*Safari\/\d/.test(value)) return 'web'
  return 'unknown'
}
