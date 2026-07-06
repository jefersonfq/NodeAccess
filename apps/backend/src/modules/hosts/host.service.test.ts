import { describe, expect, it, vi } from 'vitest'
import type { CreateHostDto } from '@nodeaccess/shared'
import { HostService } from './host.service.js'
import type { HostRepository, HostRow } from './host.repository.js'

vi.mock('../../shared/crypto.js', () => ({
  encrypt: vi.fn(() => ({ encrypted: 'encrypted', iv: 'iv' })),
}))

type HostCreateInput = Parameters<HostRepository['create']>[0]
type HostUpdateInput = Parameters<HostRepository['update']>[2]

function makeHostRow(overrides: Partial<HostRow> = {}): HostRow {
  return {
    id: 10,
    tenantId: 1,
    name: 'host',
    ip: '10.0.0.10',
    port: 22,
    accessProtocol: 'SSH',
    sshUser: 'root',
    authType: 'PASSWORD',
    connectionMode: 'DIRECT',
    scope: 'GLOBAL',
    ownerId: null,
    groupId: null,
    folderId: null,
    bastionId: null,
    pemKeyId: null,
    passwordEncrypted: null,
    onePasswordRef: null,
    trustedHostKeyFingerprint: null,
    trustedHostKeyVerifiedAt: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    tags: [],
    bastion: null,
    group: null,
    ...overrides,
  } as HostRow
}

function makeService() {
  const createdInputs: HostCreateInput[] = []
  const updatedInputs: HostUpdateInput[] = []
  let existingHost = makeHostRow()

  const hostRepo = {
    findHostLicenseLimit: vi.fn().mockResolvedValue(null),
    countByTenant: vi.fn().mockResolvedValue(0),
    create: vi.fn(async (input: HostCreateInput) => {
      createdInputs.push(input)
      return makeHostRow({
        ...input,
        id: 11,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        tags: [],
        bastion: null,
        group: null,
      } as Partial<HostRow>)
    }),
    findById: vi.fn().mockImplementation(async () => existingHost),
    update: vi.fn(async (_id: number, _tenantId: number, input: HostUpdateInput) => {
      updatedInputs.push(input)
      existingHost = makeHostRow({ ...existingHost, ...input })
      return existingHost
    }),
    listAssociatedLinksByHostIds: vi.fn().mockResolvedValue(new Map()),
    bastionExists: vi.fn().mockResolvedValue(true),
    pemKeyExists: vi.fn().mockResolvedValue(true),
  }

  const service = new HostService(
    hostRepo as unknown as HostRepository,
    {} as never,
    { logAdminEvent: vi.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    { publishEvent: vi.fn().mockResolvedValue(undefined) } as never,
    { del: vi.fn().mockResolvedValue(1) } as never,
  )

  return {
    service,
    hostRepo,
    createdInputs,
    updatedInputs,
    setExistingHost(host: HostRow) {
      existingHost = host
    },
  }
}

const baseDto: CreateHostDto = {
  name: 'srv-rdp',
  ip: '10.0.0.20',
  port: 3389,
  accessProtocol: 'rdp',
  sshUser: 'admin',
  authType: 'pem_password',
  connectionMode: 'direct',
  scope: 'global',
  password: 'secret',
  pemKeyId: 5,
  bastionId: 7,
  onePasswordRef: 'op://vault/item/password',
}

describe('HostService protocol-specific credential handling', () => {
  it('persists password but not SSH-only fields when creating a graphical host', async () => {
    const { service, createdInputs } = makeService()

    await service.create(baseDto, 1, 2)

    expect(createdInputs).toHaveLength(1)
    expect(createdInputs[0]).toMatchObject({
      accessProtocol: 'RDP',
      sshUser: '',
      authType: 'PASSWORD',
    })
    expect(createdInputs[0]).toHaveProperty('passwordEncrypted')
    expect(createdInputs[0]).not.toHaveProperty('pemKeyId')
    expect(createdInputs[0]).not.toHaveProperty('bastionId')
    expect(createdInputs[0]).not.toHaveProperty('onePasswordRef')
  })

  it('clears SSH-only fields but preserves password unless replaced when updating to a graphical protocol', async () => {
    const { service, updatedInputs, setExistingHost } = makeService()
    setExistingHost(makeHostRow({
      accessProtocol: 'SSH',
      sshUser: 'root',
      authType: 'PEM_PASSWORD',
      pemKeyId: 5,
      bastionId: 7,
      passwordEncrypted: '{"encrypted":"x","iv":"y"}',
      onePasswordRef: 'op://vault/item/password',
    }))

    await service.update(10, { accessProtocol: 'rdp', port: 3389 }, 1, 2, 'ADMIN')

    expect(updatedInputs).toHaveLength(1)
    expect(updatedInputs[0]).toMatchObject({
      accessProtocol: 'RDP',
      sshUser: '',
      authType: 'PASSWORD',
      pemKeyId: null,
      bastionId: null,
      onePasswordRef: null,
    })
    expect(updatedInputs[0]).not.toHaveProperty('passwordEncrypted')
  })

  it('stores a replacement VNC password when updating a graphical host', async () => {
    const { service, updatedInputs, setExistingHost } = makeService()
    setExistingHost(makeHostRow({
      accessProtocol: 'VNC',
      sshUser: '',
      authType: 'PASSWORD',
      passwordEncrypted: null,
    }))

    await service.update(10, { accessProtocol: 'vnc', port: 5901, password: 'vnc-secret' }, 1, 2, 'ADMIN')

    expect(updatedInputs).toHaveLength(1)
    expect(updatedInputs[0]).toMatchObject({
      accessProtocol: 'VNC',
      sshUser: '',
      authType: 'PASSWORD',
      pemKeyId: null,
      bastionId: null,
      onePasswordRef: null,
    })
    expect(updatedInputs[0]).toHaveProperty('passwordEncrypted')
  })
})
