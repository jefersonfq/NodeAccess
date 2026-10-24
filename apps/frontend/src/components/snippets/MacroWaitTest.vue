<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import { NButton, NInput } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { MacroStep } from '@nodeaccess/shared'
import { createMacroMatcher } from '@/services/macro-regex.service'
const props = defineProps<{ step: Extract<MacroStep, { type: 'wait' }>; index: number }>()
const { t } = useI18n()
const sample = ref('')
const result = ref('')
const matchedText = ref('')
const testing = ref(false)
let revision = 0
let controller: AbortController | null = null
function invalidate(): void {
  revision++
  controller?.abort()
  result.value = ''
  matchedText.value = ''
}
watch(() => [props.step, sample.value], invalidate, { deep: true, flush: 'sync' })
onBeforeUnmount(invalidate)
async function test(): Promise<void> {
  if (testing.value) return
  const current = revision
  const text = sample.value
  const step = { ...props.step }
  const abort = new AbortController()
  controller = abort
  testing.value = true
  let matchText = ''
  const matcher = createMacroMatcher((start, end) => { matchText = start === null || end === null ? '' : text.slice(start, end) })
  try {
    const index = (step.caseSensitive ? text : text.toLowerCase()).indexOf(step.caseSensitive ? step.pattern : step.pattern.toLowerCase())
    const end = step.mode === 'regex'
      ? await matcher.match(step.pattern, text, step.caseSensitive, abort.signal)
      : index < 0 ? null : index + step.pattern.length
    if (current !== revision) return
    matchedText.value = step.mode === 'literal' && end !== null ? text.slice(index, end) : matchText
    result.value = t(end === null ? 'snippets.macro.noMatch' : 'snippets.macro.matched')
  } catch {
    if (current === revision) result.value = t('snippets.macro.regexError')
  } finally {
    matcher.dispose()
    testing.value = false
    if (controller === abort) controller = null
  }
}
</script>
<template>
  <details data-macro-wait-test>
    <summary>{{ t('snippets.macro.testStep', { step: index + 1 }) }}</summary>
    <NInput
      v-model:value="sample"
      type="textarea"
      :maxlength="8192"
      :input-props="{ 'aria-label': t('snippets.macro.sample') }"
    />
    <NButton
      size="small"
      :loading="testing"
      :disabled="!step.pattern || !sample"
      @click="test"
    >
      {{ t('snippets.macro.test') }}
    </NButton>
    <p
      v-if="result"
      role="status"
    >
      {{ result }} <mark v-if="matchedText">{{ matchedText }}</mark>
    </p>
  </details>
</template>
