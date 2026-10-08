export function formatRecentAccess(value: Date | string | null, active = false, now = Date.now(), locale = 'pt-BR'): string {
  if (active) return locale.startsWith('pt') ? 'Sessão ativa' : 'Active session'
  if (!value) return locale.startsWith('pt') ? 'Sem sessão registrada' : 'No recorded session'
  const date = value instanceof Date ? value : new Date(value)
  const elapsed = Math.max(0, now - date.getTime())
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return locale.startsWith('pt') ? 'Último acesso agora' : 'Last accessed now'
  if (minutes < 60) return locale.startsWith('pt') ? `Último acesso há ${minutes} min` : `Last accessed ${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return locale.startsWith('pt') ? `Último acesso há ${hours} h` : `Last accessed ${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return locale.startsWith('pt') ? 'Último acesso ontem' : 'Last accessed yesterday'
  if (days < 7) return locale.startsWith('pt') ? `Último acesso há ${days} dias` : `Last accessed ${days} days ago`
  return `${locale.startsWith('pt') ? 'Último acesso em' : 'Last accessed'} ${new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(date)}`
}

export function exactRecentAccess(value: Date | string | null, locale = 'pt-BR'): string | undefined {
  if (!value) return undefined
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
