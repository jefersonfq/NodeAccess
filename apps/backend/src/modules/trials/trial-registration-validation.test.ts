import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { invitationSchema, registrationSchema } from './trial-contract.js'
import { trialRoutes } from './trial.routes.js'
import { TrialService } from './trial.service.js'

const base = { name: 'Maria da Silva', email: 'visitor@example.test', termsAccepted: true, privacyVersion: 'fixture' }
describe('public registration validation', () => {
  it.each(['Maria da Silva', 'José Gonçalves', 'Jose\u0301 Gonçalves', "Anne-Marie O'Neill", 'Maria  Silva', '王小明 张小华'])('accepts complete Unicode name %s', name => {
    expect(registrationSchema.safeParse({ ...base, name }).success).toBe(true)
  })
  it.each(['Maria', 'Ana Li', 'Ab Cd', '123 456', 'Maria Silva😀', 'Maria @Silva', 'a'.repeat(101)])('rejects incomplete or invalid name %s', name => {
    expect(registrationSchema.safeParse({ ...base, name }).success).toBe(false)
  })
  it('normalizes Unicode/spacing while preserving short particles and invitation compatibility', () => {
    expect(registrationSchema.parse({ ...base, name: ' Jose\u0301  da Silva ' }).name).toBe('José da Silva')
    expect(invitationSchema.parse({ name: 'Li', email: base.email }).name).toBe('Li')
  })
  it.each(['visitor@localhost', 'visitor@example.c', 'visitor@example.123', 'visitor@@example.test', 'visitor example@test.com'])('rejects invalid email %s', email => {
    expect(registrationSchema.safeParse({ ...base, email }).success).toBe(false)
  })
  it('applies the same name length limit to NFC and decomposed Unicode', () => {
    const name = 'é'.repeat(48) + ' ' + 'é'.repeat(51)
    expect(registrationSchema.parse({ ...base, name: name.normalize('NFD') }).name).toBe(name)
    expect(registrationSchema.safeParse({ ...base, name: name + 'é' }).success).toBe(false)
  })
  it('keeps email normalization and independent optional consents', () => {
    expect(registrationSchema.parse({ ...base, email: ' VISITOR@EXAMPLE.TEST ' })).toMatchObject({ email: 'visitor@example.test', marketingConsent: false, researchConsent: false })
  })
  it.each(['(48) 99999-0000', '(11) 2345-6789', '(99) 5999-0000', '+55 (48) 99999-0000', '+44 20 7946 0958', '+12025550123', '', '   '])('accepts supported optional phone %s', phone => {
    expect(registrationSchema.safeParse({ ...base, phone }).success).toBe(true)
  })
  it.each(['2025550123', '4899990000', '11899990000', '(23) 99999-0000', '(11) 1234-5678', '+55 23 99999-0000', '+55 48 89999-0000', '489999900001', '99999999', '11spam999999999', '-+442079460958', '(+44)2079460958'])('rejects invalid national phone %s', phone => {
    expect(registrationSchema.safeParse({ ...base, phone }).success).toBe(false)
  })
  it('returns field errors without submitted values and never reaches persistence for invalid input', async () => {
    const app = Fastify(), db = { trialProfile: { findUnique: vi.fn() } }
    const service = new TrialService(db as never, { registrationsEnabled: true })
    await trialRoutes(app, service, { check: vi.fn().mockResolvedValue(undefined) } as never)
    try {
      const response = await app.inject({ method: 'POST', url: '/trials/public/register', payload: { ...base, name: 'Z', email: 'sensitive-invalid-address', phone: 'sensitive-invalid-number', termsAccepted: false } })
      expect(response.statusCode).toBe(422)
      expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR', fields: { name: 'Informe nome e sobrenome, com pelo menos duas palavras de três letras.', email: 'Informe um e-mail válido com domínio completo.', phone: 'Informe DDD e telefone válido; use +DDI para outro país.', termsAccepted: 'Aceite os termos para continuar.' } })
      expect(response.body).not.toContain('sensitive-invalid')
      expect(db.trialProfile.findUnique).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
})
