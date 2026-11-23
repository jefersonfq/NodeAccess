# NA-0187 — Registro da implementação

Base: ver `plan.md` (fast-forward até a NA-0186). Branch: security/NA-0187-20261122-login-sessions. Worktree: `.tmp/worktrees/na0187`.

## Pedido e objetivo

Na guia Usuários, ver quem está online e de qual IP, e desconectar uma sessão de login específica (pedido do responsável na homologação da NA-0183).

## Implementação

- `modules/auth/login-session.registry.ts`: registro por refresh token no Redis (`login-session:<jti>`, índice `login-sessions:<tenant>`), referência opaca por hash, online em 15 min, limpeza de entradas mortas, desconexão apagando primeiro o refresh.
- `AuthService`: access token com `sid` (o `jti` do refresh), registro no login (todos os métodos, inclusive OIDC com IP e navegador), atualização no refresh (no máximo 1 vez por minuto), limpeza no logout; falha do registro não bloqueia o login.
- `current-session.ts`: `sid` presente exige `refresh:<sid>` vivo (falha fechada 503 sem Redis); token sem `sid` segue a regra anterior.
- `modules/users/user-login-sessions.{service,routes}.ts`: `GET /users/online`, `GET /users/:id/login-sessions`, `DELETE /users/:id/login-sessions/:ref`, `POST /users/:id/login-sessions/revoke-all` (admin, próprio tenant), com auditoria em `admin_logs`.
- Portal: etiqueta **Online** e ação **Sessões de login** em `UsersView.vue`; `components/users/UserLoginSessions.vue`; `services/login-sessions.service.ts`; `utils/user-agent.ts`; textos pt-BR/en; manual `hosts.md`.

## Validação

- Ran: vitest `auth` + `users` com Redis 8.2 real descartável 318 PASS; `auth`, `users`, `shared` e portal (componentes, serviços, views, utils) 1318 PASS; `tsc` e `vue-tsc` PASS; eslint dos arquivos da frente 0 problemas; `manual:check-reviewed` PASS; `security:scan` PASS.
- Ran: cobertura do código novo local (linhas + condições alteradas desde `062034059`): 304/349 = 87,1%.
- Ran: revisão independente de segurança (subagente): PASS_WITH_WARNINGS; LOW de corrida corrigido.
- Skipped: `validate:sonar` local (tokens do responsável); homologação no navegador (responsável).

## Recuperação

Revert da PR. As chaves `login-session*` vencem com o refresh; tokens com `sid` continuam aceitos pelo código anterior.

## Pendências

- `npm run validate:sonar` local: exige Node 24 e os tokens do responsável.
- Homologação: entrar com o mesmo usuário em dois navegadores, ver os dois IPs/navegadores, desconectar um e confirmar que só ele perde o acesso; **Desconectar todas** encerra também o terminal aberto.
- Roadmap 2027: sem ferramenta de edição da planilha.

## Diário de interações

### 2026-11-22T23:59:00-03:00 — Implementação de ponta a ponta

Pedido: "pode incluir a NA-0187 fim a fim também". Plano com `GO_WITH_RISKS`. Worktree separada (o checkout principal está na branch da NA-0186), avançada até o commit da NA-0186 para não conflitar no `UsersView.vue`.
Ran: baseline 402 PASS; candidato: vitest `auth`, `users`, `shared`, `ssh`, `app-events`, `vault-security` e componentes do portal sem regressão (backend 735 PASS antes dos testes novos; `auth`+`users`+componentes 321 PASS depois); registro contra Redis 8.2 real descartável (`LOGIN_SESSIONS_REDIS_URL`) PASS; `tsc` e `vue-tsc` PASS; eslint dos arquivos da frente 0 erros (corrigido 1 erro antigo em `oidc-auth.service.test.ts`); `manual:check-reviewed` PASS; `security:scan` PASS (hashes revisados de 3 arquivos atualizados; linhas sinalizadas inalteradas).

### 2026-11-23T00:40:00-03:00 — Revisão independente e ajustes

Revisão independente de segurança (subagente, somente leitura): PASS_WITH_WARNINGS, sem achados críticos, altos ou médios. Corrigido o LOW de corrida (registro recriado sem validade por um refresh simultâneo à desconexão: `SET … XX KEEPTTL`, com teste no Redis real). Ressalvas aceitas registradas no `plan.md`. A branch foi refeita sobre o commit novo da NA-0186 (`5aab31d43`, correção de lint pedida pela CI da PR77); único conflito: hash do manual, recalculado. Também: tipos de retorno nos arquivos tocados para o `lint:changed` com zero avisos.
Ran: vitest `auth` + `users` com Redis 8.2 real 318 PASS; `auth` + componentes/serviço do portal 282 PASS; `tsc` e `vue-tsc` PASS; eslint dos arquivos da frente 0 problemas; `manual:check-reviewed` PASS.
Skipped: `validate:sonar` (Node 24 e tokens do responsável).

### 2026-11-23T01:40:00-03:00 — Alinhamento com a NA-0186 e cobertura

Branch refeita sobre o commit `062034059` da NA-0186 (teste novo do `UsersView.vue`, pedido pela cobertura do `sonar-real` na PR77); o teste ganhou o caso da NA-0187 (etiqueta Online, ação e janela de sessões, falha ao carregar online). Cobertura local do código novo (linhas + condições alteradas desde `062034059`): 304/349 = 87,1%. Ran: vitest `auth`, `users`, `shared`, componentes, serviços, views e utils do portal 1318 PASS; eslint do teste 0 problemas.

### 2026-11-23T03:20:00-03:00 — PR78 e revisão do controle de identidade

PR78 aberta. A CI reprovou `build`, `manual`, `csp-browser`, `upgrade-restore` e `sonar-real` pela mesma causa: o catálogo da Central de Segurança (`docs/security/controls-catalog.json`, controle `identity`) revisa `auth.service.ts`, `current-session.ts` e `guards.ts`, que mudaram. Revisão editorial refeita: escopo descreve a conferência do `sid` e a desconexão de uma sessão; testes mapeados incluem `current-session.test.ts` e `auth.service.login-sessions.test.ts`; texto público inalterado (não promete recurso novo ao usuário final). Ran: `node --test tools/security-center/` 7 PASS; carregamento do catálogo PASS; `vite build` do portal PASS.

### 2026-11-23T07:35:00-03:00 — Merge e encerramento

PR78 mergeada em `master` (`518e88aa5`, 2026-11-23) com os 12 checks remotos verdes (após a revisão do controle `identity` do catálogo da Central de Segurança). `master` local sincronizado. Status `closed`. Seguem: homologação pelo responsável (roteiro em Pendências) e `validate:sonar` local (tokens do responsável). Encerramento registrado na branch da NA-0188.
