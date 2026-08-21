export type SessionImportSource = 'ssh' | 'csv' | 'mobaxterm' | 'guacamole'

export interface SessionImportDetection {
  source: SessionImportSource
  confidence: 'high' | 'medium'
  reason: string
}

export function detectSessionImportSource(fileName: string, content: string): SessionImportDetection {
  const name = fileName.trim().toLowerCase()
  const sample = content.replace(/^\uFEFF/, '').trimStart()
  if (name.endsWith('.mxtsessions') || /^\[Bookmarks(?:_\d+)?]/im.test(sample)) {
    return { source: 'mobaxterm', confidence: 'high', reason: 'mobaxterm-bookmarks' }
  }
  if (name === 'mobaxterm.ini' || (/^\[(?:Misc|Passwords(?:_\d+)?)\]/im.test(sample) && /MobaXterm/i.test(sample))) {
    return { source: 'mobaxterm', confidence: 'high', reason: 'mobaxterm-ini' }
  }
  if (name.endsWith('.xml') || /^<\?xml|^<user-mapping[\s>]/i.test(sample)) {
    return { source: 'guacamole', confidence: 'high', reason: 'guacamole-xml' }
  }
  if (name.endsWith('.json') || sample.startsWith('{')) {
    try {
      const value = JSON.parse(sample) as Record<string, unknown>
      if (['connections', 'guacamole_connection', 'connectionParameters', 'guacamole_connection_parameter'].some(key => key in value)) {
        return { source: 'guacamole', confidence: 'high', reason: 'guacamole-jdbc-json' }
      }
    } catch { /* parsing feedback belongs to the selected importer */ }
  }
  const firstDataLine = sample.split(/\r?\n/).find(line => line.trim() && !line.trim().startsWith('#')) ?? ''
  const normalizedHeader = firstDataLine.toLowerCase().replace(/\s/g, '')
  if (name.endsWith('.csv') || (/\bname[,;]/.test(normalizedHeader) && /[,;](?:ip|hostname)[,;]/.test(`${normalizedHeader},`))) {
    return { source: 'csv', confidence: 'high', reason: 'csv-header' }
  }
  if (/^(?:Host|Match|Include)\s+/im.test(sample) || /(?:^|\n)\s*(?:HostName|IdentityFile|ProxyJump)\s+/i.test(sample)) {
    return { source: 'ssh', confidence: 'high', reason: 'openssh-directive' }
  }
  return { source: 'ssh', confidence: 'medium', reason: 'text-fallback' }
}
