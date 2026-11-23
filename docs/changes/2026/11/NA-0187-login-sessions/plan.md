---
change_id: NA-0187
title: Sessões de login online por IP e desconexão de uma sessão específica
type: security
status: ready-for-review
created_at: 2026-11-22T22:30:00-03:00
base_branch: master
base_sha: d26301ed8a994abef4ec99998e00840274954e35
branch: security/NA-0187-20261122-login-sessions
owner: Jeferson Quintana
planner: Claude Code
risk: high
issue: null
---

# NA-0187 — Sessões de login online por IP e desconexão de uma sessão

## Contexto e situação anterior

- Cada login (local, LDAP, OIDC, Google, e-mail OTP) emite um refresh token com `jti` e grava `refresh:<jti>` no Redis (`auth.service.ts`, `issueTokens`). Não há registro de IP nem navegador por sessão; o IP do login vai só para `auth_logs`.
- O access token (JWT, 15 min por padrão) não carrega o `jti`. Cada requisição confere usuário, tenant e `sessionVersion` (`assertCurrentUserSession`), então "sair de todos" (incremento de `sessionVersion`) vale na hora, mas não existe desconectar **uma** sessão.
- O administrador não vê quem está online nem de qual IP. Pedido do responsável na homologação da NA-0183 (2026-11-22).

## Problema e objetivo

Na guia **Usuários**, o administrador do tenant vê quem está online e, por usuário, as sessões de login com IP, navegador, método, início e último uso; e desconecta uma sessão específica (por exemplo, um IP desconhecido) sem derrubar as outras.

## Escopo

Backend:
1. Registro de sessões de login no Redis, sem mudar o formato de `refresh:<jti>`:
   - `login-session:<jti>`: tenant, usuário, método, IP e navegador do login, último IP, início e último uso; mesma validade do refresh.
   - `login-sessions:<tenantId>`: conjunto ordenado (`<userId>:<jti>`, nota = último uso), para listar e contar online.
   - Gravado no login (todas as rotas que emitem tokens) e atualizado no refresh (no máximo 1 vez por minuto). Falha ao gravar o registro não bloqueia o login.
2. O access token passa a levar `sid` (o `jti` do refresh). `assertCurrentUserSession` confere que `refresh:<sid>` ainda existe; token sem `sid` (emitido antes da mudança ou delegado) segue a regra atual até expirar.
3. Rotas de administrador (`requireAdmin`, só no próprio tenant):
   - `GET /users/online`: usuários com sessão usada nos últimos 15 min e a quantidade de sessões.
   - `GET /users/:id/login-sessions`: sessões vivas do usuário, com referência opaca (hash do `jti`; o `jti` nunca sai do servidor) e marca "esta sessão".
   - `DELETE /users/:id/login-sessions/:ref`: apaga o refresh e o registro; a sessão perde o acesso na próxima requisição. Não desconecta a própria sessão atual (use **Sair**).
   - `POST /users/:id/login-sessions/revoke-all`: incrementa `sessionVersion` (mecanismo existente), o que encerra também terminais e acessos gráficos abertos.
4. Auditoria em `admin_logs`: `LOGIN_SESSION_REVOKED` e `LOGIN_SESSIONS_REVOKED_ALL`, sem `jti` nem token; o IP da sessão vai nos detalhes.
5. O logout normal apaga também o registro.

Portal:
6. Guia Usuários: marca **Online** na linha do usuário; ação **Sessões de login** abre uma janela com a lista (IP do login e último IP, navegador resumido, método, início, último uso, "esta sessão") e **Desconectar** (com confirmação) e **Desconectar todas**.
7. Textos pt-BR/en e manual.

Fora: o usuário ver e encerrar as próprias sessões no perfil; geolocalização de IP; desconectar por IP em lote; encerrar terminais abertos por uma sessão específica (continuam até fechar ou até **Desconectar todas**/**Sessões**); limite de sessões simultâneas.

## Critérios de aceitação

- [ ] Login por qualquer método registra IP, navegador e método; refresh atualiza último uso e último IP.
- [ ] Admin do tenant vê online e sessões só do próprio tenant; usuário comum recebe 403; outro tenant recebe 404.
- [ ] Desconectar uma sessão: a próxima requisição daquela sessão recebe 401, o refresh falha e o cofre dela é negado; as outras sessões do usuário continuam.
- [ ] Referência inválida, de outro usuário ou de outro tenant não desconecta nada.
- [ ] **Desconectar todas** invalida todas as sessões (mecanismo atual).
- [ ] Token antigo sem `sid` continua aceito até expirar (sem logout em massa no deploy).
- [ ] Redis indisponível na conferência do `sid`: falha fechada (503), como a leitura de sessão atual.
- [ ] Testes, lint, typecheck, manual, varredura e checks remotos PASS; revisão independente de segurança.

## Estratégia técnica

- `LoginSessionRegistry` (`modules/auth/login-session.registry.ts`) com ioredis; usado por `AuthService` (login, refresh, logout) e pelo serviço de usuários.
- Conferência do `sid` instalada no `container.ts` como a leitura de sessão atual (`configureLoginSessionChecker`), valendo para API e gateways.
- IP: `request.ip` (respeita `TRUST_PROXY`); navegador: `user-agent` limitado a 256 caracteres.

## Riscos e mitigações

- **Auth tocada** (cada requisição faz mais um GET no Redis): custo baixo; falha fechada; token sem `sid` mantém a regra atual.
- Dado pessoal (IP, navegador): só para admin do tenant, com a mesma validade do refresh; nada novo em log de aplicação.
- Corrida entre refresh e desconexão: desconectar apaga `refresh:<jti>` primeiro; o refresh confere a chave antes de emitir.

## Matriz de testes e evidências

Unitários do registro e do `assertCurrentUserSession`; rotas de usuários (permissão, tenant, referência); `auth.service` (login grava, refresh atualiza, logout limpa, desconectada falha); componente da janela no portal; Redis real se disponível; lint, typecheck, manual, `security:scan`; revisão independente.

## Baseline

Registrada em 2026-11-22 sobre `7c973fce8` (master): vitest `auth`, `users` e `shared` do backend 49 arquivos, 402 PASS. A branch avança por fast-forward até o commit da NA-0186 (`d26301ed8`, PR77), porque as duas frentes alteram `UsersView.vue`; a PR da NA-0187 abre depois do merge da NA-0186.

## Rollback ou recuperação

Revert da PR. Chaves `login-session*` vencem sozinhas; tokens com `sid` continuam válidos no código anterior (o campo é ignorado).

## Mudanças de escopo e decisões

- Decisões de desenho (planejador): referência por hash; não desconectar a própria sessão atual; terminais abertos encerram só com **Desconectar todas**; online = uso nos últimos 15 min.
- Implementação: sessões abertas antes da mudança ganham o registro no primeiro refresh (até 15 min), com o tempo que resta do refresh; "Desconectar todas" usa o motivo `logout_all` já aceito pelo barramento de eventos; não vale para a própria conta do administrador (use **Sair de todos**). Manual: a seção fica no capítulo `hosts`, que já mapeia a guia Usuários desde a NA-0186.
- Revisão independente (2026-11-23): PASS_WITH_WARNINGS. Corrigido: um refresh concorrente com a desconexão podia recriar o registro sem validade (agora `SET … XX KEEPTTL`). Ressalvas aceitas: listagem por usuário lê as 5000 entradas mais recentes do tenant (acima disso, sessões antigas só saem com **Desconectar todas**); tokens delegados de superadmin não têm `sid`; refresh configurado acima de 31 dias sai do índice; Redis fora do ar devolve 503 em toda requisição autenticada (falha fechada, como planejado).

## Aprovação

Decisão: `GO_WITH_RISKS` — o responsável pediu a frente de ponta a ponta em 2026-11-22. Risco: toca a verificação de sessão em toda requisição.
