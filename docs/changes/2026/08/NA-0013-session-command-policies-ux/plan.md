---
change_id: NA-0013
title: Simplificar configuração de políticas de comandos
type: feature
status: ready-for-tests
created_at: 2026-08-09T19:30:00-03:00
base_branch: feature/NA-0012-20260809-reports-navigation
base_sha: 8a823c93e14bd99c7fb65b4fbe9c964acff77e51
branch: feature/NA-0013-20260809-session-command-policies-ux
owner: codex
planner: codex
risk: medium
issue: null
---

# NA-0013 — UX de políticas de comandos

## Contexto e situação anterior

A tela `/admin/session-command-policies` concentra grupos, regras, vínculos, prioridades, ajuda e dois simuladores em um componente de 1.144 linhas. O fluxo exige compreender vários conceitos antes de identificar o próximo passo seguro.

## Problema e objetivo

Avaliar funcionamento, UX, design, responsividade e acessibilidade; criar cobertura automatizada dos fluxos principais; e reduzir a complexidade percebida com a menor reorganização compatível com a arquitetura atual.

## Escopo

- Included:
  - baseline Playwright de loading, vazio, erro, grupo selecionado, regras, vínculos e simulação;
  - auditoria de hierarquia visual, microcopy, CTA, estados e navegação por teclado;
  - reorganização localizada da tela e extração apenas quando reduzir responsabilidade real;
  - correção de vínculos duplicados, contrato de criação e proteção contra escopos redundantes;
  - migration de limpeza e unicidade para vínculos globais;
  - testes direcionados de comportamento e regressão responsiva.
- Excluded:
  - alterar regras de avaliação no backend;
  - mudar contratos da API, permissões ou auditoria;
  - criar um novo editor visual de regex.

## Critérios de aceitação

- [x] O objetivo e o próximo passo da tela ficam claros sem abrir ajuda.
- [x] Estados loading, vazio, erro, sucesso e grupo sem vínculo são compreensíveis.
- [x] Criar/editar grupo, adicionar regra e adicionar vínculo possuem ordem e CTAs previsíveis.
- [x] Simulação deixa claro se é local ou efetiva e não altera configuração.
- [x] Fluxo principal funciona por teclado e em 1024×768.
- [x] Testes Playwright e testes unitários/componentes relevantes cobrem os riscos encontrados.
- [x] Typecheck e `git diff --check` passam.

## Estratégia técnica

Primeiro registrar baseline real com APIs mockadas. Depois separar informação essencial de detalhes avançados, priorizar uma sequência grupo → regras → alcance → validação e preservar serviços/rotas existentes.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Stop criterion |
|---|---|---|---|
| Alterar semântica de segurança | Alto | nenhuma mudança no backend/contrato | resultado de avaliação divergente |
| Remover vínculo duplicado legítimo | Alto | deduplicar somente chaves semanticamente idênticas e preservar o menor ID | destinos diferentes afetados |
| Ocultar configuração crítica | Alto | resumo visível e detalhes acessíveis | ação padrão ou vínculo não identificável |
| Regressão em tela menor | Médio | Playwright em duas viewports | CTA ou tabela inacessível |
| Componente continuar excessivo | Médio | extração orientada a responsabilidade | nova lógica duplicada |

## Matriz de testes e evidências

| Critério/risco | Teste/harness | Ambiente | Evidência | Obrigatório |
|---|---|---|---|---|
| Fluxo e hierarquia | Playwright | Chromium | asserts/screenshots | sim |
| Estados vazio/erro/loading | Playwright mockado | Chromium | asserts | sim |
| Regras e simulador | teste direcionado | local | TAP/Vitest | sim |
| Tipos | typecheck frontend | local | saída | sim |
| Formatação | `git diff --check` | NA-0013 | saída | sim |

## Baseline

- Componente principal: 1.144 linhas.
- Nenhum teste frontend específico localizado para a tela.
- Lista, formulários e simuladores compartilham o mesmo componente e estado.

## Rollback ou recuperação

Reverter componentes/testes da NA-0013 e remover a coluna gerada `target_key`, restaurando o índice anterior caso necessário. A migration preserva o vínculo mais antigo e remove somente duplicatas semanticamente idênticas; registros removidos exigem restauração por backup, embora não alterem o efeito da política.

## Aprovação

- Decisão: `GO`
- Aprovado por: usuário
- Aprovado em: 2026-08-09T19:30:00-03:00
