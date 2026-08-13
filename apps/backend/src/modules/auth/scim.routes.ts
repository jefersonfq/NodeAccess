import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { requireAdmin } from '../../shared/guards.js'
import { ScimError, type ScimGroupInput, type ScimService, type ScimUserInput } from './scim.service.js'

const userSchema = 'urn:ietf:params:scim:schemas:core:2.0:User'
const groupSchema = 'urn:ietf:params:scim:schemas:core:2.0:Group'

export async function scimAdminRoutes(app: FastifyInstance, service: ScimService): Promise<void> {
  app.get('/config', { preHandler: requireAdmin }, async (request) => service.getAdminConfig(request.jwtUser!.tenantId))
  app.post('/config/rotate-token', { preHandler: requireAdmin }, async (request, reply) => reply.send(await service.rotateToken(request.jwtUser!.tenantId)))
  app.put<{ Body: { enabled: boolean } }>('/config', {
    preHandler: requireAdmin,
    schema: { body: { type: 'object', additionalProperties: false, required: ['enabled'], properties: { enabled: { type: 'boolean' } } } },
  }, async (request) => service.setEnabled(request.jwtUser!.tenantId, request.body.enabled))
}

export async function scimRoutes(app: FastifyInstance, service: ScimService): Promise<void> {
  app.setErrorHandler((error, _request, reply) => sendScimError(reply, error))
  app.addHook('preHandler', async (request) => {
    ;(request as FastifyRequest & { scimTenantId: number }).scimTenantId = await service.authenticate(request.headers.authorization)
  })

  app.get('/ServiceProviderConfig', async () => ({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    patch: { supported: true }, bulk: { supported: false }, filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false }, sort: { supported: false }, etag: { supported: false },
  }))
  app.get('/ResourceTypes', async () => listResponse([
    { schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'], id: 'User', name: 'User', endpoint: '/Users', schema: userSchema },
    { schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'], id: 'Group', name: 'Group', endpoint: '/Groups', schema: groupSchema },
  ]))
  app.get('/Schemas', async () => listResponse([
    { id: userSchema, name: 'User', schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'] },
    { id: groupSchema, name: 'Group', schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'] },
  ]))

  app.get<{ Querystring: { filter?: string } }>('/Users', async (request) => service.listUsers(tenant(request), request.query.filter))
  app.get<{ Params: { id: string } }>('/Users/:id', async (request) => service.getUser(tenant(request), request.params.id))
  app.post<{ Body: ScimUserInput }>('/Users', async (request, reply) => reply.code(201).send(await service.createUser(tenant(request), request.body)))
  app.put<{ Params: { id: string }; Body: ScimUserInput }>('/Users/:id', async (request) => service.replaceUser(tenant(request), request.params.id, request.body))
  app.patch<{ Params: { id: string }; Body: { Operations?: Array<{ op?: string; path?: string; value?: unknown }> } }>('/Users/:id', async (request) => service.patchUser(tenant(request), request.params.id, request.body.Operations ?? []))

  app.get('/Groups', async (request) => service.listGroups(tenant(request)))
  app.get<{ Params: { id: string } }>('/Groups/:id', async (request) => service.getGroup(tenant(request), request.params.id))
  app.post<{ Body: ScimGroupInput }>('/Groups', async (request, reply) => reply.code(201).send(await service.createGroup(tenant(request), request.body)))
  app.put<{ Params: { id: string }; Body: ScimGroupInput }>('/Groups/:id', async (request) => service.replaceGroup(tenant(request), request.params.id, request.body))
  app.patch<{ Params: { id: string }; Body: { Operations?: Array<{ op?: string; path?: string; value?: unknown }> } }>('/Groups/:id', async (request) => service.patchGroup(tenant(request), request.params.id, request.body.Operations ?? []))
}

function tenant(request: FastifyRequest): number { return (request as FastifyRequest & { scimTenantId: number }).scimTenantId }
function listResponse(Resources: unknown[]) { return { schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'], totalResults: Resources.length, startIndex: 1, itemsPerPage: Resources.length, Resources } }
function sendScimError(reply: FastifyReply, error: Error) {
  const status = error instanceof ScimError ? error.status : 500
  return reply.code(status).type('application/scim+json').send({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: String(status),
    ...(error instanceof ScimError && error.scimType ? { scimType: error.scimType } : {}),
    detail: error instanceof ScimError ? error.message : 'Falha ao processar solicitação SCIM',
  })
}
