---
change_id: NA-0110
title: Testar contratos de acesso à rede
type: test
status: ready-for-tests
created_at: 2026-11-03T19:34:07+00:00
base_branch: chore/NA-0089-20261103-sonar-integration
base_sha: 4a77f7139600e70aa612e753418978d9b31b10ae
branch: test/NA-0110-20261103-network-contracts
owner: NodeAccess
planner: Codex
risk: medium
---

# NA-0110 — Contratos de acesso à rede

## Contexto e situação anterior

O módulo network-access/network-access.service.ts ainda tem 65 linhas e 27 funções descobertas no baseline, especialmente configuração, credenciais e autorização TACACS.

## Problema e objetivo

Exercitar contratos observáveis e reduzir lacunas sem modificar produto nem limiares.

## Escopo

Testes do serviço real; banco e repositórios de contexto/ACL/licença são fronteiras simuladas. Sem instalações/modelos/acesso remoto.

## Critérios de aceitação

- [x] Configurações e credenciais respeitam tenant e identidade.
- [x] ACL negada impede autenticação/autorização e eventos omitem credenciais.
- [x] Campos e limites são mapeados com assertivas de efeitos.
- [x] Suite, lint/typecheck e revisão independente registrados.

## Estratégia técnica

Serviço real com banco e ACL simulados; criptografia real. Assertivas sobre consultas parametrizadas e resultados; sem modelos/provedores externos.

## Riscos e mitigações

Os testes não comprovam aplicação das consultas no banco real. Validar filtros/argumentos e não substituir métodos do serviço.

## Matriz de testes e evidências

Ran: 27 contratos PASS; 85/85 linhas, 37/37 funções, 68/73 branches. Lint e typecheck backend PASS. Revisão independente PASS_WITH_WARNINGS (banco simulado não prova rollback, locks ou colisões reais).

## Baseline

SHA 4a77f7139600e70aa612e753418978d9b31b10ae; sem modificação de comportamento.

## Rollback ou recuperação

Reverter somente novo arquivo de teste; sem migração ou produção.

## Aprovação

Decisão: GO_WITH_RISKS. ampliação de testes necessária ao pedido das quatro pendências autorizado pelo usuário.
