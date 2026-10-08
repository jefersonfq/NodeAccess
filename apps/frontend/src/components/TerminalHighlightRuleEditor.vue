<script setup lang="ts">
import type { TerminalHighlightRule } from '@nodeaccess/shared'
import { computed, reactive } from 'vue'
import { NAlert, NButton, NCheckbox, NInput, NInputNumber, NSelect, NSwitch, NTag } from 'naive-ui'
import { compileHighlightRules, matchTerminalLine } from '@/terminal/terminal-highlighter'

const props = defineProps<{ modelValue: TerminalHighlightRule[]; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [rules: TerminalHighlightRule[]] }>()

const modeOptions = [{ label: 'Palavra ou texto', value: 'literal' }, { label: 'Curinga (* e ?)', value: 'wildcard' }, { label: 'Regex avançado', value: 'regex' }]
const colorOptions = [
  { label: 'Vermelho', value: 'red' }, { label: 'Amarelo', value: 'amber' }, { label: 'Laranja', value: 'orange' },
  { label: 'Verde', value: 'green' }, { label: 'Azul', value: 'blue' }, { label: 'Ciano', value: 'cyan' },
  { label: 'Roxo', value: 'purple' }, { label: 'Cinza', value: 'gray' },
]
const examples = reactive<Record<string, string>>({})
const starterRules = [
  { name: 'Erros', pattern: 'ERROR', foreground: 'red' },
  { name: 'Avisos', pattern: 'WARNING', foreground: 'amber' },
  { name: 'Crítico', pattern: 'CRITICAL', foreground: 'orange' },
  { name: 'Falha de autenticação', pattern: 'authentication failed', foreground: 'purple' },
] as const
const preview = computed(() => Object.fromEntries(props.modelValue.map((rule) => {
  const text = examples[rule.id] ?? `[serviço] ${rule.pattern} exemplo de saída`
  return [rule.id, { text, ranges: matchTerminalLine(text, compileHighlightRules([rule])) }]
})))
function segments(rule: TerminalHighlightRule) {
  const current = preview.value[rule.id]
  const result: Array<{ text: string; matched: boolean }> = []
  let cursor = 0
  for (const range of current.ranges) {
    if (range.x > cursor) result.push({ text: current.text.slice(cursor, range.x), matched: false })
    result.push({ text: current.text.slice(range.x, range.x + range.width), matched: true })
    cursor = range.x + range.width
  }
  if (cursor < current.text.length) result.push({ text: current.text.slice(cursor), matched: false })
  return result
}
function addStarter(starter: typeof starterRules[number]) {
  if (props.modelValue.length >= 40) return
  emit('update:modelValue', [...props.modelValue, { id: crypto.randomUUID(), mode: 'literal', caseSensitive: false, wholeWord: true, background: null, bold: true, enabled: true, priority: 50, ...starter }])
}

function update(index: number, patch: Partial<TerminalHighlightRule>) {
  emit('update:modelValue', props.modelValue.map((rule, current) => current === index ? { ...rule, ...patch } : rule))
}
function remove(index: number) { emit('update:modelValue', props.modelValue.filter((_, current) => current !== index)) }
function add() {
  if (props.modelValue.length >= 40) return
  emit('update:modelValue', [...props.modelValue, {
    id: crypto.randomUUID(), name: '', pattern: '', mode: 'literal', caseSensitive: false,
    wholeWord: true, foreground: 'amber', background: null, bold: true, enabled: true, priority: 50,
  }])
}
</script>

<template>
  <div class="space-y-3" data-terminal-highlight-rule-editor="true">
    <div class="flex flex-wrap items-center gap-2" aria-label="Sugestões de regras">
      <span class="text-xs text-gray-500">Começar com:</span>
      <NButton v-for="starter in starterRules" :key="starter.name" size="tiny" secondary :disabled="disabled || modelValue.length >= 40" @click="addStarter(starter)">{{ starter.name }}</NButton>
    </div>
    <div v-if="!modelValue.length" class="rounded-lg border border-dashed border-gray-700 p-6 text-center text-sm text-gray-400">
      Nenhuma regra configurada. O terminal não altera cores por padrão.
    </div>
    <div v-for="(rule, index) in modelValue" :key="rule.id" class="na-item rounded-xl border border-gray-800 p-4">
      <div class="flex flex-wrap items-center gap-3">
        <NSwitch :value="rule.enabled" :disabled="disabled" :aria-label="`Ativar ${rule.name || 'regra'}`" @update:value="(value) => update(index, { enabled: value })" />
        <NInput :value="rule.name" :disabled="disabled" placeholder="Nome da regra" class="min-w-[180px] flex-1" @update:value="(value) => update(index, { name: value })" />
        <NTag size="small" :type="rule.enabled ? 'success' : 'default'">{{ rule.enabled ? 'Ativa' : 'Inativa' }}</NTag>
        <NButton quaternary type="error" :disabled="disabled" @click="remove(index)">Remover</NButton>
      </div>
      <div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-12">
        <NSelect class="md:col-span-3" :value="rule.mode" :options="modeOptions" :disabled="disabled" @update:value="(value) => update(index, { mode: value })" />
        <NInput class="md:col-span-5" :value="rule.pattern" :disabled="disabled" :placeholder="rule.mode === 'regex' ? '\\bERROR\\b' : 'ERROR ou WARN*'" @update:value="(value) => update(index, { pattern: value })" />
        <NSelect class="md:col-span-2" :value="rule.foreground" :options="colorOptions" :disabled="disabled" @update:value="(value) => update(index, { foreground: value })" />
        <NInputNumber class="md:col-span-2" :value="rule.priority" :min="0" :max="100" :disabled="disabled" placeholder="Prioridade" @update:value="(value) => update(index, { priority: value ?? 50 })" />
      </div>
      <div class="mt-3 flex flex-wrap gap-5 text-sm text-gray-300">
        <NCheckbox :checked="rule.wholeWord" :disabled="disabled" @update:checked="(value) => update(index, { wholeWord: value })">Palavra inteira</NCheckbox>
        <NCheckbox :checked="rule.caseSensitive" :disabled="disabled" @update:checked="(value) => update(index, { caseSensitive: value })">Diferenciar maiúsculas</NCheckbox>
        <NCheckbox :checked="rule.bold" :disabled="disabled" @update:checked="(value) => update(index, { bold: value })">Negrito</NCheckbox>
      </div>
      <div class="mt-3 rounded-lg border border-gray-800 bg-black/30 p-3">
        <div class="mb-2 text-xs font-medium text-gray-400">Testar com uma linha de exemplo</div>
        <NInput :value="examples[rule.id] ?? `[serviço] ${rule.pattern} exemplo de saída`" :disabled="disabled" size="small" :input-props="{ 'aria-label': `Linha de teste para ${rule.name || 'regra'}` }" @update:value="(value) => examples[rule.id] = value" />
        <div class="mt-2 min-h-7 overflow-x-auto whitespace-pre rounded bg-black px-2 py-1 font-mono text-sm text-gray-300" aria-live="polite">
          <span v-for="(part, partIndex) in segments(rule)" :key="partIndex" :class="part.matched ? 'rounded bg-amber-400/20 font-bold text-amber-300' : ''">{{ part.text }}</span>
        </div>
        <NAlert v-if="rule.mode === 'regex' && /\.\*|\.\+/.test(rule.pattern)" class="mt-2" type="warning" :bordered="false">Expressões muito amplas podem destacar mais texto e consumir mais processamento.</NAlert>
        <div class="mt-1 text-xs text-gray-500">{{ preview[rule.id].ranges.length }} correspondência(s) nesta linha.</div>
      </div>
    </div>
    <NButton dashed block :disabled="disabled || modelValue.length >= 40" @click="add">Adicionar regra</NButton>
    <div class="text-xs text-gray-500">Máximo de 40 regras. Regex é validado antes de salvar e a prioridade vale dentro da mesma origem (direta, grupo ou pessoal).</div>
  </div>
</template>
