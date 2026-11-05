import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('monaco-editor', () => ({ editor: {}, languages: {} }))
vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => ({ default: class { kind = 'editor' } }))
vi.mock('monaco-editor/esm/vs/language/json/json.worker?worker', () => ({ default: class { kind = 'json' } }))
vi.mock('monaco-editor/esm/vs/language/css/css.worker?worker', () => ({ default: class { kind = 'css' } }))
vi.mock('monaco-editor/esm/vs/language/html/html.worker?worker', () => ({ default: class { kind = 'html' } }))
vi.mock('monaco-editor/esm/vs/language/typescript/ts.worker?worker', () => ({ default: class { kind = 'typescript' } }))

describe('local Monaco worker dispatch', () => {
  beforeAll(async () => {
    vi.stubGlobal('self', {})
    await import('./monaco-runtime')
  })
  afterAll(() => vi.unstubAllGlobals())
  it.each([
    ['json', 'json'], ['css', 'css'], ['scss', 'css'], ['less', 'css'],
    ['html', 'html'], ['handlebars', 'html'], ['razor', 'html'],
    ['typescript', 'typescript'], ['javascript', 'typescript'], ['plaintext', 'editor'],
  ])('dispatches %s to the local %s worker', (label, kind) => {
    expect(self.MonacoEnvironment?.getWorker?.('unused', label)).toMatchObject({ kind })
  })
})
