export type MobaXtermImportWarning =
  | 'invalid-port-defaulted'
  | 'private-key-reference-ignored'
  | 'extra-fields-ignored'
  | 'field-layout-variation'

export interface MobaXtermImportedHost {
  sourceId: string
  name: string
  ip: string
  port: number
  sshUser: string
  folderPath: string[]
  warnings: MobaXtermImportWarning[]
  pemKeyNameHint?: string
  proxyJump?: string
}

export interface MobaXtermImportResult {
  hosts: MobaXtermImportedHost[]
  invalidSessions: number
  unsupportedSessions: number
  unsupportedSessionTypes: string[]
  folders: string[][]
  fieldCounts: number[]
  bookmarkSections: number
  totalSessions: number
  format: 'sessions-export' | 'full-ini'
  encryptedCredentialsDetected: number
  masterPasswordConfigured: boolean
}

const MAX_FILE_CHARACTERS = 5 * 1024 * 1024
const MAX_SESSIONS = 5000
const SSH_SESSION_MARKER = /^#109#\d+$/
const SESSION_MARKER = /^#\d+#\d+$/
const PRIVATE_KEY_EXTENSION = /\.(?:pem|key|ppk|openssh)$/i
const KNOWN_SAMPLE_FIELD_COUNT = 66

interface BookmarkSection {
  name: string
  values: Array<{ key: string; value: string; line: number }>
}

function folderPath(value: string): string[] {
  return value
    .replace(/^\\+|\\+$/g, '')
    .split(/[\\/]+/)
    .map(part => part.trim())
    .filter(Boolean)
    .slice(0, 20)
}

function parseSections(content: string): BookmarkSection[] {
  const sections: BookmarkSection[] = []
  let current: BookmarkSection | null = null

  for (const [index, rawLine] of content.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';')) continue
    const sectionMatch = line.match(/^\[([^\]]+)]$/)
    if (sectionMatch) {
      current = /^Bookmarks(?:_\d+)?$/i.test(sectionMatch[1])
        ? { name: sectionMatch[1], values: [] }
        : null
      if (current) sections.push(current)
      continue
    }
    if (!current) continue
    const separator = rawLine.indexOf('=')
    if (separator < 1) continue
    current.values.push({
      key: rawLine.slice(0, separator).trim(),
      value: rawLine.slice(separator + 1).trim(),
      line: index + 1,
    })
  }

  return sections
}

function countSectionEntries(content: string, sectionPattern: RegExp): number {
  let active = false
  let count = 0
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    const section = line.match(/^\[([^\]]+)]$/)
    if (section) { active = sectionPattern.test(section[1]); continue }
    if (active && line && !line.startsWith(';') && line.includes('=')) count++
  }
  return count
}

export function parseMobaXtermSessions(content: string): MobaXtermImportResult {
  if (content.length > MAX_FILE_CHARACTERS) throw new Error('MobaXterm file exceeds the 5 MB limit')

  const hosts: MobaXtermImportedHost[] = []
  const unsupportedSessionTypes = new Set<string>()
  const folderKeys = new Set<string>()
  const folders: string[][] = []
  const fieldCounts = new Set<number>()
  let invalidSessions = 0
  let unsupportedSessions = 0
  let sessionCount = 0

  const sections = parseSections(content)
  const allSectionNames = [...content.matchAll(/^\[([^\]]+)]\s*$/gm)].map(match => match[1].trim())
  const format = allSectionNames.some(name => !/^Bookmarks(?:_\d+)?$/i.test(name)) ? 'full-ini' as const : 'sessions-export' as const
  const encryptedCredentialsDetected = countSectionEntries(content, /^Passwords(?:_\d+)?$/i)
  const masterPasswordConfigured = /^(?:MasterPassword|MPSet|PasswordsMasterPassword)\s*=\s*[^\s0]\s*$/im.test(content)
  for (const [sectionIndex, section] of sections.entries()) {
    const sectionFolder = folderPath(section.values.find(item => item.key.toLowerCase() === 'subrep')?.value ?? '')
    const sectionFolderKey = sectionFolder.join('\u0000').toLowerCase()
    if (sectionFolder.length && !folderKeys.has(sectionFolderKey)) {
      folderKeys.add(sectionFolderKey)
      folders.push(sectionFolder)
    }

    let entryIndex = 0
    for (const entry of section.values) {
      if (/^(?:subrep|imgnum)$/i.test(entry.key)) continue
      sessionCount++
      if (sessionCount > MAX_SESSIONS) throw new Error('MobaXterm file exceeds the 5000 session limit')

      const fields = entry.value.split('%')
      const marker = fields[0]?.trim() ?? ''
      if (!SESSION_MARKER.test(marker)) {
        invalidSessions++
        continue
      }
      if (!SSH_SESSION_MARKER.test(marker)) {
        unsupportedSessions++
        unsupportedSessionTypes.add(marker)
        continue
      }

      const ip = fields[1]?.trim() ?? ''
      if (!entry.key || !ip) {
        invalidSessions++
        continue
      }

      const warnings: MobaXtermImportWarning[] = []
      const rawPort = fields[2]?.trim() ?? ''
      const numericPort = /^\d+$/.test(rawPort) ? Number(rawPort) : 22
      const port = numericPort >= 1 && numericPort <= 65535 ? numericPort : 22
      if (rawPort && port !== numericPort) warnings.push('invalid-port-defaulted')
      if (!rawPort || !/^\d+$/.test(rawPort)) {
        if (rawPort) warnings.push('invalid-port-defaulted')
      }

      // MobaXterm's private-key slot has moved across observed exports. Only detect it;
      // never expose the path or treat a local path as an uploaded NodeAccess key.
      const privateKeyReference = [fields[14], fields[15]].find(value => PRIVATE_KEY_EXTENSION.test(value?.trim() ?? ''))?.trim()
      if (privateKeyReference) {
        warnings.push('private-key-reference-ignored')
      }
      if (fields.length > KNOWN_SAMPLE_FIELD_COUNT) warnings.push('extra-fields-ignored')
      else if (fields.length < KNOWN_SAMPLE_FIELD_COUNT) warnings.push('field-layout-variation')

      // Observed SSH bookmark layouts store the optional gateway as
      // host/port/user at slots 8-10 (and 7-9 in an older variant). Require a
      // complete plausible tuple so an
      // unknown layout cannot silently associate the wrong bastion.
      const gatewayTuple = [[8, 9, 10], [7, 8, 9]].map(([hostIndex, portIndex, userIndex]) => ({
        host: fields[hostIndex]?.trim() ?? '',
        port: fields[portIndex]?.trim() ?? '',
        user: fields[userIndex]?.trim() ?? '',
      })).find(candidate => candidate.host.length > 0
        && candidate.host !== '-1'
        && candidate.user.length > 0
        && candidate.user !== '-1'
        && /^\d+$/.test(candidate.port)
        && Number(candidate.port) >= 1
        && Number(candidate.port) <= 65535)
      const gatewayHost = gatewayTuple?.host ?? ''
      const gatewayPort = gatewayTuple?.port ?? ''
      const gatewayUser = gatewayTuple?.user ?? ''
      const hasGateway = gatewayHost.length > 0
        && gatewayHost !== '-1'
        && gatewayUser.length > 0
        && gatewayUser !== '-1'
        && /^\d+$/.test(gatewayPort)
        && Number(gatewayPort) >= 1
        && Number(gatewayPort) <= 65535
      const proxyJump = hasGateway
        ? `${gatewayUser}@${gatewayHost}${gatewayPort === '22' ? '' : `:${gatewayPort}`}`
        : undefined

      fieldCounts.add(fields.length)
      hosts.push({
        sourceId: `mobaxterm:${sectionIndex}:${entryIndex++}:${entry.line}`,
        name: entry.key.slice(0, 100),
        ip: ip.slice(0, 255),
        port,
        sshUser: (fields[3]?.trim() ?? '').slice(0, 64),
        folderPath: sectionFolder,
        warnings,
        ...(privateKeyReference ? { pemKeyNameHint: privateKeyReference.split(/[\\/]/).pop()?.replace(/\.(?:pem|key|ppk|openssh)$/i, '').slice(0, 100) } : {}),
        ...(proxyJump ? { proxyJump } : {}),
      })
    }
  }

  return {
    hosts,
    invalidSessions,
    unsupportedSessions,
    unsupportedSessionTypes: [...unsupportedSessionTypes].sort(),
    folders,
    fieldCounts: [...fieldCounts].sort((a, b) => a - b),
    bookmarkSections: sections.length,
    totalSessions: sessionCount,
    format,
    encryptedCredentialsDetected,
    masterPasswordConfigured,
  }
}
