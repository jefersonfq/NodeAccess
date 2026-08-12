---
change_id: NA-0029
title: Mapeamento seguro de grupos OIDC
type: feature
status: passed
created_at: 2026-08-11T20:15:00-03:00
base_branch: master
base_sha: 7d5fc2b8cd8be92ac3fe6fad4cc49fa5de2289b6
branch: feature/NA-0029-20260811-oidc-group-mapping
owner: codex
planner: codex
risk: high
issue: null
---

# NA-0029 — Mapeamento seguro de grupos OIDC

## Contexto e situação anterior

O login OIDC já recebia o claim `groups`, mas ele não participava do vínculo de
acesso e não havia uma aprovação administrativa entre grupos externos e internos.

## Problema e objetivo

Permitir que administradores mapeiem grupos emitidos pelo IdP para grupos do
NodeAccess sem substituir associações manuais nem elevar o papel global do usuário.

## Escopo

- CRUD administrativo e auditado dos mapeamentos por tenant;
- sincronização no login OIDC, incluindo usuários JIT;
- origem explícita das associações `MANUAL` e `OIDC`;
- remoção de acessos OIDC obsoletos ou vinculados a uma identidade revogada;
- seção administrativa expansível com estados de loading, vazio, erro e sucesso.

## Critérios de aceitação

- [x] Apenas ADMIN configura mapeamentos.
- [x] Grupo externo e grupo interno têm vínculo único no tenant.
- [x] Associações manuais nunca são removidas pela sincronização OIDC.
- [x] JIT continua criando usuário com papel `USER` e sem permissões globais.
- [x] Revogação da identidade remove apenas associações concedidas por ela.
- [x] Migration, testes direcionados, typechecks e builds passam.

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Escalada involuntária | mapeamento exige ação explícita de ADMIN; papel global não é alterado |
| Remoção de acesso manual | origem e identidade proprietária persistidas em `user_groups` |
| Dados de outro tenant | consultas e constraints incluem `tenant_id` |
| Claims ausentes ou antigos | sincronização fail-closed remove somente associações OIDC obsoletas |

## Estratégia técnica

Persistir a origem e a identidade proprietária na associação usuário-grupo. No
login, resolver apenas mapeamentos aprovados no tenant, remover concessões OIDC
obsoletas da mesma identidade e criar somente associações ainda inexistentes.

## Matriz de testes e evidências

| Critério/risco | Evidência |
|---|---|
| Associação manual preservada | teste unitário do repositório de mapeamento |
| Isolamento administrativo | testes HTTP de tenant e `requireAdmin` |
| Revogação remove concessões | teste transacional de identidade externa |
| Regressão de autenticação | suíte completa do módulo auth |
| Interface e tipos | typechecks e builds de produção |
| Banco | backup válido e migration aplicada no MySQL local |

## Baseline

Antes da mudança, nenhum grupo do IdP concedia acesso e `user_groups` não
registrava se a associação era manual ou gerenciada por uma identidade externa.

## Rollback ou recuperação

Desabilitar/remover os mapeamentos pela UI. Para rollback de código, restaurar o
backup anterior à migration antes de reverter a estrutura de banco.

## Aprovação

- Decisão: `GO_WITH_RISKS`
- Aprovado por: usuário
- Aprovado em: 2026-08-11
