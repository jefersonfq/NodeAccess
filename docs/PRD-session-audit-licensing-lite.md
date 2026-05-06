# PRD Session Audit Licensing Lite

## Objetivo
Definir como o recurso `Auditoria de Sessao SSH` deve ser licenciado e aplicado por escopo dentro de cada tenant, sem ambiguidade entre regra comercial, regra operacional e kill switch tecnico.

## Problema
O recurso de auditoria ja existe tecnicamente, mas ainda nao ha definicao de produto para:
- quem pode contratar
- quando o tenant esta autorizado a usar
- se a auditoria vale para todos ou apenas parte dos usuarios
- como combinar usuario, grupo e tenant
- o que acontece quando a licenca expira ou e desabilitada

Sem essa definicao, o risco e implementar uma politica tecnica incorreta e precisar refazer backend, UI e comunicacao comercial.

## Principios
- `FEATURE_SESSION_AUDIT` continua sendo apenas kill switch tecnico
- a regra de produto deve vir do banco, nao de `.env`
- licenca habilita o direito de uso no tenant
- politica de escopo define em quem a auditoria sera aplicada
- a decisao final precisa ser barata o suficiente para rodar na abertura da sessao SSH

## Conceitos
### 1. Licenca do recurso
Indica se o tenant pode usar auditoria de sessao.

Campos esperados:
- `sessionAuditEnabled: boolean`
- opcional futuro:
  - `sessionAuditRetentionDays`
  - `sessionAuditAiSummaryEnabled`
  - `sessionAuditRealtimeGuardrailsEnabled`

### 2. Politica de escopo
Define quais usuarios do tenant terao sessoes auditadas.

Modos iniciais recomendados:
- `ALL`
- `USERS`
- `GROUPS`
- `MIXED`
- `DISABLED`

Significado:
- `DISABLED`: tenant possui implementacao tecnica disponivel, mas nao esta auditando ninguem
- `ALL`: todas as sessoes SSH do tenant sao auditadas
- `USERS`: apenas usuarios explicitamente marcados
- `GROUPS`: apenas usuarios que pertencem a grupos marcados
- `MIXED`: usuarios marcados OU membros de grupos marcados

## Regra de decisao
Ao abrir uma sessao SSH, o gateway deve avaliar nesta ordem:

1. `FEATURE_SESSION_AUDIT`
- se `false`, nao audita nada

2. licenca do tenant
- se `sessionAuditEnabled = false`, nao audita

3. politica de escopo do tenant
- `DISABLED` -> nao audita
- `ALL` -> audita
- `USERS` -> audita se `userId` estiver autorizado
- `GROUPS` -> audita se o usuario pertencer a pelo menos um grupo autorizado
- `MIXED` -> audita se `userId` autorizado OU grupo autorizado

## Regras de precedencia
- licenca desabilitada sempre vence
- kill switch tecnico sempre vence
- politica de escopo so e avaliada se a licenca permitir
- em `MIXED`, a regra e inclusiva
- nao deve existir modo em que um grupo bloqueia explicitamente um usuario no MVP

## Regras de UX/Admin
O admin do tenant deve conseguir:
- ver se a auditoria esta licenciada
- ver se a auditoria esta ativa ou nao
- escolher escopo:
  - todos
  - grupos
  - usuarios
  - grupos + usuarios
- selecionar grupos e usuarios incluidos
- entender quantos usuarios estao cobertos pela politica atual

Mensagens esperadas:
- licenca indisponivel: recurso nao contratado
- politica desabilitada: recurso contratado, mas sem usuarios cobertos
- politica ativa: mostrar cobertura estimada

## Regras de operacao
- a decisao de auditar deve ocorrer na abertura da sessao
- essa decisao deve ser persistida no metadado da sessao auditada
- sessao iniciada com auditoria habilitada continua auditada ate o encerramento, mesmo se a politica mudar durante a sessao
- mudanca de politica vale apenas para novas sessoes

## Expiracao ou revogacao
### Licenca expirada ou removida
- novas sessoes nao devem iniciar auditoria
- sessoes ja auditadas continuam acessiveis conforme politica de retencao
- sessoes em andamento mantem o comportamento decidido na abertura

### Politica desabilitada
- novas sessoes deixam de ser auditadas
- historico anterior continua visivel

## Retencao e download
- o recurso de download da sessao auditada faz parte da mesma licenca base da auditoria
- retencao pode ser unica no MVP
- retencao diferenciada por tier pode entrar depois

## IA e guardrails
Nao devem ser obrigatorios para o MVP da auditoria licenciada.

Modelo recomendado:
- `Auditoria de Sessao SSH`: recurso principal
- `Resumo por IA`: add-on ou tier posterior
- `Guardrails em tempo real`: add-on ou tier posterior

## Estrutura de dados recomendada
### Licenca
Adicionar em `License`:
- `session_audit_enabled`
- opcional futuro:
  - `session_audit_retention_days`
  - `session_audit_ai_enabled`
  - `session_audit_guardrails_enabled`

### Politica
Criar entidade dedicada, por exemplo `SessionAuditPolicy`:
- `tenant_id`
- `mode`
- `enabled`
- `created_at`
- `updated_at`

Criar relacoes para escopo:
- `session_audit_policy_users`
- `session_audit_policy_groups`

## API esperada
### Tenant/admin
- `GET /api/v1/session-audit-policy`
- `PUT /api/v1/session-audit-policy`

### Features do tenant
Expandir `GET /api/v1/features` para retornar algo como:
- `sessionAuditLicensed`
- `sessionAuditPolicyMode`
- `sessionAuditEffective`

## Performance
- evitar query complexa a cada evento da sessao
- resolver a politica uma vez na abertura da conexao SSH
- opcional futuro: cache curto em memoria ou Redis por `tenantId`

## Escopo do proximo corte
### Backend
- schema Prisma de licenca + policy
- migrations
- `SessionAuditPolicyService`
- integracao no `ssh.gateway`

### Fora do escopo imediato
- tela admin completa
- billing real
- tiers comerciais complexos
- bloqueio por exclusao explicita

## Decisoes recomendadas
- sim, o recurso deve ser licenciado
- sim, deve permitir escopo por tenant, grupo e usuario
- nao usar `.env` como fonte de verdade de produto
- nao reavaliar politica a cada evento
- nao interromper sessoes em andamento por mudanca de politica
