# NA-0092 — Registro da implementação

## Pedido e objetivo

Fechar a pendência de scanner real automático em CI, mantendo revisão individual, cobertura e isolamento.

## Implementação

Base SHA `4a77f7139600e70aa612e753418978d9b31b10ae`. Frente limitada a workflow, scripts ci e documentação. Workflow e ferramentas implementados; ensaio real passou.

## Validação

Ran:61 testes Sonar PASS, YAML validado e ensaio real Docker com três análises PASS. Não houve execução no GitHub nem publicação nesta frente.

## Recuperação

Branch isolada, reversão por commit; contêineres descartáveis sem acesso ao serviço local9000.

## Pendências

Rotina completa do produto depende da integração NA-0090; ensaio Docker concluído e recursos removidos. Atualização de planilha e índice documental pela coordenação. Revisão independente e execução GitHub pendentes.

## Diário de interações

### 2026-11-03T16:00:00-03:00 — Desenho e autorização

Coordenação autorizou CI hospedado descartável, análise base/head e baseline versionado do candidato com digest/diff explícito. Confirmado escopo original do gate70/70/60, novo80 por diff e ausência de aprovação automática de findings. Pesquisa oficial registrada no relatório da frente; próximo passo é implementar e testar.

### 2026-11-03T16:10:00-03:00 — Checkpoint e testes ampliados

Workflow, bootstrap privado, comparação base/head e política implementados em checkpoint local. Executados54 testes Sonar (21 novos) com sucesso e governança PASS. Acrescentado teste de subprocesso scanner e identidade CE, também PASS. Medição Node/V8 preliminar das novas ferramentas:86,82%linhas/80,24%branches antes desse último teste, sem excluir fontes. Não equivale à cobertura integrada NA-0090. Espera PostgreSQL ajustada para TCP do servidor final após evidência da frente de restore. Ensaio Docker continua pendente de liberação do slot por NA-0091; nenhuma instância criada nesta frente. Coordenação solicitou iniciar testes NA-0095 durante a espera, mantendo prioridade de conclusão CI.

### 2026-11-03T16:30:23-03:00 — Ensaio real aprovado e limites de entrega

Após corrigir política de senha efêmera e ausência explícita do grupo Anyone, bootstrap privado e três análises reais passaram. Base/head identifica4linhas novas:100%coverage aprova e42,9%reprova, limite80 e ignoredConditions=false. Projeto/tokens/anon e cleanup confirmados.61 testes automatizados PASS; medição focal Node93,90%linhas/83,64%branches. Workflow YAML verificado. Evidência sanitizada em rehearsal.json. Não houve execução GitHub/publicação nem rotina completa do produto neste worktree, que não contém coletorNA-0090; integração e revisão independente permanecem necessárias.

### 2026-11-03T16:31:44-03:00 — Contrato final do coletor

Alinhado com NA-0090: falha de pipeline/error, newCoverage ausente/incoerente e fingerprint diferente interrompem antes do scanner. CI recalcula inventário/fingerprint com helpers do coletor. Falhas de thresholds com dados completos continuam permitindo diagnóstico Sonar, mantendo reprovação final.61 testes repetidos com PASS após esse endurecimento.

### 2026-11-03T16:36:12-03:00 — Revisão independente CI

Coordenação revisou workflow, orquestração, policy e servidor sem bloqueadores estruturais. Recomendou rejeitar também ausência de ignoredConditions; aplicado requisito booleano false explícito, mantendo condições vazias possíveis quando Gitdiff comprova ausência de linhas novas executáveis.19 testes policy/run PASS incluindo gateOK sem campo agora reprovado. Reprodução integrada da suíte permanece com a coordenação.

### 2026-11-03T16:39:15-03:00 — Estabilidade da revisão durante análise

Alinhado ao endurecimento NA-0090: HEAD, fingerprint e alterações rastreadas são rechecados após scanner e após export. Quatro cenários simulam alteração de fonte, novo commit, fingerprint diferente e mutação durante export; todos reprovam com cleanup.16 testes de orquestração PASS. Não alterada a configuração do scanner/gate nem o ensaio real já concluído.

### 2026-11-03T16:51:00-03:00 — Chromium no runner descartável

Alinhado com NA-0090: `npm run test:coverage -- --base SHA` passa a executar a fase browser obrigatória em Vite loopback efêmero, antes de consolidar V8. Workflow instala Chromium e dependências pelo CLI Playwright já fixado no package-lock, após npm ci; não usa pacote remoto implícito. Confirmado CLI com `install --dry-run chromium` em Node24 (PASS); não executada instalação de pacotes do sistema local nem GitHub. Execução dos harnesses e coleta real pertencem à validação integrada NA-0090. NODE_V8_COVERAGE não credita callbacks executados no navegador por page.evaluate. Documentação oficial consultada: https://playwright.dev/docs/ci e https://playwright.dev/docs/browsers. Próximo passo: reproduzir os dois harnesses no coletor e validar resultado integrado.
