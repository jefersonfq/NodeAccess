---
change_id: NA-0118
title: Validar fluxos reais de diagnóstico e dashboard em Chromium
type: test
status: in-development
created_at: 2026-11-03T20:43:31+00:00
base_branch: fix/NA-0119-20261103-diagnostic-accessibility
base_sha: b2eb4d937decc60e8343e0fe12caa57695156aa8
branch: test/NA-0118-20261103-browser-flow-contracts
owner: NodeAccess
planner: Codex
risk: medium
---

# NA-0118 — Contratos de navegação e diagnóstico

## Contexto e situação anterior

A limpeza de lint mantém comportamento e testes, mas o diff expõe lacunas de execução em DiagnosticRunDetailView e dashboard administrativo. A coleta Chromium NA-0117 precisa de fluxos reais para medir essas telas.

## Problema e objetivo

Validar estados, navegação e ações com interfaces reais e APIs simuladas, sem substituir componentes por réplicas nem alterar produto.

## Escopo

Harness Playwright, fixtures sintéticas, capturas e evidência. Sem API/SSH/Jira/modelo externo. Hook de cobertura somente opt-in em ambiente de teste.

## Critérios de aceitação

- [x] Diagnóstico: carregamento/erro, evidências, exportação, rastreabilidade, comparação, resumo e publicação simulada.
- [x] Dashboard: leitura de estatísticas, filtros/navegação e acesso por teclado.
- [x] Desktop/mobile sem overflow da página; fechamento previsível dos overlays e erros de página verificados.
- [x] Chromium real, documentação e revisão independente; limitações explícitas de APIs simuladas.

## Estratégia técnica

Reutilizar auth/mock das ferramentas existentes e seletores acessíveis da aplicação real. Interceptar API antes de navegar. Captura opt-in usa o hook de NA-0117; sem crédito para código não observado.

## Riscos e mitigações

Fixtures não provam backend nem segurança real de RBAC; validar solicitações e resultados visíveis, preservar testes backend. Usar loopback e dados sintéticos, cleanup em finally.

## Matriz de testes e evidências

Ran: Chromium real, seis grupos de cenários, foco dos quatro labels, sete ações dentro da largura mobile, quatro capturas revisadas; três contratos de schema e lint limpo. Revisão independente frontend PASS_WITH_WARNINGS; reforço contra lista vazia incorporado e Chromium reexecutado PASS.

## Baseline

SHA b2eb4d937decc60e8343e0fe12caa57695156aa8; produto inclui correção NA-0119 previamente validada; esta frente altera somente testes. Gap medido em LCOV: diagnóstico 279 e dashboard 210 unidades novas sem cobertura.

## Rollback ou recuperação

Reverter somente harness/fixtures/documentos. Sem dados ou migrações.

## Aprovação

Decisão: GO_WITH_RISKS. Ampliação de testes necessária aos gates autorizados; usuário autorizou saneamento e entrega fim a fim.
