# Mapa da camada de entrada e políticas de autenticação

## Fluxo atual

1. O frontend inicia em modo `email-first` e consulta `POST /auth/lookup-tenant`.
2. Com um tenant, avança direto; com vários, pede a organização; sem resultado ou em erro, permite continuar.
3. O login por senha recebe `tenantSlug`, tenta credencial local e, em caso de falha, LDAP.
4. Após senha válida, TOTP é obrigatório: o primeiro acesso cadastra o fator e os demais o validam. OTP por e-mail funciona como recuperação quando há SMTP no tenant.
5. Google SSO é carregado antes da escolha da organização, usa o tenant inferido do host e emite os tokens diretamente, sem TOTP local.
6. O access token é curto e o refresh token é revogável por `jti` no Redis. Logout revoga somente o refresh informado.
7. Administrador da plataforma pode assumir um tenant com token específico e evento de auditoria.

## Pontos que exigem correção ou decisão antes do OIDC

| Prioridade | Achado | Impacto | Direção |
| --- | --- | --- | --- |
| Alta | `resolveTenant` troca um slug inexistente pelo tenant `default` | Uma seleção/configuração incorreta pode autenticar no contexto errado | Em login com slug explícito, falhar fechado. Manter fallback apenas em instalação single-tenant, por política explícita |
| Alta | Google aparece antes da resolução `email-first` e não envia o tenant escolhido | Em ambiente multi-tenant, pode mostrar o IdP errado ou usar a configuração do tenant inferido pelo host | Resolver tenant antes de listar/iniciar qualquer SSO |
| Alta | Google vincula automaticamente por e-mail | Colisão ou mudança de identidade no IdP pode assumir conta preexistente | Exigir `email_verified`, tenant correto e política de linking; para contas privilegiadas, confirmação administrativa |
| Alta | SSO ignora TOTP local sem política declarada | O nível de garantia depende implicitamente do IdP | Definir se MFA é delegado ao IdP e validar `acr`/`amr` quando exigido; caso contrário, executar MFA local |
| Média | Busca pública retorna nomes e slugs dos tenants associados ao e-mail | Possibilita enumeração de associação organizacional | Rate limit, resposta uniforme e opção de descoberta restrita por instalação |
| Média | Bloqueio de 5 tentativas/15 minutos e TTLs são constantes ou globais | Tenant não consegue adaptar política, e valores podem divergir de requisitos corporativos | Transformar em limites governados, com piso/teto da instalação |
| Média | Refresh valida usuário ativo, mas não reavalia tenant ativo nem versão de política/permissões | Mudanças críticas podem persistir até novo login ou access token expirar | Revalidar vínculo/tenant e adotar versão de sessão para revogação ampla |
| Média | Logout revoga apenas um refresh token | "Sair de todos os dispositivos" não existe | Manter logout simples e oferecer revogação global auditada |

## Hierarquia de configuração

Precedência obrigatória:

`invariantes da plataforma > limites da instalação > política do tenant > preferência do usuário`

Uma camada inferior pode endurecer um controle, mas nunca ultrapassar teto, reduzir piso ou desativar um invariante da camada superior.

### Invariantes da plataforma

Não configuráveis por tenant ou usuário:

- isolamento de tenant e falha fechada quando a organização não for inequívoca;
- OIDC Authorization Code + PKCE, discovery HTTPS e lista de algoritmos permitidos;
- validação de assinatura, `issuer`, `audience`, expiração, `state` e `nonce`;
- redirect URI exata e allowlist de destinos pós-login;
- segredo cifrado, nunca retornado pela API nem escrito em logs;
- identidade externa pelo par estável `issuer + subject`, nunca somente pelo e-mail;
- auditoria de login, linking, JIT, falha, bloqueio, mudança de política e break-glass;
- usuário inativo, tenant inativo e vínculo removido encerram renovação de sessão;
- papéis privilegiados nunca são atribuídos por JIT padrão;
- mensagens públicas não revelam se usuário, tenant ou vínculo existe.

### Configuração da instalação

Definida pelo operador do ambiente/Helm e aplicada como limite ou default:

- URL pública, domínio base de tenants, proxy confiável e redirect base;
- cookies `Secure`, `HttpOnly`, `SameSite`, domínio e política de HTTPS;
- chaves de assinatura/cifragem, rotação e integração com Secret/KMS externo;
- TTL máximo de access, refresh, sessão absoluta e sessão ociosa;
- piso de MFA, lockout e rate limit; limites máximos por IP, identidade e tenant;
- habilitação dos recursos local, LDAP, Google legado e OIDC;
- allowlist de issuers/egress, CAs privadas e restrições de discovery;
- disponibilidade e custódia da conta break-glass;
- política de descoberta de tenant por e-mail;
- retenção mínima/máxima de auditoria e destino dos eventos.

### Configuração do tenant

Administrada dentro dos limites da instalação:

- provedores permitidos e provedor preferencial;
- issuer/discovery URL, client ID e referência ao client secret;
- scopes adicionais e mapeamento de nome, e-mail e grupos;
- domínios aceitos;
- JIT ligado/desligado e grupo inicial sem privilégio;
- regras explícitas de grupos do IdP para grupos locais;
- exigir SSO e permitir ou ocultar login local;
- MFA local, MFA delegada ou ambas, respeitando o piso da instalação;
- valores de sessão, lockout e recuperação dentro dos limites globais;
- linking automático apenas para e-mail verificado e contas não privilegiadas, se a instalação permitir;
- acesso ao break-glass por fluxo separado, sem expor esse usuário no login comum.

### Configuração individual do usuário

Somente preferências que não reduzam segurança:

- provedor preferido quando houver mais de um permitido;
- dispositivos/sessões e revogação própria;
- cadastro e renovação dos fatores autorizados pelo tenant;
- idioma e acessibilidade da tela de login.

O usuário não pode desabilitar MFA obrigatório, ampliar TTL, ativar linking ou escolher papel/grupo inicial.

## Modelo mínimo recomendado

Separar configuração de identidade da tabela `Tenant`:

- `IdentityProviderConfig`: tenant, tipo, nome, enabled, issuer, clientId, secret cifrado, scopes e claims;
- `ExternalIdentity`: tenant, provider, subject, user e metadados mínimos verificados;
- `TenantAuthPolicy`: descoberta, login local, SSO obrigatório, MFA, JIT, linking e tempos solicitados;
- `AuthSession`: família/versionamento de refresh para revogação por dispositivo, usuário ou tenant.

Essa separação preserva os provedores local, LDAP e Google como adaptadores e evita espalhar condicionais de fornecedor pelo `AuthService`.

## Defaults de migração sem regressão

- instalações existentes continuam com login local + LDAP e Google atuais;
- `ssoRequired=false`, `jit=false` e linking OIDC automático desligado inicialmente;
- política atual de TOTP permanece obrigatória para senha;
- Google mantém o comportamento de MFA delegado temporariamente, mas passa a ser exibido somente após resolver o tenant;
- nenhum tenant recebe OIDC ativo durante migration;
- fallback para `default` permanece apenas enquanto uma configuração de compatibilidade da instalação estiver ativa e deve gerar alerta de depreciação.

## Matriz de validação da entrada

- tenant único, múltiplos tenants, nenhum tenant e slug inválido;
- usuário local, LDAP, Google legado e OIDC;
- tenant/usuário desativado antes do login e antes do refresh;
- SSO obrigatório com IdP disponível, indisponível e break-glass;
- MFA local, MFA delegada com `acr`/`amr` suficiente e insuficiente;
- linking permitido, proibido, e-mail não verificado e conta administrativa;
- JIT permitido, domínio inválido, grupo ausente e limite de licença;
- `state`, `nonce`, issuer, audience, assinatura, relógio e JWKS inválidos/rotacionados;
- rate limit por IP/e-mail/tenant sem revelar existência;
- logout do dispositivo, logout global e mudança de política durante sessão;
- dois tenants usando o mesmo e-mail e o mesmo `subject`, garantindo isolamento;
- navegação por teclado, foco, loading, erro seguro e recuperação em viewport móvel.

## Sequência segura de implementação

1. Corrigir resolução inequívoca de tenant e fazer o frontend resolver a organização antes de apresentar provedores.
2. Introduzir `TenantAuthPolicy` com defaults compatíveis, limites da instalação e auditoria.
3. Criar `IdentityProviderConfig`/`ExternalIdentity` e o adaptador OIDC genérico.
4. Implementar callbacks OIDC, linking/JIT governados e MFA delegada verificável.
5. Adicionar gestão de sessões e revogação ampla.
6. Certificar Entra ID, Okta e Keycloak; só depois oferecer `ssoRequired` na interface.
