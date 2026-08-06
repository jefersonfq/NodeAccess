import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type {
  GuacamoleImportCommitResponse,
  GuacamoleImportPreviewResponse,
} from '@nodeaccess/shared'
import { hostImportRoutes } from './host-import.routes.js'
import { HostImportController } from './host-import.controller.js'
import type { HostImportService } from './host-import.service.js'

const previewBody = {
  destinationId: 1,
  preserveHierarchy: true,
  hosts: [{
    sourceId: 'source-1', name: 'Linux', ip: '10.0.0.1', port: 22,
    accessProtocol: 'ssh', sshUser: 'ubuntu', folderPath: ['Produção'], warnings: [],
  }],
  aclMappings: [],
  sourceStats: { invalidConnections: 0, unsupportedProtocols: [], unmappedPermissions: 0 },
}

async function appFor(role: 'admin' | 'user' = 'admin', canManageHosts = true) {
  const service = {
    preview: vi.fn((): Promise<GuacamoleImportPreviewResponse> => Promise.resolve({
      previewId: '11111111-1111-4111-8111-111111111111',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      summary: {
        detected: 1, ready: 1, blocked: 0, foldersToCreate: 1,
        aclMappings: 0, warnings: 0, credentialsDetected: 0, credentialsToImport: 0,
      },
      report: [{ sourceId: 'source-1', name: 'Linux', status: 'ready', destinationPath: 'Inventário / Produção', warnings: [] }],
    })),
    commit: vi.fn((): Promise<GuacamoleImportCommitResponse> => Promise.resolve({
      status: 'committed', createdHosts: 1, createdFolders: 1, createdSecrets: 0, appliedAclMappings: 0,
      rolledBackHosts: 0, rolledBackFolders: 0, rolledBackSecrets: 0,
      rows: [{ sourceId: 'source-1', name: 'Linux', status: 'created', message: 'Importado' }],
    })),
  }
  const app = Fastify()
  app.decorateRequest('jwtVerify', function () {
    return Promise.resolve({
      sub: '9', email: 'admin@example.test', role, isPlatformAdmin: false, tenantId: 7,
      canManageHosts, canViewLiveSessions: false, forcePasswordChange: false, stage: 'authenticated',
    })
  })
  await app.register(async (instance) => {
    await hostImportRoutes(instance, new HostImportController(service as unknown as HostImportService))
  })
  return { app, service }
}

describe('host import HTTP routes', () => {
  it('validates preview input and forwards active tenant/user context', async () => {
    const { app, service } = await appFor()
    try {
      const response = await app.inject({ method: 'POST', url: '/guacamole/preview', payload: previewBody })
      expect(response.statusCode).toBe(200)
      expect(response.json<GuacamoleImportPreviewResponse>().summary.ready).toBe(1)
      expect(service.preview).toHaveBeenCalledWith(expect.objectContaining({ destinationId: 1 }), 7, 9, 'ADMIN')
    } finally { await app.close() }
  })

  it('rejects malformed payloads before reaching the service', async () => {
    const { app, service } = await appFor()
    try {
      const response = await app.inject({ method: 'POST', url: '/guacamole/preview', payload: { destinationId: 1, hosts: [] } })
      expect(response.statusCode).toBe(400)
      expect(service.preview).not.toHaveBeenCalled()
    } finally { await app.close() }
  })

  it('requires host-management permission', async () => {
    const { app, service } = await appFor('user', false)
    try {
      const response = await app.inject({ method: 'POST', url: '/guacamole/preview', payload: previewBody })
      expect(response.statusCode).toBe(403)
      expect(service.preview).not.toHaveBeenCalled()
    } finally { await app.close() }
  })

  it('accepts a confirmed preview id for commit', async () => {
    const { app, service } = await appFor()
    try {
      const response = await app.inject({
        method: 'POST', url: '/guacamole/commit',
        payload: { previewId: '11111111-1111-4111-8111-111111111111', confirm: true },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json<GuacamoleImportCommitResponse>().status).toBe('committed')
      expect(service.commit).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 7, 9, 'ADMIN')
    } finally { await app.close() }
  })
})
