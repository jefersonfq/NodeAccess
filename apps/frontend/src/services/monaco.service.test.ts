import { expect, it, vi } from 'vitest'
import { loadMonaco } from './monaco.service'
const { initialize } = vi.hoisted(() => ({ initialize: vi.fn() }))
vi.mock('./monaco-runtime', () => { initialize(); return { monaco: { editor: {}, languages: {} } } })
it('loads the editor runtime only when requested and reuses its module', async () => {
  expect(initialize).not.toHaveBeenCalled()
  const first = await loadMonaco()
  expect(initialize).toHaveBeenCalledTimes(1)
  expect(await loadMonaco()).toBe(first)
  expect(initialize).toHaveBeenCalledTimes(1)
})
