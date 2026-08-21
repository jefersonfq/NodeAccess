import type { TerminalCompletion } from './terminal-autocomplete.service'

interface ContextRule { pattern: RegExp; values: Array<[string, string]>; label: string; append?: boolean }

const RULES: ContextRule[] = [
  { pattern: /^systemctl\s+/, label: 'systemd', values: [['systemctl status ', 'systemctl'], ['systemctl --failed', 'systemctl'], ['systemctl list-units --type=service', 'systemctl'], ['systemctl restart ', 'systemctl']] },
  { pattern: /^journalctl\s+/, label: 'systemd', values: [['journalctl -u ', 'journalctl'], ['journalctl -xe', 'journalctl'], ['journalctl --since "1 hour ago"', 'journalctl'], ['journalctl -f', 'journalctl']] },
  { pattern: /^docker\s+/, label: 'Docker', values: [['docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"', 'docker'], ['docker logs --tail 200 ', 'docker'], ['docker stats --no-stream', 'docker'], ['docker inspect ', 'docker'], ['docker exec -it ', 'docker']] },
  { pattern: /^kubectl\s+/, label: 'Kubernetes', values: [['kubectl get pods -A', 'kubectl'], ['kubectl get events -A --sort-by=.lastTimestamp', 'kubectl'], ['kubectl logs --tail=200 ', 'kubectl'], ['kubectl describe pod ', 'kubectl']] },
  { pattern: /^git\s+/, label: 'Git', values: [['git status --short --branch', 'git'], ['git log --oneline --decorate -20', 'git'], ['git diff --stat', 'git'], ['git branch --all', 'git']] },
  { pattern: /^ip\s+/, label: 'Rede', values: [['ip -br address', 'ss'], ['ip route show', 'ss'], ['ip -s link', 'ss']] },
  { pattern: /^find\s+\S+\s+/, label: 'Busca', append: true, values: [['-type f', 'find'], ['-type d', 'find'], ['-name "*.log"', 'find'], ['-mtime -1', 'find'], ['-size +100M', 'find']] },
  { pattern: /^tar\s+/, label: 'Arquivo compactado', values: [['tar -tf ', 'find'], ['tar -xvf ', 'find'], ['tar -czvf backup.tar.gz ', 'find']] },
]

export function suggestContextualTerminalCompletions(line: string, limit = 8): TerminalCompletion[] {
  const normalized = line.trimStart()
  const rule = RULES.find((candidate) => candidate.pattern.test(normalized))
  if (!rule) return []
  return rule.values
    .map(([suffix, descriptionKey]) => {
      const value = rule.append ? `${line}${line.endsWith(' ') ? '' : ' '}${suffix}` : suffix
      return { value, descriptionKey: `terminal.autocomplete.descriptions.${descriptionKey}`, source: 'command' as const, resourceType: 'command' as const, contextLabel: rule.label, persistable: true }
    })
    .filter((item) => rule.append || item.value.toLowerCase().startsWith(normalized.toLowerCase()))
    .slice(0, limit)
}
