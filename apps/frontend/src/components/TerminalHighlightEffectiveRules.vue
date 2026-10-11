<script setup lang="ts">
import { computed, ref } from 'vue'
import { NAlert, NEmpty, NInput, NTag } from 'naive-ui'
import type { EffectiveTerminalHighlights } from '@/services/terminal-highlight.service'
import { compileHighlightRules, matchTerminalLine } from '@/terminal/terminal-highlighter'

const props = defineProps<{ effective: EffectiveTerminalHighlights }>()
const sourceLabels = { direct: 'Atribuição direta', group: 'Por grupo', personal: 'Pessoal' }
const sample = ref('ERROR WARNING CRITICAL')
const preview = computed(() => {
  const ranges = props.effective.enabled ? matchTerminalLine(sample.value, compileHighlightRules(props.effective.rules)).sort((a, b) => a.x - b.x) : []
  const parts: Array<{ text: string; style?: Record<string, string | number | undefined> }> = []
  let cursor = 0
  for (const range of ranges) {
    if (range.x > cursor) parts.push({ text: sample.value.slice(cursor, range.x) })
    parts.push({ text: sample.value.slice(range.x, range.x + range.width), style: { color: range.foreground, backgroundColor: range.background, fontWeight: range.bold ? 700 : undefined } })
    cursor = range.x + range.width
  }
  parts.push({ text: sample.value.slice(cursor) })
  return parts
})
</script>

<template>
  <div
    class="min-w-0 space-y-4"
    data-highlight-effective="true"
  >
    <p class="text-sm text-gray-400">
      Em sobreposições: atribuição direta → grupo → pessoal. Dentro de cada origem, a maior prioridade vence. Em empate entre templates, vence o criado primeiro; no mesmo template, vale a ordem das regras.
    </p>
    <NAlert
      v-if="!effective.enabled"
      type="warning"
    >
      Destaques desativados pelo usuário. As regras abaixo estão configuradas, mas não são aplicadas.
    </NAlert>
    <section
      aria-label="Templates recebidos"
      class="space-y-2"
    >
      <h3 class="font-medium">
        Templates recebidos · somente leitura
      </h3>
      <p
        v-if="!effective.templates.length"
        class="text-sm text-gray-400"
      >
        Nenhum template atribuído.
      </p>
      <div
        v-for="template in effective.templates"
        :key="template.id"
        class="flex flex-wrap items-center gap-2 text-sm"
      >
        <span class="break-words">{{ template.name }}</span><NTag size="small">
          {{ sourceLabels[template.assignment] }}
        </NTag><span class="text-gray-500">Versão {{ template.version }}</span>
      </div>
    </section>
    <NAlert
      v-if="effective.omittedRules"
      type="warning"
    >
      {{ effective.omittedRules }} regras ativas ficaram fora do limite de {{ effective.limits.maxRules }}, seguindo a precedência. As regras salvas foram preservadas.
    </NAlert>
    <section
      aria-label="Ordem de aplicação"
      class="space-y-2"
    >
      <h3 class="font-medium">
        Ordem de aplicação · {{ effective.rules.length }} regras
      </h3>
      <NEmpty
        v-if="!effective.rules.length"
        description="Nenhuma regra ativa configurada."
      />
      <ol
        v-else
        class="space-y-2"
      >
        <li
          v-for="(rule, index) in effective.rules"
          :key="`${rule.templateId ?? 'personal'}:${rule.id}:${index}`"
          class="na-item rounded-lg border border-gray-800 p-3 text-sm"
          data-effective-rule="true"
        >
          <div class="flex flex-wrap items-center gap-2">
            <strong class="break-words">{{ index + 1 }}. {{ rule.name }}</strong><NTag size="small">
              {{ sourceLabels[rule.assignment] }}
            </NTag><span>Prioridade {{ rule.priority }}</span>
          </div>
          <div
            v-if="rule.templateName"
            class="mt-1 break-words text-gray-400"
          >
            {{ rule.templateName }}
          </div>
          <code class="mt-1 block break-all">{{ rule.pattern }}</code>
        </li>
      </ol>
    </section>
    <section
      aria-label="Simular destaques"
      class="space-y-2"
    >
      <label
        class="block font-medium"
        for="highlight-effective-sample"
      >Simular com uma linha de exemplo</label>
      <NInput
        v-model:value="sample"
        :maxlength="1000"
        :input-props="{ id: 'highlight-effective-sample' }"
      />
      <div
        class="min-h-8 whitespace-pre-wrap break-all rounded bg-black p-3 font-mono text-sm text-gray-300"
        aria-live="polite"
        data-effective-preview="true"
      >
        <span
          v-for="(part, index) in preview"
          :key="index"
          :style="part.style"
        >{{ part.text }}</span>
      </div>
      <p class="text-xs text-gray-400">
        A simulação usa apenas este texto; nenhum comando é enviado ao terminal. Regras sem conflito continuam sendo aplicadas.
      </p>
    </section>
  </div>
</template>
