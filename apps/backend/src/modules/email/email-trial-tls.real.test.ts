import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type TLSSocket } from 'node:tls'
import nodemailer from 'nodemailer'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../trials/trial-outbound.js', async original => ({
  ...await original<typeof import('../trials/trial-outbound.js')>(),
  // Transport fixture only; SSRF policy is exercised separately without this resolver override.
  resolveTrialOutboundHost: (): Promise<string> => Promise.resolve('127.0.0.1'),
}))
import { EmailService } from './email.service.js'
import { configureTrialPolicy } from '../trials/trial-policy.js'
afterEach(() => { vi.restoreAllMocks(); configureTrialPolicy(() => Promise.resolve(null)) })
describe.runIf(process.env.TRIAL_SMTP_TLS_REAL === 'true')('trial real implicit SMTP TLS', () => {
  it('upgrades the supplied raw TCP socket before SMTP AUTH and verifies original hostname', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'na0074-smtp-tls-'))
    const sockets = new Set<TLSSocket>()
    let handshakes = 0; let authentications = 0
    let server: ReturnType<typeof createServer> | undefined
    try {
      await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=mail.vendor.test', '-addext', 'subjectAltName=DNS:mail.vendor.test'])
      const key = await readFile(join(directory, 'key.pem')); const cert = await readFile(join(directory, 'cert.pem'))
      const original = nodemailer.createTransport.bind(nodemailer)
      vi.spyOn(nodemailer, 'createTransport').mockImplementation(options => original({ ...(options as object), tls: { ca: cert, servername: 'mail.vendor.test', rejectUnauthorized: true } }))
      server = createServer({ key, cert }, socket => {
        handshakes++; sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {})
        socket.write('220 fixture ESMTP\r\n')
        let buffer = ''
        socket.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf8')
          while (buffer.includes('\r\n')) {
            const end = buffer.indexOf('\r\n'); const line = buffer.slice(0, end); buffer = buffer.slice(end + 2)
            if (line.startsWith('EHLO')) socket.write('250-fixture\r\n250 AUTH PLAIN\r\n')
            else if (line.startsWith('AUTH PLAIN')) { authentications++; socket.write('235 authenticated\r\n') }
            else if (line === 'QUIT') socket.end('221 bye\r\n')
            else socket.write('250 OK\r\n')
          }
        })
      })
      await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture port')
      configureTrialPolicy(() => Promise.resolve({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000), profileJson: { experience: 'full' } }))
      await new EmailService().testConnection({ tenantId: 12, host: 'mail.vendor.test', port: address.port, secure: true, user: 'fixture', password: 'fixture', fromName: 'Fixture' })
      expect(handshakes).toBe(1); expect(authentications).toBe(1)
    } finally {
      for (const socket of sockets) socket.destroy()
      if (server) await new Promise<void>(resolve => server!.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  }, 15_000)
})
