# PRD RBAC Architecture

## Objetivo

Consolidar a arquitetura de RBAC do NodeAccess para suportar permissoes internas solidas, desacopladas e preparadas para integracoes corporativas como LDAP/AD, Microsoft Entra ID, Okta, OIDC, SAML, SCIM e TACACS+.

Este documento substitui a visao fragmentada de permissoes espalhadas por telas, flags e provedores externos por uma diretriz unica:

```text
Provedores externos autenticam e provisionam identidade.
NodeAccess autoriza o acesso.
NodeAccess audita a decisao e a sessao.
```

## Documentos relacionados

- `docs/PRD-rbac-lite.md`: proposta curta original de permissoes granulares.
- `docs/PRD-ldap-integration-lite.md`: visao de Identity Providers, LDAP, Entra ID, Okta, SCIM e TACACS+.
- `docs/PRD-live-sessions-overview-lite.md`: permissao dedicada para sessoes abertas.
- `docs/PRD-ssh-gateway-lite.md`: gateway deve revalidar permissao antes de conectar.
- `docs/PRD-session-audit-lite.md`: auditoria deve respeitar permissao propria.
- `docs/PRD-terminal-sharing-lite.md`: controle de sessao compartilhada exige permissao explicita e auditoria.
- `docs/PRD-vault-secrets-lite.md`: uso de secrets exige permissao no backend.
- `docs/PRD-mcp-nodeaccess-lite.md`: MCP deve reutilizar permissoes, escopo e tenant isolation existentes.
- `docs/PRD-local-ai-lite.md`: acoes de IA devem respeitar permissao do usuario.

## Estado atual

O modelo atual e funcional, mas ainda simples:

- `users.role`: `ADMIN` ou `USER`.
- `users.can_manage_hosts`: excecao para gestao de hosts.
- `users.can_view_live_sessions`: permissao dedicada para sessoes abertas.
- `groups`: segmentacao de usuarios e hosts.
- varios modulos fazem verificacoes locais com `role === 'admin'`, `canManageHosts` ou regras proprias.
- rotas administrativas usam `requireAdmin`.

Problema:

- a regra de permissao fica espalhada por modulo;
- novas integracoes podem tentar empurrar regra de grupo externo para o core;
- fica dificil responder "por que este usuario pode acessar este host/protocolo?";
- UI e backend tendem a duplicar logica;
- IdPs como LDAP, Entra ID e Okta tem formatos de grupos diferentes.

## Principios

- RBAC interno e fonte primaria de autorizacao.
- Autenticacao e autorizacao devem ser separadas.
- Backend sempre valida permissao; frontend apenas reflete capacidades.
- Permissoes devem ser orientadas por capacidade, nao por tela.
- Permissao deve considerar tenant, recurso, escopo e acao.
- Admin do tenant continua tendo todas as permissoes do tenant, salvo restricoes globais da plataforma.
- Platform admin e papel de plataforma, nao substituto do RBAC do tenant.
- Grupos externos nunca devem decidir acesso final diretamente.
- Toda decisao sensivel deve ser auditavel.
- Negar por padrao quando permissao nao for encontrada.

## Fronteira entre AuthN, Provisionamento e AuthZ

### AuthN

Responsavel por identificar o usuario:

- Local DB;
- LDAP/AD;
- Microsoft Entra ID via OIDC/SAML;
- Okta via OIDC/SAML;
- Google SSO existente.

Resultado esperado:

```text
AuthenticatedIdentity
  providerType
  providerKey
  externalId
  email
  displayName
  externalGroups?
  tenantId
```

### Provisionamento

Responsavel por criar/atualizar usuarios e grupos locais:

- SCIM;
- sync LDAP;
- importacao manual;
- auto-provisionamento no primeiro login.

Resultado esperado:

```text
User local espelho
ExternalIdentity vinculada
ExternalGroupMapping opcional
NodeAccessGroup interno
```

### AuthZ

Responsavel por decidir:

- pode ver host?
- pode conectar via SSH, Telnet, RDP, VNC ou SQL?
- pode usar secret?
- pode executar snippet?
- pode abrir port forwarding?
- pode compartilhar sessao?
- pode encerrar sessao de outro usuario?
- pode ver/exportar auditoria?
- pode configurar integracoes?

Essa decisao deve ocorrer no NodeAccess.

## Arquitetura proposta

```text
Controller / Gateway
        |
        v
Use case / Service
        |
        v
AuthorizationService.can(user, action, resource, context)
        |
        +--> PermissionCatalog
        +--> EffectivePermissionResolver
        +--> ResourceScopeResolver
        +--> PolicyConstraintEvaluator
        +--> AuditDecisionLogger
```

### Responsabilidades

`PermissionCatalog`

- catalogo estatico de permissoes conhecidas;
- tipagem compartilhada entre backend e frontend;
- nomes estaveis para auditoria, testes e UI.

`EffectivePermissionResolver`

- calcula permissoes efetivas do usuario;
- combina role base, grupos internos, atribuicoes diretas e mapeamentos externos ja sincronizados;
- nao conhece LDAP, OIDC, SAML ou TACACS+.

`ResourceScopeResolver`

- resolve se o recurso pertence ao tenant;
- resolve escopo do recurso: pessoal, grupo, tenant/global;
- resolve se o usuario tem relacao com o recurso.

`PolicyConstraintEvaluator`

- avalia condicoes adicionais;
- exemplos: protocolo, escopo do host, obrigatoriedade de auditoria, horario, IP, JIT, comando, gravacao.

`AuditDecisionLogger`

- registra decisoes sensiveis e negacoes relevantes;
- evita logar em excesso decisoes triviais de UI/listagem;
- sempre registra mudancas de permissao.

## Aplicacao de SOLID

### Single Responsibility

- `AuthService` autentica e emite tokens.
- `IdentityProvider` autentica contra provider externo.
- `ProvisioningService` cria/atualiza usuarios e grupos locais.
- `AuthorizationService` decide permissao.
- Modulos de negocio executam a acao depois da autorizacao.

### Open/Closed

Novas permissoes entram no catalogo sem reescrever todos os modulos.

Novos providers entram por adaptadores:

```text
LdapIdentityProvider
OidcIdentityProvider
SamlIdentityProvider
LocalIdentityProvider
TacacsAaaAdapter
```

O RBAC nao muda porque um provider novo foi adicionado.

### Liskov Substitution

Todo provider deve retornar uma identidade normalizada. O login nao pode depender de detalhes como `memberOf`, `groups`, `oid`, `NameID` ou `sAMAccountName` fora do adaptador.

### Interface Segregation

Separar interfaces:

```ts
interface IdentityProvider {
  authenticate(input: AuthInput): Promise<AuthenticatedIdentity>
}

interface ProvisioningProvider {
  sync(input: SyncInput): Promise<ProvisioningSummary>
}

interface AuthorizationPort {
  can(input: AuthorizationInput): Promise<AuthorizationDecision>
}

interface AaaProvider {
  authenticate(input: AaaAuthInput): Promise<AaaAuthResult>
  authorize?(input: AaaAuthorizeInput): Promise<AaaAuthorizeResult>
  account?(input: AaaAccountingInput): Promise<void>
}
```

LDAP pode implementar AuthN e Provisioning; SCIM apenas Provisioning; TACACS+ AAA; RBAC nenhum deles.

### Dependency Inversion

Use cases dependem de `AuthorizationPort`, nao de Prisma, LDAP, Okta ou Entra ID.

Adapters externos ficam na borda:

```text
core authorization -> repositories/interfaces
providers externos -> adapters/integrations
```

## Modelo conceitual

### Entidades

`Permission`

- catalogo tecnico, versionado em codigo;
- exemplo: `hosts.connect.ssh`.

`Role`

- conjunto nomeado de permissoes por tenant;
- pode representar perfis como `Administrador`, `Suporte N1`, `Auditoria`.

`Group`

- grupo interno do NodeAccess;
- pode ser gerenciado manualmente ou alimentado por mapeamento externo.

`UserRoleAssignment`

- atribui role ao usuario.

`GroupRoleAssignment`

- atribui role ao grupo interno.

`UserPermissionOverride`

- excecao direta por usuario;
- deve ser usado com parcimonia e sempre auditado.

`ExternalIdentity`

- vincula usuario local a uma identidade externa.

`ExternalGroupMapping`

- mapeia grupo externo para grupo ou role interna.

`AccessPolicy`

- regras condicionais por recurso/contexto;
- evolucao para ABAC controlado.

## Modelo de dados recomendado

```prisma
model PermissionRole {
  id          Int      @id @default(autoincrement())
  tenantId    Int      @map("tenant_id")
  name        String
  description String?  @db.Text
  systemKey   String?  @map("system_key")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@unique([tenantId, name])
  @@index([tenantId, systemKey])
  @@map("permission_roles")
}

model PermissionRoleGrant {
  roleId     Int      @map("role_id")
  permission String   @db.VarChar(120)
  effect     String   @default("ALLOW") @db.VarChar(20)
  createdAt  DateTime @default(now()) @map("created_at")

  @@id([roleId, permission])
  @@map("permission_role_grants")
}

model UserRoleAssignment {
  tenantId  Int      @map("tenant_id")
  userId    Int      @map("user_id")
  roleId    Int      @map("role_id")
  createdAt DateTime @default(now()) @map("created_at")

  @@id([tenantId, userId, roleId])
  @@index([tenantId, userId])
  @@map("user_role_assignments")
}

model GroupRoleAssignment {
  tenantId  Int      @map("tenant_id")
  groupId   Int      @map("group_id")
  roleId    Int      @map("role_id")
  createdAt DateTime @default(now()) @map("created_at")

  @@id([tenantId, groupId, roleId])
  @@index([tenantId, groupId])
  @@map("group_role_assignments")
}

model ExternalIdentity {
  id          Int      @id @default(autoincrement())
  tenantId    Int      @map("tenant_id")
  userId      Int      @map("user_id")
  providerKey String   @map("provider_key") @db.VarChar(80)
  providerType String  @map("provider_type") @db.VarChar(40)
  externalId  String   @map("external_id") @db.VarChar(500)
  username    String?  @db.VarChar(255)
  dn          String?  @db.Text
  lastSyncAt  DateTime? @map("last_sync_at")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@unique([tenantId, providerKey, externalId])
  @@index([tenantId, userId])
  @@map("external_identities")
}

model ExternalGroupMapping {
  id             Int      @id @default(autoincrement())
  tenantId       Int      @map("tenant_id")
  providerKey    String   @map("provider_key") @db.VarChar(80)
  externalGroupId String  @map("external_group_id") @db.VarChar(500)
  externalName   String?  @map("external_name") @db.VarChar(255)
  groupId        Int?     @map("group_id")
  roleId         Int?     @map("role_id")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  @@unique([tenantId, providerKey, externalGroupId])
  @@index([tenantId, groupId])
  @@index([tenantId, roleId])
  @@map("external_group_mappings")
}
```

Observacao:

- `Permission` nao precisa ser tabela no primeiro corte; pode ser catalogo em codigo.
- `RoleGrant.effect = DENY` deve ser evitado no MVP. Comecar com allow-list simplifica auditoria e suporte.

## Compatibilidade com modelo atual

No primeiro corte, manter:

- `role = ADMIN`: recebe todas as permissoes do tenant.
- `role = USER`: recebe perfil base `User padrao`.
- `canManageHosts`: alimenta permissoes `hosts.create`, `hosts.update`, `hosts.trust_key` conforme escopo.
- `canViewLiveSessions`: alimenta `sessions.view_live`.

Isso permite migrar sem quebrar tenants existentes.

## Ordem de resolucao

1. Validar usuario ativo, tenant ativo e licenca.
2. Se platform admin em tenant delegado, aplicar regras de delegacao.
3. Se `role = ADMIN`, conceder permissoes do tenant, exceto restricoes globais.
4. Carregar roles diretas do usuario.
5. Carregar roles herdadas dos grupos internos.
6. Aplicar permissoes legadas (`canManageHosts`, `canViewLiveSessions`).
7. Aplicar politicas condicionais do recurso.
8. Negar por padrao.

## Nomenclatura de permissoes

Padrao:

```text
dominio.recurso.acao
```

Exemplos:

- `hosts.view`
- `hosts.create`
- `hosts.update`
- `hosts.delete`
- `hosts.connect.ssh`
- `hosts.connect.telnet`
- `hosts.connect.rdp`
- `hosts.connect.vnc`
- `hosts.connect.sql`
- `hosts.test`
- `hosts.import`
- `hosts.trust_key`
- `forwardings.view`
- `forwardings.open`
- `forwardings.manage`
- `snippets.view`
- `snippets.execute`
- `snippets.manage`
- `secrets.view`
- `secrets.use`
- `secrets.manage`
- `agents.view`
- `agents.manage`
- `sessions.view_own`
- `sessions.view_all`
- `sessions.view_live`
- `sessions.close_own`
- `sessions.close_any`
- `session_audit.view`
- `session_audit.export`
- `session_audit.ai`
- `shared_sessions.create`
- `shared_sessions.request_control`
- `shared_sessions.grant_control`
- `integrations.manage`
- `identity_providers.manage`
- `users.manage`
- `groups.manage`
- `roles.manage`
- `settings.manage`
- `logs.view`
- `mcp.use`
- `mcp.manage`
- `ai_actions.request`
- `ai_actions.approve`
- `ai_actions.execute`

## Contexto de autorizacao

Permissao sem contexto e insuficiente para acesso operacional.

```ts
type AuthorizationContext = {
  tenantId: number
  userId: number
  action: PermissionKey
  resourceType?: 'host' | 'session' | 'secret' | 'agent' | 'group' | 'integration'
  resourceId?: number
  hostProtocol?: 'ssh' | 'telnet' | 'rdp' | 'vnc' | 'sql'
  hostScope?: 'personal' | 'team' | 'global'
  groupIds?: number[]
  accessType?: 'interactive' | 'jit_public_link' | 'native_gateway' | 'mcp' | 'agent'
  reason?: string
}
```

Exemplo:

```text
Usuario tem hosts.connect.ssh
Mas so pode conectar se:
- host pertence ao tenant;
- host esta no escopo visivel para ele;
- protocolo solicitado e SSH;
- policy de sessao permite acesso;
- gravacao obrigatoria e cumprida quando aplicavel.
```

## Mapeamento de provedores externos

### LDAP/AD

- LDAP autentica por bind e pode fornecer grupos (`memberOf` ou busca reversa).
- Grupos LDAP devem mapear para grupos/roles internos.
- Preferir `objectGUID`, `objectSid` ou DN estavel como `externalGroupId`.
- Nao usar nome de grupo como identificador final.

### Microsoft Entra ID

- OIDC/SAML autentica.
- SCIM provisiona usuarios/grupos.
- Claims de grupos podem ter overage; nao depender deles como unica fonte.
- Preferir ObjectId de grupo, app roles ou SCIM.

### Okta

- OIDC/SAML autentica.
- SCIM provisiona usuarios/grupos.
- Claims de grupo variam por authorization server; tratar como entrada de mapeamento, nao permissao final.

### TACACS+

- TACACS+ client pode alimentar decisao adicional de AAA.
- TACACS+ server futuro deve usar RBAC/Policy do NodeAccess para command authorization/accounting.
- Nao misturar adapter TACACS+ com RBAC web; criar camada `AaaProvider`.

## Fluxo recomendado de login com IdP externo

```text
1. Usuario autentica via LDAP/OIDC/SAML/local.
2. IdentityProvider retorna identidade normalizada.
3. NodeAccess encontra ou cria User local espelho.
4. Provisioning/mapping atualiza grupos internos quando permitido.
5. AuthService emite tempToken/JWT.
6. RBAC efetivo e carregado no `/me` ou no token apenas como resumo.
7. Cada acao sensivel chama AuthorizationService.can().
```

Tokens JWT nao devem carregar a matriz completa de permissoes quando ela puder ficar grande. Preferir:

- claims minimas para UI rapida;
- endpoint `/me/permissions` ou cache Redis para permissoes efetivas;
- revalidacao no backend por acao critica.

## Ajustes necessarios na arquitetura atual

### Backend

1. Criar `packages/shared/src/permissions.ts` com catalogo tipado.
2. Criar `apps/backend/src/shared/authorization/authorization.service.ts`.
3. Criar `AuthorizationRepository` para roles, grupos, grants e mappings.
4. Substituir gradualmente `requireAdmin` por `requirePermission(permission, contextResolver)`.
5. Manter `requireAdmin` apenas como atalho legado para rotas ainda nao migradas.
6. Centralizar verificacao de acesso a host em um `HostAccessPolicy`.
7. Expor permissoes efetivas em endpoint autenticado.
8. Registrar `AdminLog` para alteracoes de roles, grants e mappings.
9. Registrar eventos de negacao relevantes em logs de seguranca.

### Frontend

1. Auth store deve receber permissoes efetivas ou capabilities resumidas.
2. UI deve esconder/desabilitar acoes por permissao.
3. Menus devem diferenciar falta de licenca de falta de permissao.
4. Componentes nao devem codificar `role === admin` quando existir permissao equivalente.
5. Telas administrativas devem consultar capabilities, nao provider externo.

### Gateway SSH/RDP/Telnet/SQL

1. Gateway deve revalidar permissao antes de abrir conexao.
2. A permissao deve incluir protocolo.
3. A decisao deve considerar escopo do host e grupo.
4. Sessao deve registrar qual permissao/policy autorizou o acesso.
5. Encerramento administrativo deve exigir `sessions.close_any`.

### Agentes e Zero Trust NodeAccess

1. Agente nao concede permissao por si so.
2. Agente apenas amplia rota/conectividade.
3. Usuario ainda precisa de permissao RBAC para host/protocolo.
4. Escopo do agente entra como policy de rede, nao como permissao de usuario.

## Matriz inicial de permissoes

### Perfil `Tenant Admin`

- todas as permissoes do tenant;
- nao implica platform admin.

### Perfil `User padrao`

- `hosts.view`
- `hosts.connect.ssh`
- `hosts.test`
- `forwardings.view`
- `forwardings.open`
- `snippets.view`
- `snippets.execute`
- `sessions.view_own`
- `sessions.close_own`

### Perfil `Suporte N1`

- permissoes de `User padrao`;
- `hosts.connect.telnet` quando habilitado por grupo/escopo;
- `session_audit.view` apenas de sessoes proprias ou conforme policy.

### Perfil `Operador RDP`

- `hosts.view`
- `hosts.connect.rdp`
- `sessions.view_own`
- `sessions.close_own`

### Perfil `Auditor`

- `sessions.view_all`
- `session_audit.view`
- `session_audit.export`
- sem permissao de conectar por padrao.

### Perfil `Gestor de Hosts`

- `hosts.view`
- `hosts.create`
- `hosts.update`
- `hosts.import`
- `hosts.test`
- `hosts.trust_key` conforme escopo.

## Politicas condicionais futuras

RBAC responde "pode fazer a acao?". Politicas condicionais respondem "pode fazer agora, neste recurso e nestas condicoes?".

Exemplos:

- acesso permitido apenas em horario comercial;
- exigir justificativa para host critico;
- gravacao obrigatoria para RDP/SSH em grupo X;
- proibir Telnet fora de grupo legado;
- exigir aprovacao para secrets sensiveis;
- limitar MCP/IA a acoes aprovadas;
- command policy para bloquear comandos destrutivos.

Essas regras devem viver em `PolicyConstraintEvaluator`, nao no provider externo.

## Auditoria

Auditar obrigatoriamente:

- criacao/edicao/exclusao de roles;
- alteracao de grants;
- atribuicao/remocao de role em usuario ou grupo;
- mapeamento externo para grupo/role interno;
- auto-provisionamento por IdP;
- negacoes de acesso sensiveis;
- abertura de sessao com permissao aplicada;
- encerramento de sessao por terceiro;
- exportacao de auditoria.

Campos recomendados:

```text
tenantId
actorUserId
targetUserId?
targetGroupId?
resourceType
resourceId
permission
decision
source: direct | group | role | legacy | external_mapping | admin
providerKey?
policyId?
reason
ip
userAgent
```

## Performance

O RBAC nao pode degradar a tela de hosts com centenas ou milhares de hosts.

Regras:

- catalogo de permissoes em memoria;
- permissoes efetivas por usuario/tenant em cache curto;
- invalidar cache ao alterar usuario, grupo, role ou mapeamento;
- nao calcular permissao host-a-host em loop com queries individuais;
- resolver visibilidade de hosts via SQL com joins/indices;
- usar RBAC para acoes e SQL de escopo para listagem.

Cache recomendado:

```text
rbac:effective:{tenantId}:{userId}:{version}
```

Invalidacao:

- alterou role/grant;
- alterou grupo do usuario;
- alterou mapeamento externo;
- alterou status do usuario;
- alterou escopo critico de host/grupo.

## Testes obrigatorios

### Unitarios

- admin recebe todas as permissoes do tenant;
- user padrao recebe apenas base;
- grupo interno concede role;
- permissao direta concede acao especifica;
- ausencia de permissao nega;
- provider externo nao concede acesso sem mapeamento interno;
- `canManageHosts` legado mapeia corretamente;
- `canViewLiveSessions` legado mapeia corretamente.

### Integracao

- endpoint protegido retorna `403` quando falta permissao;
- usuario sem acesso ao host nao conecta via terminal web;
- usuario sem acesso ao host nao conecta via SSH gateway;
- usuario com `sessions.close_any` encerra sessao alheia;
- usuario sem `sessions.close_any` nao encerra sessao alheia;
- mapeamento LDAP/Entra/Okta para grupo interno aplica role esperada.

### Regressao

- admins atuais continuam administrando;
- usuarios atuais continuam conectando nos hosts visiveis;
- `canManageHosts` continua funcionando ate migracao completa;
- `canViewLiveSessions` continua funcionando ate migracao completa.

## Plano incremental

### Fase 0 — Inventario

- mapear todos os `requireAdmin`, `role === 'admin'`, `canManageHosts` e `canViewLiveSessions`;
- classificar por dominio e risco;
- documentar permissao equivalente.

### Fase 1 — Fundacao

- criar catalogo de permissoes;
- criar `AuthorizationService.can()`;
- criar adapter de compatibilidade com modelo atual;
- expor permissoes efetivas em `/me`;
- sem migration complexa obrigatoria.

### Fase 2 — Persistencia RBAC

- adicionar roles, role grants e assignments;
- criar tela administrativa simples de roles;
- auditar mudancas;
- manter flags legadas sincronizadas.

### Fase 3 — Migrar modulos criticos

Ordem recomendada:

1. hosts e conexao;
2. sessoes e encerramento;
3. auditoria;
4. secrets;
5. agentes;
6. snippets;
7. port forwarding;
8. integracoes;
9. MCP/IA.

### Fase 4 — Integracoes externas

- ExternalIdentity;
- ExternalGroupMapping;
- LDAP group mapping;
- Entra/Okta OIDC/SAML claims mapping;
- SCIM users/groups;
- reconciliacao e dry-run.

### Fase 5 — Policies condicionais

- gravacao obrigatoria;
- restricao por protocolo;
- justificativa;
- command policy;
- TACACS+ client/server integration.

## Decisoes

- Implementar RBAC interno antes de expandir IdPs corporativos avancados.
- Usar provedores externos para AuthN/provisionamento, nao como fonte final de autorizacao.
- Comecar com allow-list; evitar `DENY` persistente no MVP.
- Manter compatibilidade com `ADMIN`, `USER`, `canManageHosts` e `canViewLiveSessions`.
- Separar RBAC de policies condicionais para evitar acoplamento e explosao de permissoes.
- Revalidar permissao no backend/gateway em toda acao critica.
