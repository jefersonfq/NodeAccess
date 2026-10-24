import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { requireAuditRead } from '../session-audit/session-audit.routes.js'
import { configureTrialPolicy, configureTrialUserReader } from './trial-policy.js'

const reply = {} as FastifyReply
function request(role: 'user' | 'admin', method = 'GET'): FastifyRequest {
  return { method, url: '/api/v1/session-audit/1', jwtVerify: () => Promise.resolve({ sub: '1', tenantId: 1, role, stage: 'authenticated', sessionVersion: 0 }) } as unknown as FastifyRequest
}
afterEach(() => { configureTrialPolicy(() => Promise.resolve(null)); configureTrialUserReader(() => Promise.resolve(false)) })
describe('trial audit read admission', () => {
  it('preserves normal admin access and denies normal non-admin users', async () => {
    configureTrialPolicy(() => Promise.resolve(null))
    await expect(requireAuditRead(request('admin'), reply)).resolves.toBeUndefined()
    await expect(requireAuditRead(request('user'), reply)).rejects.toMatchObject({ statusCode: 403 })
  })
  it('allows a verified participant only when the trial audit resource is enabled', async () => {
    configureTrialPolicy(() => Promise.resolve({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 60000), profileJson: { resources: ['ssh', 'audit'] } }))
    configureTrialUserReader(() => Promise.resolve(true))
    await expect(requireAuditRead(request('user'), reply)).resolves.toBeUndefined()
    await expect(requireAuditRead(request('user', 'POST'), reply)).rejects.toMatchObject({ code: 'TRIAL_FEATURE_DISABLED' })
  })
  it('denies disabled audit, expired trial and canceled participant', async () => {
    configureTrialUserReader(() => Promise.resolve(true))
    configureTrialPolicy(() => Promise.resolve({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 60000), profileJson: { resources: ['ssh'] } }))
    await expect(requireAuditRead(request('user'), reply)).rejects.toMatchObject({ statusCode: 403 })
    configureTrialPolicy(() => Promise.resolve({ status: 'ACTIVE', expiresAt: new Date(0), profileJson: { resources: ['audit'] } }))
    await expect(requireAuditRead(request('user'), reply)).rejects.toMatchObject({ code: 'TRIAL_EXPIRED' })
    configureTrialPolicy(() => Promise.resolve({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 60000), profileJson: { resources: ['audit'] } }))
    configureTrialUserReader(() => Promise.resolve(false))
    await expect(requireAuditRead(request('user'), reply)).rejects.toMatchObject({ statusCode: 403 })
  })
})
