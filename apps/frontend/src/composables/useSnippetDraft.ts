import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import type { SnippetFormData } from '@/services/snippet.service'

type Draft = { form: SnippetFormData; baseline: string; editId: number | null }
const drafts = new Map<string, Draft>()
// Memory only: never persist terminal contents or resolved secrets in browser storage.
export function useSnippetDraft(form: Ref<SnippetFormData>, open: Ref<boolean>, editId: Ref<number | null>, surface: string, discardText: () => string): { canDiscard: () => boolean; restored: Ref<boolean> } {
  const auth = useAuthStore()
  const key = computed(() => [auth.user?.tenantId, auth.user?.id, surface].join(':'))
  const baseline = ref('')
  const restored = ref(false)
  const dirty = computed(() => open.value && JSON.stringify(form.value) !== baseline.value)
  watch(open, value => {
    if (value) baseline.value = JSON.stringify(form.value)
    else { drafts.delete(key.value); restored.value = false }
  }, { flush: 'sync' })
  function canDiscard(): boolean {
    if (!dirty.value) return true
    if (!window.confirm(discardText())) return false
    drafts.delete(key.value)
    baseline.value = JSON.stringify(form.value)
    return true
  }
  function beforeUnload(event: BeforeUnloadEvent): void {
    if (!dirty.value) return
    event.preventDefault()
    event.returnValue = ''
  }
  onMounted(() => {
    const draft = drafts.get(key.value)
    if (draft) {
      form.value = structuredClone(draft.form)
      editId.value = draft.editId
      open.value = true
      baseline.value = draft.baseline
      restored.value = true
      drafts.delete(key.value)
    }
    window.addEventListener('beforeunload', beforeUnload)
  })
  watch(key, (_next, previous) => {
    drafts.delete(previous)
    open.value = false
  })
  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', beforeUnload)
    if (dirty.value) drafts.set(key.value, { form: JSON.parse(JSON.stringify(form.value)) as SnippetFormData, baseline: baseline.value, editId: editId.value })
  })
  return { canDiscard, restored }
}
