---
change_id: NA-0180
title: Verificação antecipada, diagnóstico seguro e terminal sem duplicação na cobertura
type: performance
status: ready-for-tests
created_at: 2026-11-16T13:40:32-03:00
base_branch: master
base_sha: 2b980b9950ecbdb6f675a84c004dfd31981f999c
branch: performance/NA-0180-20261116-validation-efficiency
owner: unassigned
planner: Codex
risk: medium
---

# NA-0180 — Validação sem retrabalho evitável

## Contexto e situação anterior
NA0179 precisou repetir gates por Chromium ausente, socket longo, cache sem permissão e diagnóstico Vitest incompleto. O terminal completo roda no harness do cofre e no coletor geral. Gate local aprovado levou17,8min; não prometer economia percentual sem medir.

## Problema e objetivo
Detectar ambiente inválido antes da cobertura, localizar falhas sem expor dados e executar a mesma regressão terminal apenas uma vez no gate orquestrado.

## Escopo
Preflight compartilhado dos executores de cobertura/Sonar; diagnósticos Vitest limitados e sanitizados; contrato de delegação do terminal somente no coletor orquestrado, preservando execução completa standalone. Documentação operacional e uma consolidação do roadmap.
Fora: produto, auth, SSH/RDP, thresholds, exclusões Sonar, novas dependências, reutilização de evidência entre SHAs, filtros amplos de CI, deploy ou ativação. Commit local e gate final autorizados posteriormente; sem push, PR ou deploy.

## Critérios de aceitação
- [x] Ambiente inválido falha antes dos coletores caros, com códigos e orientação sem segredos; temporários limpos.
- [x] Diagnóstico identifica arquivo/teste com limites, sem stack, valores esperados/recebidos, tokens ou dados dinâmicos.
- [x] Terminal completo executa uma vez no gate de cobertura; standalone continua completo; ausência/falha do coletor obrigatório reprova.
- [x] Cobertura, TLS e dez coletores continuam obrigatórios; nenhum reaproveitamento de artefatos antigos.
- [ ] Testes negativos/focais, ensaios reais dos dois modos, Sonar integral e revisão independente.

## Estratégia técnica
Separar probe rápido, formatação segura do diagnóstico e coordenação da execução; flags internas não representam aprovação. Identidade de execução e fontes verificadas pelo orquestrador, sem cache persistente de aprovações. Pré-validação não repara permissões nem inicia serviços do usuário.

## Riscos e mitigações
| Risco | Mitigação |
|---|---|
| Omitir terminal por flag | Exigir coletor terminal obrigatório da mesma execução; testes negativos |
| Vazamento em mensagens | Campos permitidos, limites e testes adversariais; logs brutos privados |
| Preflight divergir do executor | Mesmo navegador/runtime e serviços realmente usados; ensaio real |

## Matriz de testes e evidências
Baseline e testes Node dos coletores/diagnósticos; testes adversariais de ambiente e dados sensíveis; cofre standalone e coleta integrada; validate:sonar local obrigatório. Registros privados em .tmp/NA-0180; não medir economia de tokens por redução de bytes.

## Baseline
Base2b980b995 (master limpa/sincronizada). Testes focais run.test, ci-coverage-diagnostics.test e validate.test em .tmp/NA-0180/baseline.log. Gate anterior b825 validou árvore idêntica à base, não equivale a gate desta alteração.

## Rollback ou recuperação
Reverter apenas ferramentas/testes/documentação; nenhuma migração ou estado do produto. Não apagar artefatos anteriores.

## Mudanças de escopo e decisões
Remover apenas duplicação comprovada do terminal; seleção por impacto e cache de validações ficam fora desta fase.

## Aprovação
Usuário autorizou explicitamente as três melhorias. Revisão independente de viabilidade GO_WITH_RISKS: preservar coletor obrigatório e evidência da mesma execução. Implementação/revisão final ainda pendentes.

## Candidato para commit local
Usuário autorizou commit local e gate final, sem publicação, e pediu economia de créditos. Consolidação única, sem novos agentes, sem repetir focais aprovados. A rodada integral em WIP passou nos testes/análise/cobertura, mas a reconciliação corretamente recusou checkout não commitado. Gate obrigatório será repetido no SHA consolidado; evidência final em .tmp/NA-0180, sem commit recursivo de relatórios.
