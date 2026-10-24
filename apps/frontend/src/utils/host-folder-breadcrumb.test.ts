import { describe, expect, it } from 'vitest'
import { hostFolderBreadcrumb } from './host-folder-breadcrumb'

describe('host folder breadcrumb', () => {
  const folders = new Map([
    [1, { id: 1, parentId: null, name: '__root__', type: 'ROOT' }],
    [2, { id: 2, parentId: 1, name: 'Banco de dados', type: 'FOLDER' }],
    [3, { id: 3, parentId: 2, name: 'Dbs', type: 'FOLDER' }],
  ])
  it('builds the complete corporate ancestry and masks the technical root', () => {
    expect(hostFolderBreadcrumb(3, folders, 'Raiz')).toBe('Raiz → Banco de dados → Dbs')
    expect(hostFolderBreadcrumb(1, folders, 'Raiz')).toBe('Raiz')
  })
  it('supports personal folders and translated root labels', () => {
    expect(hostFolderBreadcrumb(2, new Map([
      [1, { id: 1, parentId: null, name: 'Cliente' }],
      [2, { id: 2, parentId: 1, name: 'Servers' }],
    ]), 'Root')).toBe('Root → Cliente → Servers')
  })
  it('does not guess missing ancestors or cross into another tree', () => {
    expect(hostFolderBreadcrumb(3, new Map([[3, folders.get(3)!]]), 'Raiz')).toBe('… → Dbs')
    expect(hostFolderBreadcrumb(99, folders, 'Raiz')).toBeNull()
    expect(hostFolderBreadcrumb(null, folders, 'Raiz')).toBeNull()
  })
  it('terminates safely on a cyclic hierarchy', () => {
    expect(hostFolderBreadcrumb(1, new Map([
      [1, { id: 1, parentId: 2, name: 'A' }],
      [2, { id: 2, parentId: 1, name: 'B' }],
    ]), 'Raiz')).toBe('… → B → A')
  })
})
