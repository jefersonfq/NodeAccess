import type { TerminalHighlightRule } from '@nodeaccess/shared'

interface PresetRule {
  name: string
  pattern: string
  foreground: TerminalHighlightRule['foreground']
  sample: string
  negative: string
}
export interface HighlightPreset { id: string; name: string; description: string; rules: PresetRule[] }
const errors: PresetRule = { name: 'Erros e falhas', pattern: 'ERROR|FAILED|FAILURE|FATAL|CRITICAL', foreground: 'red', sample: 'ERROR connection failed', negative: 'error_count=0; failedAttempts=0' }
const warnings: PresetRule = { name: 'Avisos', pattern: 'WARN|WARNING', foreground: 'amber', sample: 'WARNING disk usage above 90%', negative: 'warning_count=0' }
export const highlightPresets: readonly HighlightPreset[] = [
  { id: 'classic', name: 'Clássico', description: 'Erros, avisos e resultados positivos com cores familiares e poucas regras.', rules: [errors, warnings,
    { name: 'Sucesso', pattern: 'OK|SUCCESS|SUCCESSFUL|PASSED', foreground: 'green', sample: 'Backup completed: SUCCESS', negative: 'token=abc; successfulJobs=0' }] },
  { id: 'linux', name: 'Linux e infraestrutura', description: 'Serviços, autenticação, permissões e indisponibilidade em saídas operacionais.', rules: [errors, warnings,
    { name: 'Acesso negado', pattern: 'permission denied|authentication failed|access denied', foreground: 'purple', sample: 'sshd: permission denied for user operator', negative: 'permission granted' },
    { name: 'Indisponibilidade', pattern: 'connection refused|unreachable|timed out', foreground: 'orange', sample: 'ssh: connection refused', negative: 'connection established' },
    { name: 'Serviços em execução', pattern: 'active|running', foreground: 'green', sample: 'nginx.service active running', negative: 'inactive; notrunning' }] },
  { id: 'network', name: 'Redes / NOC', description: 'Endereços IPv4, interfaces, estados e falhas de conectividade. Não substitui diagnóstico de rede.', rules: [
    { name: 'Falhas de rede', pattern: 'DOWN|timeout|unreachable|(?:100|[1-9][0-9]?)% packet loss', foreground: 'red', sample: 'eth0 DOWN: 20% packet loss', negative: 'download completed' },
    { name: 'Link disponível', pattern: 'UP|ESTABLISHED', foreground: 'green', sample: 'eth0 UP ESTABLISHED', negative: 'backup uploaded' },
    { name: 'IPv4', pattern: '(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(?:\\.(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}', foreground: 'cyan', sample: 'gateway 192.0.2.1', negative: 'no address assigned' },
    { name: 'Interfaces', pattern: '(?:eth|ens|enp|Gi|GigabitEthernet|FastEthernet|Vlan)[0-9]{1,4}(?:[/.][0-9]{1,4}){0,4}', foreground: 'blue', sample: 'interface GigabitEthernet0/1', negative: 'interface unknown' }] },
  { id: 'logs', name: 'Logs de aplicações', description: 'Níveis de log para acompanhar aplicações, com depuração discreta e falhas em evidência.', rules: [errors, warnings,
    { name: 'Informação', pattern: 'INFO|NOTICE', foreground: 'cyan', sample: 'INFO request completed', negative: 'information recorded' },
    { name: 'Depuração', pattern: 'DEBUG|TRACE', foreground: 'gray', sample: 'DEBUG processing request', negative: 'debugger attached' }] },
  { id: 'quiet', name: 'Discreto', description: 'Somente avisos e falhas, preservando a maior parte das cores originais.', rules: [errors, warnings] },
]

// Each use creates independent rule identities; no link to or mutation of a saved template.
export function createHighlightPreset(id: string, uuid = () => crypto.randomUUID()) {
  const preset = highlightPresets.find(item => item.id === id)
  if (!preset) throw new Error('Modelo de destaques não encontrado.')
  return {
    name: preset.name, description: preset.description,
    rules: preset.rules.map((rule, index): TerminalHighlightRule => ({
      id: uuid(), name: rule.name, pattern: rule.pattern, mode: 'regex', caseSensitive: false,
      wholeWord: true, foreground: rule.foreground, background: null, bold: !['gray', 'cyan', 'blue'].includes(rule.foreground),
      enabled: true, priority: 90 - index,
    })),
  }
}
