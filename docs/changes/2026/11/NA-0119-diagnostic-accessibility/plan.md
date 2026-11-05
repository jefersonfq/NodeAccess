---
change_id: NA-0119
title: Rótulos reais e ações responsivas no diagnóstico
type: fix
status: in-development
created_at: 2026-11-03T17:52:30-03:00
base_branch: chore/NA-0093-20261103-sonar-integration
base_sha: fb2eb5c9ea0a9ed878c7b76d65ef7a39abcbd6dd
branch: fix/NA-0119-20261103-diagnostic-accessibility
owner: Codex
planner: Codex
risk: low
issue: null
---

# NA-0119 — Acessibilidade do diagnóstico

## Problema e escopo

Harness real NA0118 observou ID vazio/labels[] no input nativo da sessão e ações cortadas a390px. O id do componente Naive fica no wrapper. Defeito preexistente observado; não atribuído ao lote44 Web:S6853 NA0087, pois DiagnosticRunDetail não está nesse lote.

Corrigir somente três NInput e o NSelect de comparação, usando API instalada input-props/ARIA; CSS local mínimo para header/reportactions. Auditar os44 rótulos remediados com Naive real e identificar mesma falha sem ampliar outros fluxos. Não mudar negócio, endpoints ou layout global.

## Critérios e validação

Labels associados ao elemento nativo, nome acessível e foco por clique/teclado. Nenhum botão visível de header/reportactions ultrapassa viewport390/desktop; fluxo, carregamento/erro/sucesso permanecem. Prova before/after com componentes/tela reais e prints, lint/typecheck e regressões pertinentes. Réplicas HTML não comprovam associação NInput; auditoria deve preservar rótulo/controle e API real.

## Aprovação e recuperação

GO_WITH_RISKS: root autorizou correção mínima na branch isolada, com skill frontend-full-cycle-agent modo Implementer e revisão UX. Reverter commit restaura somente ajustes desta frente. Manual consultado: DiagnosticRunDetail não consta no manifest do manual piloto; sem alteração de procedimento. Revisão independente frontend ao liberar ensaio CI. Nenhuma publicação/merge autorizada nesta frente.
