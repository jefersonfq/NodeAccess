const http = require('node:http')
const fs = require('node:fs')
const crypto = require('node:crypto')
const bytes = Buffer.from('verified installer fixture')
const server = http.createServer((req, res) => {
  const mode = fs.readFileSync(process.argv[3], 'utf8').trim()
  if (req.headers.authorization || req.url.includes('?')) { res.writeHead(400); return res.end() }
  if (mode === 'redirect') { res.writeHead(302, { Location: 'http://127.0.0.1:1/untrusted' }); return res.end() }
  if (mode === 'unavailable') { res.writeHead(503); return res.end() }
  if (mode === 'slow') return
  if (mode === 'body-slow') { res.writeHead(200); res.write('x'); return }
  if (req.url.endsWith('/updates/windows')) {
    res.setHeader('Content-Type', 'application/json')
    return res.end(JSON.stringify({ schemaVersion: 1, platform: 'windows', architecture: 'x64', version: '9.0.0', downloadPath: '/api/v1/agents/download/windows_msi', size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }))
  }
  if (mode === 'corrupt') return res.end(Buffer.alloc(bytes.length, 1))
  if (mode === 'oversize') return res.end(Buffer.alloc(bytes.length + 1, 1))
  res.end(bytes)
})
server.listen(0, '127.0.0.1', () => fs.writeFileSync(process.argv[2], String(server.address().port)))
