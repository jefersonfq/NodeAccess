<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NButton, NInput, NAlert } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { LocalAiTerminalAssist } from '@nodeaccess/shared'
import { terminalAiFailure, canRetryTerminalAi, type TerminalAiFailure } from '@/services/terminal-ai-errors'
import { localAiService } from '@/services/local-ai.service'
import { canInsertTerminalAiCommand, terminalAiRejectionReason } from '@/services/terminal-ai-command.service'
import { positionTerminalAutocomplete } from '@/services/terminal-autocomplete-position.service'

import type { TerminalPaneHandle } from './terminal-pane-handle'
const props = defineProps<{ hostId: number; hostName: string; initialQuestion?: string; getAnchor?: TerminalPaneHandle['getAiAnchor'] }>()
const emit = defineEmits<{ close: []; insert: [LocalAiTerminalAssist]; context: [string]; draft: [string] }>()
const { t } = useI18n()
const input = ref<{ focus: () => void } | null>(null)
const popup = ref<HTMLElement | null>(null)
const question = ref(props.initialQuestion ?? '')
const loading = ref(false)
const error = ref('')
const failure = ref<TerminalAiFailure | null>(null)
const result = ref<LocalAiTerminalAssist | null>(null)
const selected = ref(0)
const choices = computed(() => result.value ? [result.value, ...(result.value.alternatives ?? []).map(item => ({ ...result.value!, ...item, alternatives: undefined, warnings: [] }))].filter(canInsertTerminalAiCommand) : [])
const position = ref({ left: 8, top: 8, width: 520 })
const maxHeight = ref(window.innerHeight - 16)
let revision = 0
let controller: AbortController | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let accepted = false
let observer: ResizeObserver | null = null
let focusFrame = 0

function reposition(): void {
  const anchor = props.getAnchor?.() ?? {left:16,top:40,cellHeight:18,viewport:{left:0,top:0,width:window.innerWidth,height:window.innerHeight}}
  const bounds = anchor.viewport
  maxHeight.value = Math.max(80, bounds.height - 16)
  const local = positionTerminalAutocomplete({
    anchor, containerWidth: bounds.width, containerHeight: bounds.height,
    popupWidth: 520, popupHeight: popup.value?.offsetHeight ?? 120,
  })
  position.value = {left: bounds.left + local.left, top: bounds.top + local.top, width:local.width}
}
function invalidate(): void {
  revision++
  controller?.abort()
  controller = null
  if (timer) clearTimeout(timer)
  timer = null
  loading.value = false
  error.value = ''
  failure.value = null
  result.value = null
  selected.value = 0
}
watch(question, value => { invalidate(); emit('draft', value) }, { flush: 'sync' })
onMounted(async () => {
  await nextTick()
  reposition()
  observer = new ResizeObserver(reposition)
  if (popup.value) observer.observe(popup.value)
  window.addEventListener('resize', reposition)
  input.value?.focus()
  // xterm completes its local prefix write asynchronously.
  focusFrame = requestAnimationFrame(() => input.value?.focus())
})
onBeforeUnmount(() => {
  invalidate()
  cancelAnimationFrame(focusFrame)
  observer?.disconnect()
  window.removeEventListener('resize', reposition)
})
async function submit(): Promise<void> {
  if (question.value.trim().length < 3 || loading.value || (failure.value && !canRetryTerminalAi(failure.value))) return
  invalidate()
  const current = revision
  const abort = new AbortController()
  controller = abort
  loading.value = true
  timer = setTimeout(() => abort.abort(), 21000)
  try {
    const { data } = await localAiService.terminalAssist({
      hostId: props.hostId, intent: 'command', instruction: question.value.trim(), alternatives: true,
    }, abort.signal)
    if (current !== revision) return
    result.value = data
    await nextTick()
    if (current === revision) input.value?.focus()
  } catch (err) {
    if (current === revision) {
      failure.value = abort.signal.aborted ? 'timeout' : terminalAiFailure(err)
      error.value = t('terminal.ai.failures.' + failure.value)
    }
  } finally {
    if (current === revision) {
      loading.value = false
      controller = null
      if (timer) clearTimeout(timer)
      timer = null
    }
  }
}
function onInputKey(event: KeyboardEvent): void {
  if (event.isComposing) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (choices.value.length) selected.value = (selected.value + (event.key === 'ArrowDown' ? 1 : -1) + choices.value.length) % choices.value.length
  } else if (event.key === 'Enter') {
    event.preventDefault()
    if (!event.repeat) {
      if (choices.value.length) choose(selected.value)
      else void submit()
    }
  }
}
function choose(index: number): void {
  const value = choices.value[index]
  if (accepted || !value || !canInsertTerminalAiCommand(value)) return
  accepted = true
  emit('insert', value)
}
</script>

<template>
  <section
    ref="popup"
    :style="{ left: position.left + 'px', top: position.top + 'px', width: position.width + 'px', maxHeight: maxHeight + 'px' }"
    data-testid="terminal-command-suggestion"
    role="region"
    :aria-label="t('terminal.ai.quick.title')"
    class="terminal-command-suggestion"
    @keydown.stop
    @keydown.esc.stop.prevent="emit('close')"
    @keydown="event => { if (event.key === 'Enter' && event.repeat) { event.preventDefault(); event.stopPropagation() } }"
  >
    <div class="flex items-center justify-between gap-2">
      <strong :title="props.hostName">{{ t('terminal.ai.quick.title') }}</strong>
      <NButton
        size="tiny"
        :aria-label="t('common.close')"
        @click="emit('close')"
      >
        ×
      </NButton>
    </div>
    <NInput
      ref="input"
      v-model:value="question"
      :maxlength="1000"
      :input-props="{ 'aria-label': t('terminal.ai.quick.question'), role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': choices.length > 0, 'aria-controls': 'terminal-ai-options', 'aria-activedescendant': choices.length ? 'terminal-ai-option-' + selected : undefined }"
      :placeholder="t('terminal.ai.quick.placeholder')"
      @keydown="onInputKey"
    />
    <div class="flex flex-wrap justify-between gap-2">
      <NButton
        size="small"
        text
        @click="emit('context', question)"
      >
        {{ t('terminal.ai.quick.context') }}
      </NButton>
      <NButton
        size="small"
        :loading="loading"
        :disabled="question.trim().length < 3 || loading || (!!failure && !canRetryTerminalAi(failure))"
        @click="submit"
      >
        {{ t(failure && canRetryTerminalAi(failure) ? 'terminal.ai.retry' : 'terminal.ai.quick.ask') }}
      </NButton>
    </div>
    <NButton
      v-if="loading"
      size="small"
      @click="invalidate()"
    >
      {{ t('terminal.ai.cancel') }}
    </NButton>
    <NAlert
      v-if="error"
      type="error"
      role="alert"
    >
      {{ error }}
    </NAlert>
    <div
      v-if="result"
      aria-live="polite"
    >
      <div
        id="terminal-ai-options"
        role="listbox"
        :aria-label="t('terminal.ai.quick.title')"
      >
        <button
          v-for="(item, index) in choices"
          :id="'terminal-ai-option-' + index"
          :key="item.content"
          type="button"
          role="option"
          :aria-selected="index === selected"
          data-testid="terminal-ai-command-choice"
          class="terminal-command-choice"
          :class="{ 'is-selected': index === selected }"
          @mousedown.prevent
          @click="choose(index)"
        >
          <code class="block whitespace-pre-wrap break-all">{{ item.content }}</code>
          <span class="block mt-1 text-xs">{{ item.explanation }}</span>
        </button>
      </div>
      <NAlert
        v-if="!choices.length"
        type="warning"
      >
        <p data-testid="terminal-ai-rejection">
          {{ t('terminal.ai.quick.rejection.' + terminalAiRejectionReason(result)) }}
        </p>
        <pre
          v-if="result.content"
          data-testid="terminal-ai-rejected-content"
          class="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all text-xs"
        >{{ result.content }}</pre>
        <p
          v-if="result.explanation"
          class="mt-2 text-xs"
        >
          {{ result.explanation }}
        </p>
      </NAlert>
    </div>
    <p class="text-xs">
      {{ t('terminal.ai.quick.enterHint') }}
    </p>
  </section>
</template>

<style scoped>
.terminal-command-suggestion {position:fixed;z-index:85;max-height:calc(100vh - 16px);overflow:auto;display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--na-border-strong);border-radius:6px;background:var(--na-surface);color:var(--na-text-strong);box-shadow:0 8px 28px #0003}
.terminal-command-choice {width:100%;text-align:left;padding:10px;border-radius:4px;border:1px solid var(--na-border-strong);background:var(--na-surface-soft);margin-top:4px}
.terminal-command-choice.is-selected {border-color:#10b981;background:var(--na-surface)}
.terminal-command-choice:focus-visible {outline:2px solid #10b981;outline-offset:2px}
</style>
