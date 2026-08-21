import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { agentRoutes } from './agent.routes.js'
import type { AgentController } from './agent.controller.js'

function controllerStub(): AgentController {
  const handler = async () => ({})
  return new Proxy({}, { get: () => handler }) as AgentController
}

describe('agent installation scripts', () => {
  it.each([
    ['linux', '/etc/nodeaccess-agent/token'],
    ['macos', '/Library/Application Support/NodeAccess/token'],
    ['windows', 'agent.token'],
  ])('stores service token outside process arguments on %s', async (platform, tokenPath) => {
    const app = Fastify()
    await app.register(async instance => agentRoutes(instance, controllerStub()))
    try {
      const response = await app.inject({ method: 'GET', url: `/install/${platform}?server=https%3A%2F%2Fnodeaccess.test` })
      expect(response.statusCode).toBe(200)
      expect(response.body).toContain('--token-file')
      expect(response.body).toContain(tokenPath)
      expect(response.body).not.toMatch(/ExecStart=.*--token\s/)
      expect(response.body).not.toMatch(/New-ScheduledTaskAction[^\n]+--token\s/)
    } finally { await app.close() }
  })
})
