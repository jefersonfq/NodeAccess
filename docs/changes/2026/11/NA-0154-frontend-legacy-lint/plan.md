---
change_id: NA-0154
title: Limpar lint legado das fontes de HA e autocomplete preservando comportamento
type: chore
status: draft
created_at: 2026-11-04T11:20:00-03:00
base_branch: fix/NA-0150-20261104-explicit-contracts
base_sha: 02e7521cbe69e72cb5c8c3f5f951dcdc6e1c5fec
branch: chore/NA-0154-20261104-frontend-legacy-lint
owner: equipe NodeAccess
planner: Codex
risk: medium
---

# NA-0154 — Lint legado HA e autocomplete

## Contexto e situação anterior
NA0152 muda seis ocorrências em três fontes, mas CI lint-changed encontra legado anterior. Comparação ESLint lintText base/atual comprovou multiset idêntico: nenhuma introdução pela correção. Usuário já autorizou saneamento legado em branches separadas; raiz pediu plano antes da edição e separação de features.

## Problema e objetivo
Zerar lint nas duas fontes antigas tocadas preservando emissão/semântica e sem supressões. Não mudar regras, thresholds, promoção HA/quorum ou transporte.

## Escopo
Apenas apps/frontend/src/views/admin/HighAvailabilityView.vue (47 erros551 warnings) e apps/frontend/src/services/terminal-path-autocomplete.service.ts (10 erros17 warnings). MCP já0/0. Teste antigo autocomplete tem9erros anteriores; novos contratos NA0152 serão movidos para arquivo próprio, mantendo testes legados intactos. Testes novos necessários às mudanças de handlers terão escopo próprio.

## Critérios de aceitação
- [x] Lint2fontes0/0 semdisables/waiver.
- [x] Semântica JS/AST preservada por comparação quando alterações forem layout/tipos; diferenças explícitas revisadas.
- [x] Handler async/void de HA, se necessário, possui contrato com eventos/serviço simulado; sem alteração de promoção/quorum.
- [x] Baseline/after testes autocomplete, typecheck e provas de fluxo; revisão independente.
- [x] NA0152 reaplicável como delta pequeno sobre cleanup, planos com base correta e evidências separadas.

## Estratégia técnica
Primeiro catalogar regras (lint-baseline.json), aplicar formatação automática apenas nos dois arquivos, inspecionar todas correções. Tipos de retorno/assertions redundantes ajustados pontualmente. Para handlers async, preferir wrapper com void preservando execução imediata e identidade de listener se existir; jamais alterar ordem/await/autorização para silenciar lint. Comparar scripts SFC por transpile e AST normalizada, estilos/template semânticos, e identificar toda diferença de runtime antes de continuar. Se houver alteração funcional necessária, parar e reportar para revisão antes de aceitar.

## Riscos e mitigações
HA é fluxo crítico: não exercer promoção real. Mocks devem manter argumentos/ordem e falhas significativas, sem afirmar infraestrutura real. Formatação Vue amplia diff/linhas de coverage; raiz medirá cobertura integrada mantendo denominadores. Parser const/assertions/types deve manter retorno; diferencial e suíte existente.

## Matriz de testes e evidências
Lint base/after porarquivo/regra; emissão JS/AST; autocomplete28baseline+contratos; typecheckfrontend; testes focais de handlers caso AST não idêntica. Capturas NA0152 antes/depois MCP permanecem atribuídas àquele delta, não provarão HA. Render mudou somente11espaços de borda documentados; AST restante eCSS iguais. Se template de HA mudar somentewhitespace, comparar AST; mudanças semânticas exigem browser direcionado. Scanner apenas raiz serialmente.

## Baseline
02e7521cbe69e72cb5c8c3f5f951dcdc6e1c5fec. Duas fontes57errors568warnings anteriores. Produto intacto nesta frente ao escrever plano; NA0152WIP preservado emworktree e /tmp/NA0152-feature-wip.patch.

## Rollback ou recuperação
Branch de cleanup separada; reversão própria sem dados/config. Reaplicar NA0152 após checkpoint, sem squash da distinção cleanup/features. Sem push/merge por agente.

## Mudanças de escopo e decisões
Raiz solicitou NA0154 para qualidade de CI semwaiver; aguardando GO do plano antes de editar. Planilha/status final consolidados pela raiz.

## Aprovação
Decisão: GO_WITH_RISKS — raiz confirmou avanço em2026-11-04, incluindo warnings, comparação JS/template e manutenção dos gates.
