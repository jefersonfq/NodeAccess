import { describe, expect, it, vi } from 'vitest'
import { FolderService } from './folder.service.js'
import type { FolderRepository } from './folder.repository.js'
import type { LogRepository } from '../logs/log.repository.js'

function setup() {
  const repo = {
    findAll: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    countChildren: vi.fn().mockResolvedValue(0),
    existsByName: vi.fn().mockResolvedValue(false),
  }
  const logRepo = { logAdminEvent: vi.fn().mockResolvedValue(undefined) }
  return {
    repo,
    service: new FolderService(repo as unknown as FolderRepository, logRepo as unknown as LogRepository),
  }
}

describe('FolderService personal hierarchy', () => {
  it('creates a subfolder only below a folder owned by the current user', async () => {
    const { repo, service } = setup()
    repo.findById.mockResolvedValue({ id: 8, userId: 4, tenantId: 2, parentId: null })
    repo.create.mockResolvedValue({ id: 9, name: 'Servidores', userId: 4, tenantId: 2, parentId: 8, createdAt: new Date() })

    await service.create('Servidores', 8, 4, 2)

    expect(repo.findById).toHaveBeenCalledWith(8, 4, 2)
    expect(repo.existsByName).toHaveBeenCalledWith('Servidores', 4, 2, 8)
    expect(repo.create).toHaveBeenCalledWith({ name: 'Servidores', userId: 4, tenantId: 2, parentId: 8 })
  })

  it('rejects a parent folder from another user', async () => {
    const { repo, service } = setup()
    repo.findById.mockResolvedValue(null)
    await expect(service.create('Proxy principal', 99, 4, 2)).rejects.toThrow('Pasta pai')
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('blocks deleting a folder that still contains subfolders', async () => {
    const { repo, service } = setup()
    repo.findById.mockResolvedValue({ id: 8, userId: 4, tenantId: 2, parentId: null })
    repo.countChildren.mockResolvedValue(2)
    await expect(service.delete(8, 4, 2)).rejects.toThrow('subpastas')
    expect(repo.delete).not.toHaveBeenCalled()
  })

  it('allows equal names in different parents but not among siblings', async () => {
    const { repo, service } = setup()
    repo.findById.mockResolvedValue({ id: 8, userId: 4, tenantId: 2, parentId: null })
    repo.existsByName.mockResolvedValue(true)
    await expect(service.create('Servidores', 8, 4, 2)).rejects.toThrow('já existe')
    expect(repo.existsByName).toHaveBeenCalledWith('Servidores', 4, 2, 8)
  })

  it('maps a database uniqueness race to a domain conflict', async () => {
    const { repo, service } = setup()
    repo.create.mockRejectedValue({ code: 'P2002' })
    await expect(service.create('Cliente X', null, 4, 2)).rejects.toThrow('já existe')
  })

  it('deletes a leaf and keeps the operation scoped to its owner', async () => {
    const { repo, service } = setup()
    repo.findById.mockResolvedValue({ id: 8, userId: 4, tenantId: 2, parentId: 7 })
    await service.delete(8, 4, 2)
    expect(repo.countChildren).toHaveBeenCalledWith(8, 4, 2)
    expect(repo.delete).toHaveBeenCalledWith(8, 4)
  })

  it('does not treat the current folder as a duplicate while renaming', async () => {
    const { repo, service } = setup()
    repo.findById.mockResolvedValue({ id: 8, name: 'Banco', userId: 4, tenantId: 2, parentId: 7 })
    repo.update.mockResolvedValue({ id: 8, name: 'Banco', userId: 4, tenantId: 2, parentId: 7, createdAt: new Date() })
    await service.update(8, 'Banco', 4, 2)
    expect(repo.existsByName).toHaveBeenCalledWith('Banco', 4, 2, 7, 8)
  })
})
