import { describe, expect, it } from 'vitest'
import nodemailer from 'nodemailer'
import { renderTrialEmail } from './trial-email.js'

const policy = { retentionDays: 17, privacyUrl: 'https://example.test/privacy', termsUrl: 'https://example.test/terms' }
const expiresAt = new Date('2026-11-02T15:30:00Z')
describe('trial operational emails (pure renderer, no SMTP)', () => {
  it.each(['ready', 'expiring'] as const)('%s has matching date, retention, legal links and usable text without images', kind => {
    const mail = renderTrialEmail({ kind, expiresAt, link: 'https://example.test/trial', ...policy })
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain('2 de novembro de 2026')
      expect(body).toContain('12:30')
      expect(body).toContain('America/Sao_Paulo')
      expect(body).toContain('17 dias')
      expect(body).toContain('conclusão do encerramento')
      expect(body).toContain('Máquinas externas cadastradas por você não são apagadas')
      expect(body).toContain('Cópias de segurança seguem ciclos próprios')
      expect(body).toContain(policy.privacyUrl)
      expect(body).toContain(policy.termsUrl)
      expect(body).toContain('independente da preferência de marketing')
    }
    expect(mail.html).toContain('Acompanhar meu teste')
    expect(mail.html).not.toMatch(/<img[^>]+src="https?:/)
    expect(mail.html).not.toContain('<script')
  })
  it('confirmation retains the one-time link and anti-enumeration safety advice', () => {
    const link = `https://example.test/trial#token=${'ab'.repeat(32)}`
    const mail = renderTrialEmail({ kind: 'verification', link })
    expect(mail.text).toContain(link)
    expect(mail.html).toContain(link)
    expect(mail.text).toContain('temporário e de uso único')
    expect(mail.text).toContain('Se você não solicitou')
    expect(mail.subject).not.toContain('ab'.repeat(32))
  })
  it('escapes attributes and body text derived from links', () => {
    const mail = renderTrialEmail({ kind: 'verification', link: 'https://example.test/trial?x=a&y=%22%3E%3Cscript%3E' })
    expect(mail.html).toContain('?x=a&amp;y=')
    expect(mail.html).not.toContain('<script>')
    expect(mail.text).toContain('?x=a&y=')
  })
  it.each(['javascript:alert(1)', 'http://example.test/trial', 'https://user:secret@example.test/trial'])('refuses unsafe URL %s', link => {
    expect(() => renderTrialEmail({ kind: 'verification', link })).toThrow('INVALID_TRIAL_EMAIL_LINK')
  })
  it('ships a real PNG inline in the compiled module, not a filesystem path', () => {
    const mail = renderTrialEmail({ kind: 'verification', link: 'https://example.test/trial' })
    const image = mail.attachments[0]!
    expect(image.content.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(image.content.length).toBeGreaterThan(100)
    expect(image.contentType).toBe('image/png')
    expect(mail.html).toContain(`cid:${image.cid}`)
    expect(mail.html).toContain('alt=""')
    expect(mail.html).toContain('NodeAccess')
  })
  it('composes MIME with plaintext, HTML and the inline PNG using a local stream only', async () => {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' })
    const mail = renderTrialEmail({ kind: 'ready', expiresAt, link: 'https://example.test/trial', ...policy })
    const result: unknown = await transport.sendMail({ from: 'sender@example.test', to: 'recipient@example.test', ...mail })
    if (!result || typeof result !== 'object' || !('message' in result) || !Buffer.isBuffer(result.message)) throw new Error('Expected local MIME buffer')
    const mime = result.message.toString('utf8')
    expect(mime).toContain('Content-Type: text/plain')
    expect(mime).toContain('Content-Type: text/html')
    expect(mime).toContain('Content-Type: image/png')
    expect(mime).toContain('Content-ID: <nodeaccess-brand@trial.local>')
    expect(mime).toContain('Content-Disposition: inline')
    expect(mime).not.toContain('List-Unsubscribe')
  })
  it('does not invent retention when snapshot metadata is malformed', () => {
    expect(() => renderTrialEmail({ kind: 'ready', expiresAt, link: 'https://example.test/trial', ...policy, retentionDays: 0 })).toThrow('INVALID_TRIAL_EMAIL_POLICY')
  })
})
