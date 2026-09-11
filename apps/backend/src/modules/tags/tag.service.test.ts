import { describe, it, expect, vi } from 'vitest'
import { TagService } from './tag.service.js'
describe('tag editing', () => {
  it('keeps identity and associations and normalizes name', async () => {
    const repo = { findById: vi.fn().mockResolvedValue({ id: 7 }), update: vi.fn().mockResolvedValue({ id: 7, name: 'Prod', color: '#abcdef' }) }
    expect(await new TagService(repo as never).update(7, 2, { name: ' Prod ', color: '#abcdef' })).toEqual({ id: 7, name: 'Prod', color: '#abcdef' })
    expect(repo.findById).toHaveBeenCalledWith(7, 2)
    expect(repo.update).toHaveBeenCalledWith(7, 2, { name: 'Prod', color: '#abcdef' })
  })
  it('does not mutate a tag outside tenant', async () => {
    const repo = { findById: vi.fn().mockResolvedValue(null), update: vi.fn() }
    await expect(new TagService(repo as never).update(7, 9, { name: 'Prod', color: '#abcdef' })).rejects.toMatchObject({ statusCode: 404 })
    expect(repo.update).not.toHaveBeenCalled()
  })
  it('rejects empty names and non-color strings', async () => {
    const service = new TagService({} as never)
    await expect(service.update(1, 1, { name: ' ', color: '#ffffff' })).rejects.toThrow()
    await expect(service.update(1, 1, { name: 'Prod', color: 'url(javascript:alert(1))' })).rejects.toThrow()
  })
})
