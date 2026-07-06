export interface ParsedLogin {
  nodeAccessLogin: string
  targetUser?: string
  target?: string
}

export function parseLoginCandidates(username: string): ParsedLogin[] {
  const parts = username.split('@').filter(Boolean)
  const candidates: ParsedLogin[] = [{ nodeAccessLogin: username }]

  if (parts.length >= 2) {
    for (let loginParts = parts.length - 1; loginParts >= 1; loginParts -= 1) {
      const remainingParts = parts.length - loginParts
      if (remainingParts >= 2) {
        const targetUser = parts[loginParts]
        const target = parts.slice(loginParts + 1).join('@')
        candidates.push({
          nodeAccessLogin: parts.slice(0, loginParts).join('@'),
          ...(targetUser !== undefined && { targetUser }),
          target,
        })
      }

      candidates.push({
        nodeAccessLogin: parts.slice(0, loginParts).join('@'),
        target: parts.slice(loginParts).join('@'),
      })
    }
  }

  return dedupeParsedLogins(candidates)
}

export function parseTarget(input: string): Pick<ParsedLogin, 'targetUser' | 'target'> {
  const separator = input.indexOf('@')
  if (separator <= 0) return { target: input }
  return {
    targetUser: input.slice(0, separator),
    target: input.slice(separator + 1),
  }
}

function dedupeParsedLogins(candidates: ParsedLogin[]): ParsedLogin[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = `${candidate.nodeAccessLogin}|${candidate.targetUser ?? ''}|${candidate.target ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
