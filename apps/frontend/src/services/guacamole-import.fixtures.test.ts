import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { anonymizeGuacamoleImport, parseGuacamoleExport } from './guacamole-import.service'

function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/guacamole/${name}`, import.meta.url), 'utf8')
}

describe('Guacamole versioned import fixtures', () => {
  it('imports a realistic user-mapping with four protocols, shared connections and secrets', () => {
    const result = parseGuacamoleExport(fixture('user-mapping-complete.xml'))

    expect(result.hosts).toHaveLength(4)
    expect(result.hosts.map(host => host.accessProtocol)).toEqual(['ssh', 'rdp', 'vnc', 'telnet'])
    expect(result.hosts.find(host => host.accessProtocol === 'ssh')).toEqual(expect.objectContaining({
      name: 'Linux Produção',
      port: 2222,
      sshUser: 'ubuntu',
    }))
    expect(result.hosts[0].warnings).toEqual(expect.arrayContaining([
      'secret-ignored',
      'parameters-not-supported',
      'duplicate-merged',
    ]))
    expect(result.invalidConnections).toBe(1)
    expect(result.unsupportedProtocols).toEqual(['kubernetes'])
    expect(result.unmappedPermissions).toBe(6)
    expect(result.hosts.filter(host => host.password).length).toBe(2)
    expect(JSON.stringify(result)).not.toContain('portal-password')
  })

  it('imports Guacamole single DEFAULT connection syntax', () => {
    const result = parseGuacamoleExport(fixture('user-mapping-default.xml'))
    expect(result.hosts).toEqual([expect.objectContaining({
      name: 'default.example.test',
      port: 22,
      accessProtocol: 'ssh',
    })])
  })

  it('rejects a malformed user-mapping fixture', () => {
    expect(() => parseGuacamoleExport(fixture('user-mapping-invalid.xml'))).toThrow()
  })

  it('preserves a realistic snake_case JDBC hierarchy and reports permission differences', () => {
    const result = parseGuacamoleExport(fixture('jdbc-hierarchy-snake-case.json'))

    expect(result.hosts).toHaveLength(3)
    expect(result.hosts.find(host => host.name === 'API Linux')?.folderPath)
      .toEqual(['Brasil', 'São Paulo', 'Produção'])
    expect(result.hosts.find(host => host.name === 'RDP 01')).toEqual(expect.objectContaining({
      folderPath: ['Brasil', 'São Paulo'],
      port: 3390,
      warnings: expect.arrayContaining(['balancing-group-flattened', 'parameters-not-supported']),
    }))
    expect(result.unmappedPermissions).toBe(3)
    expect(result.hosts.find(host => host.sourceId === 'jdbc:103')?.password).toBe('jdbc-password-must-not-survive')
    expect(JSON.stringify(result)).not.toContain('jdbc-private-key-must-not-survive')
  })

  it('keeps valid rows from a mixed-quality export and explains hierarchy loss', () => {
    const result = parseGuacamoleExport(fixture('jdbc-mixed-quality.json'))

    expect(result.hosts).toHaveLength(2)
    expect(result.invalidConnections).toBe(2)
    expect(result.unsupportedProtocols).toEqual(['kubernetes'])
    expect(result.hosts.find(host => host.name === 'SSH válido')?.port).toBe(22)
    expect(result.hosts.find(host => host.name === 'Grupo removido')).toEqual(expect.objectContaining({
      folderPath: [],
      warnings: expect.arrayContaining(['hierarchy-unresolved']),
    }))
  })

  it('rejects a truncated JDBC JSON fixture', () => {
    expect(() => parseGuacamoleExport(fixture('jdbc-invalid.json'))).toThrow()
  })

  it('produces a shareable sample without real names, addresses, users or folders', () => {
    const parsed = parseGuacamoleExport(fixture('jdbc-hierarchy-snake-case.json'))
    const anonymized = anonymizeGuacamoleImport(parsed)
    const serialized = JSON.stringify(anonymized)

    expect(anonymized.format).toBe('nodeaccess-guacamole-anonymized-v1')
    expect(anonymized.hosts[0]).toEqual(expect.objectContaining({
      name: 'connection-0001',
      ip: 'host-0001.example.invalid',
      folderPath: ['folder-001', 'folder-002', 'folder-003'],
    }))
    expect(serialized).not.toMatch(/Brasil|São Paulo|Produção|10\.10\.|deploy|operadores-linux|financeiro/)
  })
})
