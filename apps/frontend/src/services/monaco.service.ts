// Keep the editor and worker constructors out of the initial application graph.
export function loadMonaco(): Promise<typeof import('monaco-editor')> {
  return import('./monaco-runtime').then(runtime => runtime.monaco)
}
