import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertTacacsActivation } from './tacacs-activation.js'

const runtime = vi.hoisted(() => ({ create: vi.fn(), diagnostics: vi.fn() }))
vi.mock('dotenv/config', () => ({}))
vi.mock('node:http', () => ({ createServer: runtime.diagnostics }))
vi.mock('../../config/database.js', () => ({ prisma: {} }))
vi.mock('../../config/env.js', () => ({ env: {} }))
vi.mock('../ssh/ssh.repository.js', () => ({ SshRepository: vi.fn() }))
vi.mock('../inventory/inventory-acl.repository.js', () => ({ InventoryAclRepository: vi.fn() }))
vi.mock('./network-access.service.js', () => ({ NetworkAccessService: vi.fn() }))
vi.mock('./tacacs-server.js', () => ({ createTacacsServer: runtime.create }))
vi.mock('./tacacs-health.js', () => ({ TacacsHealthStore: vi.fn(), operationalState: vi.fn(), requiresSupervisorRestart: vi.fn() }))

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

describe('legacy TACACS+ activation', () => {
  it.each([undefined, '', 'false', 'TRUE', '1', ' true '])('keeps the optional service disabled for enable=%s even with acknowledgement', enable => {
    expect(() => assertTacacsActivation({ NODEACCESS_TACACS_ENABLE: enable, NODEACCESS_TACACS_LEGACY_RISK_ACKNOWLEDGED: 'true' }))
      .toThrow('NODEACCESS_TACACS_ENABLE=true')
  })

  it.each([undefined, '', 'false', 'TRUE', '1', ' true '])('rejects missing or ambiguous acknowledgement=%s', acknowledgement => {
    expect(() => assertTacacsActivation({ NODEACCESS_TACACS_ENABLE: 'true', NODEACCESS_TACACS_LEGACY_RISK_ACKNOWLEDGED: acknowledgement }))
      .toThrow('NODEACCESS_TACACS_LEGACY_RISK_ACKNOWLEDGED=true')
  })

  it('allows an explicit opt-in and operational risk acknowledgement', () => {
    expect(() => assertTacacsActivation({ NODEACCESS_TACACS_ENABLE: 'true', NODEACCESS_TACACS_LEGACY_RISK_ACKNOWLEDGED: 'true' })).not.toThrow()
  })

  it('blocks the real bootstrap before constructing either listener without acknowledgement', async () => {
    vi.resetModules()
    vi.stubEnv('NODEACCESS_TACACS_ENABLE', 'true')
    vi.stubEnv('NODEACCESS_TACACS_LEGACY_RISK_ACKNOWLEDGED', undefined)
    await expect(import('./tacacs-main.js')).rejects.toThrow('does not verify protection or resolve the MD5 risk')
    expect(runtime.create).not.toHaveBeenCalled()
    expect(runtime.diagnostics).not.toHaveBeenCalled()
  })
})
