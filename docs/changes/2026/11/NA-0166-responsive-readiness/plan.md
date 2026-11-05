---
change_id: NA-0166
title: Esperar layout responsivo antes da asserção de overflow
type: test
status: in-development
created_at: 2026-11-04T18:06:31-03:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: 630040e6c956c1d645a55c89a076edcdc3854445
branch: test/NA-0166-20261104-responsive-readiness
owner: NodeAccess
planner: Codex
risk: medium
---

# NA-0166 — Esperar layout responsivo antes da asserção de overflow

## Contexto e situação anterior
No candidato 630040, a execução hospedada falhou em `sonar-frontend-review.cjs` na asserção imediata de overflow mobile após resize; Vitest passou (3629 testes) e coletor Node encerrou sem erro, conforme diagnóstico da orquestração. O resultado hospedado falhou antes da análise Sonar e não é aprovação; a validação local de 630040 segue em execução pela orquestração. A base anterior 025e82863d0a2cff49b29896dc283c7efdd00548 teve 21 checks aprovados, conforme evidência da orquestração, sem transferir essa aprovação ao candidato 630040.

## Problema e objetivo
Esperar layout responsivo antes da asserção de overflow.

## Escopo
Corrigir sincronização do harness após resize, com espera da condição sem aumentar timeout existente. Provar com Chromium real que estado transitório resolve e overflow persistente reprova. Não alterar CSS/produto, esconder elementos, relaxar limites ou presumir causa exata do CI sem evidência. Diagnóstico hospedado630040 repetiu ASSERTION mobile overflow:140 após Vitest3629PASS e Nodeexit0.

## Critérios de aceitação
- [ ] Comportamento e evidências correspondem ao escopo.
- [ ] Casos negativos e regressões aplicáveis passam.
- [ ] Revisão independente e análise integrada no candidato final.

## Estratégia técnica
Adicionar um helper que espera o mesmo predicado `scrollWidth <= innerWidth` usando `waitForFunction`, herdando o timeout de 5000 ms já configurado no page. Manter a asserção final e todos os limites. Contratos Node cobrem predicado, timeout herdado e propagação de falhas sem retries; ensaio Chromium opt-in compara leitura imediata, resposta transitória após resize e overflow persistente. O inventário existente descobre helper e testes automaticamente. Integração na NA0093 e sincronização canônica pela orquestração.

## Riscos e mitigações
Não alterar nem mover dados de produção automaticamente. Não aceitar achados nem reduzir gates. Homologação humana permanece separada.

## Matriz de testes e evidências
Planned: testes focais, lint, governança e gates integrados; registrar comandos e resultados reais no diário.

## Baseline
630040e6c956c1d645a55c89a076edcdc3854445: falha hospedada mobile overflow relatada pela orquestração. Baseline sintética Chromium local confirmou que leitura imediata reprova largura 908 para viewport 390; isso não prova a causa exata da falha hospedada.

## Rollback ou recuperação
Branch preservada; reverter patch específico. Configurações operacionais anteriores serão preservadas como evidência privada.

## Aprovação
Decisão: GO_WITH_RISKS. Correção necessária para concluir o CI Sonar já autorizado; orquestração aprovou implementação isolada e testes focais, sem reexecutar pipeline nem fazer commit antes da revisão.
