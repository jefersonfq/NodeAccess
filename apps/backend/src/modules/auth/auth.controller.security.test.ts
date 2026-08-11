import { describe, expect, it, vi } from 'vitest'

vi.mock('../../config/env.js', () => ({ env: {} }))

import { AuthController } from './auth.controller.js'

function replyHarness() {
  const reply = {
    status: vi.fn(),
    send: vi.fn(),
  }
  reply.status.mockReturnValue(reply)
  reply.send.mockImplementation((value) => value)
  return reply
}

describe('AuthController credential rate-limit dimensions', () => {
  it('scopes Google attempts by IP, tenant and opaque credential input', async () => {
    const auth = {
      loginWithGoogle: vi.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' }),
    }
    const rateLimit = { check: vi.fn().mockResolvedValue(undefined) }
    const controller = new AuthController(auth as never, rateLimit as never)
    const request = {
      ip: '203.0.113.10',
      headers: {},
      body: { credential: 'signed-google-id-token', tenantSlug: 'Acme' },
    }

    await controller.googleLogin(request as never, replyHarness() as never)

    expect(rateLimit.check).toHaveBeenCalledWith({
      action: 'google',
      ip: '203.0.113.10',
      tenant: 'acme',
      identity: 'signed-google-id-token',
    })
  })

  it('rate-limits logout before attempting refresh-token revocation', async () => {
    const auth = { logout: vi.fn().mockResolvedValue(undefined) }
    const rateLimit = { check: vi.fn().mockResolvedValue(undefined) }
    const controller = new AuthController(auth as never, rateLimit as never)
    const request = {
      ip: '203.0.113.10',
      headers: {},
      body: { refreshToken: 'signed-refresh-token' },
    }

    await controller.logout(request as never, replyHarness() as never)

    expect(rateLimit.check).toHaveBeenCalledWith({
      action: 'logout',
      ip: '203.0.113.10',
      identity: 'signed-refresh-token',
    })
    expect(rateLimit.check.mock.invocationCallOrder[0])
      .toBeLessThan(auth.logout.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER)
  })
})
