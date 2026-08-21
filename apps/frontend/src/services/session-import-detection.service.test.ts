import { describe, expect, it } from 'vitest'
import { detectSessionImportSource } from './session-import-detection.service'

describe('detectSessionImportSource', () => {
  it.each([
    ['sessions.mxtsessions', '[Bookmarks]\nserver=#109#0%host%22%root', 'mobaxterm'],
    ['MobaXterm.ini', '[Bookmarks_1]\nSubRep=Prod', 'mobaxterm'],
    ['user-mapping.xml', '<user-mapping><authorize /></user-mapping>', 'guacamole'],
    ['jdbc.json', '{"guacamole_connection":[]}', 'guacamole'],
    ['hosts.csv', '# nodeaccess-import-version=1\nname,ip,port\na,1.2.3.4,22', 'csv'],
    ['config', 'Host prod\n HostName prod.example.test', 'ssh'],
  ])('detects %s', (name, content, source) => {
    expect(detectSessionImportSource(name, content).source).toBe(source)
  })
})
