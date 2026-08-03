<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NProgress, NTag } from 'naive-ui'
import type { HaNode } from '@/services/ha.service'

const props = defineProps<{
  licensed: boolean
  nodes: HaNode[]
}>()

const emit = defineEmits<{
  attach: []
  openOperations: []
}>()
const copied = ref(false)
const witnessInstallCommand = 'sudo bash scripts/deploy/install-ha-witness-authorizer.sh'

async function copyWitnessInstallCommand() {
  await navigator.clipboard.writeText(witnessInstallCommand)
  copied.value = true
  window.setTimeout(() => { copied.value = false }, 1800)
}

type SetupStep = {
  key: string
  title: string
  description: string
  done: boolean
  action?: string
}

const currentNodes = computed(() =>
  props.nodes.filter((node) => node.heartbeatState === 'CURRENT'),
)
const sharedVip = computed(() => {
  const values = new Set(props.nodes.map((node) => node.virtualIp).filter(Boolean))
  return props.nodes.length === 2 && values.size === 1
})
const primaryReady = computed(() =>
  props.nodes.filter((node) =>
    node.observedRole === 'PRIMARY' && node.ownsVip && node.heartbeatState === 'CURRENT'
  ).length === 1,
)
const standbyReady = computed(() =>
  props.nodes.filter((node) =>
    node.observedRole === 'STANDBY'
    && !node.ownsVip
    && node.heartbeatState === 'CURRENT'
    && node.inventory
  ).length === 1,
)
const witnessReady = computed(() =>
  props.nodes.length === 2
  && props.nodes.every((node) =>
    node.components.autoFailover?.status === 'ok'
    || node.components.autoFailover?.status === 'degraded'
  ),
)
const topologyReady = computed(() =>
  props.nodes.length === 2
  && currentNodes.value.length === 2
  && primaryReady.value
  && standbyReady.value
  && sharedVip.value
  && props.nodes.every((node) => node.desiredRole === node.observedRole)
)

const steps = computed<SetupStep[]>(() => [
  {
    key: 'license',
    title: 'Habilitar alta disponibilidade',
    description: 'Libera o cadastro e a supervisão dos dois nós.',
    done: props.licensed,
  },
  {
    key: 'network',
    title: 'Reservar IPs e a VIP',
    description: 'Use IP fixo em cada host e uma VIP livre, igual nos dois cadastros.',
    done: sharedVip.value,
    action: props.nodes.length < 2 ? 'Cadastrar nós' : undefined,
  },
  {
    key: 'primary',
    title: 'Confirmar o primeiro PRIMARY',
    description: 'O nó inicial deve responder ao heartbeat e possuir a VIP.',
    done: primaryReady.value,
  },
  {
    key: 'standby',
    title: 'Instalar agente e release no STANDBY',
    description: 'O inventário, a réplica e os serviços devem ser validados antes da promoção.',
    done: standbyReady.value,
    action: props.nodes.length < 2 ? 'Anexar standby' : undefined,
  },
  {
    key: 'witness',
    title: 'Preparar a terceira máquina witness',
    description: 'Instale a chave e valide a autorização assinada sem copiar a chave privada.',
    done: witnessReady.value,
  },
  {
    key: 'validation',
    title: 'Validar a topologia completa',
    description: 'Um PRIMARY com VIP, um STANDBY sem VIP e os dois heartbeats atuais.',
    done: topologyReady.value,
  },
])

const completed = computed(() => steps.value.filter((step) => step.done).length)
const percent = computed(() => Math.round((completed.value / steps.value.length) * 100))
const setupComplete = computed(() => completed.value === steps.value.length)
</script>

<template>
  <section class="setup-wizard" aria-labelledby="ha-setup-title">
    <header class="setup-header">
      <div>
        <span class="eyebrow">{{ setupComplete ? 'Implantação concluída' : 'Implantação guiada' }}</span>
        <h2 id="ha-setup-title">
          {{ setupComplete ? 'HA preparado para operação' : 'Prepare o HA em seis etapas' }}
        </h2>
        <p>
          {{
            setupComplete
              ? 'A topologia essencial está confirmada. Use o painel abaixo para acompanhar e operar.'
              : 'Conclua apenas a próxima pendência; detalhes técnicos permanecem disponíveis quando necessários.'
          }}
        </p>
      </div>
      <div class="setup-progress" :aria-label="`${completed} de ${steps.length} etapas concluídas`">
        <strong>{{ completed }}/{{ steps.length }}</strong>
        <NProgress type="line" :percentage="percent" :show-indicator="false" />
      </div>
    </header>

    <ol v-if="!setupComplete" class="setup-steps">
      <li
        v-for="(step, index) in steps"
        :key="step.key"
        :class="{ done: step.done, current: !step.done && steps.slice(0, index).every((item) => item.done) }"
      >
        <span class="step-number" aria-hidden="true">{{ step.done ? '✓' : index + 1 }}</span>
        <div>
          <div class="step-title">
            <strong>{{ step.title }}</strong>
            <NTag :type="step.done ? 'success' : 'default'" size="small">
              {{ step.done ? 'Concluído' : 'Pendente' }}
            </NTag>
          </div>
          <p>{{ step.description }}</p>
          <NButton
            v-if="step.action && !step.done"
            size="small"
            type="primary"
            @click="emit('attach')"
          >
            {{ step.action }}
          </NButton>
          <details v-if="step.key === 'witness' && !step.done" class="step-help">
            <summary>Como preparar o witness</summary>
            <p>Na terceira máquina, fora dos dois nós, execute uma única vez:</p>
            <code>{{ witnessInstallCommand }}</code>
            <NButton size="tiny" secondary @click="copyWitnessInstallCommand">
              {{ copied ? 'Copiado' : 'Copiar comando' }}
            </NButton>
            <small>
              Depois copie somente <code>witness-public.pem</code> para os dois nós. A chave privada nunca sai do witness.
            </small>
          </details>
        </div>
      </li>
    </ol>

    <footer class="setup-footer">
      <span>
        {{
          setupComplete
            ? 'A configuração avançada continua disponível para manutenção.'
            : 'O assistente usa a telemetria real dos agentes; etapas não são marcadas manualmente.'
        }}
      </span>
      <NButton v-if="setupComplete" size="small" secondary @click="emit('openOperations')">
        Ir para operação
      </NButton>
    </footer>
  </section>
</template>

<style scoped>
.setup-wizard {
  width: min(100%, 1080px);
  margin: 0 auto 14px;
  overflow: hidden;
  border: 1px solid rgba(56, 189, 248, .24);
  border-radius: 12px;
  background: linear-gradient(145deg, rgba(14, 116, 144, .1), rgba(15, 23, 42, .65));
}
.setup-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 180px;
  gap: 24px;
  padding: 18px 20px;
  border-bottom: 1px solid rgba(148, 163, 184, .16);
}
.eyebrow {
  color: #7dd3fc;
  font-size: .6875rem;
  font-weight: 700;
  letter-spacing: .07em;
  text-transform: uppercase;
}
.setup-header h2 { margin: 5px 0 0; color: #f8fafc; font-size: 1.05rem; }
.setup-header p { margin: 5px 0 0; color: #a5b4c7; font-size: .8125rem; line-height: 1.5; }
.setup-progress { align-self: center; }
.setup-progress strong { display: block; margin-bottom: 6px; color: #e0f2fe; text-align: right; }
.setup-steps {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  margin: 0;
  padding: 1px;
  list-style: none;
  background: rgba(148, 163, 184, .12);
}
.setup-steps li {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 11px;
  padding: 14px 16px;
  background: rgba(15, 23, 42, .94);
}
.setup-steps li.current { box-shadow: inset 3px 0 #38bdf8; }
.step-number {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border: 1px solid rgba(148, 163, 184, .34);
  border-radius: 50%;
  color: #cbd5e1;
  font-size: .75rem;
  font-weight: 700;
}
.done .step-number { border-color: rgba(34, 197, 94, .44); color: #86efac; background: rgba(22, 163, 74, .12); }
.step-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.step-title strong { color: #e2e8f0; font-size: .8125rem; }
.setup-steps p { margin: 5px 0 9px; color: #94a3b8; font-size: .75rem; line-height: 1.45; }
.step-help { margin-top: 7px; color: #bae6fd; font-size: .75rem; }
.step-help summary { cursor: pointer; font-weight: 650; }
.step-help code {
  display: block;
  margin: 8px 0;
  padding: 8px;
  overflow-wrap: anywhere;
  border-radius: 6px;
  color: #e0f2fe;
  background: rgba(2, 6, 23, .72);
}
.step-help small { display: block; margin-top: 8px; color: #94a3b8; line-height: 1.45; }
.step-help small code { display: inline; margin: 0; padding: 0; background: transparent; }
.setup-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 11px 16px;
  color: #94a3b8;
  font-size: .75rem;
}
@media (max-width: 720px) {
  .setup-header { grid-template-columns: 1fr; gap: 12px; }
  .setup-progress strong { text-align: left; }
  .setup-steps { grid-template-columns: 1fr; }
}
@media (max-width: 480px) {
  .setup-header { padding: 15px; }
  .setup-footer { align-items: stretch; flex-direction: column; }
}
</style>
