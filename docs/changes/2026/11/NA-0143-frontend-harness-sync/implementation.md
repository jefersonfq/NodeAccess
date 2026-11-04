# NA-0143 — Registro da implementação

## Pedido e objetivo

Investigar falha frontend no CI b568, sem repetir até passar nem alterar assertions/gates por suposição.

## Implementação

Branch isolada `fix/NA-0143-20261103-frontend-harness-sync`, base `b568eccf0e2c8048842c8db830ec42639c59c287`. Plano antes de código. **Nenhuma fonte de produto, harness, helper, teste, timeout ou política foi alterada.** Este checkpoint contém apenas documentação de investigação.

Instrumentação privada em memória acrescentou observação de fase e estado DOM após falha, mantendo assertions originais. A frente NA0144 identificou separadamente que o parser não aceitava frame de AssertionError async terminado em `) {`; isso explica ausência de coordenadas, não qual assertion falhou historicamente.

## Validação

Ran: controles e resultados abaixo; todos os resultados foram preservados, inclusive controles inválidos. Horários exatos e escopos em investigation.json. Runtime Ubuntu Noble/Chromium1248/CPU2/Node24.22.1, rede desabilitada; sem scanner ou cobertura global.

1. Três tentativas de preparação encerraram antes de importar o harness por caminho incorreto do launcher privado. Nenhum browser/assertion executado; não são evidência funcional.
2. Três controles privados servindo index da aplicação falharam após Enter no indicador, observando aria-expanded=false quando esperado true. O coletor real serve HTML isolado, portanto essa preparação não era equivalente ao CI.
3. Três controles privados com HTML isolado também falharam no mesmo ponto. Revisão encontrou outra diferença concreta: launcher configura cacheDir customizado, mas o harness importa Vue/Naive por URLs fixas `/node_modules/.vite/deps`; além disso, faltava a etapa waitForBrowserModules do coletor real. Runtimes/dependências distintos são uma hipótese para esses resultados privados, não causalidade demonstrada. Não foram usados para justificar alteração de produto ou polling.
4. **Controle com collectBrowserCoverage real, sem reconstruir configuração/readiness/env: frontend PASS44labels+10controles nativos em16,123s.** Início01:16:00.663Z, fim01:16:16.786Z. O executor delegou somente frontend ao executeBrowserHarness original e interrompeu explicitamente antes de table com DIAGNOSTIC_FRONTEND_ONLY_STOP. O resumo externo permanece failed por essa parada intencional; não representa aprovação dos cinco harnesses nem cobertura completa. Fonte/harness intactos.

Logs privados: `/tmp/NA0143-control-{1,2,3}.log`, `/tmp/NA0143-observed-{1,2,3}.log`, `/tmp/NA0143-isolated-{1,2,3}.log`, `/tmp/NA0143-real-collector.log` e `coverage/browser/frontend.log`. Não publicados como raw. O resumo preserva somente campos sanitizados e hash da fonte.

Skipped: testes unitários novos, scanner, coverage global ou PTY, pois não houve patch funcional. Não há nova evidência de UX do produto nesta investigação.

## Recuperação

Checkpoint documental independente; nenhuma migração ou alteração executável a reverter. Servidores/containers dos ensaios encerrados; instrumentação privada não pertence ao repositório.

## Pendências

**Causa histórica do CI permanece não identificada.** Raiz determinou encerrar investigação local e aguardar próxima execução com diagnóstico NA0144 corrigido. Não introduzir espera/polling sem evidência causal. Índices, planilha e publicação coordenados pela raiz; não declarados concluídos aqui.

## Diário de interações

### 2026-11-04T01:13:00+00:00 — Investigação registrada

Reservada NA0143, preparado worktree e plano. Estratégia inicial de três controles fixos com observação privada; consumidores de diagnóstico pertencem à NA0144.

### 2026-11-04T01:17:18+00:00 — Limites reconhecidos e encerramento autorizado

Controles privados falharam em indicador, mas setup não equivalia ao coletor real. Controle com coletor verdadeiro passou e foi interrompido antes dos demais harnesses de forma explícita. Raiz autorizou checkpoint somente documental e determinou aguardar CI com parser corrigido. Nenhuma correção especulativa aplicada.
