import type { FastifyInstance } from 'fastify'
import {
  GuacamoleImportCommitRequestSchema,
  GuacamoleImportCommitResponseSchema,
  GuacamoleImportPreviewRequestSchema,
  GuacamoleImportPreviewResponseSchema,
} from '@nodeaccess/shared'
import type { GuacamoleImportCommitRequest, GuacamoleImportPreviewRequest } from '@nodeaccess/shared'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { requireHostManager } from '../../shared/guards.js'
import type { HostImportController } from './host-import.controller.js'

export async function hostImportRoutes(app: FastifyInstance, controller: HostImportController): Promise<void> {
  app.post<{ Body: GuacamoleImportPreviewRequest }>('/guacamole/preview', {
    preHandler: [requireHostManager],
    schema: {
      tags: ['Host imports'],
      summary: 'Pré-validar importação do Apache Guacamole',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(GuacamoleImportPreviewRequestSchema),
      response: { 200: zodToJsonSchema(GuacamoleImportPreviewResponseSchema) },
    },
  }, (request, reply) => controller.preview(request, reply))

  app.post<{ Body: GuacamoleImportCommitRequest }>('/guacamole/commit', {
    preHandler: [requireHostManager],
    schema: {
      tags: ['Host imports'],
      summary: 'Confirmar importação transacional do Apache Guacamole',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(GuacamoleImportCommitRequestSchema),
      response: { 200: zodToJsonSchema(GuacamoleImportCommitResponseSchema) },
    },
  }, (request, reply) => controller.commit(request, reply))
}
