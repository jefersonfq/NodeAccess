<script setup lang="ts">
import { computed } from 'vue'
import { NTag } from 'naive-ui'
import HaHelpTooltip from './HaHelpTooltip.vue'
import type { HaNode } from '@/services/ha.service'

const props = defineProps<{ nodes: HaNode[]; accessEndpoint: string; transitionActive?: boolean }>()

const freshVipOwners = computed(() =>
  props.nodes.filter((node) => node.ownsVip && node.heartbeatState !== 'STALE'),
)
const vipOwner = computed(() =>
  freshVipOwners.value.length === 1 ? freshVipOwners.value[0] : null,
)
const duplicateVip = computed(() => freshVipOwners.value.length > 1)
const staleVipClaims = computed(() =>
  props.nodes.filter((node) => node.ownsVip && node.heartbeatState === 'STALE'),
)
const candidates = computed(() =>
  props.nodes.filter((node) => node.observedRole !== 'PRIMARY'),
)
const readyCandidates = computed(() =>
  candidates.value.filter((node) => node.promotionReady),
)
const vipAddress = computed(() =>
  vipOwner.value?.virtualIp ?? props.nodes.find((node) => node.virtualIp)?.virtualIp ?? props.accessEndpoint,
)

function readinessLabel(node: HaNode) {
  if (node.ownsVip && node.heartbeatState === 'STALE') return 'Última posse não confirmada'
  if (node.observedRole === 'PRIMARY' && node.ownsVip) return 'Ativo com a VIP'
  if (node.observedRole === 'PRIMARY') return 'PRIMARY sem a VIP'
  if (node.promotionReady) return 'Pronto para promoção'
  if (node.status === 'PENDING') return 'Aguardando telemetria'
  if (node.status === 'OFFLINE') return 'Sem heartbeat'
  return 'Promoção bloqueada'
}

function readinessType(node: HaNode): 'success' | 'warning' | 'error' | 'default' {
  if ((node.observedRole === 'PRIMARY' && node.ownsVip) || node.promotionReady) return 'success'
  if (node.status === 'PENDING') return 'default'
  if (node.status === 'DEGRADED') return 'warning'
  return 'error'
}
</script>

<template>
  <section class="topology" aria-labelledby="ha-topology-title">
    <div class="topology-heading">
      <div>
        <h2 id="ha-topology-title">Visão central da topologia</h2>
        <p>Veja por onde o acesso entra, qual nó está ativo e quais podem assumir.</p>
      </div>
      <NTag :type="duplicateVip ? 'error' : vipOwner ? 'success' : transitionActive ? 'info' : 'warning'" size="small">
        {{
          duplicateVip
            ? 'Conflito de VIP confirmado'
            : vipOwner
              ? 'Dono da VIP confirmado'
              : transitionActive
                ? 'VIP em transferência'
                : 'Dono da VIP não confirmado'
        }}
      </NTag>
    </div>

    <dl class="topology-summary">
      <div>
        <dt>
          Endereço virtual (VIP)
          <HaHelpTooltip
            label="VIP"
            text="VIP é o endereço único usado para acessar o NodeAccess. Ele acompanha o nó ativo durante uma troca controlada."
          />
        </dt>
        <dd>{{ vipAddress }}</dd>
        <span>
          {{
            duplicateVip
              ? `Reportada simultaneamente por ${freshVipOwners.map((node) => node.name).join(' e ')}`
              : vipOwner
                ? `Ativa em ${vipOwner.name}`
                : transitionActive
                  ? 'Transferência controlada em andamento'
                  : 'Aguardando telemetria do nó ativo'
          }}
        </span>
      </div>
      <div>
        <dt>Candidatos prontos</dt>
        <dd>{{ readyCandidates.length }} de {{ candidates.length }}</dd>
        <span>Standbys que passaram em todos os gates</span>
      </div>
      <div>
        <dt>Nós monitorados</dt>
        <dd>{{ nodes.length }}</dd>
        <span>Atualização automática a cada 30 segundos</span>
      </div>
    </dl>

    <div class="topology-diagram">
      <article class="vip-node" :aria-label="vipOwner ? `VIP ativa em ${vipOwner.name}` : 'Dono da VIP não confirmado'">
        <span class="node-kicker">Ponto de acesso</span>
        <strong>{{ vipAddress }}</strong>
        <span class="vip-owner">{{ vipOwner ? vipOwner.name : 'Proprietário não identificado' }}</span>
      </article>

      <div class="vertical-connector" aria-hidden="true" />

      <div class="node-list" aria-label="Nós da topologia">
        <article
          v-for="node in nodes"
          :key="node.id"
          class="topology-node"
          :class="{ owner: node.id === vipOwner?.id, ready: node.promotionReady }"
        >
          <div class="node-heading">
            <div>
              <span class="node-kicker">
                {{ node.observedRole === 'PRIMARY' ? 'Nó ativo' : 'Nó candidato' }}
              </span>
              <strong>{{ node.name }}</strong>
            </div>
            <NTag :type="readinessType(node)" size="small">{{ readinessLabel(node) }}</NTag>
          </div>

          <dl class="node-addresses">
            <div>
              <dt>IP administrativo</dt>
              <dd>{{ node.endpoint ?? 'Não informado' }}</dd>
            </div>
            <div>
              <dt>Papel observado</dt>
              <dd>{{ node.observedRole ?? 'Não informado' }}</dd>
            </div>
          </dl>

          <small v-if="node.id === vipOwner?.id">Recebe o tráfego do endereço virtual.</small>
          <small v-else-if="node.promotionReady">Pode assumir após validação e isolamento do nó anterior.</small>
          <small v-else>{{ node.blockers[0] ?? 'Verificações de promoção incompletas.' }}</small>
        </article>
      </div>
    </div>

    <p v-if="duplicateVip" class="topology-note topology-note--critical" role="alert">
      Dois heartbeats recentes confirmaram a mesma VIP. Isole um dos nós antes de continuar.
    </p>
    <p v-else-if="!vipOwner" class="topology-note" role="status">
      {{
        transitionActive
          ? 'A VIP está sendo direcionada. O painel aguardará o próximo heartbeat antes de confirmar o novo proprietário.'
          : 'Nenhum heartbeat recente confirmou simultaneamente o papel PRIMARY e a posse da VIP.'
      }}
      <template v-if="staleVipClaims.length">
        A última posse registrada por {{ staleVipClaims.map((node) => node.name).join(', ') }} está desatualizada.
      </template>
    </p>
  </section>
</template>

<style scoped>
.topology {
  width: min(100%, 1080px);
  margin-inline: auto;
  padding: 20px;
  border: 1px solid rgba(148, 163, 184, .2);
  border-radius: 12px;
  background: rgba(15, 23, 42, .52);
}
.topology-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.topology-heading h2 { margin: 0; color: #f8fafc; font-size: 1rem; }
.topology-heading p { margin: 4px 0 0; color: #9ca3af; font-size: .875rem; }
.topology-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  margin: 18px 0 0;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, .16);
  border-radius: 9px;
  background: rgba(148, 163, 184, .16);
}
.topology-summary > div { display: grid; gap: 3px; padding: 13px 14px; background: #111827; }
.topology-summary dt,
.node-kicker,
.node-addresses dt {
  color: #94a3b8;
  font-size: .6875rem;
  font-weight: 650;
  letter-spacing: .055em;
  text-transform: uppercase;
}
.topology-summary dd { margin: 0; color: #f8fafc; font-size: 1.05rem; font-weight: 650; }
.topology-summary span,
.topology-node small { color: #94a3b8; font-size: .75rem; line-height: 1.4; }
.topology-diagram {
  display: grid;
  justify-items: center;
  margin-top: 22px;
}
.vip-node {
  display: grid;
  min-width: min(100%, 280px);
  gap: 4px;
  padding: 14px 20px;
  text-align: center;
  border: 1px solid rgba(56, 189, 248, .52);
  border-radius: 10px;
  background: rgba(14, 116, 144, .1);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, .05);
}
.vip-node strong { color: #f8fafc; font: 650 1.05rem/1.3 ui-monospace, monospace; }
.vip-owner { color: #7dd3fc; font-size: .8125rem; }
.vertical-connector { width: 2px; height: 28px; background: linear-gradient(#38bdf8, rgba(148, 163, 184, .3)); }
.node-list {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 270px), 1fr));
  gap: 12px;
}
.topology-node {
  display: grid;
  gap: 12px;
  min-width: 0;
  padding: 14px;
  border: 1px solid rgba(148, 163, 184, .2);
  border-radius: 9px;
  background: #111827;
}
.topology-node.owner { border-color: rgba(56, 189, 248, .52); }
.topology-node.ready:not(.owner) { border-color: rgba(34, 197, 94, .42); }
.node-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.node-heading > div { display: grid; gap: 2px; min-width: 0; }
.node-heading strong { overflow-wrap: anywhere; color: #f8fafc; }
.node-addresses {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}
.node-addresses > div { min-width: 0; padding: 8px; border-radius: 6px; background: rgba(30, 41, 59, .65); }
.node-addresses dd { margin: 3px 0 0; overflow-wrap: anywhere; color: #e2e8f0; font: .75rem/1.35 ui-monospace, monospace; }
.topology-note { margin: 14px 0 0; color: #fbbf24; font-size: .8125rem; text-align: center; }
.topology-note--critical { color: #fca5a5; }
@media (max-width: 720px) {
  .topology { padding: 16px; }
  .topology-summary { grid-template-columns: 1fr; }
}
@media (max-width: 480px) {
  .topology-heading,
  .node-heading { align-items: stretch; flex-direction: column; }
  .node-addresses { grid-template-columns: 1fr; }
}
</style>
