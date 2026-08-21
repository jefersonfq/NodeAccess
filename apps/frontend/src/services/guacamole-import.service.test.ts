import { describe, expect, it } from 'vitest'
import { parseGuacamoleExport, parseGuacamoleJdbcExport, parseGuacamoleUserMapping } from './guacamole-import.service'

describe('parseGuacamoleUserMapping', () => {
  it('preserves SSH connection fields without treating the authorize user as an SSH credential', () => {
    const result = parseGuacamoleUserMapping(`
      <user-mapping>
        <authorize username="portal-user" password="portal-secret">
          <connection name="Linux &amp; produção">
            <protocol>ssh</protocol>
            <param name="hostname">srv.example.com</param>
            <param name="port">2222</param>
            <param name="password">remote-secret</param>
            <param name="private-key">private-material</param>
          </connection>
        </authorize>
      </user-mapping>
    `)

    expect(result.hosts).toEqual([expect.objectContaining({
      name: 'Linux & produção',
      ip: 'srv.example.com',
      port: 2222,
      accessProtocol: 'ssh',
      sshUser: '',
    })])
    expect(result.hosts[0].warnings).toEqual(expect.arrayContaining([
      'secret-ignored',
      'username-not-imported',
    ]))
    expect(result.hosts[0].password).toBe('remote-secret')
    expect(JSON.stringify(result)).not.toContain('private-material')
    expect(JSON.stringify(result)).not.toContain('portal-secret')
  })

  it('maps supported protocols and their standard ports', () => {
    const result = parseGuacamoleUserMapping(`
      <user-mapping><authorize username="operator">
        <connection name="SSH"><protocol>ssh</protocol><param name="hostname">linux</param><param name="username">ubuntu</param></connection>
        <connection name="RDP"><protocol>rdp</protocol><param name="hostname">windows</param><param name="username">DOMAIN\\user</param></connection>
        <connection name="VNC"><protocol>vnc</protocol><param name="hostname">desktop</param></connection>
        <connection name="Telnet"><protocol>telnet</protocol><param name="hostname">legacy</param></connection>
      </authorize></user-mapping>
    `)

    expect(result.hosts.map(host => [host.accessProtocol, host.port, host.sshUser])).toEqual([
      ['ssh', 22, 'ubuntu'],
      ['rdp', 3389, 'DOMAIN\\user'],
      ['vnc', 5900, ''],
      ['telnet', 23, ''],
    ])
  })

  it('consolidates a connection repeated under multiple authorize users', () => {
    const result = parseGuacamoleUserMapping(`
      <user-mapping>
        <authorize username="alice"><connection name="Shared"><protocol>ssh</protocol><param name="hostname">shared.local</param></connection></authorize>
        <authorize username="bob"><connection name="Shared"><protocol>ssh</protocol><param name="hostname">shared.local</param></connection></authorize>
      </user-mapping>
    `)

    expect(result.hosts).toHaveLength(1)
    expect(result.hosts[0].warnings).toContain('duplicate-merged')
  })

  it('classifies dynamic credentials, exposes a safe mapping hint, and preserves native 1Password references', () => {
    const token = parseGuacamoleUserMapping('<user-mapping><authorize username="u"><connection name="A"><protocol>ssh</protocol><param name="hostname">a</param><param name="password">${GUAC_PASSWORD}</param></connection></authorize></user-mapping>')
    expect(token.hosts[0]).not.toHaveProperty('password')
    expect(token.hosts[0]).toHaveProperty('credentialReferenceHint', '${GUAC_PASSWORD}')
    expect(token.hosts[0].warnings).toContain('credential-reference-not-imported')
    expect(token.credentials.externalReferences).toBe(1)

    const onePassword = parseGuacamoleUserMapping('<user-mapping><authorize username="u"><connection name="A"><protocol>ssh</protocol><param name="hostname">a</param><param name="password">op://Infra/Server/password</param></connection></authorize></user-mapping>')
    expect(onePassword.hosts[0]).toEqual(expect.objectContaining({ onePasswordRef: 'op://Infra/Server/password' }))
    expect(onePassword.hosts[0]).not.toHaveProperty('password')
  })

  it('reports unsupported and incomplete connections instead of silently discarding them', () => {
    const result = parseGuacamoleUserMapping(`
      <user-mapping><authorize username="operator">
        <connection name="Kubernetes"><protocol>kubernetes</protocol><param name="hostname">cluster</param></connection>
        <connection name="Incomplete"><protocol>ssh</protocol></connection>
      </authorize></user-mapping>
    `)

    expect(result.hosts).toEqual([])
    expect(result.invalidConnections).toBe(2)
    expect(result.unsupportedProtocols).toEqual(['kubernetes'])
  })

  it('supports the Guacamole DEFAULT connection form directly under authorize', () => {
    const result = parseGuacamoleUserMapping(`
      <user-mapping><authorize username="operator">
        <protocol>vnc</protocol>
        <param name="hostname">default-vnc</param>
        <param name="port">5901</param>
      </authorize></user-mapping>
    `)

    expect(result.hosts).toEqual([expect.objectContaining({
      name: 'default-vnc',
      accessProtocol: 'vnc',
      port: 5901,
    })])
  })

  it('rejects malformed XML', () => {
    expect(() => parseGuacamoleUserMapping('<user-mapping><authorize></user-mapping>')).toThrow()
  })

  it('rejects document type declarations and custom entities', () => {
    expect(() => parseGuacamoleUserMapping(`
      <!DOCTYPE user-mapping [<!ENTITY secret SYSTEM "file:///etc/passwd">]>
      <user-mapping><authorize username="user"><protocol>ssh</protocol><param name="hostname">&secret;</param></authorize></user-mapping>
    `)).toThrow('DOCTYPE')
  })
})

describe('parseGuacamoleJdbcExport', () => {
  it('maps nested organizational groups to a NodeAccess folder path', () => {
    const result = parseGuacamoleJdbcExport(JSON.stringify({
      guacamole_connection_group: [
        { connection_group_id: 1, parent_id: null, connection_group_name: 'Datacenter', type: 'ORGANIZATIONAL' },
        { connection_group_id: 2, parent_id: 1, connection_group_name: 'Produção', type: 'ORGANIZATIONAL' },
      ],
      guacamole_connection: [
        { connection_id: 10, parent_id: 2, connection_name: 'Linux 01', protocol: 'ssh' },
      ],
      guacamole_connection_parameter: [
        { connection_id: 10, parameter_name: 'hostname', parameter_value: '10.0.0.10' },
        { connection_id: 10, parameter_name: 'username', parameter_value: 'ubuntu' },
        { connection_id: 10, parameter_name: 'password', parameter_value: 'never-copy-this' },
      ],
      guacamole_connection_permission: [
        { entity_id: 7, connection_id: 10, permission: 'READ' },
      ],
    }))

    expect(result.hosts).toEqual([expect.objectContaining({
      name: 'Linux 01',
      folderPath: ['Datacenter', 'Produção'],
      accessProtocol: 'ssh',
      ip: '10.0.0.10',
    })])
    expect(result.hosts[0].warnings).toContain('secret-ignored')
    expect(result.unmappedPermissions).toBe(1)
    expect(result.hosts[0].password).toBe('never-copy-this')
  })

  it('flattens balancing groups while preserving their organizational ancestors', () => {
    const result = parseGuacamoleJdbcExport(JSON.stringify({
      connectionGroups: [
        { id: 1, name: 'Filial SP', type: 'ORGANIZATIONAL' },
        { id: 2, parentId: 1, name: 'Pool RDP', type: 'BALANCING' },
      ],
      connections: [{ id: 20, parentId: 2, name: 'Windows', protocol: 'rdp' }],
      connectionParameters: [{ connectionId: 20, name: 'hostname', value: 'win.example.test' }],
    }))

    expect(result.hosts[0].folderPath).toEqual(['Filial SP'])
    expect(result.hosts[0].warnings).toContain('balancing-group-flattened')
  })

  it('automatically selects the XML or JDBC JSON parser', () => {
    expect(parseGuacamoleExport(JSON.stringify({
      connections: [{ id: 1, name: 'Server', protocol: 'ssh' }],
      connectionParameters: [{ connectionId: 1, name: 'hostname', value: 'server' }],
    })).hosts).toHaveLength(1)
    expect(parseGuacamoleExport('<user-mapping><authorize username="u"><protocol>ssh</protocol><param name="hostname">server</param></authorize></user-mapping>').hosts).toHaveLength(1)
  })
})
