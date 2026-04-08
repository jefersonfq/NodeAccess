# PRD License Entitlements Lite

## Objetivo

Evoluir a licenca do NodeAccess para um modelo de `entitlements` capaz de controlar:

- limites quantitativos
- modulos da plataforma
- integracoes por provider

Sem depender de regras dispersas em `.env` e sem criar ambiguidade entre:

- direito comercial de uso
- disponibilidade tecnica
- configuracao efetiva do tenant

## Problema

Hoje a licenca ja controla parte do produto:

- `maxUsers`
- `multiConnect`
- `sessionAuditEnabled`
- `sessionAuditAiEnabled`
- limites de sessoes ativas

Mas o roadmap do produto exige ir alem:

- maximo de servidores cadastrados
- acesso a snippets
- acesso a acessos locais
- acesso a integracoes
- controle por provider de integracao:
  - JIRA
  - Google
  - 1Password
  - futuros providers

Se isso continuar espalhado em flags isoladas, a plataforma tende a ficar dificil de vender, operar e auditar.

## Principios

- a licenca no banco define o direito de uso do tenant
- feature flags tecnicas continuam existindo apenas como kill switch
- configuracao do tenant define se o recurso foi realmente habilitado/configurado
- a decisao final deve ser simples de avaliar no backend e no frontend
- o modelo deve crescer sem exigir migration para toda nova integracao

## Modelo recomendado

### 1. Limites quantitativos

Campos de licenca que representam capacidade:

- `maxUsers`
- `maxHosts`
- `maxActiveSessionsPerUser`
- `maxActiveSessionsPerTenant`

Futuro opcional:

- `maxAgents`
- `maxPortForwardingsPerHost`
- `maxSharedSessions`

### 2. Recursos/modulos

Entitlements por modulo:

- `snippetsEnabled`
- `portForwardingEnabled`
- `webAccessEnabled`
- `agentsEnabled`
- `sharedSessionsEnabled`
- `sessionAuditEnabled`
- `sessionPlaybackEnabled`
- `secretsEnabled`
- `integrationsEnabled`

Observacao:

- `sessionAuditAiEnabled` pode continuar como add-on especifico
- `sessionPlaybackEnabled` pode depender de `sessionAuditEnabled`, mas deve ser licenciado separadamente se o produto quiser vender tiers

### 3. Integracoes por provider

Nao basta um booleano generico de integracoes.

Precisamos permitir:

- tenant com integracoes habilitadas, mas apenas JIRA
- tenant com JIRA + 1Password
- tenant sem Google

Modelo recomendado:

- `integrationProvidersJson`

Exemplo:

```json
{
  "jira": true,
  "google": false,
  "onepassword": true
}
```

Assim, novas integracoes nao exigem coluna nova no banco para cada provider.

## Estrutura de dados recomendada

### Opcao recomendada

Manter colunas fixas para limites e recursos mais criticos, e usar JSON para extensao:

Na entidade `License`:

- colunas fixas:
  - `max_users`
  - `max_hosts`
  - `multi_connect`
  - `session_audit_enabled`
  - `session_audit_ai_enabled`
  - `max_active_sessions_per_user`
  - `max_active_sessions_tenant`
- JSON:
  - `feature_entitlements_json`
  - `integration_entitlements_json`

Exemplo de `feature_entitlements_json`:

```json
{
  "snippets": true,
  "portForwarding": true,
  "webAccess": true,
  "agents": true,
  "sharedSessions": true,
  "sessionPlayback": false,
  "secrets": false
}
```

Exemplo de `integration_entitlements_json`:

```json
{
  "jira": true,
  "google": false,
  "onepassword": true
}
```

### Por que nao usar apenas colunas

- cada nova integracao exigiria migration
- cada novo modulo pequeno exigiria schema change
- a evolucao comercial ficaria lenta

### Por que nao usar apenas JSON

- limites criticos como `maxUsers` e `maxHosts` merecem coluna dedicada
- relatorios e validacoes ficam mais simples
- regras mais usadas devem continuar explicitadas

## Regra de decisao

Um recurso deve aparecer/funcionar apenas quando:

1. a feature tecnica da instalacao permite
2. a licenca do tenant permite
3. o tenant configurou o provider ou recurso, quando aplicavel

Exemplos:

### Acessos locais

- `FEATURE_PORT_FORWARDING = true`
- `license.feature_entitlements.portForwarding = true`

### JIRA

- `FEATURE_INTEGRATIONS = true` ou equivalente tecnico
- `license.feature_entitlements.integrations = true`
- `license.integration_entitlements.jira = true`
- tenant com integracao JIRA configurada

### Snippets

- recurso tecnico disponivel
- `license.feature_entitlements.snippets = true`

## UX/Admin

O admin do tenant deve conseguir ver:

- quais recursos estao contratados
- quais limites estao em uso
- quais integracoes estao licenciadas
- quando algo esta indisponivel por:
  - licenca
  - falta de configuracao
  - indisponibilidade tecnica

Mensagens recomendadas:

- `Recurso nao contratado`
- `Provider nao incluido no plano`
- `Integracao licenciada, mas nao configurada`
- `Limite de hosts atingido`

## API recomendada

### Settings / visao detalhada do tenant

Expandir `GET /api/v1/settings` com:

- `license.maxHosts`
- `license.featureEntitlements`
- `license.integrationEntitlements`

### Features / consumo rapido no frontend

Expandir `GET /api/v1/features` com:

- `maxHosts`
- `snippetsLicensed`
- `portForwardingLicensed`
- `integrationsLicensed`
- `integrationProviders`

Exemplo:

```json
{
  "multiConnect": true,
  "maxHosts": 200,
  "snippetsLicensed": true,
  "portForwardingLicensed": true,
  "integrationsLicensed": true,
  "integrationProviders": {
    "jira": true,
    "google": false,
    "onepassword": true
  }
}
```

## Ordem recomendada de implementacao

### Fase 1

- adicionar `maxHosts`
- adicionar `featureEntitlementsJson`
- adicionar `integrationEntitlementsJson`
- expor isso em `settings` e `features`

### Fase 2

- aplicar bloqueio de criacao/edicao onde fizer sentido:
  - hosts
  - snippets
  - acessos locais
  - integracoes

### Fase 3

- melhorar UX com badges de plano/licenca
- explicar claramente por que algo esta bloqueado
- preparar terreno para tiers e add-ons

## Casos mapeados agora

### Limites

- maximo de usuarios
- maximo de servidores cadastrados

### Recursos

- acesso a snippets
- acesso a acessos locais
- acesso a integracoes

### Providers

- JIRA
- Google
- 1Password
- proximas integracoes

## Fora do escopo imediato

- billing real
- renovacao automatica
- self-service comercial
- licenciamento por uso/consumo
- precificacao

## Decisoes recomendadas

- sim, devemos evoluir para entitlements
- `maxHosts` deve virar limite de primeira classe
- snippets e acessos locais devem ser licenciaveis
- integracoes devem ter licenca base + provider por provider
- limites criticos em coluna, modulos e providers em JSON
