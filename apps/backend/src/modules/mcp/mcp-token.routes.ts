import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../../shared/guards.js'
import type { McpTokenController } from './mcp-token.controller.js'

interface TokenParams {
  id: string
}

interface CreateMcpTokenBody {
  name: string
  allowedCapabilities?: string[]
  allowedActionModes?: string[]
  allowedHostIds?: number[]
  expiresAt?: string | null
}

interface UpdateMcpTokenBody {
  name: string
  allowedCapabilities?: string[]
  allowedActionModes?: string[]
  allowedHostIds?: number[]
  expiresAt?: string | null
}

const tokenParamSchema = {
  type: 'object',
  properties: { id: { type: 'integer' } },
  required: ['id'],
}

const tokenPublicSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    name: { type: 'string' },
    active: { type: 'boolean' },
    allowedCapabilities: { type: 'array', items: { type: 'string' } },
    allowedActionModes: { type: 'array', items: { type: 'string' } },
    allowedHostIds: { type: 'array', items: { type: 'integer', minimum: 1 } },
    expiresAt: { type: ['string', 'null'], format: 'date-time' },
    lastUsedAt: { type: ['string', 'null'], format: 'date-time' },
    revokedAt: { type: ['string', 'null'], format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    createdByName: { type: 'string' },
    revokedByName: { type: ['string', 'null'] },
  },
  required: ['id', 'name', 'active', 'allowedCapabilities', 'allowedActionModes', 'allowedHostIds', 'expiresAt', 'lastUsedAt', 'revokedAt', 'createdAt', 'updatedAt', 'createdByName', 'revokedByName'],
}

const capabilitySchema = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    kind: { type: 'string', enum: ['resource', 'tool', 'prompt'] },
    title: { type: 'string' },
    description: { type: 'string' },
    module: { type: 'string' },
    scope: { type: 'string' },
    risk: { type: 'string', enum: ['low', 'medium', 'high'] },
    accessMode: { type: 'string', enum: ['read_only', 'approval_required', 'autonomous'] },
  },
  required: ['key', 'kind', 'title', 'description', 'module', 'scope', 'risk', 'accessMode'],
}

export async function mcpTokenAdminRoutes(app: FastifyInstance, controller: McpTokenController): Promise<void> {
  app.get('/capabilities', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['MCP'],
      summary: 'Listar capabilities MCP disponiveis para governanca de tokens',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'array',
          items: capabilitySchema,
        },
      },
    },
  }, (request, reply) => controller.listCapabilities(request, reply))

  app.get('/tokens', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['MCP'],
      summary: 'Listar tokens MCP do tenant',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'array',
          items: tokenPublicSchema,
        },
      },
    },
  }, (request, reply) => controller.list(request, reply))

  app.post<{ Body: CreateMcpTokenBody }>('/tokens', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['MCP'],
      summary: 'Criar token MCP para o tenant',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 120 },
          allowedCapabilities: { type: 'array', items: { type: 'string' } },
          allowedActionModes: { type: 'array', items: { type: 'string', enum: ['read_only', 'diagnostic_only', 'approval_required', 'full_operational_access'] } },
          allowedHostIds: { type: 'array', items: { type: 'integer', minimum: 1 } },
          expiresAt: { type: ['string', 'null'], format: 'date-time' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            record: tokenPublicSchema,
          },
          required: ['token', 'record'],
        },
      },
    },
  }, (request, reply) => controller.create(request, reply))

  app.post<{ Params: TokenParams }>('/tokens/:id/revoke', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['MCP'],
      summary: 'Revogar token MCP do tenant',
      security: [{ bearerAuth: [] }],
      params: tokenParamSchema,
      response: {
        200: tokenPublicSchema,
      },
    },
  }, (request, reply) => controller.revoke(request, reply))

  app.patch<{ Params: TokenParams; Body: UpdateMcpTokenBody }>('/tokens/:id', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['MCP'],
      summary: 'Editar metadata de token MCP do tenant',
      security: [{ bearerAuth: [] }],
      params: tokenParamSchema,
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 120 },
          allowedCapabilities: { type: 'array', items: { type: 'string' } },
          allowedActionModes: { type: 'array', items: { type: 'string', enum: ['read_only', 'diagnostic_only', 'approval_required', 'full_operational_access'] } },
          allowedHostIds: { type: 'array', items: { type: 'integer', minimum: 1 } },
          expiresAt: { type: ['string', 'null'], format: 'date-time' },
        },
      },
      response: {
        200: tokenPublicSchema,
      },
    },
  }, (request, reply) => controller.update(request, reply))
}
