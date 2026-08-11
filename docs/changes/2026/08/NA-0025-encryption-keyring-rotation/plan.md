---
change_id: NA-0025
title: Keyring compatível com rotação da chave de criptografia
type: security
status: passed
created_at: 2026-08-11T17:22:00-03:00
base_branch: master
base_sha: 2d34c81b4b1bef90297a3593bb2392271ec19e73
branch: security/NA-0025-20260811-encryption-keyring-rotation
owner: codex
planner: codex
risk: high
issue: null
---

# NA-0025 — Keyring compatível com rotação da chave de criptografia

## Contexto e situação anterior

Uma única `PEM_ENCRYPTION_KEY` cifrava todos os segredos persistidos. Substituí-la
tornava imediatamente ilegíveis dados existentes em múltiplos domínios.

## Problema e objetivo

Permitir rollout de uma nova chave sem indisponibilidade: novas escritas usam a
primária e leituras aceitam somente chaves anteriores explicitamente declaradas.

## Escopo

- Included: keyring AES-GCM, até cinco chaves anteriores, validação de ambiente,
  compatibilidade da API de crypto, testes e runbook.
- Excluded: recifrar o banco, remover automaticamente chaves antigas, armazenar
  chaves no banco/ConfigMap ou alterar o formato dos payloads.

## Critérios de aceitação

- [x] Novos payloads usam exclusivamente a chave primária.
- [x] Payload legado pode ser lido por chave anterior configurada.
- [x] Chave ausente ou payload inválido falha de forma fechada.
- [x] Consumidores existentes mantêm a mesma API.
- [x] Runbook impede remoção precoce e cobre HA/rollback.
- [x] Testes e typecheck passam.

## Estratégia técnica

Encapsular AES-256-GCM em `EncryptionKeyring`, mantendo funções `encrypt` e
`decrypt` como fachada. Autenticação GCM determina qual chave válida abriu o
payload, sem persistir identificador novo ou migration.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Stop criterion |
|---|---|---|---|
| Perda de dados | Crítico | chave anterior explícita + runbook | dado legado ilegível no rollout |
| Escrita com chave antiga | Alto | somente índice primário cifra | payload novo abre pela antiga |
| DoS por keyring enorme | Médio | máximo de cinco anteriores | lista ilimitada aceita |
| Chave em ConfigMap/log | Crítico | somente Secret/env, sem logs | valor aparece em manifesto/output |

## Matriz de testes e evidências

| Critério/risco | Teste | Evidência |
|---|---|---|
| Primária | crypto unitário | round-trip e antiga rejeitada |
| Legado | crypto unitário | payload antigo aberto após rotação |
| Fail-closed | crypto unitário | chave/payload inválidos rejeitados |
| Regressão | PEM, OIDC, 1Password e host-link | consumidores preservados |
| Tipos | backend typecheck | fachada compatível |

## Baseline

Antes, a documentação instruía nunca trocar a chave porque o runtime conhecia
apenas um valor e não havia janela técnica de transição.

## Rollback ou recuperação

Restaurar a chave anterior como primária e manter a nova na lista anterior para
ler eventuais dados escritos durante o rollout. Não há migration.

## Aprovação

- Decisão: `GO_WITH_RISKS`
- Aprovado por: usuário
- Aprovado em: 2026-08-11T17:22:00-03:00
