import { ref } from 'vue'
import type { UserSnippetPreferences } from '@nodeaccess/shared'

export type SnippetViewMode = UserSnippetPreferences['pickerView']

const PICKER_VIEW_KEY = 'nodeaccess:snippets-panel-view-mode'
const PAGE_VIEW_KEY   = 'nodeaccess:snippets-view-mode'

function readMode(key: string): SnippetViewMode {
  if (typeof window === 'undefined') return 'flat'
  const value = window.localStorage.getItem(key)
  return value === 'grouped' ? 'grouped' : 'flat'
}

export const snippetPickerView = ref<SnippetViewMode>(readMode(PICKER_VIEW_KEY))
export const snippetPageView   = ref<SnippetViewMode>(readMode(PAGE_VIEW_KEY))

export function setSnippetPickerView(mode: SnippetViewMode) {
  snippetPickerView.value = mode
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(PICKER_VIEW_KEY, mode)
  }
}

export function setSnippetPageView(mode: SnippetViewMode) {
  snippetPageView.value = mode
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(PAGE_VIEW_KEY, mode)
  }
}

export function applySnippetPreferenceSnapshot(snapshot: UserSnippetPreferences) {
  setSnippetPickerView(snapshot.pickerView)
  setSnippetPageView(snapshot.pageView)
}

export function getSnippetPreferenceSnapshot(): UserSnippetPreferences {
  return {
    pickerView: snippetPickerView.value,
    pageView:   snippetPageView.value,
  }
}
