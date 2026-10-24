import { describe, expect, it } from 'vitest'
import { HostImportPreviewRequestSchema } from '@nodeaccess/shared'
import { isRoyalTsCsv, parseRoyalTsCsv, readSessionImportFile } from './royalts-import.service'

describe('Royal TS CSV export', () => {
  it('maps documented connection properties and distinguishes Telnet within RoyalSSHConnection', () => {
    const result = parseRoyalTsCsv('Name,URI,ObjectType,ConnectionType,Port,RDPPort,Username,FolderPath,Password\nLinux,linux.test,RoyalSSHConnection,ssh;SSH,2222,,deploy,Prod/Linux, secret \nSwitch,switch.test,RoyalSSHConnection,telnet;Telnet,,,admin,Prod/Network,\nWindows,windows.test,RoyalRDSConnection,,,3390,DOMAIN\\user,Prod/Windows,\nDesktop,vnc.test,RoyalVNCConnection,,,,,Prod/Desktops,')
    expect(result.hosts.map(h => [h.accessProtocol, h.port])).toEqual([['ssh',2222],['telnet',23],['rdp',3390],['vnc',5900]])
    expect(result.hosts[0]).toMatchObject({ name: 'Linux', ip: 'linux.test', sshUser: 'deploy', folderPath: ['Prod','Linux'], password: ' secret ' })
    expect(result.hosts[2].sshUser).toBe('DOMAIN\\user')
    expect(HostImportPreviewRequestSchema.safeParse({ source: 'royalts', destinationId: 1, sourceStats: {}, hosts: result.hosts }).success).toBe(true)
  })
  it.each([',', ';', '\t'])('handles %j separators, BOM, CRLF, escaped quotes and multiline descriptions', delimiter => {
    const csv = [
      ['Name','URI','ConnectionType','Port','Description','ParentPath'],
      ['Banco "produção"','db.test','ssh;SSH','22','line 1\nline 2','Prod\\Bancos'],
    ].map(row => row.map(cell => '"' + cell.replaceAll('"','""') + '"').join(delimiter)).join('\r\n')
    expect(isRoyalTsCsv('\uFEFF'+csv)).toBe(true)
    expect(parseRoyalTsCsv('\uFEFF'+csv).hosts[0]).toMatchObject({ name: 'Banco "produção"', folderPath: ['Prod','Bancos'] })
  })
  it('supports sep header and retains IPv6', () => {
    expect(parseRoyalTsCsv('sep=;\nName;URI;ConnectionType\nIPv6;2001:db8::1;"ssh;SSH"').hosts[0].ip).toBe('2001:db8::1')
  })
  it('requires an explicit protocol for ambiguous exports and never guesses from port', () => {
    const csv='Name,URI,Port\nServer,server.test,3389'
    expect(parseRoyalTsCsv(csv)).toEqual({hosts:[],missingProtocols:1,unsupportedConnections:0})
    expect(parseRoyalTsCsv(csv,'vnc').hosts[0]).toMatchObject({accessProtocol:'vnc',port:3389})
    expect(parseRoyalTsCsv('Name,URI,RDPPort\nServer,server.test,').hosts[0]).toMatchObject({accessProtocol:'rdp',port:3389})
  })
  it('does not override explicit unsupported protocols with the selected fallback', () => {
    const result = parseRoyalTsCsv('Name,URI,ConnectionType\nWeb,https://web.test,https\nSerial,COM1,serial\nLinux,linux.test,ssh', 'rdp')
    expect(result.unsupportedConnections).toBe(2)
    expect(result.hosts).toHaveLength(1)
    expect(result.hosts[0].accessProtocol).toBe('ssh')
  })
  it.each(['0','65536','22abc','-1','2.2'])('retains invalid port %s for correction and schema rejection', port => {
    const host = parseRoyalTsCsv('Name,URI,ConnectionType,Port\nBad,bad.test,ssh,'+port).hosts[0]
    expect(HostImportPreviewRequestSchema.safeParse({source:'royalts',destinationId:1,sourceStats:{},hosts:[host]}).success).toBe(false)
  })
  it('retains incomplete rows and duplicates with stable unique IDs', () => {
    const csv = 'Name,URI,ConnectionType\n,missing-name.test,ssh\nMissing address,,ssh\nDuplicate,dup.test,ssh\nDuplicate,dup.test,ssh'
    const hosts=parseRoyalTsCsv(csv).hosts
    expect(hosts).toHaveLength(4)
    expect(hosts[0].name).toBe('')
    expect(hosts[1].ip).toBe('')
    expect(new Set(hosts.map(h=>h.sourceId)).size).toBe(4)
    expect(parseRoyalTsCsv(csv).hosts).toEqual(hosts)
  })
  it('does not convert references, private material, scripts or custom fields into credentials or commands', () => {
    const result=parseRoyalTsCsv('Name,URI,ConnectionType,CredentialID,PrivateKey,CustomCommandWin,CustomField1\nTest,test.example,ssh,ref-secret,private-material,execute-me,secret-custom')
    expect(JSON.stringify(result)).not.toMatch(/ref-secret|private-material|execute-me|secret-custom/)
    expect(result.hosts[0].password).toBeUndefined()
    expect(result.hosts[0].sshUser).toBe('')
  })
  it.each([
    ['PK encrypted archive','format'], ['<RoyalDocument/>','format'], ['{"Objects":[]}','format'],
    ['Name,URI\n"unfinished','csv'], ['Name,URI\n"x"oops,host','csv'],
    ['Name,URI\nx,host,extra','csv'], ['Name,URI\nx','csv'],
    ['Name,URI,Name\nx,host,y','headers'], ['Name,Host\nx,host','headers'],
  ])('rejects malformed input without leaking its content: %s', (csv,code) => {
    expect(()=>parseRoyalTsCsv(csv)).toThrow(code)
  })
  it('enforces bounded file size, record count and column count', () => {
    expect(()=>parseRoyalTsCsv('x'.repeat(5*1024*1024+1))).toThrow('limit')
    expect(()=>parseRoyalTsCsv('Name,URI\n'+'x,host\n'.repeat(5001))).toThrow('limit')
    expect(()=>parseRoyalTsCsv(Array.from({length:513},(_,i)=>'col'+i).join(','))).toThrow('limit')
    expect(parseRoyalTsCsv('Name,URI\n'+'x,host\n'.repeat(5000),'ssh').hosts).toHaveLength(5000)
  })
  it('handles empty files without suggesting any host', () => {
    expect(parseRoyalTsCsv('\uFEFF \n').hosts).toEqual([])
    expect(parseRoyalTsCsv('Name,URI').hosts).toEqual([])
  })
  it.each(['utf8','utf16le'] as const)('reads %s files', async encoding => {
    const csv='Name,URI\nProdução,host.test'
    const buffer=Buffer.from((encoding==='utf16le'?'\uFEFF':'')+csv,encoding)
    const file={arrayBuffer:()=>Promise.resolve(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength))} as File
    expect(await readSessionImportFile(file)).toBe(csv)
  })
  it('reads UTF-16BE and rejects corrupt encodings', async () => {
    const buffer=Buffer.from('\uFEFFName,URI\nServidor,host.test','utf16le').swap16()
    expect(await readSessionImportFile({arrayBuffer:()=>Promise.resolve(buffer)} as unknown as File)).toContain('Servidor')
    await expect(readSessionImportFile({arrayBuffer:()=>Promise.resolve(new Uint8Array([0xff,0,0xff]))} as unknown as File)).rejects.toThrow()
  })
})
