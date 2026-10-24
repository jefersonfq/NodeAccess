<script setup lang="ts">
import { computed, ref } from 'vue'
import { NCheckbox, NInput, NTag } from 'naive-ui'
import type { McpCapabilityDefinition } from '@/services/mcp.service'

const props = defineProps<{ modelValue: string[]; definitions: McpCapabilityDefinition[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()
const search = ref('')
const moduleLabels: Record<string, string> = {
  hosts: 'Hosts', host_dashboard: 'Painel de hosts', sessions: 'Sessões',
  session_audit: 'Auditoria de sessões', diagnostics: 'Diagnóstico', snippets: 'Snippets',
  ai_ssh_actions: 'Ações SSH', mcp_interactive_ssh: 'Shell interativo',
}
const riskLabels = { high: 'Alto risco', medium: 'Risco médio', low: 'Baixo risco' }
const selected = computed(() => new Set(props.modelValue))
const available = computed(() => props.definitions.filter((item) => item.kind !== 'prompt' || selected.value.has(item.key)))
const unknownSelected = computed(() => props.modelValue.filter((key) => !props.definitions.some((item) => item.key === key)))
const query = computed(() => search.value.trim().toLocaleLowerCase())
const visibleUnknown = computed(() => unknownSelected.value.filter((key) => !query.value || key.toLocaleLowerCase().includes(query.value) || 'permissões sem metadados'.includes(query.value)))
const groups = computed(() => {
  const modules = new Map<string, McpCapabilityDefinition[]>()
  for (const item of available.value) {
    const items = modules.get(item.module) ?? []
    items.push(item)
    modules.set(item.module, items)
  }
  return [...modules].map(([key, items]) => ({
    key,
    label: moduleLabels[key] ?? key,
    total: items.length,
    selected: items.filter((item) => selected.value.has(item.key)).length,
    items: items.filter((item) => !query.value || [item.title, item.key, item.description, moduleLabels[key] ?? key]
      .some((text) => text.toLocaleLowerCase().includes(query.value)))
      .sort((a, b) => a.title.localeCompare(b.title)),
  })).filter((group) => group.items.length).sort((a, b) => a.label.localeCompare(b.label))
})
const highRiskCount = computed(() => available.value.filter((item) => selected.value.has(item.key) && item.risk === 'high').length)

function toggle(key: string, checked: boolean): void {
  emit('update:modelValue', checked ? [...new Set([...props.modelValue, key])] : props.modelValue.filter((item) => item !== key))
}
</script>

<template>
  <div
    class="capability-selector"
    data-testid="mcp-capability-selector"
  >
    <div
      class="selection-status"
      aria-live="polite"
      data-testid="mcp-capability-selection"
    >
      <template v-if="modelValue.length">
        <strong>{{ modelValue.length }} {{ modelValue.length === 1 ? 'permissão selecionada' : 'permissões selecionadas' }}</strong>
        <span v-if="highRiskCount"> · {{ highRiskCount }} de alto risco</span>
        <span v-if="unknownSelected.length"> · {{ unknownSelected.length }} com risco não informado</span>
      </template>
      <template v-else>
        <strong>Herdadas do ambiente</strong>
        <span> — sem seleção explícita, o token usa as permissões permitidas pelo ambiente.</span>
      </template>
    </div>
    <NInput
      v-model:value="search"
      clearable
      placeholder="Buscar permissão ou módulo"
      aria-label="Buscar permissão ou módulo"
      data-testid="mcp-capability-search"
    />
    <p
      v-if="!available.length && !unknownSelected.length"
      class="empty"
    >
      Nenhuma permissão disponível para seleção.
    </p>
    <p
      v-else-if="!groups.length && !visibleUnknown.length"
      class="empty"
      role="status"
    >
      Nenhuma permissão encontrada. Altere a busca; sua seleção foi preservada.
    </p>
    <details
      v-for="group in groups"
      :key="group.key"
      class="module"
      :open="Boolean(query)"
      :data-testid="`mcp-capability-module-${group.key}`"
    >
      <summary>
        <strong>{{ group.label }}</strong>
        <span>{{ group.selected }} de {{ group.total }} selecionadas</span>
      </summary>
      <div class="module-options">
        <div
          v-for="capability in group.items"
          :key="capability.key"
          class="option"
          :data-testid="`mcp-capability-option-${capability.key}`"
        >
          <div class="option-heading">
            <NCheckbox
              :checked="selected.has(capability.key)"
              @update:checked="toggle(capability.key, $event)"
            >
              {{ capability.title }}
            </NCheckbox>
            <NTag
              size="small"
              :type="capability.risk === 'high' ? 'error' : capability.risk === 'medium' ? 'warning' : 'default'"
            >
              {{ riskLabels[capability.risk] }}
            </NTag>
          </div>
          <details class="description">
            <summary :aria-label="`Detalhes de ${capability.title}`">
              Detalhes
            </summary>
            <p>{{ capability.description }}</p>
            <code>{{ capability.key }}</code>
          </details>
        </div>
      </div>
    </details>
    <details
      v-if="visibleUnknown.length"
      class="module"
      :open="Boolean(query)"
      data-testid="mcp-capability-module-unknown"
    >
      <summary>
        <strong>Permissões sem metadados</strong>
        <span>{{ unknownSelected.length }} selecionadas</span>
      </summary>
      <p class="empty">
        Estas permissões estão no token, mas não constam no catálogo atual. O risco não foi informado; a seleção será preservada até você removê-las.
      </p>
      <div class="module-options">
        <div
          v-for="key in visibleUnknown"
          :key="key"
          class="option-heading"
          :data-testid="`mcp-capability-option-${key}`"
        >
          <NCheckbox
            :checked="true"
            @update:checked="toggle(key, $event)"
          >
            {{ key }}
          </NCheckbox>
          <NTag size="small">
            Risco não informado
          </NTag>
        </div>
      </div>
    </details>
  </div>
</template>

<style scoped>
.capability-selector { width: 100%; min-width: 0; display: grid; gap: 10px; }
.selection-status, .empty { font-size: 12px; color: var(--na-text-muted); }
.selection-status strong { color: var(--na-text); }
.module { border-bottom: 1px solid var(--na-border); }
.module > summary { padding: 10px 0; cursor: pointer; }
.module > summary span { margin-left: 8px; color: var(--na-text-muted); font-size: 12px; }
.module-options { display: grid; gap: 12px; padding: 4px 0 12px; }
.option-heading { display: flex; gap: 8px; justify-content: space-between; align-items: flex-start; }
.option-heading :deep(.n-checkbox) { min-width: 0; }
.option-heading :deep(.n-checkbox__label) { white-space: normal; overflow-wrap: anywhere; }
.option-heading :deep(.n-tag) { flex-shrink: 0; }
.description { margin: 2px 0 0 24px; font-size: 12px; color: var(--na-text-muted); }
.description summary { cursor: pointer; width: fit-content; }
.description p { margin: 6px 0; }
.description code { overflow-wrap: anywhere; }
summary:focus-visible { outline: 2px solid var(--na-primary-color, #18a058); outline-offset: 3px; }
@media (max-width: 480px) { .option-heading { flex-wrap: wrap; } .module > summary span { display: block; margin: 3px 0 0 16px; } }
</style>
