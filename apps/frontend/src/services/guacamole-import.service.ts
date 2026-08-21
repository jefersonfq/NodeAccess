import { XMLParser, XMLValidator } from 'fast-xml-parser'
import type { HostAccessProtocol } from '@nodeaccess/shared'

export type GuacamoleImportWarning =
  | 'secret-ignored'
  | 'duplicate-merged'
  | 'username-not-imported'
  | 'parameters-not-supported'
  | 'balancing-group-flattened'
  | 'hierarchy-unresolved'
  | 'credential-reference-not-imported'

export interface GuacamoleImportedHost {
  sourceId: string
  name: string
  ip: string
  port: number
  accessProtocol: HostAccessProtocol
  sshUser: string
  password?: string
  onePasswordRef?: string
  credentialReferenceHint?: string
  folderPath: string[]
  warnings: GuacamoleImportWarning[]
}

export interface GuacamoleImportResult {
  hosts: GuacamoleImportedHost[]
  invalidConnections: number
  unsupportedProtocols: string[]
  unmappedPermissions: number
  sourcePrincipals: string[]
  credentials: { plaintextPasswords: number; externalReferences: number; privateKeys: number; passphrases: number }
}

type XmlNode = Record<string, unknown>

const SUPPORTED_PROTOCOLS = new Set<HostAccessProtocol>(['ssh', 'rdp', 'vnc', 'telnet'])
const DEFAULT_PORTS: Record<string, number> = { ssh: 22, rdp: 3389, vnc: 5900, telnet: 23 }
const SECRET_PARAMETERS = new Set(['password', 'private-key', 'passphrase'])
const PRESERVED_PARAMETERS = new Set(['hostname', 'host', 'port', 'username'])
const emptyCredentials = () => ({ plaintextPasswords: 0, externalReferences: 0, privateKeys: 0, passphrases: 0 })
const isCredentialReference = (value: string) => /^\$\{[^}]+}$/.test(value.trim()) || /^(?:op|secret|keeper):\/\//i.test(value.trim())

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
  isArray: (_name, jPath) => typeof jPath === 'string' && /\.(authorize|connection|param)$/.test(jPath),
})

function asObject(value: unknown): XmlNode | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as XmlNode : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value]
}

function text(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim()
  const node = asObject(value)
  return typeof node?.['#text'] === 'string' ? node['#text'].trim() : ''
}

function parameters(connection: XmlNode): Map<string, string> {
  const result = new Map<string, string>()
  for (const rawParam of asArray(connection.param)) {
    const param = asObject(rawParam)
    const name = text(param?.['@_name']).toLowerCase()
    if (name) result.set(name, text(param?.['#text']))
  }
  return result
}

function parsePort(value: string, fallback: number): number {
  if (!/^\d+$/.test(value)) return fallback
  const port = Number(value)
  return port >= 1 && port <= 65535 ? port : fallback
}

export function parseGuacamoleUserMapping(content: string): GuacamoleImportResult {
  const normalized = content.trim()
  if (!normalized) return { hosts: [], invalidConnections: 0, unsupportedProtocols: [], unmappedPermissions: 0, sourcePrincipals: [], credentials: emptyCredentials() }
  if (/<!DOCTYPE/i.test(normalized)) throw new Error('DOCTYPE declarations are not supported')

  const validation = XMLValidator.validate(normalized)
  if (validation !== true) throw new Error(validation.err.msg)

  const document = asObject(parser.parse(normalized))
  const mapping = asObject(document?.['user-mapping'])
  if (!mapping) throw new Error('Expected a user-mapping root element')

  const hostsByEndpoint = new Map<string, GuacamoleImportedHost>()
  const unsupportedProtocols = new Set<string>()
  let invalidConnections = 0
  let authorizationLinks = 0
  const sourcePrincipals = new Set<string>()
  const credentials = emptyCredentials()

  for (const rawAuthorize of asArray(mapping.authorize)) {
    const authorize = asObject(rawAuthorize)
    if (!authorize) continue
    const authorizeUsername = text(authorize['@_username'])
    if (authorizeUsername) sourcePrincipals.add(authorizeUsername)
    const nestedConnections = asArray(authorize.connection)
    const directConnection = authorize.protocol ? [authorize] : []
    authorizationLinks += nestedConnections.length + directConnection.length

    for (const rawConnection of [...nestedConnections, ...directConnection]) {
      const connection = asObject(rawConnection)
      if (!connection) continue
      const protocol = text(connection.protocol).toLowerCase()
      if (!SUPPORTED_PROTOCOLS.has(protocol as HostAccessProtocol)) {
        if (protocol) unsupportedProtocols.add(protocol)
        invalidConnections++
        continue
      }

      const params = parameters(connection)
      const ip = params.get('hostname') || params.get('host') || ''
      if (!ip) {
        invalidConnections++
        continue
      }

      const accessProtocol = protocol as HostAccessProtocol
      const port = parsePort(params.get('port') || '', DEFAULT_PORTS[protocol])
      const sshUser = params.get('username') || ''
      const name = text(connection['@_name']) || ip
      const warnings = new Set<GuacamoleImportWarning>()
      if ([...SECRET_PARAMETERS].some(key => params.has(key))) warnings.add('secret-ignored')
      const password = params.get('password') ?? ''
      if (password) {
        if (isCredentialReference(password)) { credentials.externalReferences++; warnings.add('credential-reference-not-imported') }
        else credentials.plaintextPasswords++
      }
      if (params.get('private-key')) credentials.privateKeys++
      if (params.get('passphrase')) credentials.passphrases++
      if (!sshUser && authorizeUsername) warnings.add('username-not-imported')
      if ([...params.keys()].some(key => !PRESERVED_PARAMETERS.has(key) && !SECRET_PARAMETERS.has(key))) {
        warnings.add('parameters-not-supported')
      }

      const endpointKey = `${accessProtocol}|${ip.toLowerCase()}|${port}|${sshUser.toLowerCase()}`
      const existing = hostsByEndpoint.get(endpointKey)
      if (existing) {
        if (!existing.warnings.includes('duplicate-merged')) existing.warnings.push('duplicate-merged')
        continue
      }

      hostsByEndpoint.set(endpointKey, {
        sourceId: endpointKey,
        name,
        ip,
        port,
        accessProtocol,
        sshUser,
        ...(password && !isCredentialReference(password) ? { password } : {}),
        ...(password.startsWith('op://') ? { onePasswordRef: password } : {}),
        ...(password && isCredentialReference(password) && !password.startsWith('op://') ? { credentialReferenceHint: password.slice(0, 500) } : {}),
        folderPath: [],
        warnings: [...warnings],
      })
    }
  }

  return {
    hosts: [...hostsByEndpoint.values()],
    invalidConnections,
    unsupportedProtocols: [...unsupportedProtocols].sort(),
    unmappedPermissions: authorizationLinks,
    sourcePrincipals: [...sourcePrincipals].sort(),
    credentials,
  }
}

function field(row: XmlNode, ...names: string[]): unknown {
  for (const name of names) if (row[name] !== undefined) return row[name]
  return undefined
}

function rows(document: XmlNode, ...names: string[]): XmlNode[] {
  for (const name of names) {
    const value = document[name]
    if (value !== undefined) return asArray(value).map(asObject).filter((row): row is XmlNode => row !== null)
  }
  return []
}

export function parseGuacamoleJdbcExport(content: string): GuacamoleImportResult {
  const document = asObject(JSON.parse(content))
  if (!document) throw new Error('Expected a JSON object')

  const groupRows = rows(document, 'connectionGroups', 'connection_groups', 'guacamole_connection_group')
  const connectionRows = rows(document, 'connections', 'guacamole_connection')
  const parameterRows = rows(document, 'connectionParameters', 'connection_parameters', 'guacamole_connection_parameter')
  const permissionRows = [
    ...rows(document, 'connectionPermissions', 'connection_permissions', 'guacamole_connection_permission'),
    ...rows(document, 'connectionGroupPermissions', 'connection_group_permissions', 'guacamole_connection_group_permission'),
  ]
  const entityRows = rows(document, 'entities', 'guacamole_entity')
  const entityNames = new Map(entityRows.map(row => [
    text(field(row, 'entity_id', 'entityId', 'id')),
    text(field(row, 'name', 'entity_name', 'entityName')),
  ]))
  if (!connectionRows.length) throw new Error('No Guacamole connections found')

  const groups = new Map<string, { name: string; parentId: string; type: string }>()
  for (const row of groupRows) {
    const id = text(field(row, 'connection_group_id', 'connectionGroupId', 'id'))
    if (!id) continue
    groups.set(id, {
      name: text(field(row, 'connection_group_name', 'connectionGroupName', 'name')),
      parentId: text(field(row, 'parent_id', 'parentId')),
      type: text(field(row, 'type')).toUpperCase(),
    })
  }

  const paramsByConnection = new Map<string, Map<string, string>>()
  for (const row of parameterRows) {
    const connectionId = text(field(row, 'connection_id', 'connectionId'))
    const name = text(field(row, 'parameter_name', 'parameterName', 'name')).toLowerCase()
    if (!connectionId || !name) continue
    const params = paramsByConnection.get(connectionId) ?? new Map<string, string>()
    params.set(name, text(field(row, 'parameter_value', 'parameterValue', 'value')))
    paramsByConnection.set(connectionId, params)
  }

  const hosts: GuacamoleImportedHost[] = []
  const unsupportedProtocols = new Set<string>()
  let invalidConnections = 0
  const credentials = emptyCredentials()

  for (const row of connectionRows) {
    const connectionId = text(field(row, 'connection_id', 'connectionId', 'id'))
    const protocol = text(field(row, 'protocol')).toLowerCase()
    if (!SUPPORTED_PROTOCOLS.has(protocol as HostAccessProtocol)) {
      if (protocol) unsupportedProtocols.add(protocol)
      invalidConnections++
      continue
    }
    const params = paramsByConnection.get(connectionId) ?? new Map<string, string>()
    const ip = params.get('hostname') || params.get('host') || ''
    if (!ip) {
      invalidConnections++
      continue
    }

    const folderPath: string[] = []
    let groupId = text(field(row, 'parent_id', 'parentId'))
    let balancingGroup = false
    let hierarchyUnresolved = false
    const visited = new Set<string>()
    while (groupId && !visited.has(groupId)) {
      visited.add(groupId)
      const group = groups.get(groupId)
      if (!group) {
        hierarchyUnresolved = true
        break
      }
      if (group.type === 'BALANCING') balancingGroup = true
      else if (group.name) folderPath.unshift(group.name)
      groupId = group.parentId
    }
    if (groupId && visited.has(groupId)) hierarchyUnresolved = true

    const accessProtocol = protocol as HostAccessProtocol
    const warnings = new Set<GuacamoleImportWarning>()
    if ([...SECRET_PARAMETERS].some(key => params.has(key))) warnings.add('secret-ignored')
    if ([...params.keys()].some(key => !PRESERVED_PARAMETERS.has(key) && !SECRET_PARAMETERS.has(key))) warnings.add('parameters-not-supported')
    if (balancingGroup) warnings.add('balancing-group-flattened')
    if (hierarchyUnresolved) warnings.add('hierarchy-unresolved')
    const password = params.get('password') ?? ''
    if (password) {
      if (isCredentialReference(password)) { credentials.externalReferences++; warnings.add('credential-reference-not-imported') }
      else credentials.plaintextPasswords++
    }
    if (params.get('private-key')) credentials.privateKeys++
    if (params.get('passphrase')) credentials.passphrases++

    hosts.push({
      sourceId: `jdbc:${connectionId}`,
      name: text(field(row, 'connection_name', 'connectionName', 'name')) || ip,
      ip,
      port: parsePort(params.get('port') || '', DEFAULT_PORTS[protocol]),
      accessProtocol,
      sshUser: params.get('username') || '',
      ...(password && !isCredentialReference(password) ? { password } : {}),
      ...(password.startsWith('op://') ? { onePasswordRef: password } : {}),
      ...(password && isCredentialReference(password) && !password.startsWith('op://') ? { credentialReferenceHint: password.slice(0, 500) } : {}),
      folderPath,
      warnings: [...warnings],
    })
  }

  return {
    hosts,
    invalidConnections,
    unsupportedProtocols: [...unsupportedProtocols].sort(),
    unmappedPermissions: permissionRows.length,
    sourcePrincipals: [...new Set(permissionRows
      .map(row => entityNames.get(text(field(row, 'entity_id', 'entityId'))) ?? '')
      .filter(Boolean))].sort(),
    credentials,
  }
}

export function parseGuacamoleExport(content: string): GuacamoleImportResult {
  return content.trimStart().startsWith('{')
    ? parseGuacamoleJdbcExport(content)
    : parseGuacamoleUserMapping(content)
}

export function anonymizeGuacamoleImport(result: GuacamoleImportResult) {
  const folderAliases = new Map<string, string>()
  const principalAliases = new Map<string, string>()
  const alias = (map: Map<string, string>, value: string, prefix: string) => {
    if (!map.has(value)) map.set(value, `${prefix}-${String(map.size + 1).padStart(3, '0')}`)
    return map.get(value)!
  }
  return {
    format: 'nodeaccess-guacamole-anonymized-v1',
    hosts: result.hosts.map((host, index) => ({
      ...host,
      sourceId: `source-${String(index + 1).padStart(4, '0')}`,
      name: `connection-${String(index + 1).padStart(4, '0')}`,
      ip: `host-${String(index + 1).padStart(4, '0')}.example.invalid`,
      sshUser: host.sshUser ? `user-${String(index + 1).padStart(4, '0')}` : '',
      ...(host.password ? { password: '[REDACTED]' } : {}),
      folderPath: host.folderPath.map(folder => alias(folderAliases, folder, 'folder')),
    })),
    invalidConnections: result.invalidConnections,
    unsupportedProtocols: result.unsupportedProtocols,
    unmappedPermissions: result.unmappedPermissions,
    sourcePrincipals: result.sourcePrincipals.map(principal => alias(principalAliases, principal, 'principal')),
  }
}
