---
change_id: NA-0143
title: Investigar assertion intermitente no harness frontend
type: fix
status: in-development
created_at: 2026-11-04T01:13:00+00:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: b568eccf0e2c8048842c8db830ec42639c59c287
branch: fix/NA-0143-20261103-frontend-harness-sync
owner: NodeAccess
planner: Codex
risk: low
---

# NA-0143 — Investigação de sincronização do harness frontend

## Contexto e situação anterior

CI b568: primeiro harness frontend exit1 semtimeout, localização ausente. Parser de stack corrigido separadamente em NA0144; não identifica retroativamente a assertion.

## Problema e objetivo

Localizar causa por observação privada de fases/assertions do código real, sem inferir problema apenas de suspeita.

## Escopo

Harness frontend, fixtures e testes somente se causa reproduzida. Consumers de diagnóstico pertencem à frente NA0144. Nenhum produto ou gate alterado.

## Critérios de aceitação

- [x] Registrar todos os controles e suas diferenças de preparação. Estratégia inicial de três controles foi encerrada por decisão da raiz após controle com coletor real; investigação.json preserva também tentativas inválidas.
- [x] Limite explícito: causa CI não identificada; controle real passou. Não tratar controles privados não equivalentes como reprodução causal.
- [x] Nenhuma correção aplicada, pois causa histórica não demonstrada; assertions/timeouts intactos.
- [x] Não houve patch funcional. Encerramento documental determinado pela raiz; próxima análise depende do CI com NA0144.

## Estratégia técnica

Registrar fase/controle no harness real em memória e estado relevante caso falhe. Não introduzir sleeps ou mudar asserts. Comparar resize/foco/eventos somente após evidência.

## Riscos e mitigações

Falha intermitente pode não reproduzir; controles locais não provam resolução do CI. Logs privados não serão publicados como raw; resumo não conterá segredos ou tokens.

## Matriz de testes e evidências

Executados controles privados com limitações de preparação documentadas e um controle usando o coletor real, frontend PASS44+10. Nenhum scanner ou cobertura global. Não houve patch funcional.

## Baseline

b568eccf0e2c8048842c8db830ec42639c59c287.

## Rollback ou recuperação

Nenhuma alteração de produto; remover instrumentação privada ao concluir.

## Aprovação

Decisão: GO_WITH_RISKS. Raiz autorizou investigação isolada; não relaxar assertions/gates.
