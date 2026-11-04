import { describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { HostRepository } from './host.repository.js'

async function query(visible: number[] | null, inventory: number[] | null, folder: number[] | null) {
  const findMany = vi.fn<(args: Prisma.HostFindManyArgs) => Promise<never[]>>().mockResolvedValue([])
  const count = vi.fn().mockResolvedValue(0)
  const db = { host: { findMany, count }, $transaction: vi.fn((queries: Promise<unknown>[]) => Promise.all(queries)) }
  const repository = new HostRepository(db as never, {} as never)
  const visibility = vi.fn().mockResolvedValue(visible)
  const subtree = vi.fn().mockResolvedValue(inventory)
  const personal = vi.fn().mockResolvedValue(folder)
  // Only selector boundaries are doubled; findVisible and its query construction remain real.
  Object.defineProperties(repository, {
    findVisibleHostIds: { value: visibility },
    findHostIdsInInventorySubtree: { value: subtree },
    findPersonalFolderHostIds: { value: personal },
  })
  await repository.findVisible(7, 41, visible === null ? 'ADMIN' : 'USER', {
    ...(inventory === null ? {} : { inventoryNodeId: 11 }),
    ...(folder === null ? {} : { folderId: 12 }),
  })
  return { findMany, count, visibility, subtree, personal }
}

describe('HostRepository filter intersection', () => {
  it.each([
    { name: 'no selectors preserves unrestricted admin scope', sets: [null, null, null], expected: null },
    { name: 'one selector preserves order and duplicates', sets: [[3, 1, 3, 2], null, null], expected: [3, 1, 3, 2] },
    { name: 'inventory alone is retained for admin', sets: [null, [8, 7, 8], null], expected: [8, 7, 8] },
    { name: 'two selectors intersect without reordering', sets: [[3, 1, 3, 2], [2, 3], null], expected: [3, 3, 2] },
    { name: 'three selectors retain first multiplicity', sets: [[3, 1, 3, 2], [2, 3], [3]], expected: [3, 3] },
  ] satisfies { name: string; sets: [number[] | null, number[] | null, number[] | null]; expected: number[] | null }[])('$name', async ({ sets, expected }) => {
    const before = structuredClone(sets)
    const result = await query(...sets)
    expect(result.findMany).toHaveBeenCalledOnce()
    expect(result.count).toHaveBeenCalledOnce()
    const where = result.findMany.mock.calls[0]?.[0].where
    expect(where?.tenantId).toBe(7)
    expect(where?.deletedAt).toBeNull()
    if (expected === null) expect(where).not.toHaveProperty('id')
    else expect(where).toMatchObject({ id: { in: expected } })
    if (sets[0] !== null) expect(result.visibility).toHaveBeenCalledWith(7, 41, 'USER')
    if (sets[1] !== null) expect(result.subtree).toHaveBeenCalledWith(7, 11)
    if (sets[2] !== null) expect(result.personal).toHaveBeenCalledWith(7, 41, 12)
    expect(sets).toEqual(before)
  })

  it.each([
    [[], null, null], [null, [], null], [null, null, []], [[1], [2], null], [[1, 2], [2], [1]],
  ] satisfies [number[] | null, number[] | null, number[] | null][])('denies empty or disjoint selectors %# before database host queries', async (visible, inventory, folder) => {
    const result = await query(visible, inventory, folder)
    expect(result.findMany).not.toHaveBeenCalled()
    expect(result.count).not.toHaveBeenCalled()
  })

  it('matches the previous guarded reduction across 216 selector combinations', async () => {
    const choices: (number[] | null)[] = [null, [], [1], [2], [2, 1, 2], [3, 2]]
    let checked = 0
    for (const visible of choices) for (const inventory of choices) for (const folder of choices) {
      const selectors = [visible, inventory, folder].filter((ids): ids is number[] => ids !== null)
      let expected = selectors[0] ?? null
      for (const ids of selectors.slice(1)) expected = expected?.filter(id => ids.includes(id)) ?? null
      const result = await query(visible, inventory, folder)
      if (expected?.length === 0) expect(result.findMany).not.toHaveBeenCalled()
      else {
        const where = result.findMany.mock.calls[0]?.[0].where
        if (expected === null) expect(where).not.toHaveProperty('id')
        else expect(where).toMatchObject({ id: { in: expected } })
      }
      checked++
    }
    expect(checked).toBe(216)
  })
})
