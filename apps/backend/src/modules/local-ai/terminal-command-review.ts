import type { ActionCommandRisk } from '../ai-ssh-actions/ai-ssh-action-command-policy.js'
/** Conservative convenience-insertion gate, not a shell parser or execution sandbox. */
export function reviewTerminalCommand(command: string, policyRisk: ActionCommandRisk, platform = 'UNKNOWN'): ActionCommandRisk {
  if (policyRisk !== 'safe') return policyRisk
  if (/[;&|<>$\x60\\{}()[\]\r\n\u0000-\u001f]/.test(command)) return 'approval_required'
  const tokens = command.trim().split(/\s+/)
  const executable = tokens[0]?.toLowerCase() ?? ''
  const windows = platform.toUpperCase().startsWith('WINDOWS')
  const windowsRead = new Set(['get-nettcpconnection','get-netudpendpoint','get-process','get-service','get-date','get-childitem','get-content','get-computerinfo','ipconfig','tasklist'])
  if (windowsRead.has(executable)) return platform.toUpperCase() !== 'UNKNOWN' && !windows ? 'approval_required' : 'safe'
  if (windows && !['netstat','hostname','whoami'].includes(executable)) return 'approval_required'
  if (['MACOS','FREEBSD'].includes(platform.toUpperCase()) && ['ss','free','ip','systemctl','journalctl'].includes(executable)) return 'approval_required'
  const readOnly = new Set(['pwd','whoami','hostname','uptime','date','uname','id','df','free','ps','ls','cat','head','tail','grep','rg','wc','ss','netstat','lsof'])
  if (executable === 'ss' && /(?:^|\s)(?:--kill|-[-a-zA-Z]*K)/.test(command)) return 'approval_required'
  if (executable === 'rg' && tokens.some(t => t.startsWith('--pre'))) return 'approval_required'
  if (executable === 'date' && tokens.slice(1).some(t => /^\d{8,}/.test(t))) return 'approval_required'
  if (executable === 'date' && tokens.some(t => t.startsWith('-s') || t.startsWith('--set'))) return 'approval_required'
  if (executable === 'hostname' && tokens.slice(1).some(t => !['-f','-s','-d','-i','-I','--fqdn','--short','--domain','--ip-address','--all-ip-addresses'].includes(t))) return 'approval_required'
  if (executable === 'ip') return /^ip\s+(?:(?:-[46br]|--brief)\s+)*(?:addr(?:ess)?|link|route|neigh(?:bour)?)(?:\s+(?:show|list))?$/.test(command.trim()) ? 'safe' : 'approval_required'
  if (executable === 'systemctl') return /^systemctl\s+(?:status|is-active|is-enabled|list-units|list-unit-files)(?:\s+[\w.@*-]+)*$/.test(command.trim()) ? 'safe' : 'approval_required'
  if (executable === 'journalctl') return /--(?:vacuum|rotate|flush|sync|relinquish|setup|update)/.test(command) ? 'approval_required' : 'safe'
  return readOnly.has(executable) ? 'safe' : 'approval_required'
}
