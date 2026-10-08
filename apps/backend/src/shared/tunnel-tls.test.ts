import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import https from 'node:https'
import { expect, it } from 'vitest'
import { tunnelTlsOptions } from './tunnel-tls.js'

it('authenticates the original target through loopback and refuses untrusted/mismatched certificates', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nodeaccess-tls-lab-'))
  let server: https.Server | undefined
  try {
    const keyFile = join(directory, 'key.pem'); const certFile = join(directory, 'cert.pem')
    execFileSync('openssl', ['req', '-x509', '-nodes', '-newkey', 'rsa:2048', '-days', '1', '-subj', '/CN=target.example', '-addext', 'subjectAltName=DNS:target.example', '-keyout', keyFile, '-out', certFile], { stdio: 'ignore' })
    const cert = readFileSync(certFile)
    let requests = 0
    server = https.createServer({ key: readFileSync(keyFile), cert }, (_req, res) => { requests++; res.end('ok') })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    function request(host: string, trusted: boolean) {
      return new Promise<number>((resolve, reject) => {
        const req = https.get({ host: '127.0.0.1', port, ...tunnelTlsOptions(host), ...(trusted ? { ca: cert } : {}) }, res => { res.resume(); resolve(res.statusCode!) })
        req.on('error', reject)
      })
    }
    await expect(request('target.example', false)).rejects.toThrow()
    await expect(request('wrong.example', true)).rejects.toThrow()
    expect(requests).toBe(0)
    await expect(request('target.example', true)).resolves.toBe(200)
    expect(requests).toBe(1)
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
})
