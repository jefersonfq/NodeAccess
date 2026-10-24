<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NModal, NTag } from 'naive-ui'
import type { McpCapabilityDefinition } from '@/services/mcp.service'

const props = defineProps<{
  tokenName: string
  permissions: string[]
  definitions: McpCapabilityDefinition[]
}>()
const open = ref(false)
const entries = computed(() => props.permissions.map(key => ({
  key,
  meta: props.definitions.find(item => item.key === key),
})))
const hasShell = computed(() => props.permissions.includes('open_interactive_ssh_session'))
const highRiskCount = computed(() => entries.value.filter(item =>
  item.key !== 'open_interactive_ssh_session' && item.meta?.risk === 'high',
).length)
const unknownCount = computed(() => entries.value.filter(item => !item.meta).length)
const countLabel = computed(() => props.permissions.length
  ? `${props.permissions.length} ${props.permissions.length === 1 ? 'permissão' : 'permissões'}`
  : 'Herdadas do ambiente')
const riskLabels = { low: 'Baixo', medium: 'Médio', high: 'Alto' }
</script>

<template>
  <div
    class="permission-summary"
    data-testid="mcp-permission-summary"
  >
    <span>{{ countLabel }}</span>
    <div
      v-if="hasShell || highRiskCount"
      class="sensitive-access"
    >
      <NTag
        v-if="hasShell"
        size="small"
        type="error"
      >
        Shell interativo
      </NTag>
      <NTag
        v-if="highRiskCount"
        size="small"
        type="error"
      >
        {{ highRiskCount }} de alto risco
      </NTag>
    </div>
    <span
      v-if="unknownCount"
      class="permission-note"
    >{{ unknownCount }} com risco não informado</span>
    <NButton
      text
      type="primary"
      size="small"
      :aria-label="`Ver permissões de ${tokenName}`"
      @click="open = true"
    >
      Ver detalhes
    </NButton>
    <NModal
      v-model:show="open"
      preset="card"
      :title="`Permissões de ${tokenName}`"
      class="permission-dialog"
      style="width: min(560px, calc(100vw - 32px))"
      data-testid="mcp-permission-details"
    >
      <p
        v-if="!permissions.length"
        class="inheritance-note"
      >
        Este token herda as permissões habilitadas no ambiente. Isso não significa
        ausência de acesso. O acesso efetivo também depende das políticas e do escopo do usuário.
      </p>
      <template v-else>
        <p class="permission-note">
          Permissões configuradas neste token: {{ permissions.length }}. O acesso efetivo também depende das políticas do ambiente.
        </p>
        <ul class="permission-list">
          <li
            v-for="entry in entries"
            :key="entry.key"
          >
            <strong>{{ entry.meta?.title ?? entry.key }}</strong>
            <span>Risco: {{ entry.meta ? riskLabels[entry.meta.risk] : 'Não informado' }}</span>
            <code v-if="entry.meta">{{ entry.key }}</code>
            <p>{{ entry.meta?.description ?? 'Metadados indisponíveis para esta permissão.' }}</p>
          </li>
        </ul>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.permission-summary { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.sensitive-access { display: flex; flex-wrap: wrap; gap: 4px; }
.permission-note { color: var(--na-text-muted); font-size: 12px; }
.permission-list { max-height: 55vh; overflow-y: auto; padding: 0 8px 0 0; list-style: none; }
.permission-list li { display: flex; flex-direction: column; gap: 4px; padding: 12px 0; overflow-wrap: anywhere; }
.permission-list p, .inheritance-note { margin: 0; }
.permission-list code { font-size: 12px; color: var(--na-text-muted); }
</style>
