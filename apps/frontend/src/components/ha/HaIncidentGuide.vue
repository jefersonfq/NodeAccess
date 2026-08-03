<script setup lang="ts">
import { computed } from 'vue'
import { NTag } from 'naive-ui'
import type { HaNode, HaOperation } from '@/services/ha.service'

const props = defineProps<{
  nodes: HaNode[]
  activeOperations: HaOperation[]
  hasSplitBrain: boolean
  hasRoleMismatch: boolean
}>()

const mode = computed(() => {
  if (props.hasSplitBrain) return {
    type: 'error' as const,
    label: 'Ação imediata',
    title: 'Isole um dos nós antes de continuar',
    detail: 'Dois heartbeats recentes confirmaram a VIP. Não promova nem reconcilie papéis.',
    stage: 1,
  }
  if (props.activeOperations.length) return {
    type: 'info' as const,
    label: 'Operação acompanhada',
    title: 'Aguarde a etapa atual terminar',
    detail: props.activeOperations[0]?.currentStage || 'A operação está sendo processada pelos agentes.',
    stage: 3,
  }
  if (props.hasRoleMismatch) return {
    type: 'warning' as const,
    label: 'Troca concluída',
    title: 'Confirme a topologia e persista os novos papéis',
    detail: 'Faça isso somente com um PRIMARY na VIP e um STANDBY sem a VIP.',
    stage: 5,
  }
  const offline = props.nodes.find((node) => node.status === 'OFFLINE' || node.heartbeatState === 'STALE')
  if (offline) return {
    type: 'error' as const,
    label: 'Falha detectada',
    title: `Confirme o fencing de ${offline.name}`,
    detail: 'A promoção automática só avança quando o witness confirmar o isolamento por uma rede independente.',
    stage: 2,
  }
  return null
})

const stages = ['Detectar', 'Confirmar', 'Isolar', 'Promover', 'Reconciliar']
</script>

<template>
  <section v-if="mode" class="incident-guide" :data-type="mode.type" aria-live="polite">
    <div class="incident-copy">
      <NTag :type="mode.type" size="small">{{ mode.label }}</NTag>
      <div>
        <strong>{{ mode.title }}</strong>
        <p>{{ mode.detail }}</p>
      </div>
    </div>
    <ol aria-label="Progresso da resposta HA">
      <li v-for="(stage, index) in stages" :key="stage" :class="{ reached: index + 1 <= mode.stage }">
        <span>{{ index + 1 }}</span>
        <small>{{ stage }}</small>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.incident-guide {
  width: min(100%, 1080px);
  margin: 12px auto;
  padding: 15px 17px;
  border: 1px solid rgba(56, 189, 248, .25);
  border-left: 4px solid #38bdf8;
  border-radius: 9px;
  background: rgba(14, 116, 144, .08);
}
.incident-guide[data-type="warning"] { border-left-color: #f59e0b; background: rgba(180, 83, 9, .08); }
.incident-guide[data-type="error"] { border-left-color: #ef4444; background: rgba(185, 28, 28, .08); }
.incident-copy { display: flex; align-items: flex-start; gap: 12px; }
.incident-copy strong { display: block; color: #f8fafc; font-size: .875rem; }
.incident-copy p { margin: 4px 0 0; color: #cbd5e1; font-size: .75rem; line-height: 1.45; }
.incident-guide ol {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 5px;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
}
.incident-guide li { display: grid; grid-template-columns: 22px minmax(0, 1fr); align-items: center; gap: 6px; color: #64748b; }
.incident-guide li::after {
  content: '';
  grid-column: 1 / -1;
  height: 2px;
  border-radius: 2px;
  background: rgba(100, 116, 139, .25);
}
.incident-guide li.reached { color: #bae6fd; }
.incident-guide li.reached::after { background: #38bdf8; }
.incident-guide li span {
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border: 1px solid currentColor;
  border-radius: 50%;
  font-size: .625rem;
  font-weight: 700;
}
.incident-guide li small { font-size: .6875rem; font-weight: 650; }
@media (max-width: 600px) {
  .incident-copy { align-items: stretch; flex-direction: column; }
  .incident-guide ol { grid-template-columns: 1fr; }
  .incident-guide li { grid-template-columns: 22px 1fr; }
  .incident-guide li::after { display: none; }
}
</style>
