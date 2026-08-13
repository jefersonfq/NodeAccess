---
change_id: NA-0031
title: Governança de provisionamento corporativo e certificação operacional
type: feature
status: passed
created_at: 2026-08-13T16:10:00-03:00
base_branch: feature/NA-0030-20260813-sso-kubernetes-certification
base_sha: c601875a50b1a51188f5592d88abfc54de9370d6
branch: feature/NA-0031-20260813-identity-provisioning-governance
owner: codex
planner: codex
risk: high
issue: null
---

# NA-0031 — Governança de provisionamento corporativo

## Contexto e situação anterior

OIDC genérico, MFA delegado, sessão versionada, mapeamento de grupos, política
administrativa e certificação Kubernetes já estão implementados. A homologação
interativa Entra/Okta depende de tenants externos, e o provisionamento ainda não
possui fila de aprovação privilegiada nem canal SCIM.

## Problema e objetivo

Impedir elevação automática de privilégio por identidade externa, fornecer um
primeiro corte SCIM 2.0 seguro e ampliar os testes operacionais do chart sem
acoplar autenticação à disponibilidade do canal de provisionamento.

## Escopo

- aprovação administrativa de vínculos e mapeamentos privilegiados;
- JIT sempre sem privilégio até decisão humana;
- SCIM 2.0 para usuários e grupos, protegido por entitlement e credencial própria;
- desativação com revogação de sessões;
- upgrade/rollback Helm e rotação operacional de Secret;
- documentação final e preparação para homologação Entra/Okta externa.

## Critérios de aceitação

- [x] Nenhum claim ou grupo externo concede papel privilegiado sem aprovação.
- [x] Administrador visualiza, aprova e rejeita solicitações com auditoria.
- [x] SCIM cria, consulta, atualiza e desativa usuários sem aceitar senhas.
- [x] SCIM suporta grupos e filtro `userName eq` com isolamento por tenant.
- [x] Desativação SCIM invalida sessões renováveis do usuário.
- [x] Helm passa upgrade, rollback e rotação de Secret em cluster efêmero.
- [x] Testes, typechecks e governança passam no SHA final.

## Estratégia técnica

Preservar `User.role` e grupos locais como fonte de autorização. Entradas de IdP
que impliquem privilégio geram solicitação pendente idempotente; somente a ação
administrativa aplica a mudança. SCIM usa token dedicado armazenado por hash,
opera em escopo de tenant e reutiliza os serviços existentes de usuário, grupo,
licença, auditoria e revogação.

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Elevação por claim forjado ou configuração incorreta | aprovação humana e RBAC local como autoridade |
| Enumeração pelo endpoint SCIM | autenticação dedicada, respostas padronizadas e escopo por tenant |
| Sessão sobreviver à desativação | incrementar versão da sessão na mesma operação lógica |
| Rollback incompatível com schema | migrations aditivas e harness de recuperação |

## Matriz de testes e evidências

- testes unitários e de rota para aprovação, rejeição e idempotência;
- testes SCIM Users/Groups, filtros, isolamento e desativação;
- typecheck backend/frontend/shared;
- harness Helm em kind para upgrade, rollback e Secret rotation;
- evidência externa Entra/Okta permanece condicional a credenciais controladas.

Resultados no ambiente local:

- 30 testes direcionados de vínculo e SCIM aprovados;
- Prisma validate e typechecks backend/frontend/shared aprovados;
- Helm lint e renders mínimo/produção/Traefik aprovados;
- kind: install, Helm test, migration failure/recovery, upgrade, rollback,
  Secret rotation/recovery e SSH durante drain aprovados;
- repetição de Nginx/Traefik não concluída por timeout no repositório externo;
  ambos permanecem cobertos pela certificação aprovada da NA-0030.

## Baseline

- branch-base: `feature/NA-0030-20260813-sso-kubernetes-certification`;
- SHA-base: `c601875a50b1a51188f5592d88abfc54de9370d6`;
- certificação anterior: auth, OIDC matrix, Keycloak e kind aprovados.

## Rollback ou recuperação

Desabilitar o entitlement SCIM e a criação de solicitações externas, mantendo
login local/break-glass. Reverter a UI e rotas; tabelas novas são aditivas e
podem permanecer sem uso. No cluster, executar `helm rollback` para a revisão
anterior e restaurar o Secret versionado pelo operador.

## Aprovação

- Decisão: `GO_WITH_RISKS`
- Aprovado por: usuário
- Aprovado em: 2026-08-13
