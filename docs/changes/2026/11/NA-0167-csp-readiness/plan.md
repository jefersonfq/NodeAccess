---
change_id: NA-0167
title: Validar prontidão do editor no ensaio CSP
type: test
status: in-development
created_at: 2026-11-04T18:28:36-03:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: ae062494453585d5fec49da60786fb62257a6490
branch: test/NA-0167-20261104-csp-readiness
owner: NodeAccess
planner: Codex
risk: medium
---

# NA-0167 — Prontidão e diagnóstico do ensaio CSP

## Contexto e situação anterior
CI do candidato ae0624944 falhou no CSP: primeiro timeout45000 esperando editor; repetição chegou a TypeError window.editor.getValue is not a function. A condição aceita erro de carga e continua; elemento id=editor pode aparecer como propriedade global antes da instância. Scanner local do candidato concluiu posteriormente com exit0 conforme orquestração; CSP hospedado permanece reprovado, portanto o pipeline não está aprovado.

## Problema e objetivo
Rejeitar erro de carga explicitamente, evitar confusão com elemento DOM e preservar diagnóstico seguro para investigar a dependência de carregamento.

## Escopo
Menor correção no harness CSP e testes positivos/negativos; repetir laboratório real HTTP/HTTPS com Nginx e Monaco, sem enfraquecer CSP, mocks favoráveis, timeout ampliado ou novas dependências. Nenhuma alteração de produto sem causa demonstrada e decisão registrada.

## Critérios de aceitação
- [ ] Erro de carga nunca vira editor pronto.
- [ ] Diagnósticos preservados sem dados sensíveis.
- [ ] Editor real, worker, WebSocket e bloqueios inline/eval validados.
- [ ] Revisão independente e CI do candidato final.

## Estratégia técnica
Investigar causa antes de alterar. Harness local com fixtures próprias; não reutilizar serviços reais. Extrair helper de estado/validação e diagnóstico categórico, cobri-lo com contratos Node e negativo Chromium opt-in; incluir os novos arquivos no filtro de caminhos do workflow CSP. Referências de globals não devem confundir named properties do DOM com instância.

## Riscos e mitigações
Falha de CDN é hipótese, não conclusão dos logs atuais. Não contornar política nem substituir Monaco real por mock. Se dependência externa bloquear, declarar limite e manter gate reprovado.

## Matriz de testes e evidências
Planned: casos carga pronta/erro/timeout, DOM id collision, laboratório Chromium real HTTP/HTTPS e scripts de regressão relevantes.

## Baseline
ae062494453585d5fec49da60786fb62257a6490: CSP reprovado nas duas tentativas, diagnósticos privados preservados; demais resultados não transferem aprovação ao patch.

## Rollback ou recuperação
Reverter patch específico; preservar branch e evidências. Limpar somente recursos descartáveis da frente.

## Aprovação
Decisão: GO_WITH_RISKS. Correção necessária para concluir os checks autorizados; sem aceite de risco nem alteração de produto/CSP.
