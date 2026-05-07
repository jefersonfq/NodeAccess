export type HostLinkTemplateContext = {
  id: number
  name: string
  ip: string
  port: number
  sshUser: string
}

export type HostLinkTemplateValidationResult = {
  valid: boolean
  unknownVariables: string[]
  invalidScheme: boolean
  invalidResolvedUrl: boolean
}

const PRIMARY_HOST_LINK_VARIABLES = {
  '{{HOST.ID}}': (context: HostLinkTemplateContext) => String(context.id),
  '{{HOST.NAME}}': (context: HostLinkTemplateContext) => context.name,
  '{{HOST.IP}}': (context: HostLinkTemplateContext) => context.ip,
  '{{HOST.PORT}}': (context: HostLinkTemplateContext) => String(context.port),
  '{{HOST.SSH_USER}}': (context: HostLinkTemplateContext) => context.sshUser,
} as const

const HOST_LINK_VARIABLE_ALIASES = {
  '{{HOST:ID}}': '{{HOST.ID}}',
  '{{HOST:NAME}}': '{{HOST.NAME}}',
  '{{HOST:IP}}': '{{HOST.IP}}',
  '{{HOST:PORT}}': '{{HOST.PORT}}',
  '{{HOST:SSH_USER}}': '{{HOST.SSH_USER}}',
} as const

export function listHostLinkVariables(options: { includeAliases?: boolean } = {}): string[] {
  const primary = Object.keys(PRIMARY_HOST_LINK_VARIABLES)
  if (!options.includeAliases) return primary
  return [
    ...primary,
    ...Object.keys(HOST_LINK_VARIABLE_ALIASES),
  ]
}

export function resolveHostLinkTemplate(template: string, context: HostLinkTemplateContext): string {
  let resolved = template
  for (const [alias, primary] of Object.entries(HOST_LINK_VARIABLE_ALIASES)) {
    resolved = resolved.split(alias).join(primary)
  }
  for (const [token, resolver] of Object.entries(PRIMARY_HOST_LINK_VARIABLES)) {
    resolved = resolved.split(token).join(resolver(context))
  }
  return resolved
}

export function findUnknownHostLinkVariables(template: string): string[] {
  const matches = template.match(/\{\{[^}]+\}\}/g) ?? []
  const known = new Set(listHostLinkVariables({ includeAliases: true }))
  return [...new Set(matches.filter((token) => !known.has(token)))]
}

export function validateHostLinkTemplate(
  template: string,
  context?: HostLinkTemplateContext,
): HostLinkTemplateValidationResult {
  const normalized = template.trim()
  const unknownVariables = findUnknownHostLinkVariables(normalized)
  const schemeMatch = normalized.match(/^([a-z][a-z0-9+.-]*):\/\//i)
  const scheme = schemeMatch?.[1]?.toLowerCase() ?? null
  const invalidScheme = scheme !== 'http' && scheme !== 'https'

  let invalidResolvedUrl = false
  if (!invalidScheme && context) {
    try {
      const resolved = resolveHostLinkTemplate(normalized, context)
      new URL(resolved)
    } catch {
      invalidResolvedUrl = true
    }
  }

  return {
    valid: unknownVariables.length === 0 && !invalidScheme && !invalidResolvedUrl,
    unknownVariables,
    invalidScheme,
    invalidResolvedUrl,
  }
}
