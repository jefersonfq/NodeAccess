---
change_id: NA-0160
title: Preparar dono do webroot no ensaio TLS
type: test
status: ready-for-tests
created_at: 2026-11-04T14:17:16-03:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: 9a47efdba488adeff100ebf28dfb3f74798e1d4d
branch: test/NA-0160-20261104-tls-fixture-owner
owner: NodeAccess
planner: Codex
risk: medium
---

# NA-0160 — Webroot do laboratório TLS

## Contexto e situação anterior

O runner hospedado UID1001 cria o webroot da fixture; o worker root recusa dono diferente de root/UID próprio. Transferir somente o webroot descartável para root ao semear o desafio. A limpeza existente devolve a árvore descartável ao runner. Nenhuma permissão do produto foi relaxada.

## Problema e objetivo

Reproduzir e corrigir falha de preparação do laboratório em runner não privilegiado.

## Escopo

O runner hospedado UID1001 cria o webroot da fixture; o worker root recusa dono diferente de root/UID próprio. Transferir somente o webroot descartável para root ao semear o desafio. A limpeza existente devolve a árvore descartável ao runner. Nenhuma permissão do produto foi relaxada.

## Critérios de aceitação

- [x] A/B real com UID1001.
- [x] Preservar checks de segurança e sessão.
- [ ] Reexecutar CI integrado.

## Estratégia técnica

O runner hospedado UID1001 cria o webroot da fixture; o worker root recusa dono diferente de root/UID próprio. Transferir somente o webroot descartável para root ao semear o desafio. A limpeza existente devolve a árvore descartável ao runner. Nenhuma permissão do produto foi relaxada.

## Riscos e mitigações

Somente bind mount descartável criado pelo teste; cleanup existente. Não alterar volumes em uso.

## Matriz de testes e evidências

Ran: A/B real sob UID1001, Node24 e imagem na0149 com hashes de challenge-files/entrypoint idênticos. Base falha HTTP01_LOCAL_FAILED; candidato PASS com ACME/Certbot/Nginx/TLS/SSH PTY/WebSocket, uma conexão de cada, rollback e recuperação. Tentativa inicial com tag test antiga falhou antes do cenário (entrypoint ausente); não contada como validação.

## Baseline

9a47efdba488adeff100ebf28dfb3f74798e1d4d

## Rollback ou recuperação

Branch independente; reverter patch do harness.

## Aprovação

Correção necessária autorizada pela continuidade; homologação humana permanece pendente.
