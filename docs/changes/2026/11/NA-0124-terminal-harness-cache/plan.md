---
change_id: NA-0124
title: Sincronizar prova de invalidação SFTP do harness
type: fix
status: in_progress
created_at: 2026-11-03T18:15:40-03:00
base_branch: chore/NA-0093-20261103-sonar-final-validation
base_sha: 20b169ed488ad652adad101c5f41a6779ee1a447
branch: fix/NA-0124-20261103-terminal-harness-cache
owner: Codex
planner: Codex
risk: medium
issue: null
---

# NA-0124 — Invalidação SFTP no harness

## Contexto e situação anterior

Coleta integrada20b169ed4 falhou no teste de invalidação porque contava todos os paths. Tab anterior pode iniciar consulta assíncrona /var/log/anaconda após snapshot, acrescentando uma requisição não relacionada.

## Problema e objetivo

Aguardar conclusão observável da consulta anterior e exigir exatamente uma nova listagem do diretório /var após comando mutável. Não reduzir assert ou aumentar timeout.

## Escopo

Harness terminal, helper de asserção e testes negativos. Produto, transporte, limites e configuração de cobertura fora de escopo.

## Critérios de aceitação

- [x] Sequência anterior comprovada pelo protocolo simulado antes do snapshot.
- [x] Nenhuma invalidação e consulta duplicada do alvo reprovam; consulta de outro path não falseia resultado.
- [x] Harness browser real passa com evidências de geometria e cleanup.

## Estratégia técnica

Esperar registro da consulta específica pós-Tab. Comparar contagem por path com delta exatamente1, preservando reuso exclusivo do canal SFTP da sessão. Contratos Node simulam interleavings e regressão sem invalidação.

## Riscos e mitigações

Não esconder regressão real: negativo com path órfão adicional mas alvo sem nova listagem deve falhar. Browser usa backend/websocket simulados; não comprova SSH real.

## Matriz de testes e evidências

| Critério | Teste | Ambiente | Evidência | Obrigatório |
|---|---|---|---|---|
| Corrida e negativos | Node.test | Worktree | test-results.md | Sim |
| Terminal completo | Playwright | Vite isolado | test-results.md | Sim |

## Baseline

20b169ed488ad652adad101c5f41a6779ee1a447. Falha privada coverage/browser/terminal.log na integração, sem alteração produto.

## Rollback ou recuperação

Reverter helper/harness e encerrar apenas servidor de ensaio desta frente.

## Mudanças de escopo e decisões

Coordenação autorizou correção pontual do harness após reprodução integrada. Nenhum relaxamento de gate.

## Aprovação

- Decisão: GO_WITH_RISKS
- Aprovado por: usuário e coordenação
- Aprovado em: 2026-11-03
