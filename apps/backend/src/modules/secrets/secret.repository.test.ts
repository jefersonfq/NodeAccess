import { describe, expect, it, vi } from 'vitest'
import { SecretRepository } from './secret.repository.js'

describe('secret consumer aggregation', () => {
  it('counts a snippet once, supports spaces and matches aliases literally', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([{ id: 9, count: 2n }]).mockResolvedValueOnce([
      { command: '{{secret:a_b}} {{secret:a_b}}' }, { command: '{{ secret:a_b }}' },
      { command: '{{secret:axb}}' }, { command: '{{secret:a.b}}' },
    ]) }
    const result = await new SecretRepository(db as never).countConsumers(7, [{ id: 9, alias: 'a_b' }, { id: 10, alias: 'a.b' }, { id: 11, alias: 'unused' }])
    expect([...result]).toEqual([[9, 4], [10, 1], [11, 0]])
    expect(db.$queryRaw).toHaveBeenCalledTimes(2)
  })
  it('uses the same literal placeholder rules in details and never returns command content', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: 1, name: 'Valid', command: '{{ secret:a_b }}' },
      { id: 2, name: 'Another alias', command: '{{secret:axb}}' },
    ]) }
    const repo = new SecretRepository(db as never)
    vi.spyOn(repo, 'findById').mockResolvedValue({ alias: 'a_b' } as never)
    const result = await repo.findConsumers(7, 9)
    expect(result).toEqual({ hostCount: 0, hosts: [], snippetCount: 1, snippets: [{ id: 1, name: 'Valid' }] })
    expect(JSON.stringify(result)).not.toContain('command')
  })
  it('does not query for an empty accessible list', async () => {
    const db = { $queryRaw: vi.fn() }
    expect(await new SecretRepository(db as never).countConsumers(7, [])).toEqual(new Map())
    expect(db.$queryRaw).not.toHaveBeenCalled()
  })
})
