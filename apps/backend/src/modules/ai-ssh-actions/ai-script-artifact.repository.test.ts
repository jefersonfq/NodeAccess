import { describe, expect, it, vi } from 'vitest'
import { AiScriptArtifactRepository } from './ai-script-artifact.repository.js'

describe('script destination provenance', () => {
  it('persists a fresh destination on creation before the command is prepared for approval', async () => {
    const destinations: string[] = []
    const tx = {
      $executeRaw: vi.fn(async (sql: { values: unknown[] }) => {
        destinations.push(sql.values[5] as string)
        return 1
      }),
      $queryRaw: vi.fn(async () => [{ id: BigInt(destinations.length) }]),
    }
    const db = { $transaction: (operation: (value: typeof tx) => unknown) => operation(tx) }
    const repository = new AiScriptArtifactRepository(db as never)
    vi.spyOn(repository, 'findById').mockImplementation(async (id) => ({ id, destination: destinations[id - 1] } as never))
    const input = { tenantId: 1, hostId: 2, createdById: 3, title: 'test', objective: 'test', content: 'true', checksum: 'checksum', risk: 'safe' as const }
    const first = await repository.create(input), second = await repository.create(input)
    expect(first.destination).toMatch(/^\/tmp\/nodeaccess-ai-script-\d+\.sh$/)
    expect(second.destination).not.toBe(first.destination)
    // The pre-change runner accepts decimal destinations and reads this persisted field.
    for (const artifact of [first, second]) {
      const nonce = BigInt(artifact.destination.match(/-(\d+)\.sh$/)![1]!)
      expect(nonce).toBeGreaterThanOrEqual(0n)
      expect(nonce).toBeLessThan(1n << 128n)
      expect(artifact.destination).not.toBe(`/tmp/nodeaccess-ai-script-${artifact.id}.sh`)
    }
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2)
  })
})
