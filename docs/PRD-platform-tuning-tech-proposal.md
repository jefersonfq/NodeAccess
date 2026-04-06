# PRD Platform Tuning Tech Proposal

## Objetivo
Traduzir o `PRD-platform-tuning-lite.md` em um plano tecnico executavel, incremental e de baixo risco para melhorar performance e estabilidade do NodeAccess.

## Premissas
- sem quebrar comportamento funcional
- sem alterar contrato central de login, terminal e auditoria
- priorizar correcoes de `stale state`, expiracao de sessao e queries quentes
- evitar cache persistente agressivo em dados sensiveis

## Estado observado
### Backend
Rotas e modulos com maior chance de aquecimento:
- [server.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/server.ts)
- [features.routes.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/features/features.routes.ts)
- [settings.service.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/settings/settings.service.ts)
- [sessions.repository.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/sessions/sessions.repository.ts)
- [dashboard.repository.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/dashboard/dashboard.repository.ts)
- [session-audit.repository.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/session-audit/session-audit.repository.ts)
- [integration.repository.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/integrations/integration.repository.ts)

### Frontend
Pontos de sensibilidade atual:
- [auth-session.service.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/frontend/src/services/auth-session.service.ts)
- [api.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/frontend/src/services/api.ts)
- [router/index.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/frontend/src/router/index.ts)
- telas admin que carregam `settings`, `features`, `integrations`, `session-audit`

## Hipoteses principais
1. existe repeticao de fetch de `settings`, `features` e integrações entre telas
2. a plataforma ainda depende demais de estado atual do frontend, sem estratégia clara de invalidação por versão
3. queries de listagem e dashboard podem se beneficiar de indices adicionais
4. expiracao de sessao esta funcional, mas ainda sem parametrizacao clara de UX e sem estratégia formal para stale bundle
5. workers e polling podem gerar ruido operacional e custo desnecessario

## Frentes tecnicas
### 1. Cache seletivo no frontend
#### Recomendacao
Criar cache curto em memoria por service para:
- `settings`
- `features`
- `integrations`
- detalhes administrativos de baixa mutabilidade

#### Politica sugerida
- TTL de 15s a 60s para configs
- invalidação imediata apos `save/update/test`
- nunca cachear:
  - respostas de terminal
  - auth refresh
  - sessoes websocket
  - SFTP

#### Arquivos candidatos
- [settings.service.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/frontend/src/services/settings.service.ts)
- [features.service.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/frontend/src/services/features.service.ts)
- [integration.service.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/frontend/src/services/integration.service.ts)
- [sessionAudit.service.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/frontend/src/services/sessionAudit.service.ts)

### 2. Expiracao de sessao e stale assets
#### Estado atual
- expiracao ja limpa tokens e redireciona para login em [auth-session.service.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/frontend/src/services/auth-session.service.ts)
- auth usa refresh transparente em [api.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/frontend/src/services/api.ts)
- expiracao de JWT e refresh ja sao parametrizadas em [env.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/config/env.ts)

#### Melhorias sugeridas
- explicitar no `.env.example`:
  - `JWT_EXPIRES_IN`
  - `JWT_REFRESH_EXPIRES_IN`
- opcional futuro:
  - `WEB_SESSION_IDLE_TIMEOUT`
  - `FRONTEND_BUILD_ID`
- tratar `ChunkLoadError` e `Failed to fetch dynamically imported module`
- exibir banner de versao desatualizada com reload guiado
- evitar hard reload forçado como comportamento padrão

#### Recomendacao
Implementar detector simples:
1. backend expõe `buildId/version`
2. frontend compara em boot ou em erro de chunk
3. se houver mismatch, mostra CTA de reload seguro

### 3. Indices de banco
#### Prioridade alta
- `session_audits (tenant_id, started_at)`
- `session_audits (tenant_id, status)`
- `session_audits (tenant_id, ticket_key)`
- `session_audit_ai_jobs (status, kind, created_at)`
- `sessions (active, started_at)`

#### Prioridade media
- `sessions (user_id, active)`
- `hosts (tenant_id, name)`
- `hosts (tenant_id, ip)`
- `users (tenant_id, active, license_consumed)`
- `auth_logs (timestamp, user_id)`

#### Ja esperado como coberto
- `integrations (tenant_id, provider)` por `@@unique`
- `licenses (tenant_id)` por `@unique`

#### Metodo
- rodar `EXPLAIN` nas queries de:
  - [sessions.repository.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/sessions/sessions.repository.ts)
  - [dashboard.repository.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/dashboard/dashboard.repository.ts)
  - [session-audit.repository.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/modules/session-audit/session-audit.repository.ts)

### 4. Tuning de rotas de configuracao
#### Observacao
`/features`, `/settings` e `/integrations/*` sao lidas repetidamente em varias telas.

#### Recomendacao
- manter resposta fresca no backend
- usar cache curto apenas no frontend
- opcional:
  - `ETag` ou `Cache-Control: private, max-age=15` para respostas seguras
- nao cachear server-side ainda sem telemetria

### 5. Polling e background
#### Estado atual
- worker de auditoria IA inicia no startup em [server.ts](/mnt/c/Users/jefir/OneDrive/Área%20de%20Trabalho/TRABALHO/SQUAD%20INFRA/PROJETOS/NodeAccess/apps/backend/src/server.ts)
- sync do Google roda periodicamente no mesmo arquivo

#### Recomendacoes
- reduzir verbosidade de logs de polling
- tornar intervalo configuravel por `.env`
- adicionar jitter leve em loops longos para evitar sincronismo rigido
- separar logs de health/poll de logs de erro real

### 6. Web access e auditoria
#### Observacao
Esses modulos ja tiveram otimizações recentes.

#### Recomendacao
- nao mexer no comportamento agora
- adicionar apenas metricas leves:
  - cache hit/miss no frontend
  - tempo de detalhe da auditoria
  - total de queries por tela
  - tempo de resposta de `session-audit list/detail`

## Backlog proposto
### Fase 1
- documentar e expor tempos de expiracao de sessao
- cache curto em `settings`, `features`, `integrations`
- tratamento de erro de chunk/bundle stale
- reduzir logs redundantes de polling

#### Executado
- cache curto centralizado no frontend para `settings`, `features` e `integrations`
- invalidação desses caches ao expirar a sessão
- recuperação controlada de `ChunkLoadError`
- worker de IA só inicia quando a feature está habilitada
- intervalos de worker/sync movidos para `env`
- `prisma:query` virou opt-in

### Fase 2
- levantar `EXPLAIN` das queries quentes
- aplicar migrations de índices aprovados
- medir antes/depois em sessões, auditoria e dashboard

#### Indices compostos aplicados no primeiro corte
- `users (tenant_id, active, license_consumed)`
- `users (tenant_id, created_at)`
- `hosts (tenant_id, name)`
- `hosts (tenant_id, ip)`
- `sessions (user_id, active, started_at)`
- `sessions (host_id, active)`
- `sessions (active, started_at)`
- `session_audits (tenant_id, status, started_at)`
- `session_audits (tenant_id, ticket_key)`
- `session_audit_ai_jobs (session_audit_id, created_at)`
- `session_audit_ai_jobs (kind, status, created_at)`
- `auth_logs (user_id, timestamp)`
- `auth_logs (event_type, success, timestamp)`
- `admin_logs (admin_id, timestamp)`

#### Executado
- migration manual criada em `20260401001000_add_phase2_tuning_indexes`
- correção da migration histórica `20260331234500_add_session_audit_ai_artifacts` para manter compatibilidade com FK no MySQL

### Fase 3
- refinar UX de expiracao de sessao
- opcional: `buildId` e reload guiado
- opcional: headers seletivos de cache em rotas administrativas seguras

## Sugestoes adicionais
- adicionar um pequeno `client cache registry` para evitar caches soltos por service
- criar util comum de invalidação por dominio:
  - `settings`
  - `features`
  - `integrations`
  - `session-audit`
- criar um modo debug de timing por tela em dev

## Proximo passo recomendado
Implementar a Fase 1 primeiro:
1. cache curto no frontend para `settings/features/integrations`
2. estratégia de `session expired` + `stale chunk` sem depender de hard reload manual
3. redução de ruído operacional em polling/logs
