# PRD API Keys Lite

## Objetivo

Adicionar acesso a API do NodeAccess via `API key` para automacoes e integracoes, sem reutilizar sessao humana do painel e sem enfraquecer o isolamento por tenant.

## Problema

Hoje o acesso autenticado do NodeAccess e centrado em:

- login humano
- JWT de sessao
- UI web

Isso funciona bem para usuario interativo, mas nao e o melhor modelo para:

- scripts operacionais
- integracoes server-to-server
- sincronizacao com sistemas externos
- automacoes recorrentes

Usar JWT de usuario para isso cria risco e ambiguidade:

- token de sessao com escopo humano sendo usado como credencial tecnica
- auditoria menos clara
- revogacao mais dificil
- chance de acoplamento indevido com browser/session flow

## Principios

- `API key` e para automacao e integracao, nao para substituir login humano
- toda chave deve pertencer a um tenant
- toda chave deve ter escopo minimo necessario
- a chave completa so pode ser exibida uma unica vez na criacao
- o banco nao deve armazenar o segredo em claro
- uso da chave deve ser auditavel
- revogacao precisa ser simples e imediata

## Modelo recomendado

### Tipo de credencial

`API key` por tenant, criada por admin do tenant para uso tecnico.

Nao usar:

- senha de usuario
- JWT manual/copiado do browser
- chave global da plataforma por padrao

### Estrutura da chave

Formato recomendado:

- prefixo identificavel, por exemplo `na_live_`
- parte publica curta para identificacao visual
- segredo longo e aleatorio

Exemplo conceitual:

```text
na_live_ab12cd34.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Observacao:

- o formato exato pode variar
- o importante e permitir identificacao parcial sem expor o segredo completo

## Dados recomendados

Tabela sugerida: `api_keys`

- `id`
- `tenantId`
- `name`
- `prefix`
- `secretHash`
- `scopesJson`
- `expiresAt`
- `lastUsedAt`
- `lastUsedIp`
- `revokedAt`
- `createdAt`
- `createdByUserId`
- `revokedByUserId`

Campos opcionais futuros:

- `allowedCidrsJson`
- `description`
- `lastUsedUserAgent`

## Armazenamento seguro

### Regra obrigatoria

Nao armazenar a chave completa em claro no banco.

Armazenar apenas:

- prefixo para exibicao
- hash do segredo para validacao

### Exibicao unica

Ao criar a chave:

- mostrar a chave completa uma unica vez
- orientar o admin a armazenar em local seguro

Depois disso:

- exibir apenas nome, prefixo, scopes, criador, ultimo uso, expiracao e status

## Escopos

Toda chave deve ter `scopes`.

Exemplos iniciais:

- `hosts:read`
- `hosts:write`
- `sessions:read`
- `feedback:write`
- `integrations:read`
- `integrations:write`

Futuro:

- `secrets:read`
- `secrets:write`
- `audit:read`
- `playback:read`

## Regras de acesso

### Admin do tenant

Pode:

- criar chave do proprio tenant
- listar chaves do proprio tenant
- revogar chave do proprio tenant

Nao deve:

- ver o segredo completo novamente depois da criacao

### Usuario comum

Nao deve:

- criar ou gerenciar `API keys` por padrao

### Platform admin

Por padrao, nao deve operar chaves cross-tenant sem regra explicita.

Se houver suporte operacional futuro:

- exigir auditoria forte
- justificar acesso
- evitar leitura do segredo

## Formato de autenticacao

MVP recomendado:

- header `Authorization: Bearer <api_key>`

Alternativa suportavel:

- `X-API-Key: <api_key>`

Preferencia:

- manter `Authorization` como padrao
- o backend diferencia internamente `API key` de JWT

## Auditoria

Toda chamada autenticada por `API key` deve registrar:

- `apiKeyId`
- nome/prefixo da chave
- tenant
- rota
- metodo HTTP
- resultado
- IP de origem
- horario

Isso e especialmente importante no NodeAccess porque a plataforma lida com acesso operacional e automacoes sensiveis.

## Restricoes recomendadas

### MVP

- escopos
- expiracao opcional
- revogacao manual

### Fase seguinte

- allowlist por IP/CIDR
- limite de uso/rate limit por chave
- separacao por ambiente

## UX recomendada

### Tela admin

Nova area em `Administracao` ou `Configuracoes`:

- listar `API keys`
- criar nova chave
- visualizar:
  - nome
  - prefixo
  - scopes
  - criador
  - ultimo uso
  - expiracao
  - status
- revogar chave

### Fluxo de criacao

1. informar nome
2. escolher scopes
3. definir expiracao opcional
4. gerar chave
5. exibir chave uma unica vez

Mensagens recomendadas:

- `Copie esta chave agora. Ela nao sera exibida novamente.`
- `Chave revogada com sucesso.`
- `Esta chave expirou. Gere uma nova para continuar.`

## API recomendada

### Admin

- `GET /api/v1/api-keys`
- `POST /api/v1/api-keys`
- `POST /api/v1/api-keys/:id/revoke`

### Uso

As rotas existentes continuam as mesmas.

O middleware de autenticacao passa a aceitar:

- JWT humano
- `API key` valida com scopes suficientes

## Regras de produto

- `API key` nao deve iniciar sessao web
- `API key` nao deve abrir terminal interativo via browser
- uso inicial deve ser focado em CRUD e integracoes administrativas
- acesso a recursos muito sensiveis deve exigir escopos especificos

## Licenciamento recomendado

Considerar entitlement futuro:

- `apiAccess`

Assim o produto pode decidir:

- tenants sem acesso a API
- tenants com API apenas leitura
- tenants com API completa por plano

No primeiro corte, isso pode ficar apenas como backlog, sem bloquear a implementacao base.

## MVP recomendado

### Backend

- entidade `api_keys`
- geracao de chave aleatoria
- hash do segredo no banco
- middleware para autenticar `API key`
- verificacao de scopes
- rotas admin de criar/listar/revogar
- auditoria basica de uso

### Frontend

- tela simples de `API Keys`
- modal de criacao
- exibicao unica da chave
- lista com status, expiracao e ultimo uso

## Fora de escopo inicial

- OAuth
- client credentials
- refresh token
- delegacao entre tenants
- portal de desenvolvedor
- rotacao automatica

## Evolucao futura

### Fase 2

- restricao por IP/CIDR
- rate limit por chave
- mais scopes por modulo

### Fase 3

- auditoria analitica por chave
- chaves por integracao/provedor
- templates de escopo

### Fase 4

- OAuth machine-to-machine, se o ecossistema do produto justificar

## Arquivos provaveis

### Backend

- `apps/backend/src/modules/api-keys/*`
- middleware/auth guard compartilhado
- schema Prisma e migration

### Frontend

- `apps/frontend/src/views/admin/ApiKeysView.vue`
- `apps/frontend/src/services/api-key.service.ts`

## Proximo corte recomendado

1. CRUD admin de `API keys`
2. hash + exibicao unica
3. escopos minimos por modulo
4. auditoria basica de uso
