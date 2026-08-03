<script setup lang="ts">
import { NTag } from 'naive-ui'

const scenarios = [
  {
    kind: 'Degradação',
    tone: 'warning' as const,
    title: 'O nó ativo ainda responde',
    examples: 'Ex.: manutenção, disco perto do limite, latência alta ou componente degradado.',
    decision: 'Troca planejada e confirmada pelo operador.',
    flow: ['Executar preflight', 'Congelar escritas', 'Sincronizar estado final', 'Promover o standby', 'Mover a VIP'],
    safety: 'Se qualquer gate falhar, a troca é interrompida e o primário permanece conhecido.',
  },
  {
    kind: 'Falha ou queda',
    tone: 'error' as const,
    title: 'O nó ativo deixou de responder',
    examples: 'Ex.: VM desligada, host indisponível, API parada ou perda persistente de comunicação.',
    decision: 'Failover automático somente com confirmação externa.',
    flow: ['Falhas consecutivas', 'Health local saudável', 'Witness verifica por outra rede', 'Fencing desliga a origem', 'Evidência assinada e promoção'],
    safety: 'Sem witness, fencing ou candidato saudável, a promoção permanece bloqueada.',
  },
]

const examples = [
  {
    signal: 'API falhou uma vez',
    outcome: 'Aguardar',
    type: 'default' as const,
    reason: 'Uma amostra isolada não caracteriza queda.',
  },
  {
    signal: 'API falhou 6 ciclos; witness ainda alcança o primário',
    outcome: 'Bloquear',
    type: 'warning' as const,
    reason: 'Pode ser falha de rede apenas entre os nós.',
  },
  {
    signal: 'API falhou 6 ciclos; witness confirma falha e fencing',
    outcome: 'Promover',
    type: 'success' as const,
    reason: 'A origem foi desligada e há evidência assinada.',
  },
  {
    signal: 'Standby também está degradado',
    outcome: 'Bloquear',
    type: 'error' as const,
    reason: 'Um candidato sem health profundo não pode assumir.',
  },
]
</script>

<template>
  <section class="policy-guide" aria-labelledby="ha-failure-policy-title">
    <div class="policy-heading">
      <div>
        <h2 id="ha-failure-policy-title">Como o HA decide uma promoção</h2>
        <p>Degradação usa uma troca controlada; perda do serviço exige confirmação independente e fencing.</p>
      </div>
      <NTag type="info" size="small">Política single-writer</NTag>
    </div>

    <div class="scenario-grid">
      <article v-for="scenario in scenarios" :key="scenario.kind" class="scenario-card">
        <div class="scenario-title">
          <div>
            <NTag :type="scenario.tone" size="small">{{ scenario.kind }}</NTag>
            <h3>{{ scenario.title }}</h3>
          </div>
        </div>
        <p>{{ scenario.examples }}</p>
        <dl>
          <div>
            <dt>Decisão</dt>
            <dd>{{ scenario.decision }}</dd>
          </div>
          <div>
            <dt>Rail de segurança</dt>
            <dd>{{ scenario.safety }}</dd>
          </div>
        </dl>
        <ol class="scenario-flow" :aria-label="`Fluxo para ${scenario.kind.toLowerCase()}`">
          <li v-for="(step, index) in scenario.flow" :key="step">
            <span>{{ index + 1 }}</span>
            <strong>{{ step }}</strong>
          </li>
        </ol>
      </article>
    </div>

    <div class="example-table-wrap">
      <table class="example-table">
        <caption>Exemplos de decisão</caption>
        <thead>
          <tr>
            <th scope="col">Sinal observado</th>
            <th scope="col">Resultado</th>
            <th scope="col">Por quê</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="example in examples" :key="example.signal">
            <td>{{ example.signal }}</td>
            <td><NTag :type="example.type" size="small">{{ example.outcome }}</NTag></td>
            <td>{{ example.reason }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <aside class="policy-config" aria-label="Resumo de configuração da política">
      <strong>Onde configurar</strong>
      <p>
        Nos nós: <code>/etc/sysconfig/nodeaccess-ha-autofailover</code>.
        No terceiro host: configuração do serviço witness.
        Comece em <code>observe-only</code> e use <code>enforce</code> somente após um ensaio real de fencing e rejoin.
      </p>
    </aside>
  </section>
</template>

<style scoped>
.policy-guide {
  width: min(100%, 1080px);
  margin-inline: auto;
}
.policy-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.policy-heading h2 { margin: 0; color: #f8fafc; font-size: 1rem; }
.policy-heading p { margin: 4px 0 0; color: #9ca3af; font-size: .8125rem; line-height: 1.5; }
.scenario-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.scenario-card {
  min-width: 0;
  padding: 16px;
  border: 1px solid rgba(148, 163, 184, .18);
  border-radius: 10px;
  background: rgba(15, 23, 42, .48);
}
.scenario-title h3 { margin: 8px 0 0; color: #f8fafc; font-size: .9375rem; }
.scenario-card > p { color: #9ca3af; font-size: .8125rem; line-height: 1.5; }
.scenario-card dl { display: grid; gap: 8px; margin: 14px 0; }
.scenario-card dl > div { padding: 9px 10px; border-radius: 7px; background: rgba(30, 41, 59, .62); }
.scenario-card dt {
  color: #94a3b8;
  font-size: .6875rem;
  font-weight: 650;
  letter-spacing: .05em;
  text-transform: uppercase;
}
.scenario-card dd { margin: 3px 0 0; color: #e2e8f0; font-size: .8125rem; line-height: 1.4; }
.scenario-flow {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 5px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.scenario-flow li { display: grid; align-content: start; gap: 5px; min-width: 0; }
.scenario-flow span {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 50%;
  color: #bae6fd;
  background: rgba(14, 116, 144, .28);
  font-size: .6875rem;
  font-weight: 700;
}
.scenario-flow strong { color: #cbd5e1; font-size: .6875rem; line-height: 1.35; }
.example-table-wrap {
  margin-top: 12px;
  overflow-x: auto;
  border: 1px solid rgba(148, 163, 184, .18);
  border-radius: 9px;
}
.example-table { width: 100%; min-width: 620px; border-collapse: collapse; }
.example-table caption {
  padding: 12px 14px;
  color: #f8fafc;
  font-size: .875rem;
  font-weight: 650;
  text-align: left;
}
.example-table th,
.example-table td {
  padding: 10px 14px;
  border-top: 1px solid rgba(148, 163, 184, .14);
  color: #cbd5e1;
  font-size: .75rem;
  line-height: 1.4;
  text-align: left;
}
.example-table th { color: #94a3b8; font-weight: 650; }
.policy-config {
  margin-top: 12px;
  padding: 12px 14px;
  border-left: 3px solid #38bdf8;
  border-radius: 6px;
  background: rgba(14, 116, 144, .08);
}
.policy-config strong { color: #e0f2fe; font-size: .8125rem; }
.policy-config p { margin: 4px 0 0; color: #bae6fd; font-size: .75rem; line-height: 1.5; }
.policy-config code { color: #f8fafc; overflow-wrap: anywhere; }
@media (max-width: 760px) {
  .scenario-grid { grid-template-columns: 1fr; }
}
@media (max-width: 520px) {
  .policy-heading { align-items: stretch; flex-direction: column; }
  .scenario-flow { grid-template-columns: 1fr; gap: 8px; }
  .scenario-flow li { grid-template-columns: 22px 1fr; align-items: center; }
}
</style>
