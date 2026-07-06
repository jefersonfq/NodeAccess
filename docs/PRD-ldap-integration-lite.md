# PRD LDAP / Active Directory e Identity Providers Lite

## Objetivo
Adicionar suporte opcional a LDAP/Active Directory como provider de integracao do NodeAccess e estabelecer a base arquitetural para outros sistemas de identidade corporativa.

Este documento tambem passa a orientar a separacao entre:

- autenticacao no portal NodeAccess;
- autorizacao interna do NodeAccess;
- integracoes AAA de infraestrutura, como TACACS+;
- auditoria central de sessoes e comandos.

Para LDAP/Active Directory, o objetivo direto e:

- autenticar usuarios contra diretorio corporativo;
- sincronizar usuarios e, futuramente, grupos;
- reduzir manutencao manual de contas locais;
- manter login local como fallback controlado;
- preservar isolamento multi-tenant e auditoria de autenticacao.

## Estado atual
LDAP/Active Directory aparece hoje apenas como item futuro/fora de escopo em documentos gerais:

- `docs/PRD-lite.md`
- `docs/PRD.txt`

Nao havia um PRD especifico para esta frente antes deste documento.

O projeto ja possui base adequada para encaixar LDAP como integracao:

- tabela `integrations` por `tenant_id + provider`;
- `config` em JSON por provider;
- licenciamento por provider via entitlements;
- modulos existentes para Google, JIRA, 1Password, OpenAI e IA local;
- auth local com JWT, refresh e TOTP;
- logs de autenticacao e administrativos.

## Esforco estimado

Classificacao: **medio**.

Estimativa recomendada:

- MVP seguro de autenticacao LDAP: **5 a 8 dias uteis**.
- Versao completa com sincronizacao de usuarios/grupos: **10 a 15 dias uteis**.
- Base RBAC interna antes de IdPs corporativos avancados: **5 a 10 dias uteis**, dependendo do corte de permissoes.
- OIDC/SAML para Microsoft Entra ID ou Okta apos a base de identidade: **6 a 12 dias uteis por familia de protocolo/provider**.
- TACACS+ client: **8 a 15 dias uteis**.
- NodeAccess como servidor TACACS+: **20+ dias uteis**, recomendado apenas como evolucao premium.

Premissas:

- manter usuarios locais como entidade canonica do NodeAccess;
- LDAP valida apenas identidade e senha corporativa;
- permissoes, grupos, licenca, auditoria, preferencias e sessoes continuam no NodeAccess;
- nao substituir o fluxo atual de TOTP/MFA;
- manter conta local administrativa de emergencia (`break-glass`) por tenant.

## Decisao arquitetural recomendada

Nao acoplar LDAP diretamente no `AuthService`.

Criar uma camada de **Identity Provider** para permitir evolucao limpa e coexistencia entre:

- login local;
- LDAP/Active Directory;
- Google SSO existente;
- Microsoft Entra ID via OIDC/SAML;
- Okta via OIDC/SAML;
- futuros providers corporativos.

Contrato conceitual:

```ts
interface IdentityProvider {
  type: 'local' | 'ldap' | 'oidc' | 'saml' | 'google'
  providerKey: 'local' | 'ldap' | 'microsoft_entra' | 'okta' | 'google' | string
  authenticate(input: IdentityProviderAuthenticateInput): Promise<AuthenticatedIdentity>
  getPublicConfig?(tenantId: number): Promise<IdentityProviderPublicConfig>
}
```

Fluxo-alvo:

```text
Login
 -> resolve tenant
 -> resolve provider habilitado para o tenant
 -> autentica no provider
 -> encontra ou provisiona usuario local espelho
 -> aplica regras NodeAccess: ativo, role, grupos, MFA, JWT, refresh
```

O registro local em `users` deve continuar existindo mesmo para usuarios LDAP, pois ele concentra:

- `tenantId`;
- papel (`ADMIN`/`USER`);
- grupos NodeAccess;
- permissoes operacionais;
- status ativo/inativo;
- consumo de licenca;
- auditoria;
- preferencias;
- historico de sessoes.

## Separacao AuthN, AuthZ e auditoria

Princípio arquitetural:

```text
Provedores externos autenticam.
NodeAccess autoriza.
NodeAccess audita.
NodeAccess executa ou intermedeia a sessao.
```

Definicoes:

- **AuthN / identidade**: quem e o usuario. Pode vir de Local DB, LDAP/AD, Microsoft Entra ID, Okta ou outro IdP.
- **AuthZ / permissao**: o que o usuario pode fazer dentro do NodeAccess. Deve ser decidido pelo RBAC/ABAC interno.
- **Execucao de acesso**: abertura de SSH, Telnet, RDP, VNC, SQL ou outros protocolos.
- **Auditoria**: registro de sessao, comandos, origem, destino, justificativa e eventos administrativos.

Essa separacao evita que cada cliente force o NodeAccess a espalhar regras de permissao em LDAP, Entra ID, Okta ou TACACS+. O produto fica como broker central de acesso e politica.

## RBAC interno como pre-requisito

Antes de expandir para LDAP completo, Microsoft Entra ID, Okta, SAML/OIDC e TACACS+, o NodeAccess deve consolidar um RBAC interno minimo.

Motivos:

- grupos externos variam por cliente e provider;
- permissao de acesso a host/protocolo nao deve depender do formato de grupos do IdP;
- o backend precisa de uma camada unica para decidir acesso, independente da origem do login;
- a UI precisa consultar permissoes efetivas sem conhecer LDAP, SAML, OIDC ou TACACS+;
- auditoria deve registrar a decisao do NodeAccess, nao apenas a resposta do IdP.

Modelo recomendado:

```text
Grupo externo: Entra ID / Okta / LDAP / AD
        |
        v
Mapeamento de identidade/grupo externo
        |
        v
Grupo ou Role interna do NodeAccess
        |
        v
Permissoes NodeAccess por host, protocolo, acao e auditoria
```

Exemplo:

```text
Grupo externo: NOC_N1
Grupo NodeAccess: Suporte N1
Permissoes:
- hosts:view
- hosts:connect:ssh em escopo de roteadores
- hosts:connect:telnet em equipamentos legados
- sessions:view_own
- session_audit:record_required
- databases:connect negado
```

Referencia relacionada: `docs/PRD-rbac-lite.md`.

## Login no portal NodeAccess

Providers recomendados para acesso a interface web:

| Integracao | Uso ideal | Protocolo principal | Observacao |
| --- | --- | --- | --- |
| Local DB | contas internas e emergencia | senha local + MFA NodeAccess | deve continuar como break-glass controlado |
| LDAP/AD | login tradicional usuario/senha interno | LDAP bind / LDAPS / StartTLS | bom para ambientes AD sem SSO moderno |
| Microsoft Entra ID | SSO corporativo Microsoft | OIDC ou SAML | pode herdar MFA e Conditional Access do IdP |
| Okta | SSO corporativo multi-cloud | OIDC ou SAML | bom para clientes com varios dominios/apps |

Regra:

- OIDC/SAML devem ser tratados como IdPs de login federado.
- LDAP deve ser tratado como autenticacao direta por bind.
- Local DB deve permanecer para contas internas, break-glass e tenants sem IdP.
- Para novas integracoes SSO web, preferir **OIDC Authorization Code Flow**.
- SAML deve ser suportado para clientes corporativos que ja padronizaram SAML ou que exigem compatibilidade com apps legados.

## Controle de acesso dentro do NodeAccess

Depois do login, o NodeAccess deve decidir internamente:

- quem pode acessar qual host;
- qual protocolo pode usar: SSH, Telnet, RDP, VNC, SQL ou outros;
- se pode abrir sessao interativa;
- se pode apenas visualizar;
- se pode compartilhar sessao;
- se pode gravar ou se a gravacao e obrigatoria;
- se pode executar snippets, secrets, port forwarding ou acoes de IA;
- se pode encerrar sessoes de terceiros;
- se pode consultar auditoria.

Essas decisoes pertencem ao RBAC/ABAC do NodeAccess. Provedores externos podem fornecer grupos e atributos, mas nao devem ser a fonte final de autorizacao operacional.

## TACACS+

TACACS+ deve ser tratado como trilha de AAA de infraestrutura, separada do login web.

### Opcao A — NodeAccess como cliente TACACS+

Fluxo:

```text
NodeAccess -> servidor TACACS+ existente -> valida usuario/senha/permissao
```

Uso ideal:

- clientes com Cisco ISE, Aruba ClearPass, tac_plus ou stack AAA existente;
- validar credencial ou atributo adicional antes de liberar acesso;
- enriquecer decisao de acesso sem transformar NodeAccess em servidor AAA.

Recomendacao: **primeira fase TACACS+**, se houver demanda.

### Opcao B — NodeAccess como servidor TACACS+

Fluxo:

```text
Switch/Roteador/SBC -> NodeAccess TACACS+ -> politica NodeAccess -> autorizacao/accounting
```

Capacidades potenciais:

- login em equipamento;
- autorizacao por comando;
- accounting TACACS+;
- auditoria por comando fora da sessao web;
- politica centralizada para equipamentos de rede.

Recomendacao: tratar como **evolucao premium**, pois e muito mais complexo e muda o papel do NodeAccess no ambiente do cliente.

## Coexistencia entre provedores

| Recurso | Pode coexistir? | Observacao |
| --- | --- | --- |
| LDAP + login local | Sim | local deve servir como fallback ou break-glass |
| Entra ID + Okta | Sim | normalmente o cliente escolhe um principal, mas multi-provider pode existir por tenant |
| Entra ID + LDAP | Sim | comum em ambiente hibrido |
| Okta + LDAP | Sim | Okta pode federar/sincronizar AD, ou NodeAccess pode mapear ambos |
| TACACS+ + LDAP | Sim | TACACS pode usar LDAP como backend, ou NodeAccess pode consultar ambos |
| TACACS+ + Entra/Okta | Sim, com ressalvas | geralmente exige proxy, RADIUS ou desenho intermediario |

O NodeAccess deve suportar multiplos providers configurados, mas a politica do tenant deve definir:

- provider principal;
- providers permitidos para login;
- fallback local;
- regras de auto-provisionamento;
- regras de vinculacao de identidade externa;
- prioridade de grupos externos quando houver conflito.

## Fases recomendadas para a visao ampliada

### Fase 1 — Base essencial e vendavel

- Login local preservado.
- RBAC interno minimo.
- LDAP/Active Directory.
- Mapeamento de grupos externos para grupos internos.
- Auditoria de autenticacao e sessao.

### Fase 2 — Corporativo

- Microsoft Entra ID via OIDC/SAML.
- Okta via OIDC/SAML.
- MFA herdado do IdP quando aplicavel.
- Provisionamento SCIM.
- Politicas de auto-provisionamento e desativacao.

### Fase 3 — Infra avancada

- TACACS+ client.
- Integracao com servidores TACACS+ existentes.
- Politica por host/protocolo.
- Auditoria enriquecida de autorizacao.

### Fase 4 — Diferencial premium

- NodeAccess como servidor TACACS+.
- Autorizacao por comando.
- Accounting TACACS+.
- Controle centralizado de equipamentos de rede.

## Validacao com documentacoes oficiais

Esta secao registra decisoes para evitar refatoracao futura ao iniciar a implementacao.

### Microsoft Entra ID

#### OIDC

Documentacao consultada:

- `https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc`
- `https://learn.microsoft.com/en-us/entra/identity/hybrid/connect/how-to-connect-fed-group-claims`
- `https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups`

Decisoes para NodeAccess:

- usar OIDC como integracao preferencial para Microsoft Entra ID;
- usar tenant especifico (`tenantId` ou dominio do tenant) em vez de `common` para tenants empresariais, evitando login de diretorio errado;
- consumir discovery document (`/.well-known/openid-configuration`) para endpoints e JWKS;
- validar assinatura, issuer, audience, expiration, nonce e claims obrigatorias do ID token usando biblioteca consolidada;
- usar Authorization Code Flow para app web backend, nao implicit flow;
- persistir `oid`/`sub` como identidade externa estavel, com cuidado para diferenciar tenant;
- tratar `email`, `preferred_username` ou UPN como atributos de exibicao/login, nao como chave primaria imutavel;
- nao depender de claims de grupos grandes no token para autorizacao final;
- preferir `ApplicationGroup` ou grupos atribuidos ao app quando claims de grupo forem usadas;
- mapear grupos/roles externos para grupos/roles internos do NodeAccess;
- considerar SCIM para provisionamento e desativacao em clientes corporativos.

Riscos mapeados:

- claims de grupo possuem limites de tamanho; em tenants grandes, o IdP pode omitir grupos ou emitir overage;
- nomes de grupos nao sao identificadores seguros; preferir ObjectId ou app roles;
- `common` pode aceitar usuarios fora do tenant esperado;
- tokens precisam suportar rotacao de chaves JWKS.

#### SAML

Documentacao consultada:

- `https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/add-application-portal-setup-sso`

Decisoes para NodeAccess:

- suportar SAML como Service Provider;
- expor metadata SP do NodeAccess por tenant;
- configurar no Entra: Entity ID, Reply URL/ACS, Sign-on URL e certificado de assinatura;
- validar assinatura da assertion/resposta, issuer, audience, recipient, destination, NotBefore/NotOnOrAfter e InResponseTo;
- aceitar atributos minimos: identificador externo, email, nome e grupos/roles opcionais;
- manter RelayState apenas como retorno validado/assinado internamente, nunca como URL aberta.

### Okta

#### OIDC

Documentacao consultada:

- `https://developer.okta.com/docs/guides/implement-grant-type/authcode/main/`
- `https://developer.okta.com/docs/guides/build-sso-integration/saml2/main/`

Decisoes para NodeAccess:

- usar OIDC Authorization Code Flow como caminho preferencial para novas integracoes Okta;
- usar redirect authentication em vez de embedded auth;
- configurar app web com client id, client secret, issuer, redirect URI e logout redirect URI;
- validar tokens por issuer/JWKS, audience, nonce, expiration e assinatura;
- usar claims de grupo apenas como entrada de mapeamento para RBAC interno;
- modelar Okta como provider OIDC generico com presets de UI/config.

Riscos mapeados:

- clientes podem usar authorization server customizado; `issuer` deve ser configuravel;
- claims e grupos variam por authorization server;
- API Access Management pode ser licenciamento separado no Okta para alguns cenarios.

#### SAML

Documentacao consultada:

- `https://developer.okta.com/docs/guides/build-sso-integration/saml2/main/`

Decisoes para NodeAccess:

- suportar ACS URL, Entity ID/Audience URI e RelayState;
- exigir SHA-256 para assinatura;
- manter atributos SAML minimos para reduzir payload;
- permitir envio de grupos como atributo, mas com mapeamento interno e limite operacional;
- aceitar private app primeiro; publicacao OIN deve ser uma etapa comercial posterior.

### SCIM 2.0

Documentacoes consultadas:

- `https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups`
- `https://developer.okta.com/docs/api/openapi/okta-scim/guides/scim-20/`
- `https://www.rfc-editor.org/rfc/rfc7644.html`

Decisoes para NodeAccess:

- tratar SCIM como canal de provisionamento, nao como login;
- criar endpoints `/scim/v2/Users` e `/scim/v2/Groups` em fase corporativa;
- suportar `userName` como identificador unico configuravel por tenant;
- suportar filtro `userName eq "..."`, obrigatorio para integracao Okta;
- mapear `active=false` para desativacao/revogacao de usuario local, com politica configuravel;
- ignorar senha enviada por SCIM; o NodeAccess nao deve aceitar senha provisionada por SCIM para usuarios externos;
- guardar `externalId` do IdP e ID local do recurso SCIM;
- registrar auditoria de create/update/deactivate/group membership.

Modelo minimo:

```text
SCIM cria/atualiza usuario -> User local espelho
SCIM cria/atualiza grupo   -> Grupo NodeAccess ou grupo externo mapeavel
Login OIDC/SAML/LDAP       -> usa identidade externa ja provisionada
RBAC NodeAccess            -> decide acesso final
```

### LDAP / Active Directory

Documentacoes consultadas:

- `https://www.rfc-editor.org/rfc/rfc4511.html`
- `https://www.rfc-editor.org/rfc/rfc4513.html`

Decisoes para NodeAccess:

- LDAP e uma integracao de autenticacao direta por bind, diferente de OIDC/SAML;
- implementar fluxo service bind -> search user -> user bind;
- suportar LDAPS e StartTLS;
- bloquear ou alertar fortemente LDAP sem TLS em producao;
- escapar filtros LDAP e nunca interpolar entrada do usuario diretamente;
- limitar base DN, escopo de busca, atributos retornados, timeout e tamanho de resposta;
- mapear atributos por configuracao: email, displayName, username, objectGUID/objectSid/DN e memberOf;
- persistir identificador externo estavel, preferindo objectGUID/objectSid em AD quando disponivel;
- manter login local separado e auditado.

### TACACS+

Documentacao consultada:

- `https://www.rfc-editor.org/rfc/rfc8907.html`

Decisoes para NodeAccess:

- TACACS+ e AAA para administracao de dispositivos, nao substituto direto de SSO web;
- Fase recomendada inicial: NodeAccess como cliente TACACS+;
- NodeAccess como servidor TACACS+ deve ser produto premium separado;
- considerar authentication, authorization e accounting como capacidades separadas;
- para servidor TACACS+, planejar command authorization e command accounting;
- proteger shared secrets, origem dos clientes, timeout, replay/logging e segregacao por tenant;
- nao misturar regra TACACS+ com RBAC web; criar adaptador AAA proprio.

## Coexistencia LDAP + usuario local

O tenant deve permitir uma politica explicita:

```text
LOCAL_ONLY
LDAP_ONLY
LOCAL_AND_LDAP
```

Regras:

- `LOCAL_ONLY`: comportamento atual; LDAP ignorado no login.
- `LDAP_ONLY`: usuarios finais autenticam via LDAP; conta local break-glass continua permitida para admin autorizado.
- `LOCAL_AND_LDAP`: usuarios locais e LDAP coexistem; a origem do usuario define como validar a senha.

Campos recomendados no usuario local:

```text
authProvider: LOCAL | LDAP | OIDC | SAML | GOOGLE
providerKey: local | ldap | microsoft_entra | okta | google | ...
externalId: DN, objectGUID, OIDC sub/oid ou NameID SAML
ldapDn: DN completo do usuario
ldapUsername: sAMAccountName, userPrincipalName ou uid
lastExternalSyncAt: data do ultimo sync
```

Regra para duplicidade:

- nao auto-vincular usuario LDAP a usuario local apenas por e-mail sem politica explicita;
- preferir link manual ou auto-link somente quando dominio/tenant estiver validado e configurado pelo admin;
- em caso de conflito, negar login com mensagem generica e registrar evento administrativo.

Conta de emergencia:

- cada tenant deve poder manter pelo menos um admin local fora do LDAP;
- esse usuario deve ser auditavel e recomendado apenas para recuperacao operacional;
- desabilitar totalmente login local deve exigir confirmacao forte e validacao de outro admin LDAP funcional.

## Escopo recomendado
### Fase 1 — Autenticacao LDAP

Permitir que o tenant configure um servidor LDAP/AD e habilite login por senha LDAP.

Fluxo:

1. Usuario informa email/login e senha.
2. Backend resolve tenant pelo fluxo atual.
3. Backend busca integracao `ldap` habilitada.
4. Backend procura o usuario no diretorio.
5. Backend tenta bind com DN do usuario e senha informada.
6. Se valido, emite `tempToken` normal para seguir MFA/TOTP.
7. Se o usuario local ainda nao existir e `autoProvision` estiver habilitado, cria usuario local.

Regras:

- TOTP continua obrigatorio no NodeAccess.
- LDAP valida o primeiro fator; MFA permanece local.
- Login local pode continuar habilitado como fallback conforme politica do tenant.
- Usuario local desativado no NodeAccess nao deve conseguir logar via LDAP.
- Falha LDAP deve retornar erro generico de credenciais para nao enumerar contas.

### Fase 2 — Sincronizacao de usuarios

Adicionar job manual e/ou agendado para sincronizar usuarios do diretorio.

Capacidades:

- listar usuarios via `userSearchBase` + `userFilter`;
- criar usuarios locais quando permitido;
- atualizar nome/email;
- marcar usuarios como `external`;
- desativar usuario local quando ele for removido/desativado no diretorio, se policy permitir;
- registrar resumo da sincronizacao.

### Fase 3 — Mapeamento de grupos

Sincronizar grupos LDAP/AD para grupos do NodeAccess.

Capacidades:

- mapear `memberOf` ou busca reversa por grupo;
- vincular usuarios a grupos do NodeAccess;
- permitir mapeamento manual `ldapGroupDn -> nodeAccessGroupId`;
- opcionalmente criar grupos automaticamente com prefixo configuravel.

## Fora do escopo inicial da Fase LDAP

- SAML/OIDC corporativo.
- Kerberos/SPNEGO.
- Login transparente integrado ao Windows.
- Sincronizacao completa de OU, atributos arbitrarios ou politicas de senha.
- Substituir MFA/TOTP do NodeAccess pelo MFA do AD.
- Gravar senha LDAP no NodeAccess.

## Configuracao sugerida

Provider:

```text
ldap
```

Config publica segura:

```json
{
  "enabled": true,
  "mode": "ldap",
  "url": "ldaps://ad.empresa.local:636",
  "startTls": false,
  "baseDn": "dc=empresa,dc=local",
  "userSearchBase": "ou=Usuarios,dc=empresa,dc=local",
  "userFilter": "(&(objectClass=user)(mail={{email}}))",
  "bindDn": "cn=nodeaccess,ou=Service Accounts,dc=empresa,dc=local",
  "autoProvision": true,
  "localLoginFallback": true,
  "syncUsersEnabled": false,
  "syncGroupsEnabled": false,
  "groupSearchBase": "ou=Grupos,dc=empresa,dc=local",
  "groupFilter": "(&(objectClass=group)(member={{userDn}}))",
  "emailAttribute": "mail",
  "nameAttribute": "displayName",
  "usernameAttribute": "sAMAccountName",
  "memberOfAttribute": "memberOf"
}
```

Campos sensiveis:

- `bindPassword`
- certificados/CA customizados quando necessario

Esses valores devem ficar cifrados em repouso, seguindo padrao de segredos ja usado no backend.

## Modelo de dados recomendado

### Reusar `integrations`

Para a configuracao principal, usar:

- `tenantId`
- `provider = 'ldap'`
- `enabled`
- `config`

Vantagem: encaixa na arquitetura atual de integracoes e licenciamento.

### Evolucao opcional

Criar tabelas auxiliares apenas quando houver sincronizacao real:

```prisma
model ExternalIdentity {
  id          Int      @id @default(autoincrement())
  tenantId    Int      @map("tenant_id")
  userId      Int      @map("user_id")
  provider    String   @db.VarChar(40)
  externalId  String   @map("external_id") @db.VarChar(500)
  dn          String?  @db.Text
  lastSyncAt  DateTime? @map("last_sync_at")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@unique([tenantId, provider, externalId])
  @@index([tenantId, userId])
  @@map("external_identities")
}
```

Para Fase 1, pode ser suficiente adicionar no `User` campos simples futuros como `externalProvider` e `externalSubject`, mas a tabela separada e mais flexivel para varios providers.

## Arquitetura backend recomendada

Criar modulo de integracao isolado:

```text
apps/backend/src/modules/integrations/ldap.service.ts
```

Responsabilidades:

- validar configuracao;
- testar conexao;
- bind com service account;
- buscar usuario por email/login;
- bind como usuario para validar senha;
- mapear atributos;
- sanitizar logs;
- expor diagnostico sem revelar senha ou DN sensivel em excesso.

Interfaces sugeridas:

```ts
interface LdapIdentityProvider {
  testConnection(config): Promise<LdapTestResult>
  authenticate(input): Promise<LdapAuthenticatedUser | null>
  findUser(input): Promise<LdapDirectoryUser | null>
  syncUsers(input): Promise<LdapSyncSummary>
}
```

O `AuthService` nao deve conhecer detalhes de LDAP. Ele deve depender de uma porta abstrata, por exemplo:

```ts
interface ExternalAuthProvider {
  authenticate(input): Promise<ExternalAuthResult>
}
```

## UI recomendada

Adicionar em `Admin > Integracoes` um painel `LDAP / Active Directory`.

Campos:

- habilitado/desabilitado;
- URL LDAP/LDAPS;
- usar StartTLS;
- Base DN;
- Bind DN;
- Bind password;
- User search base;
- User filter;
- atributos de email, nome e usuario;
- politica de auto provisionamento;
- fallback para login local;
- botao `Testar conexao`;
- botao `Testar busca de usuario` com email/login;
- resumo de ultimo sync, quando existir.

UX:

- explicar que LDAP substitui apenas senha/primeiro fator;
- deixar claro que TOTP continua obrigatorio;
- mostrar alertas fortes para `ldap://` sem TLS;
- esconder campos de sincronizacao de grupos ate a fase estar habilitada;
- nao exibir DN completo ou atributos sensiveis em listas principais.

## Licenciamento e features

Adicionar entitlement de integracao:

```text
integrations.ldap
```

Comportamento:

- se nao licenciado, nao mostrar ou mostrar bloqueado no painel de integracoes;
- backend deve bloquear `upsert/test/sync` sem entitlement;
- login LDAP deve falhar fechado se provider estiver sem licenca ou desabilitado.

## Seguranca

Regras obrigatorias:

- preferir `ldaps://` ou StartTLS;
- nunca persistir senha do usuario LDAP;
- cifrar senha de bind;
- mascarar `bindPassword` em API/logs;
- usar timeout curto de conexao e busca;
- limitar tamanho de resposta LDAP;
- permitir bind com service account de menor privilegio;
- registrar eventos:
  - `LDAP_LOGIN_SUCCESS`
  - `LDAP_LOGIN_FAILED`
  - `LDAP_CONFIG_UPDATED`
  - `LDAP_TEST_CONNECTION`
  - `LDAP_SYNC_STARTED`
  - `LDAP_SYNC_FINISHED`
  - `LDAP_SYNC_FAILED`
- nao revelar se o email existe no LDAP em resposta de login;
- manter fallback local configuravel e auditado.

## Operacao e observabilidade

Logs estruturados devem conter:

- tenantId;
- provider `ldap`;
- etapa (`connect`, `service_bind`, `search_user`, `user_bind`, `sync`);
- duracao;
- resultado;
- codigo de erro normalizado;
- sem senha, sem token e sem atributos sensiveis.

Metricas uteis:

- latencia media de login LDAP;
- taxa de falha por etapa;
- ultimo sucesso de sync;
- quantidade de usuarios criados/atualizados/desativados;
- quantidade de grupos mapeados.

## Riscos

| Risco | Impacto | Mitigacao |
| --- | --- | --- |
| LDAP indisponivel bloqueia login | Alto | fallback local configuravel, timeout curto, mensagens claras |
| Configuracao errada cai em tenant errado | Alto | manter resolucao por slug/tenant antes do LDAP |
| Busca LDAP ampla demais | Medio/alto | exigir base/filter, limite de resultados e teste de busca |
| Sem TLS expõe credenciais | Alto | alertas fortes, bloquear por policy em producao |
| Sync desativa usuarios indevidamente | Alto | primeiro sync em dry-run, preview e politica explicita |
| Grupos AD conflitam com grupos locais | Medio | mapeamento manual inicial antes de auto-criar grupos |

## Dependencias tecnicas

Biblioteca Node sugerida:

```text
ldapts
```

Motivos:

- API Promise/TypeScript;
- suporta LDAP/LDAPS/StartTLS;
- reduz callback hell;
- menor acoplamento ao core.

Alternativas:

- `ldapjs`: conhecido, mas historicamente mais pesado e com manutencao variavel.

## Plano incremental

### Base antes de LDAP

1. Consolidar catalogo minimo de permissoes no RBAC interno.
2. Criar helper unico de autorizacao no backend (`can(user, permission, context)`).
3. Criar modelo de identidade externa (`ExternalIdentity` ou campos equivalentes).
4. Criar contrato `IdentityProvider` e resolver por tenant/provider.
5. Manter `LocalIdentityProvider` como adaptador do login atual.

### LDAP / AD

6. Criar schemas shared de LDAP config/test.
7. Adicionar entitlement `integrations.ldap`.
8. Adicionar provider `ldap` no service de integracoes.
9. Implementar `ldap.service.ts` com `testConnection` e `authenticate`.
10. Integrar AuthService por interface externa, preservando login local.
11. Criar painel admin de configuracao.
12. Adicionar logs de auth/admin.
13. Adicionar sync manual em dry-run.
14. Evoluir para sync agendado.
15. Evoluir para mapeamento de grupos.

### SSO corporativo e provisionamento

16. Criar `OidcIdentityProvider` generico.
17. Adicionar presets Microsoft Entra ID e Okta para OIDC.
18. Criar `SamlIdentityProvider` generico.
19. Adicionar configuracao SP metadata/ACS por tenant.
20. Implementar SCIM 2.0 para usuarios e grupos.

### AAA de infraestrutura

21. Avaliar TACACS+ client como integracao separada de AAA.
22. Tratar NodeAccess como servidor TACACS+ apenas como produto premium futuro.

## Criterios de aceite da Fase 1

- Admin configura LDAP por tenant.
- Admin testa conexao sem expor senha.
- Usuario consegue autenticar com senha LDAP.
- TOTP continua sendo exigido apos senha LDAP valida.
- Usuario local desativado permanece bloqueado.
- Falha LDAP nao derruba login local quando fallback estiver habilitado.
- Eventos de sucesso/falha aparecem em auditoria.
- Config sensivel nao aparece em API, log ou frontend.
