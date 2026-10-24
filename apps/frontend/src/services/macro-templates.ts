import type { MacroStep } from '@nodeaccess/shared'
export function macroTemplate(kind: 'diagnostic' | 'prompt'): MacroStep[] {
  if (kind === 'prompt') return [
    { type: 'wait', pattern: '[#$>]\\s*$', mode: 'regex', caseSensitive: true, timeoutMs: 15000 },
    { type: 'send', text: "printf 'NA_%s\\n' READY", enter: true },
    { type: 'wait', pattern: 'NA_READY', mode: 'literal', caseSensitive: true, timeoutMs: 10000 },
  ]
  return [
    { type: 'send', text: "hostname; uptime; printf '\\nNA_%s\\n' READY", enter: true },
    { type: 'wait', pattern: 'NA_READY', mode: 'literal', caseSensitive: true, timeoutMs: 10000 },
    { type: 'pause', durationMs: 250 },
    { type: 'send', text: "df -h; printf '\\nNA_%s\\n' DONE", enter: true },
    { type: 'wait', pattern: 'NA_DONE', mode: 'literal', caseSensitive: true, timeoutMs: 10000 },
  ]
}
