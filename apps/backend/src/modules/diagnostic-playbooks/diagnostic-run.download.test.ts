import { describe, expect, it, vi } from 'vitest'
import { DiagnosticRunController } from './diagnostic-run.controller.js'

describe('diagnostic download filename contract', () => {
  it.each([
    ['--- Ping HOST ---', 'ping-host'], ['Áé中😀', 'diagnostic-run'], ['', 'diagnostic-run'],
    ['A--B__C', 'a-b-c'], ['x'.repeat(65), 'x'.repeat(60)],
    ['a'.repeat(59) + ' - trailing', 'a'.repeat(59) + '-'],
    ['-'.repeat(100000) + 'END' + '-'.repeat(100000), 'end'],
  ])('normalizes filename without changing report or access scope %#', async (playbookName, slug) => {
    const report = { identity: { playbookName, runId: 19 } }
    const exportRun = vi.fn().mockResolvedValue(report)
    const controller = new DiagnosticRunController({ exportRun } as never)
    const reply = { header: vi.fn().mockReturnThis(), send: vi.fn() }
    await controller.download({ params: { runId: '19' }, jwtUser: { tenantId: 7, sub: '41', role: 'admin' } } as never, reply as never)
    expect(exportRun).toHaveBeenCalledWith({ id: 19, tenantId: 7, userId: 41, role: 'ADMIN' })
    expect(reply.header).toHaveBeenCalledWith('Content-Disposition', `attachment; filename="${slug}-19.json"`)
    expect(reply.send).toHaveBeenCalledWith(JSON.stringify(report, null, 2))
  })
})
