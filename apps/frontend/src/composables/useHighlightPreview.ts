import { onBeforeUnmount, shallowRef, watch, type ShallowRef } from 'vue'
import type { HighlightRequest, HighlightResultRow } from '@/terminal/terminal-highlight-engine'
import { createHighlightClient, HighlightError, highlightErrorMessage } from '@/terminal/terminal-highlight-client'

/** Debounced previews share the same isolated engine as live terminal decorations. */
export function useHighlightPreview(input: () => HighlightRequest): { rows: ShallowRef<HighlightResultRow[]>; warning: ShallowRef<string> } {
  const client = createHighlightClient()
  const rows = shallowRef<HighlightResultRow[]>([])
  const warning = shallowRef('')
  let timer: ReturnType<typeof setTimeout> | undefined
  let version = 0
  watch(input, request => {
    const current = ++version
    clearTimeout(timer); client.cancel(); rows.value = []; warning.value = ''
    if (!request.rows.length) return
    timer = setTimeout(() => {
      void client.run(request, JSON.stringify(request)).then(result => {
        if (version === current) rows.value = result.rows
      }).catch((error: unknown) => {
        if (version === current && !(error instanceof HighlightError && error.code === 'superseded')) warning.value = highlightErrorMessage(error)
      })
    }, 75)
  }, { immediate: true, deep: true })
  onBeforeUnmount(() => { version++; clearTimeout(timer); client.dispose() })
  return { rows, warning }
}
