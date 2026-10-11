import type { FastifyInstance } from 'fastify'
import { SaveTerminalHighlightPreferenceSchema, SaveTerminalHighlightTemplateSchema, TerminalHighlightTelemetrySchema } from '@nodeaccess/shared'
import { requireAdmin, requireAuth } from '../../shared/guards.js'
import type { TerminalHighlightService } from './terminal-highlight.service.js'

export function terminalHighlightRoutes(app: FastifyInstance, service: TerminalHighlightService): Promise<void> {
  app.get('/effective', { preHandler: [requireAuth] }, async (request) =>
    await service.effective(request.jwtUser!.tenantId, Number(request.jwtUser!.sub)))

  app.get('/preference', { preHandler: [requireAuth] }, async (request) =>
    service.getPreference(request.jwtUser!.tenantId, Number(request.jwtUser!.sub)))

  app.put('/preference', { preHandler: [requireAuth] }, async (request) =>
    service.savePreference(request.jwtUser!.tenantId, Number(request.jwtUser!.sub), SaveTerminalHighlightPreferenceSchema.parse(request.body)))

  app.post('/telemetry', { preHandler: [requireAuth] }, async (request, reply) => {
    await service.recordTelemetry(request.jwtUser!.tenantId, Number(request.jwtUser!.sub), TerminalHighlightTelemetrySchema.parse(request.body))
    return reply.code(204).send()
  })

  app.get<{ Params: { userId: string } }>('/admin/users/:userId/effective', { preHandler: [requireAdmin], schema: { params: { type: 'object', required: ['userId'], properties: { userId: { type: 'integer', minimum: 1 } } } } }, async (request) =>
    service.effectiveForUser(request.jwtUser!.tenantId, Number(request.params.userId)))

  app.get('/admin/templates', { preHandler: [requireAdmin] }, async (request) =>
    service.listTemplates(request.jwtUser!.tenantId))

  app.post('/admin/templates', { preHandler: [requireAdmin] }, async (request) =>
    service.saveTemplate(request.jwtUser!.tenantId, Number(request.jwtUser!.sub), null, SaveTerminalHighlightTemplateSchema.parse(request.body)))

  app.put<{ Params: { id: string } }>('/admin/templates/:id', { preHandler: [requireAdmin] }, async (request) =>
    service.saveTemplate(request.jwtUser!.tenantId, Number(request.jwtUser!.sub), Number(request.params.id), SaveTerminalHighlightTemplateSchema.parse(request.body)))

  app.delete<{ Params: { id: string } }>('/admin/templates/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    await service.removeTemplate(request.jwtUser!.tenantId, Number(request.jwtUser!.sub), Number(request.params.id))
    return reply.code(204).send()
  })

  app.post<{ Params: { id: string } }>('/admin/templates/:id/duplicate', { preHandler: [requireAdmin] }, async (request) =>
    service.duplicateTemplate(request.jwtUser!.tenantId, Number(request.jwtUser!.sub), Number(request.params.id)))

  app.get<{ Params: { id: string } }>('/admin/templates/:id/versions', { preHandler: [requireAdmin] }, async (request) =>
    service.listTemplateVersions(request.jwtUser!.tenantId, Number(request.params.id)))

  app.post<{ Params: { id: string; version: string } }>('/admin/templates/:id/versions/:version/restore', { preHandler: [requireAdmin] }, async (request) =>
    service.restoreTemplateVersion(request.jwtUser!.tenantId, Number(request.jwtUser!.sub), Number(request.params.id), Number(request.params.version)))

  app.get('/admin/telemetry', { preHandler: [requireAdmin] }, async (request) =>
    service.telemetrySummary(request.jwtUser!.tenantId))

  app.get('/admin/adoption', { preHandler: [requireAdmin] }, async (request) =>
    service.adoptionSummary(request.jwtUser!.tenantId))

  app.get('/admin/cache', { preHandler: [requireAdmin] }, async (request) =>
    await Promise.resolve(service.cacheStatus(request.jwtUser!.tenantId)))

  app.delete('/admin/cache', { preHandler: [requireAdmin] }, async (request, reply) => {
    await service.clearTenantCache(request.jwtUser!.tenantId, Number(request.jwtUser!.sub))
    return reply.code(204).send()
  })

  return Promise.resolve()
}
