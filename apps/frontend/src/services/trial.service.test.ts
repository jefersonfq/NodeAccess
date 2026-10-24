import { describe, it, expect, vi, beforeEach } from 'vitest'
const clients = vi.hoisted(() => ({ public: { get: vi.fn(), post: vi.fn() }, admin: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }))
vi.mock('axios', () => ({ default: { create: () => clients.public, isAxiosError: (value: unknown) => Boolean((value as { isAxiosError?: boolean })?.isAxiosError) } }))
vi.mock('./api', () => ({ default: clients.admin }))
import { takeTrialVerificationToken, safeTrialDocumentUrl, trialService, trialError, trialPhoneError, trialStateLabel } from './trial.service'

describe('public trial client capability isolation', () => {
  beforeEach(() => { vi.clearAllMocks(); clients.public.get.mockResolvedValue({ data: {} }); clients.public.post.mockResolvedValue({ data: {} }) })
  it('normalizes stored custom-host authentication types without exposing credentials', async () => {
    clients.admin.get.mockResolvedValue({ data: { customHosts: [{ id: 1, name: 'Fixture', ip: '1.1.1.1', port: 22, sshUser: 'test', authType: 'PEM' }] } })
    expect((await trialService.resources()).customHosts?.[0].authType).toBe('pem')
  })
  it('uses authenticated APIs for machine expansion and own-host mutations', async () => {
    clients.admin.get.mockResolvedValue({ data: { machineCount: 1 } })
    await trialService.resources()
    await trialService.requestMachines(3)
    const host = { name: 'Own host', ip: '1.1.1.1', port: 22, sshUser: 'operator', authType: 'password' as const, password: 'fixture-only' }
    await trialService.createHost(host)
    await trialService.updateHost(4, { ...host, password: undefined })
    await trialService.deleteHost(4)
    expect(clients.admin.get).toHaveBeenCalledWith('/trials/me/resources')
    expect(clients.admin.post).toHaveBeenCalledWith('/trials/me/machines', { count: 3 })
    expect(clients.admin.post).toHaveBeenCalledWith('/trials/me/hosts', host)
    expect(clients.admin.put).toHaveBeenCalledWith('/trials/me/hosts/4', { ...host, password: undefined })
    expect(clients.admin.delete).toHaveBeenCalledWith('/trials/me/hosts/4')
    expect(clients.public.post).not.toHaveBeenCalled()
  })
  it('supplies opaque management capability only to the public client', async () => {
    await trialService.status('opaque-trial-capability')
    expect(clients.public.get).toHaveBeenCalledWith('/status', { headers: { Authorization: 'Bearer opaque-trial-capability' } })
    expect(clients.admin.get).not.toHaveBeenCalled()
  })
  it('registers without a token and preserves refusal of optional marketing', async () => {
    const data = { name: 'Visitor', email: 'visitor@example.test', privacyVersion: 'v1', termsAccepted: true as const, marketingConsent: false, researchConsent: false }
    await trialService.register(data)
    expect(clients.public.post).toHaveBeenCalledWith('/register', data)
    expect(clients.admin.post).not.toHaveBeenCalled()
  })
  it('sends an optional phone only with registration, without opting into marketing', async () => {
    const body = { name: 'Visitor', email: 'visitor@example.test', phone: '+55 (11) 99999-1234', termsAccepted: true as const, privacyVersion: 'v1', marketingConsent: false, researchConsent: false }
    await trialService.register(body)
    expect(clients.public.post).toHaveBeenCalledWith('/register', body)
    expect(clients.admin.post).not.toHaveBeenCalled()
  })
  it.each(['', '   ', '(11) 99999-1234', '+55 (11) 99999-1234', '12345678', '+123456789012345'])('accepts optional or formatted phone %s', phone => {
    expect(trialPhoneError(phone)).toBe('')
  })
  it.each(['abc', '1234567', '1234567890123456', '+012345678', '11+999991234', '11.999991234', '11\n999991234', '('.repeat(40) + '12345678'])('explains invalid phone %s', phone => {
    expect(trialPhoneError(phone)).toContain('8 a 15 dígitos')
  })
  it('enforces the 40-character formatted input boundary independently of the digit limit', () => {
    const phone = '1'.repeat(15) + '-'.repeat(25)
    expect(trialPhoneError(phone)).toBe('')
    expect(trialPhoneError(phone + '-')).not.toBe('')
  })
  it('does not use administrative endpoints to cancel public trials', async () => {
    await trialService.cancel('trial-secret')
    expect(clients.public.post).toHaveBeenCalledWith('/cancel', {}, { headers: { Authorization: 'Bearer trial-secret' } })
    expect(clients.admin.post).not.toHaveBeenCalled()
  })
  it('activates invited participant with their own terms and refused marketing', async () => {
    await trialService.activate('guest-capability', 'test-password', { termsAccepted: true, privacyVersion: 'v2', marketingConsent: false, researchConsent: false })
    expect(clients.public.post).toHaveBeenCalledWith('/activate', { password: 'test-password', termsAccepted: true, privacyVersion: 'v2', marketingConsent: false, researchConsent: false }, { headers: { Authorization: 'Bearer guest-capability' } })
  })
  it('invites a colleague without inventing consent on their behalf', async () => {
    await trialService.invite('owner-capability', { name: 'Guest', email: 'guest@example.test' })
    expect(clients.public.post).toHaveBeenCalledWith('/invite', { name: 'Guest', email: 'guest@example.test' }, { headers: { Authorization: 'Bearer owner-capability' } })
  })
  it('scrubs verification token from URL before returning it', () => {
    const replaceState = vi.fn()
    expect(takeTrialVerificationToken({ hash: '#token=secret%2Bcapability', pathname: '/trial', search: '' }, { replaceState })).toBe('secret+capability')
    expect(replaceState).toHaveBeenCalledWith(null, '', '/trial')
  })
  it('does not mutate unrelated URL fragments', () => {
    const replaceState = vi.fn()
    expect(takeTrialVerificationToken({ hash: '#help', pathname: '/trial', search: '' }, { replaceState })).toBeNull()
    expect(replaceState).not.toHaveBeenCalled()
  })
  it.each(['javascript:alert(1)', 'http://example.test', 'https://user:password@example.test', ''])('rejects unsafe document URL %s', url => { expect(safeTrialDocumentUrl(url)).toBeUndefined() })
  it('accepts an https privacy notice', () => { expect(safeTrialDocumentUrl('https://example.test/privacy')).toBe('https://example.test/privacy') })
  it('does not expose server errors or infrastructure details', () => {
    const error = { isAxiosError: true, response: { status: 500, data: { message: 'database password secret' } } }
    expect(trialError(error, 'fallback')).not.toContain('secret')
    expect(trialError(error, 'fallback')).toContain('tente novamente')
  })
  it.each([401, 410])('explains expired/reused capability status %s', status => {
    expect(trialError({ isAxiosError: true, response: { status } }, '')).toContain('Solicite um novo acesso')
  })
  it('shows retry guidance when rate limited', () => { expect(trialError({ isAxiosError: true, response: { status: 429 } }, '')).toContain('Aguarde') })
  it('normalizes backend status case without claiming success for unknown states', () => {
    expect(trialStateLabel('PROVISIONING')).toBe('Preparando seu ambiente')
    expect(trialStateLabel('unknown')).toBe('Acompanhando sua degustação')
  })
})
