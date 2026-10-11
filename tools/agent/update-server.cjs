const http = require('node:http')
const fs = require('node:fs')
const crypto = require('node:crypto')
const bytes = Buffer.from('verified installer fixture')
// A fresh release identity for each test; the private key never leaves this process.
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 })
const { n, e } = publicKey.export({ format: 'jwk' })
fs.writeFileSync(process.argv[4], JSON.stringify({ keys: [{ n, e }], publisherThumbprint: 'a'.repeat(40) }))
const metadata = { schemaVersion: 1, platform: 'windows', architecture: 'x64', version: '9.0.0', downloadPath: '/api/v1/agents/download/windows_msi', size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
const payload = Buffer.from(JSON.stringify(metadata))
const releaseProof = { payload: payload.toString('base64'), signature: crypto.sign('sha256', payload, privateKey).toString('base64') }
const server = http.createServer((req, res) => {
  const mode = fs.readFileSync(process.argv[3], 'utf8').trim()
  if (req.headers.authorization || req.url.includes('?')) { res.writeHead(400); return res.end() }
  if (mode === 'redirect') { res.writeHead(302, { Location: 'http://127.0.0.1:1/untrusted' }); return res.end() }
  if (mode === 'unavailable') { res.writeHead(503); return res.end() }
  if (mode === 'slow') return
  if (mode === 'body-slow') { res.writeHead(200); res.write('x'); return }
  if (req.url.endsWith('/updates/windows')) {
    res.setHeader('Content-Type', 'application/json')
    const response = { ...metadata, releaseProof: { ...releaseProof } }
    if (mode === 'unsigned') delete response.releaseProof
    if (mode === 'bad-signature') response.releaseProof.signature = Buffer.alloc(384).toString('base64')
    if (mode === 'tampered') response.version = '9.0.1'
    return res.end(JSON.stringify(response))
  }
  if (mode === 'corrupt') return res.end(Buffer.alloc(bytes.length, 1))
  if (mode === 'oversize') return res.end(Buffer.alloc(bytes.length + 1, 1))
  res.end(bytes)
})
server.listen(0, '127.0.0.1', () => fs.writeFileSync(process.argv[2], String(server.address().port)))
