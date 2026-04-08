# PRD Tenancy Lite

## Objetivo

Ativar e melhorar a experiencia multi-tenant no NodeAccess sem quebrar o fluxo atual de login, API, WebSocket e isolamento por `tenantId`.

O foco inicial e resolver bem a descoberta do tenant antes do login e manter o isolamento depois do login baseado no JWT.

## Estado atual

- Existe entidade `Tenant` no banco.
- O login resolve tenant por `X-Tenant-Slug`, com fallback para `default`.
- O JWT emitido apos login carrega `tenantId`.
- Rotas autenticadas usam `tenantId` do JWT para escopo de dados.
- O frontend nao injeta explicitamente `X-Tenant-Slug` nas chamadas HTTP.
- O Nginx injeta `X-Tenant-Slug` usando `$host`.
- Em dev, `$host` pode virar `localhost`, o que pode conflitar com o tenant `default`.

## Principio de seguranca

- Rotas autenticadas devem confiar no `tenantId` do JWT, nao no header enviado pelo navegador.
- `X-Tenant-Slug` deve ser usado apenas para descoberta pre-login e configuracoes publicas do tenant.
- O cliente pode ajudar a indicar o tenant antes do login, mas nao deve conseguir trocar tenant depois de autenticado apenas mudando header.
- WebSocket SSH deve continuar usando o token autenticado como fonte de tenant.

## Estrategia recomendada

### 0. Separar admin do tenant e admin da plataforma

A criacao de novos tenants deve ser feita por um papel separado do `ADMIN` atual.

Nome sugerido:

- `platform_admin` ou `master_admin`

Regra:

- `ADMIN` atual continua sendo admin do tenant onde o usuario esta logado.
- `USER` continua vendo apenas os recursos permitidos do proprio tenant.
- `platform_admin` pode criar, ativar, desativar e configurar tenants.
- `platform_admin` nao deve acessar automaticamente hosts, sessoes, secrets ou auditorias dos tenants sem um fluxo explicito e auditado.

No MVP, a abordagem mais simples e adicionar um campo separado no usuario, por exemplo `platformRole` ou `isPlatformAdmin`, mantendo `role` como permissao interna do tenant.

Evitar transformar `ADMIN` em "admin global", porque isso quebraria a semantica atual e aumentaria o risco de vazamento cross-tenant.

### 1. Resolver tenant no backend de forma centralizada

Criar um utilitario de resolucao de tenant para requests publicas/pre-login:

- ler `X-Tenant-Slug`, quando informado
- se ausente, ler `Host`
- remover porta do host
- normalizar para lowercase
- mapear `localhost`, `127.0.0.1` e hosts locais para `default`
- em producao com subdominio, extrair o slug do tenant de `tenant.dominio.com`
- validar formato do slug antes de consultar banco
- retornar `default` somente quando a configuracao permitir fallback local/dev

Arquivos provaveis:

- `apps/backend/src/modules/auth/auth.controller.ts`
- `apps/backend/src/modules/auth/auth.service.ts`
- possivel novo arquivo `apps/backend/src/modules/tenants/tenant-resolver.ts`

### 2. Expor endpoint publico de tenant

Criar endpoint publico para a tela de login validar o tenant atual:

- `GET /api/v1/auth/tenant` ou `GET /api/v1/tenant/public`

Resposta sugerida:

```json
{
  "slug": "default",
  "name": "Default",
  "active": true,
  "auth": {
    "password": true,
    "google": false
  }
}
```

Esse endpoint tambem pode substituir parte da logica atual de config publica do Google, mantendo o Google como detalhe de autenticacao do tenant.

### 3. Resolver tenant no frontend antes do login

Criar um servico simples no frontend:

- `apps/frontend/src/services/tenant.service.ts`

Ordem sugerida:

1. `VITE_TENANT_SLUG`, quando definido
2. slug salvo em `localStorage`, apenas para dev/lab ou modo interno
3. subdominio do `window.location.hostname`
4. `default` para `localhost` e desenvolvimento

O interceptor HTTP pode enviar `X-Tenant-Slug` em chamadas pre-login. Para chamadas autenticadas, o backend deve ignorar esse header para escopo de dados e usar apenas o JWT.

### 4. Melhorar UX da tela de login

Na tela de login, mostrar o tenant resolvido:

- nome do tenant
- status ativo/inativo
- autenticacoes disponiveis
- mensagem clara quando o tenant nao existir ou estiver inativo

Para ambiente interno/dev, pode existir um seletor simples de tenant. Para producao, preferir subdominio canônico por tenant.

### 5. Ajustar Nginx com menor risco

Manter `X-Tenant-Slug` no Nginx, mas tratar no backend como hint:

- em dev, `localhost` deve virar `default`
- em prod, preferir subdominio por tenant
- se usar dominio unico, o frontend deve enviar o slug explicitamente antes do login

Arquivos provaveis:

- `docker/nginx.dev.conf`
- `docker/nginx.prod.conf`

## Modos suportados

### Recomendado para producao

Subdominio por tenant:

```text
cliente-a.nodeaccess.local
cliente-b.nodeaccess.local
```

Vantagens:

- UX simples
- tenant claro antes do login
- menos necessidade de seletor manual
- bom isolamento operacional por URL

### Alternativa para ambiente interno

Tenant unico ou seletor no login:

```text
nodeaccess.interno.local
```

Com seletor controlado por `localStorage` ou configuracao do frontend. Melhor para lab ou instalacao single-tenant.

## Fases

### Fase 1

- centralizar resolucao de tenant no backend
- normalizar `localhost` para `default`
- frontend enviar `X-Tenant-Slug` pre-login
- manter rotas autenticadas usando apenas JWT
- manter `ADMIN` como papel restrito ao tenant

### Fase 2

- endpoint publico de tenant
- tela de login mostrando tenant resolvido
- mensagens claras para tenant invalido/inativo
- criar papel de plataforma para gerenciamento de tenants
- criar rotas protegidas por `requirePlatformAdmin`
- criar tela admin de tenants visivel apenas para platform admin

### Fase 3

- politica por tenant para autenticacao, branding e features
- opcional: seletor de tenant para ambientes internos
- suporte/impersonation cross-tenant apenas com justificativa, expiracao e auditoria, se um dia for necessario

## Tenant management

Fluxo recomendado para criar uma nova empresa:

1. `platform_admin` cria o tenant com `name`, `slug`, status e limites iniciais.
2. Sistema cria a licenca/configuracao base do tenant.
3. `platform_admin` cria o primeiro `ADMIN` daquele tenant.
4. O admin do tenant passa a criar usuarios, grupos, hosts e configuracoes da propria empresa.
5. Usuarios e admins comuns continuam filtrados pelo `tenantId` do JWT.

APIs provaveis:

- `GET /api/v1/platform/tenants`
- `POST /api/v1/platform/tenants`
- `PATCH /api/v1/platform/tenants/:id`
- `POST /api/v1/platform/tenants/:id/admins`

UI provavel:

- menu `Tenants` ou `Empresas` visivel apenas para platform admin
- tela de listagem de tenants com status, slug, usuarios ativos e data de criacao
- modal de criacao com primeiro admin

Bootstrap operacional:

- apos aplicar migration, promover o primeiro usuario existente com `npm run platform:promote-admin -w apps/backend -- --email admin@empresa.com`
- esse usuario passa a enxergar a area de plataforma para criar novos tenants

Ponto tecnico importante:

- O modelo atual tem `User.email` unico global.
- Se o mesmo email precisar existir em tenants diferentes, sera necessario mudar para unicidade composta por tenant, por exemplo `@@unique([tenantId, email])`.
- Se a regra desejada for "um email so pode existir uma vez na instalacao", pode manter como esta.

## Fora do escopo inicial

- permitir trocar tenant sem novo login
- criacao self-service de tenant
- mover escopo de tenant para header em rotas autenticadas
- refatorar todos os modulos para um novo middleware global sem necessidade
- acesso automatico do platform admin aos dados sensiveis dos tenants

## Riscos

- Se `X-Tenant-Slug` continuar vindo como `$host` sem normalizacao, `localhost` pode ser tratado como tenant real.
- Se rotas autenticadas aceitarem tenant vindo do cliente, pode haver risco de acesso cross-tenant.
- Se a UI nao mostrar o tenant antes do login, o usuario pode autenticar no tenant errado em ambientes com varios clientes.
- Se `ADMIN` virar papel global, admins de tenant podem ganhar privilegios indevidos.
- Se platform admin conseguir acessar dados de tenant sem auditoria, isso vira risco operacional e de compliance.

## Validacao minima

- login em `localhost` resolve tenant `default`
- login em subdominio resolve o tenant correto
- tenant inexistente retorna erro claro
- tenant inativo bloqueia login
- chamada autenticada ignora tentativa de trocar tenant via header
- WebSocket SSH continua usando `tenantId` do JWT
- admin do tenant nao lista nem edita outros tenants
- platform admin cria tenant e primeiro admin
- platform admin nao acessa hosts/secrets/sessoes de tenant sem fluxo explicito
