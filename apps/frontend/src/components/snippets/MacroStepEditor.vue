<script setup lang="ts">
import { computed, ref, toRaw } from 'vue'
import { NAlert, NButton, NCheckbox, NInput, NInputNumber, NSelect } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { MacroSchema, type MacroStep } from '@nodeaccess/shared'
import MacroWaitTest from './MacroWaitTest.vue'
import { maskSecretPlaceholders } from '@/services/snippet.service'
const props = defineProps<{ modelValue: MacroStep[] }>()
const emit = defineEmits<{ 'update:modelValue': [MacroStep[]] }>()
const { t } = useI18n()
const dragged = ref<number | null>(null)
const collapsed = ref(new Set<number>())
const identities = new WeakMap<MacroStep, number>()
let nextId = 0
function stepId(step: MacroStep): number {
  step = toRaw(step)
  if (!identities.has(step)) identities.set(step, ++nextId)
  return identities.get(step)!
}
function toggle(step: MacroStep): void {
  const id = stepId(step)
  if (collapsed.value.has(id)) collapsed.value.delete(id)
  else collapsed.value.add(id)
}
function summary(step: MacroStep): string {
  return maskSecretPlaceholders(step.type === 'send' ? step.text : step.type === 'wait' ? step.pattern : step.type === 'pause' ? step.durationMs + ' ms' : step.key).replace(/\s+/g, ' ').slice(0, 100)
}
const issues = computed(() => {
  const parsed = MacroSchema.safeParse({ version: 1, steps: props.modelValue })
  return parsed.success ? [] : parsed.error.issues.map(issue => typeof issue.path[1] === 'number' ? Number(issue.path[1]) : -1)
})
function update(index: number, patch: Partial<MacroStep>): void {
  const previous = props.modelValue[index]
  const next = { ...previous, ...patch } as MacroStep
  identities.set(next, stepId(previous))
  emit('update:modelValue', props.modelValue.map((step, i) => i === index ? next : step))
}
function add(type: MacroStep['type']): void {
  const step: MacroStep = type === 'send' ? { type, text: '', enter: true }
    : type === 'wait' ? { type, pattern: '', mode: 'literal', caseSensitive: false, timeoutMs: 15000 }
      : type === 'pause' ? { type, durationMs: 500 } : { type, key: 'ENTER' }
  emit('update:modelValue', [...props.modelValue, step])
}
function move(from: number, to: number): void {
  if (to < 0 || to >= props.modelValue.length || from === to) return
  const next = [...props.modelValue]
  next.splice(to, 0, next.splice(from, 1)[0])
  emit('update:modelValue', next)
}
</script>

<template>
  <section
    class="macro-editor"
    :aria-label="t('snippets.macro.steps')"
    data-macro-editor
  >
    <p class="text-xs text-gray-400">
      {{ t('snippets.macro.enterHint') }}
    </p>
    <div
      v-for="(step, index) in modelValue"
      :key="stepId(step)"
      class="macro-step"
      :data-macro-step="index"
      @dragover.prevent
      @drop.prevent="dragged !== null && move(dragged, index)"
    >
      <div class="flex flex-wrap items-center gap-2">
        <span
          draggable="true"
          @dragstart="dragged = index"
          @dragend="dragged = null"
        >{{ index + 1 }}. {{ t('snippets.macro.' + step.type) }}</span>
        <NButton
          size="tiny"
          :aria-expanded="!collapsed.has(stepId(step))"
          @click="toggle(step)"
        >
          {{ t(collapsed.has(stepId(step)) ? 'snippets.macro.expand' : 'snippets.macro.collapse') }}
        </NButton>
        <div class="ml-auto flex gap-1">
          <NButton
            size="tiny"
            :disabled="index === 0"
            :aria-label="t('snippets.macro.up')"
            @click="move(index, index - 1)"
          >
            ↑
          </NButton>
          <NButton
            size="tiny"
            :disabled="index === modelValue.length - 1"
            :aria-label="t('snippets.macro.down')"
            @click="move(index, index + 1)"
          >
            ↓
          </NButton>
          <NButton
            size="tiny"
            :disabled="modelValue.length >= 200"
            :aria-label="t('snippetsPage.duplicate')"
            @click="emit('update:modelValue', [...modelValue.slice(0,index+1), {...step}, ...modelValue.slice(index+1)])"
          >
            +
          </NButton>
          <NButton
            size="tiny"
            :aria-label="t('common.delete')"
            @click="emit('update:modelValue', modelValue.filter((_, i) => i !== index))"
          >
            ×
          </NButton>
        </div>
      </div>
      <p
        v-if="collapsed.has(stepId(step))"
        class="text-xs break-words"
        data-macro-summary
      >
        {{ summary(step) }}
      </p>
      <div
        v-show="!collapsed.has(stepId(step))"
        class="flex flex-col gap-2"
      >
        <template v-if="step.type === 'send'">
          <NInput
            :value="step.text"
            type="textarea"
            :input-props="{ 'aria-label': t('snippets.macro.send') }"
            :placeholder="t('snippets.commandPlaceholder')"
            @update:value="text => update(index, {text})"
          />
          <NCheckbox
            :checked="step.enter"
            @update:checked="enter => update(index, {enter})"
          >
            {{ t('snippets.macro.enter') }}
          </NCheckbox>
        </template>
        <template v-else-if="step.type === 'wait'">
          <NSelect
            :value="step.mode"
            :aria-label="t('snippets.macro.matchMode')"
            :options="[{label:t('snippets.macro.literal'),value:'literal'},{label:t('snippets.macro.regex'),value:'regex'}]"
            @update:value="mode => update(index, {mode})"
          />
          <NInput
            :value="step.pattern"
            :input-props="{ 'aria-label': t('snippets.macro.pattern') }"
            :placeholder="t('snippets.macro.pattern')"
            @update:value="pattern => update(index, {pattern})"
          />
          <NCheckbox
            :checked="step.caseSensitive"
            @update:checked="caseSensitive => update(index, {caseSensitive})"
          >
            {{ t('snippets.macro.caseSensitive') }}
          </NCheckbox>
          <label>{{ t('snippets.macro.timeoutMs') }}<NInputNumber
            :value="step.timeoutMs"
            :min="100"
            :max="300000"
            :input-props="{ 'aria-label': t('snippets.macro.timeoutMs') }"
            @update:value="value => update(index, {timeoutMs: value ?? 0})"
          /></label>
          <MacroWaitTest
            :step="step"
            :index="index"
          />
        </template>
        <label v-else-if="step.type === 'pause'">{{ t('snippets.macro.durationMs') }}
          <NInputNumber
            :value="step.durationMs"
            :min="0"
            :max="300000"
            :input-props="{ 'aria-label': t('snippets.macro.durationMs') }"
            @update:value="value => update(index,{durationMs: value ?? 0})"
          />
        </label>
        <NSelect
          v-else
          :value="step.key"
          :aria-label="t('snippets.macro.key')"
          :options="['ENTER','TAB','ESC'].map(value=>({label:value,value}))"
          @update:value="key => update(index,{key})"
        />
      </div>
      <NAlert
        v-if="issues.includes(index)"
        type="error"
      >
        {{ t('snippets.macro.invalidStep', {step:index+1}) }}
      </NAlert>
    </div>
    <div class="flex flex-wrap gap-2">
      <NButton
        v-for="type in (['send','wait','pause','key'] as const)"
        :key="type"
        size="small"
        :disabled="modelValue.length >= 200"
        @click="add(type)"
      >
        + {{ t('snippets.macro.' + type) }}
      </NButton>
    </div>
    <NAlert
      v-if="!modelValue.length"
      type="info"
    >
      {{ t('snippets.macro.addFirst') }}
    </NAlert>
  </section>
</template>
<style scoped>
.macro-editor{display:flex;flex-direction:column;gap:12px;min-width:0}
.macro-step{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--na-border);border-radius:8px;min-width:0}
</style>
