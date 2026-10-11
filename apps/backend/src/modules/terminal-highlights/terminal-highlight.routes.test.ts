import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import { describe, expect, it, vi } from 'vitest'
import { terminalHighlightRoutes } from './terminal-highlight.routes.js'
import type { TerminalHighlightService } from './terminal-highlight.service.js'

async function fixture(role: 'admin' | 'user' = 'user') {
  const app = Fastify()
  await app.register(jwt, { secret: 'disposable-highlight-route-tests-only' })
  const service = Object.fromEntries(['effective', 'getPreference', 'savePreference', 'recordTelemetry', 'effectiveForUser', 'listTemplates', 'saveTemplate', 'removeTemplate', 'duplicateTemplate', 'listTemplateVersions', 'restoreTemplateVersion', 'telemetrySummary', 'adoptionSummary', 'cacheStatus', 'clearTenantCache'].map(name => [name, vi.fn().mockResolvedValue({})]))
  await terminalHighlightRoutes(app, service as unknown as TerminalHighlightService)
  const token = app.jwt.sign({ sub: '12', tenantId: 7, role, stage: 'authenticated' })
  return { app, service, headers: { authorization: `Bearer ${token}` } }
}

describe('terminal highlights HTTP authorization', () => {
  it.each([
    ['GET', '/admin/templates'], ['POST', '/admin/templates'], ['PUT', '/admin/templates/1'],
    ['DELETE', '/admin/templates/1'], ['POST', '/admin/templates/1/duplicate'],
    ['GET', '/admin/templates/1/versions'], ['POST', '/admin/templates/1/versions/1/restore'],
    ['GET', '/admin/users/2/effective'], ['GET', '/admin/telemetry'], ['GET', '/admin/adoption'],
    ['GET', '/admin/cache'], ['DELETE', '/admin/cache'],
  ] as const)('rejects ordinary users: %s %s', async (method, url) => {
    const { app, service, headers } = await fixture()
    try {
      const response = await app.inject({ method, url, headers })
      expect(response.statusCode).toBe(403)
      for (const handler of Object.values(service)) expect(handler).not.toHaveBeenCalled()
    } finally { await app.close() }
  })

  it('uses the authenticated user and tenant for personal edits even with forged body identifiers', async () => {
    const { app, service, headers } = await fixture()
    try {
      const response = await app.inject({ method: 'PUT', url: '/preference', headers, payload: { enabled: true, rules: [], userId: 99, tenantId: 88 } })
      expect(response.statusCode).toBe(200)
      expect(service.savePreference).toHaveBeenCalledWith(7, 12, { enabled: true, rules: [] })
    } finally { await app.close() }
  })

  it('allows admin preview only within the authenticated tenant', async () => {
    const { app, service, headers } = await fixture('admin')
    try {
      expect((await app.inject({ url: '/admin/users/2/effective?tenantId=99', headers })).statusCode).toBe(200)
      expect(service.effectiveForUser).toHaveBeenCalledWith(7, 2)
    } finally { await app.close() }
  })

  it('rejects unauthenticated and MFA-pending sessions', async () => {
    const { app, service } = await fixture()
    try {
      expect((await app.inject({ url: '/effective' })).statusCode).toBe(401)
      const token = app.jwt.sign({ sub: '12', tenantId: 7, role: 'admin', stage: 'mfa_pending' })
      expect((await app.inject({ url: '/admin/templates', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401)
      expect(service.listTemplates).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
})


it.each(['0', '-1', 'abc', '1.5'])('rejects invalid admin preview identifier %s', async id => {
  const { app, service, headers } = await fixture('admin')
  try {
    expect((await app.inject({ url: `/admin/users/${id}/effective`, headers })).statusCode).toBe(400)
    expect(service.effectiveForUser).not.toHaveBeenCalled()
  } finally { await app.close() }
})
