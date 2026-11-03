import { describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { AgentController } from '../modules/agents/agent.controller.js'
import type { SharedSessionGateway } from '../modules/shared-sessions/shared-session.gateway.js'
import { agentRoutes } from '../modules/agents/agent.routes.js'
import { nativeSshGatewayRoutes } from '../modules/native-ssh-gateway/native-ssh-gateway.routes.js'
import { sharedSessionWsRoutes } from '../modules/shared-sessions/shared-session.ws-routes.js'

vi.mock('../config/database.js', () => ({ prisma: {} }))
vi.mock('../config/redis.js', () => ({ redis: {} }))

const controller = new Proxy({}, { get: () => () => Promise.resolve() }) as AgentController
const gateway = {} as SharedSessionGateway
const registrations = [
  ['agents', (app: FastifyInstance) => agentRoutes(app, controller)],
  ['native gateway', nativeSshGatewayRoutes],
  ['shared sessions', (app: FastifyInstance) => sharedSessionWsRoutes(app, gateway)],
] as const

describe.each(registrations)('%s route registration Promise contract', (_name, register) => {
  it('registers synchronously and resolves as a Promise', async () => {
    const get = vi.fn()
    const app = { get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } as unknown as FastifyInstance
    const completion = register(app)
    expect(get).toHaveBeenCalled()
    expect(completion).toBeInstanceOf(Promise)
    await expect(completion).resolves.toBeUndefined()
  })

  it('rejects the original error without a synchronous throw', async () => {
    const failure = new Error('registration failed')
    const app = { get: () => { throw failure } } as unknown as FastifyInstance
    let completion: Promise<void> | undefined
    expect(() => { completion = register(app) }).not.toThrow()
    await expect(completion).rejects.toBe(failure)
  })
})
