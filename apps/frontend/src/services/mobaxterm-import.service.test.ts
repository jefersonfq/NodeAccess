import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseMobaXtermSessions } from './mobaxterm-import.service'

function sshRecord(host = 'server.example.test', port = '22', user = 'deploy', extraFields: string[] = []): string {
  const fields = Array.from({ length: 66 }, () => '')
  fields[0] = '#109#0'
  fields[1] = host
  fields[2] = port
  fields[3] = user
  return [...fields, ...extraFields].join('%')
}

describe('parseMobaXtermSessions', () => {
  it('imports the user-provided export as a real migration would', () => {
    const fixturePath = fileURLToPath(new URL('../../../../imgs_debug/MobaXterm Sessions_personal_folders.mxtsessions', import.meta.url))
    const result = parseMobaXtermSessions(readFileSync(fixturePath, 'utf8'))

    expect(result.hosts).toHaveLength(4)
    expect(result.invalidSessions).toBe(0)
    expect(result.unsupportedSessions).toBe(0)
    expect(result.fieldCounts).toEqual([66])
    expect(result.bookmarkSections).toBe(2)
    expect(result.totalSessions).toBe(4)
    expect(result.folders).toHaveLength(2)
    expect(result.hosts.filter(host => host.folderPath.length)).toHaveLength(4)
    expect(result.hosts.every(host => host.ip && host.port >= 1 && host.port <= 65535)).toBe(true)
    expect(result.hosts.filter(host => host.warnings.includes('private-key-reference-ignored'))).toHaveLength(3)
    expect(result.hosts.find(host => host.name === 'kindle 192.168.196.174')).toMatchObject({
      proxyJump: 'jump@192.168.1.27',
    })

    // The normalized payload contains no local key path or credential material.
    const serializedHosts = JSON.stringify(result.hosts)
    expect(serializedHosts).not.toMatch(/\.pem|\.key|passphrase|C:\\\\/i)
  })

  it('only imports a MobaXterm gateway when host, port and user form a complete tuple', () => {
    const complete = sshRecord().split('%')
    complete[7] = 'jump.example.test'
    complete[8] = '2222'
    complete[9] = 'gateway-user'
    const incomplete = sshRecord('second.example.test').split('%')
    incomplete[7] = 'ambiguous-field-from-another-version'
    const result = parseMobaXtermSessions(`[Bookmarks]\nComplete=${complete.join('%')}\nIncomplete=${incomplete.join('%')}`)

    expect(result.hosts[0]?.proxyJump).toBe('gateway-user@jump.example.test:2222')
    expect(result.hosts[1]?.proxyJump).toBeUndefined()
  })

  it('preserves nested personal folders and tolerates BOM, CRLF and future fields', () => {
    const content = `\uFEFF[Bookmarks_7]\r\nSubRep=Clientes\\Produção\r\nImgNum=42\r\nServidor API=${sshRecord('api.example.test', '2222', 'ubuntu', ['future-setting'])}\r\n`
    const result = parseMobaXtermSessions(content)

    expect(result.hosts).toEqual([
      expect.objectContaining({
        name: 'Servidor API',
        ip: 'api.example.test',
        port: 2222,
        sshUser: 'ubuntu',
        folderPath: ['Clientes', 'Produção'],
        warnings: ['extra-fields-ignored'],
      }),
    ])
    expect(result.fieldCounts).toEqual([67])
  })

  it('keeps valid SSH sessions while reporting malformed and unsupported records', () => {
    const content = [
      '[Bookmarks]',
      'SubRep=',
      `SSH válido=${sshRecord('valid.example.test')}`,
      `Porta inválida=${sshRecord('fallback.example.test', '70000')}`,
      'RDP=#91#0%rdp.example.test%3389%operator',
      'Quebrado=not-a-session',
      `Sem host=${sshRecord('', '22', 'root')}`,
    ].join('\n')
    const result = parseMobaXtermSessions(content)

    expect(result.hosts).toHaveLength(2)
    expect(result.hosts[1]).toEqual(expect.objectContaining({
      port: 22,
      warnings: ['invalid-port-defaulted'],
    }))
    expect(result.unsupportedSessions).toBe(1)
    expect(result.unsupportedSessionTypes).toEqual(['#91#0'])
    expect(result.invalidSessions).toBe(2)
    expect(result.totalSessions).toBe(5)
  })

  it('accepts an older shorter layout but makes the version variation visible', () => {
    const fields = sshRecord('legacy.example.test').split('%').slice(0, 20)
    const result = parseMobaXtermSessions(`[Bookmarks]\nLegado=${fields.join('%')}`)

    expect(result.hosts[0]).toEqual(expect.objectContaining({
      ip: 'legacy.example.test',
      warnings: ['field-layout-variation'],
    }))
    expect(result.fieldCounts).toEqual([20])
  })

  it('recognizes a full INI and reports encrypted credentials without exposing their values', () => {
    const result = parseMobaXtermSessions([
      '[Misc]',
      'MasterPassword=1',
      '[Passwords]',
      'ssh:user@server=proprietary-ciphertext',
      '[Bookmarks]',
      `Servidor=${sshRecord()}`,
    ].join('\n'))

    expect(result).toEqual(expect.objectContaining({
      format: 'full-ini', encryptedCredentialsDetected: 1, masterPasswordConfigured: true,
    }))
    expect(JSON.stringify(result.hosts)).not.toContain('proprietary-ciphertext')
  })

  it('rejects files beyond the safe size and session limits', () => {
    expect(() => parseMobaXtermSessions('x'.repeat(5 * 1024 * 1024 + 1))).toThrow('5 MB')
    const records = Array.from({ length: 5001 }, (_, index) => `host-${index}=${sshRecord(`host-${index}.example.test`)}`)
    expect(() => parseMobaXtermSessions(['[Bookmarks]', ...records].join('\n'))).toThrow('5000 session')
  })
})
