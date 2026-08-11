---
change_id: NA-0026
title: Primitiva segura de inspeção e recifragem
type: security
status: passed
created_at: 2026-08-11T18:10:00-03:00
base_branch: master
base_sha: c7b0ed5e0b243c707f3b474431aa4d9b8de67326
branch: security/NA-0026-20260811-encryption-rewrap-primitive
owner: codex
planner: codex
risk: high
issue: null
---

# NA-0026 — Primitiva segura de inspeção e recifragem

## Contexto e situação anterior

A NA-0025 permitiu ler dados com chaves anteriores, mas não havia uma operação
padronizada para identificar a origem e recifrar com segurança na primária.

## Problema e objetivo

Criar a base testável para inventário e recifragem futura, com dry-run real,
idempotência e sem expor valor ou fingerprint das chaves.

## Escopo

- Included: inspeção de origem, dry-run, rewrap para primária, resultado
  estruturado, fachada pública e testes.
- Excluded: consultar ou atualizar banco, escolher lotes, transações, UI e
  remover chaves anteriores.

## Critérios de aceitação

- [x] Inspeção diferencia primária/anterior sem retornar chave.
- [x] Dry-run informa mudança necessária e preserva bytes do payload.
- [x] Apply recifra legado com a primária e preserva plaintext.
- [x] Payload já primário é idempotente e não gera nova cifra.
- [x] Falhas de autenticação continuam fechadas.
- [x] Testes e typecheck passam.

## Estratégia técnica

Centralizar abertura autenticada em método privado que retorna plaintext e
posição interna da chave. Expor apenas origem categórica e posição ordinal da
chave anterior para diagnóstico, nunca material ou fingerprint criptográfico.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Stop criterion |
|---|---|---|---|
| Dry-run modificar payload | Crítico | retornar objeto original e teste de igualdade | bytes diferentes em dry-run |
| Recifragem repetida | Alto | no-op quando origem é primária | ciphertext primário muda |
| Exposição de chave | Crítico | apenas categoria/posição ordinal | material/fingerprint em resultado |
| Perda de plaintext | Crítico | round-trip e autenticação GCM | conteúdo diverge após rewrap |

## Matriz de testes e evidências

| Critério/risco | Teste | Evidência |
|---|---|---|
| Inspeção | crypto unitário | origem primária/anterior correta |
| Dry-run | crypto unitário | `wouldChange` sem mutação |
| Apply/idempotência | crypto unitário | recifra uma vez e preserva texto |
| Regressão | PEM, OIDC, 1Password, host-link | consumidores preservados |
| Tipos | backend typecheck | fachada pública válida |

## Baseline

Antes, cada futuro repositório teria de combinar `decrypt` e `encrypt` por
conta própria, sem saber se o payload já usava a primária.

## Rollback ou recuperação

Reverter o commit. Nenhum dado é atualizado por esta mudança e não há migration.

## Aprovação

- Decisão: `GO`
- Aprovado por: usuário
- Aprovado em: 2026-08-11T18:10:00-03:00
