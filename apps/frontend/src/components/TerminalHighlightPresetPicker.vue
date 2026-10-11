<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton } from 'naive-ui'
import { createHighlightPreset, highlightPresets } from '@/services/terminal-highlight-presets'
import { compileHighlightRules, matchTerminalLine } from '@/terminal/terminal-highlighter'
const props = defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ choose: [id: string] }>()
const selected = ref(highlightPresets[0].id)
const preset = computed(() => highlightPresets.find(item => item.id === selected.value)!)
const preview = computed(() => {
  const draft = createHighlightPreset(selected.value)
  const compiled = compileHighlightRules(draft.rules)
  return preset.value.rules.map(({ sample }) => {
    const ranges = matchTerminalLine(sample, compiled).sort((a, b) => a.x - b.x)
    const parts: Array<{ text: string; color?: string; bold?: boolean }> = []
    let cursor = 0
    for (const range of ranges) {
      if (range.x > cursor) parts.push({ text: sample.slice(cursor, range.x) })
      parts.push({ text: sample.slice(range.x, range.x + range.width), color: range.foreground, bold: range.bold })
      cursor = range.x + range.width
    }
    if (cursor < sample.length) parts.push({ text: sample.slice(cursor) })
    return parts
  })
})
</script>
<template>
  <section
    class="mb-4 rounded-lg border border-gray-700 p-3"
    data-highlight-preset-picker
    aria-label="Biblioteca de modelos de destaques"
  >
    <p class="mb-3 text-sm">
      Escolha um ponto de partida. Você poderá editar as regras antes de salvar e atribuir.
    </p>
    <div
      class="flex flex-wrap gap-2"
      aria-label="Modelos disponíveis"
    >
      <NButton
        v-for="item in highlightPresets"
        :key="item.id"
        size="small"
        :disabled="props.disabled"
        :aria-pressed="selected === item.id"
        :type="selected === item.id ? 'primary' : 'default'"
        @click="selected = item.id"
      >
        {{ item.name }}
      </NButton>
    </div>
    <p
      class="my-3 text-sm"
      aria-live="polite"
    >
      {{ preset.description }} {{ preset.rules.length }} regras.
    </p>
    <div
      class="overflow-x-auto rounded p-3 font-mono text-xs"
      style="background:#111827;color:#e5e7eb"
      data-highlight-preset-preview
      aria-label="Prévia com saídas de exemplo"
    >
      <div
        v-for="(line, index) in preview"
        :key="index"
        class="whitespace-pre"
      >
        <span
          v-for="(part, j) in line"
          :key="j"
          :style="{ color: part.color, fontWeight: part.bold ? '700' : undefined }"
        >{{ part.text }}</span>
      </div>
    </div>
    <p class="my-2 text-xs">
      Exemplos demonstrativos. A prévia usa o mesmo processamento de destaques do terminal e não executa comandos.
    </p>
    <NButton
      :disabled="props.disabled"
      type="primary"
      @click="emit('choose', selected)"
    >
      Usar este modelo
    </NButton>
  </section>
</template>
