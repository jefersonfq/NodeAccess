---
change_id: NA-0140
title: Sincronizar zoom e frame HTOP no harness terminal
type: fix
status: in-development
created_at: 2026-11-04T00:35:00+00:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: de7817938134c0c1e08e00833b671af937ad5864
branch: fix/NA-0140-20261103-terminal-zoom-sync
owner: NodeAccess
planner: Codex
risk: low
---

# NA-0140 — Sincronização observável do zoom terminal

## Contexto e situação anterior

CI de781793 falhou esperando header HTOP, após footer visível. Harness espera contagem histórica de resize após zoom, potencialmente aceitando dimensões anteriores ao fit.

## Problema e objetivo

Distinguir corrida do harness de produto; corrigir somente causa demonstrada, preservando checks de header/footer/geometria/PTY e deadlines.

## Escopo

Harness terminal, helper/contratos necessários e evidências. Sem produto inicialmente; mudanças resize/transporte exigiriam validação PTY real descartável adicional.

## Critérios de aceitação

- [x] Reprodução ou limite documentado com ordem observável de zoom/fit/frame.
- [x] Espera por resize novo/coerente, sem contagem histórica falsa nem sleeps arbitrários.
- [x] Contratos negativos e test:terminal-experience:web Chromium1248/UbuntuCPU2.
- [x] Revisão independente; nenhuma redução de asserts/timeouts.

## Estratégia técnica

Capturar baseline antes do gesto; observar dimensões renderizadas e mensagem de resize depois. Investigar frame ANSI com altura obsoleta usando xterm real, antes de tocar produto.

## Riscos e mitigações

CI intermitente pode não reproduzir espontaneamente; não afirmar causa histórica sem prova. Simulação deve preservar ordem causal possível e não alterar código produto.

## Matriz de testes e evidências

Planejado: reprodução dirigida, contratos de sincronização, harness completo Chromium1248/CPU2, lint e revisão.

## Baseline

de7817938134c0c1e08e00833b671af937ad5864. Runtime Node24.22.1, imagem Playwright Noble1248 fixada pela frente anterior.

## Rollback ou recuperação

Reverter frente isolada sem migração de produto.

## Aprovação

Decisão: GO_WITH_RISKS. Raiz autorizou investigação/correção mínima, preservando gates e sem editar integração.
