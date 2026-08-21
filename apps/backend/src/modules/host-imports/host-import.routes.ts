import type { FastifyInstance } from 'fastify'
import {
  GuacamoleImportPreviewRequestSchema,
  HostImportCommitRequestSchema,
  HostImportCommitResponseSchema,
  HostImportHistoryResponseSchema,
  HostImportPreviewRequestSchema,
  HostImportPreviewResponseSchema,
  HostImportRevertResponseSchema,
} from '@nodeaccess/shared'
import type { GuacamoleImportPreviewRequest, HostImportCommitRequest, HostImportPreviewRequest } from '@nodeaccess/shared'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { requireAdmin, requireHostManager } from '../../shared/guards.js'
import type { HostImportController } from './host-import.controller.js'

export function hostImportRoutes(app: FastifyInstance, controller: HostImportController): Promise<void> {
  const previewOptions = {
    preHandler: [requireHostManager],
    schema: {
      tags: ['Host imports'],
      summary: 'Pré-validar importação de hosts',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(HostImportPreviewRequestSchema),
      response: { 200: zodToJsonSchema(HostImportPreviewResponseSchema) },
    },
  }

  const commitOptions = {
    preHandler: [requireHostManager],
    schema: {
      tags: ['Host imports'],
      summary: 'Confirmar importação transacional de hosts',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(HostImportCommitRequestSchema),
      response: { 200: zodToJsonSchema(HostImportCommitResponseSchema) },
    },
  }

  app.post<{ Body: HostImportPreviewRequest }>('/preview', previewOptions, (request, reply) => controller.preview(request, reply))
  app.post<{ Body: HostImportCommitRequest }>('/commit', commitOptions, (request, reply) => controller.commit(request, reply))
  app.get('/history', {
    preHandler: [requireHostManager, requireAdmin],
    schema: { tags: ['Host imports'], summary: 'Listar histórico de importações', security: [{ bearerAuth: [] }], response: { 200: zodToJsonSchema(HostImportHistoryResponseSchema) } },
  }, (request, reply) => controller.history(request, reply))
  app.post<{ Params: { id: number } }>('/:id/revert', {
    preHandler: [requireHostManager, requireAdmin],
    schema: {
      tags: ['Host imports'], summary: 'Reverter recursos criados por uma importação', security: [{ bearerAuth: [] }],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } },
      response: { 200: zodToJsonSchema(HostImportRevertResponseSchema) },
    },
  }, (request, reply) => controller.revert(request, reply))

  // Backward-compatible aliases for clients deployed before the generic endpoints.
  app.post<{ Body: GuacamoleImportPreviewRequest }>('/guacamole/preview', {
    ...previewOptions,
    schema: { ...previewOptions.schema, body: zodToJsonSchema(GuacamoleImportPreviewRequestSchema) },
  }, (request, reply) => controller.previewGuacamole(request, reply))
  app.post<{ Body: HostImportCommitRequest }>('/guacamole/commit', commitOptions, (request, reply) => controller.commit(request, reply))
  return Promise.resolve()
}
