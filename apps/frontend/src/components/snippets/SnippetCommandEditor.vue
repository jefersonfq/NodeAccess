<script setup lang="ts">
import { computed, ref } from 'vue'
import { NAlert, NButton, NInput, NSelect } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { deserializeSnippetCommand, executionActions, serializeSnippetForm, snippetFormError, type Snippet, type SnippetFormData } from '@/services/snippet.service'
import { macroTemplate } from '@/services/macro-templates'
import MacroStepEditor from './MacroStepEditor.vue'
const props = defineProps<{ modelValue: SnippetFormData; snippets?: Snippet[] }>()
const emit = defineEmits<{ 'update:modelValue': [SnippetFormData] }>()
const { t } = useI18n()
const selected = ref<number | null>(null)
const error = ref('')
const field = computed(() => props.modelValue.kind === 'COMMAND' ? 'command' : props.modelValue.kind === 'SEQUENCE' ? 'stepsText' : 'expectSendText')
const label = computed(() => props.modelValue.kind === 'COMMAND' ? 'snippets.commandPlaceholder' : props.modelValue.kind === 'SEQUENCE' ? 'snippets.sequenceLabel' : 'snippets.expectSendLabel')
function convert(): void {
  const invalid = snippetFormError({ ...props.modelValue, name: 'validation' })
  if (invalid) { error.value = t(invalid); return }
  emit('update:modelValue', { ...props.modelValue, kind: 'MACRO', actions: executionActions(deserializeSnippetCommand(serializeSnippetForm(props.modelValue).command)) })
  error.value = ''
}
function insert(): void {
  const snippet = props.snippets?.find(item => item.id === selected.value)
  if (!snippet) return
  const execution = deserializeSnippetCommand(snippet.command)
  if (execution.invalid) { error.value = t('snippets.macro.invalidSteps'); return }
  const actions = [...(props.modelValue.actions ?? []), ...executionActions(execution)]
  if (actions.length > 200) { error.value = t('snippets.macro.invalidSteps'); return }
  emit('update:modelValue', { ...props.modelValue, actions })
  selected.value = null
}
</script>
<template>
  <div class="space-y-2">
    <template v-if="modelValue.kind === 'MACRO'">
      <div
        v-if="!modelValue.actions?.length"
        class="flex flex-wrap gap-2"
        data-macro-templates
      >
        <NButton
          v-for="kind in (['diagnostic', 'prompt'] as const)"
          :key="kind"
          size="small"
          @click="emit('update:modelValue', { ...modelValue, name: modelValue.name || t('snippets.macro.template.' + kind), actions: macroTemplate(kind) })"
        >
          {{ t('snippets.macro.template.' + kind) }}
        </NButton>
        <p class="text-xs">
          {{ t('snippets.macro.templateHint') }}
        </p>
      </div>
      <MacroStepEditor
        :model-value="modelValue.actions ?? []"
        @update:model-value="actions => emit('update:modelValue', {...modelValue,actions})"
      />
      <details v-if="snippets?.length">
        <summary>{{ t('snippets.macro.insert') }}</summary>
        <NSelect
          v-model:value="selected"
          :aria-label="t('snippets.macro.choose')"
          :placeholder="t('snippets.macro.choose')"
          :options="snippets.map(item=>({value:item.id,label:item.name}))"
          filterable
        />
        <NButton
          :disabled="selected === null"
          @click="insert"
        >
          {{ t('snippets.macro.insert') }}
        </NButton>
      </details>
    </template>
    <template v-else>
      <label class="block text-xs text-gray-400">{{ t(label) }}
        <NInput
          :value="modelValue[field]"
          type="textarea"
          :input-props="{ 'aria-label': t(label) }"
          :placeholder="t(modelValue.kind === 'SEQUENCE' ? 'snippets.sequencePlaceholder' : modelValue.kind === 'EXPECT_SEND' ? 'snippets.expectSendPlaceholder' : label, { secretReference: '{{secret:alias}}' })"
          :autosize="{minRows:3,maxRows:10}"
          @update:value="value=>emit('update:modelValue',{...modelValue,[field]:value})"
        />
      </label>
      <NButton
        v-if="modelValue[field].trim()"
        size="small"
        @click="convert"
      >
        {{ t('snippets.macro.convert') }}
      </NButton>
    </template>
    <NAlert
      v-if="error"
      type="error"
    >
      {{ error }}
    </NAlert>
  </div>
</template>
