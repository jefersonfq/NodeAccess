import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseMobaXtermSessions } from './mobaxterm-import.service'
import { buildImportSessionsPreview } from './import-sessions-preview.service'

describe('buildImportSessionsPreview', () => {
  it('shows the real MobaXterm fixture as it will appear under the corporate Sessions destination', () => {
    const fixturePath = fileURLToPath(new URL('../../../../imgs_debug/MobaXterm Sessions_personal_folders.mxtsessions', import.meta.url))
    const parsed = parseMobaXtermSessions(readFileSync(fixturePath, 'utf8'))
    const rows = buildImportSessionsPreview('Inventário importado', parsed.hosts.map(host => ({
      key: host.sourceId,
      name: host.name,
      ip: host.ip,
      port: host.port,
      folderPath: host.folderPath,
    })), true)

    expect(rows[0]).toEqual(expect.objectContaining({ kind: 'folder', name: 'Inventário importado', depth: 0, hostCount: 4 }))
    expect(rows.filter(row => row.kind === 'host')).toHaveLength(4)
    expect(rows.filter(row => row.kind === 'folder')).toHaveLength(3)
    expect(rows.filter(row => row.kind === 'host').every(row => row.depth >= 2)).toBe(true)
  })

  it('merges folder names case-insensitively and orders folders before hosts', () => {
    const rows = buildImportSessionsPreview('Destino', [
      { key: '2', name: 'Zulu', ip: 'z.example.test', port: 22, folderPath: ['Produção'] },
      { key: '1', name: 'Alpha', ip: 'a.example.test', port: 2222, folderPath: ['produção'] },
      { key: '3', name: 'Sem pasta', ip: 'root.example.test', port: 22, folderPath: [] },
    ], true)

    expect(rows.map(row => row.name)).toEqual(['Destino', 'Produção', 'Alpha', 'Zulu', 'Sem pasta'])
    expect(rows[1]).toEqual(expect.objectContaining({ hostCount: 2 }))
  })

  it('shows all hosts directly below the destination when hierarchy is disabled', () => {
    const rows = buildImportSessionsPreview('Destino', [
      { key: '1', name: 'Servidor', ip: 'host.example.test', port: 22, folderPath: ['A', 'B'] },
    ], false)

    expect(rows).toEqual([
      { key: 'destination', kind: 'folder', name: 'Destino', depth: 0, hostCount: 1 },
      { key: 'host:1', kind: 'host', name: 'Servidor', depth: 1, endpoint: 'host.example.test:22' },
    ])
  })

  it('hides the virtual inventory root so top-level folders match the real Sessions menu', () => {
    const rows = buildImportSessionsPreview('Raiz', [
      { key: '1', name: 'Servidor', ip: 'host.example.test', port: 22, folderPath: ['Produção'] },
    ], true, false)

    expect(rows[0]).toEqual(expect.objectContaining({ kind: 'folder', name: 'Produção', depth: 0 }))
    expect(rows.some(row => row.name === 'Raiz')).toBe(false)
  })
})
