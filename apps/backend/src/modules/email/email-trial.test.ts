import { EventEmitter } from 'node:events'
import { promises as dns } from 'node:dns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ transport: vi.fn(), connect: vi.fn(), eval: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: mocks.transport } }))
vi.mock('node:net', async importOriginal => ({ ...await importOriginal<typeof import('node:net')>(), connect: mocks.connect }))
vi.mock('../../config/redis.js', () => ({ redis: { eval: mocks.eval } }))
import { EmailService } from './email.service.js'
import { configureTrialPolicy, configureTrialProtectedAddresses } from '../trials/trial-policy.js'
const config = { tenantId: 12, host: 'mail.vendor.test', port: 587, secure: false, user: 'synthetic', password: 'synthetic', fromName: 'Fixture' }
beforeEach(() => {
  mocks.transport.mockReset(); mocks.connect.mockReset(); mocks.eval.mockReset(); mocks.eval.mockResolvedValue(1)
  configureTrialPolicy(() => Promise.resolve({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000), profileJson: { experience: 'full' } }))
  configureTrialProtectedAddresses(['8.8.4.4'])
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); configureTrialPolicy(() => Promise.resolve(null)); configureTrialProtectedAddresses([]) })
describe('trial SMTP isolation', () => {
  it('normal tenant keeps existing SMTP behavior', async () => {
    configureTrialPolicy(() => Promise.resolve(null))
    mocks.transport.mockReturnValue({ verify: vi.fn().mockResolvedValue(true) })
    await new EmailService().testConnection(config)
    expect(mocks.transport).toHaveBeenCalledWith({ host: config.host, port: 587, secure: false, auth: { user: config.user, pass: config.password } })
    expect(mocks.connect).not.toHaveBeenCalled()
  })
  it('rejects private and operator addresses before creating transport', async () => {
    await expect(new EmailService().testConnection({ ...config, host: '127.0.0.1' })).rejects.toThrow()
    await expect(new EmailService().testConnection({ ...config, host: '8.8.4.4' })).rejects.toThrow()
    expect(mocks.transport).not.toHaveBeenCalled()
  })
  it('pins DNS to TCP socket, forces STARTTLS verification and destroys socket after operation', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '9.9.9.9', family: 4 }])
    const socket = Object.assign(new EventEmitter(), { destroy: vi.fn() })
    mocks.connect.mockReturnValue(socket)
    mocks.transport.mockImplementation((options: { getSocket: (input: object, callback: (error: Error | null, result?: object) => void) => void }) => ({
      close: vi.fn(), verify: (): Promise<boolean> => new Promise((resolve, reject) => {
        options.getSocket({}, error => error ? reject(error) : resolve(true))
        socket.emit('connect')
      }),
    }))
    await new EmailService().testConnection(config)
    expect(mocks.connect).toHaveBeenCalledWith({ host: '9.9.9.9', port: 587 })
    const options: unknown = mocks.transport.mock.calls[0]?.[0]
    expect(options).toMatchObject({ requireTLS: true, tls: { rejectUnauthorized: true, servername: config.host } })
    expect(socket.destroy).toHaveBeenCalled()
  })
  it('expiry while TCP connect is pending rejects verification instead of leaving a pending promise', async () => {
    vi.useFakeTimers()
    configureTrialPolicy(() => Promise.resolve({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 1000), profileJson: { experience: 'full' } }))
    const socket = Object.assign(new EventEmitter(), { destroy: vi.fn() })
    socket.destroy.mockImplementation(() => { socket.emit('close'); return socket })
    mocks.connect.mockReturnValue(socket)
    mocks.transport.mockImplementation((options: { getSocket: (input: object, callback: (error: Error | null) => void) => void }) => ({
      close: vi.fn(), verify: (): Promise<boolean> => new Promise((resolve, reject) => options.getSocket({}, error => error ? reject(error) : resolve(true))),
    }))
    const result = new EmailService().testConnection({ ...config, host: '9.9.9.9' })
    const rejected = expect(result).rejects.toThrow('Conexão encerrada')
    await vi.advanceTimersByTimeAsync(1000)
    await rejected
    expect(socket.destroy).toHaveBeenCalled()
  })
  it('tenant send rate limit stops message delivery', async () => {
    const send = vi.fn(); mocks.transport.mockReturnValue({ sendMail: send, close: vi.fn() }); mocks.eval.mockResolvedValue(31)
    await expect(new EmailService().send({ ...config, host: '9.9.9.9' }, { to: 'fixture@example.invalid', subject: 'Fixture', text: 'Fixture' })).rejects.toMatchObject({ statusCode: 429 })
    expect(send).not.toHaveBeenCalled()
  })
})
