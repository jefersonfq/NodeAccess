<script setup lang="ts">
import { computed } from 'vue'
import { NAlert } from 'naive-ui'
import type { AgentInfo } from '@/services/agent.service'
import { agentConnectionDiagnostic } from '@/services/agent-presentation.service'
const props = defineProps<{ agent: AgentInfo }>()
const diagnostic = computed(() => agentConnectionDiagnostic(props.agent))
</script>
<template>
  <NAlert
    v-if="diagnostic"
    type="warning"
    :show-icon="false"
    class="mb-3"
    data-testid="agent-connection-diagnostic"
  >
    <p class="font-medium">
      {{ diagnostic.message }}
    </p>
    <p class="mt-1">
      {{ diagnostic.action }}
    </p>
    <p class="mt-1 text-xs">
      Etapa: agente ↔ NodeAccess. A plataforma aguarda uma nova conexão do agente.
    </p>
    <p
      v-if="diagnostic.code"
      class="mt-1 text-xs"
    >
      Referência: {{ diagnostic.code }}
    </p>
  </NAlert>
  <p
    v-else
    class="mb-3 text-xs"
    data-testid="agent-connection-healthy"
  >
    Canal do agente disponível. Isso não recupera automaticamente sessões SSH interrompidas.
  </p>
</template>
