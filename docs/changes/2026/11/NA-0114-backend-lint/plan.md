---
change_id: NA-0114
title: Lint legado backend sem mudança de contrato
type: fix
status: implemented_local
created_at: 2026-11-03T19:45:48+00:00
base_branch: chore/NA-0089-20261103-sonar-integration
base_sha: 47f06b51e693d91f5ed724b7b86e5362af75bc35
branch: fix/NA-0114-20261103-backend-lint
owner: equipe NodeAccess
planner: Codex
risk: medium
---

# NA-0114 — Lint legado backend

## Contexto e situação anterior
A integração identificou 17 erros legados e um warning nos arquivos backend tocados. Usuário autorizou corrigir legado em branch separada.

## Problema e objetivo
Remover erros reais de tipos e async sem await preservando contrato Promise dos plugins, autenticação e acesso SSH.

## Escopo
agent.routes, user.service, native-ssh-gateway.routes, shared-session.ws-routes e ai-script-artifact.service.test. Nove erros novos de outros testes já corrigidos em NA-0086 ficam fora desta frente.

## Critérios de aceitação
- [x] Lint dos arquivos afetados sem erros ou warnings.
- [x] Testes dirigidos e typecheck backend passam.
- [x] Contratos async e RBAC preservados; revisão independente realizada.

## Estratégia técnica
Remover assertions redundantes e tipar mocks. Registro extraído em função síncrona interna; wrapper retorna Promise cujo executor registra imediatamente e captura erro original, mantendo API assíncrona sem callback. Nenhuma supressão de regra.

## Riscos e mitigações
Plugins Fastify dependem de resolução assíncrona; testes de registro precisam provar conclusão e rotas. Alterações de tipos não devem mudar autorização. Não alterar transporte ou abrir hosts remotos.

## Matriz de testes e evidências
Ran: baseline já comparado por stdin com mesmos deps em origin/master e NA-0090: 17 erros idênticos. Planned: testes agent/user/gateway/shared-session/artifact; lint e typecheck; revisão independente. Nenhum scanner nesta frente.

## Baseline
SHA47f06b51e693d91f5ed724b7b86e5362af75bc35, worktree /tmp/nodeaccess-NA-0114, Node24. Dependências canônicas somente leitura, shared local para build.

## Rollback ou recuperação
Reverter somente o commit desta frente. Sem migração ou dados afetados.

## Aprovação
Decisão: GO_WITH_RISKS. Usuário autorizou explicitamente correção do lint legado e entrega; raiz delegou NA-0114. Commit local autorizado; integração/publicação ficam com a raiz.
