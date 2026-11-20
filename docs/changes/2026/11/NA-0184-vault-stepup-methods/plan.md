---
change_id: NA-0184
title: Confirmação de identidade do cofre por método de login (local, LDAP, OIDC, Google)
type: security
status: closed
created_at: 2026-11-19T16:45:00-03:00
base_branch: master
base_sha: 8ef8188a6af1ee0b8180a9707ad54b54b8fd4002
branch: security/NA-0184-20261119-vault-stepup-methods
owner: Jeferson Quintana
planner: Claude Code
risk: high
issue: null
---

# NA-0184 — Step-up do cofre independente do método de login

## Contexto e situação anterior

Decisão do responsável em 2026-11-19: o uso do cofre e da extensão depende **só da permissão do usuário**, não do método de login; break-glass fica negado. Hoje:
- `RedisVaultOrigin.bind` (`apps/backend/src/modules/vault-security/vault-identity.ts`) aceita apenas refresh com `authMethod: 'local'`. Usuários LDAP, OIDC e Google não destravam o cofre nem no portal.
- O desbloqueio (`POST /vault/sessions/unlock`) exige senha local + TOTP (`Reauthentication.verify` com `passwordHash`/`mfaSecret`).
- A sessão central é igual para todos os métodos: `issueTokens` grava `refresh:<jti>` no Redis e o logout apaga (`auth.service.ts`). A revogação usada pelo cofre já vale para qualquer método.
- OIDC: fluxo com state/nonce/PKCE em `oidc-flow.service.ts`; MFA avaliado por `amr`/`acr` (`evaluateMfaAssurance`), com fallback ao TOTP do NodeAccess quando a política exige MFA. LDAP: `ldap-identity.provider.ts` (`authenticate`). Certificação OIDC real com Keycloak (`npm run test:oidc:keycloak`).

## Problema e objetivo

Separar **quem pode** (permissões do cofre, sem mudança) de **como confirmar a identidade** (adaptador por método), mantendo o mesmo nível: confirmação recente, com MFA e verificada pelo servidor. Pré-requisito da NA-0183 (E1 da extensão) e benefício direto do cofre no portal.

## Escopo

1. Porta `VaultStepUp` com adaptadores, escolhidos pelo `authMethod` assinado da sessão central de origem (nunca por escolha do cliente):

| Método | Confirmação |
|---|---|
| `local` | Senha local + TOTP (comportamento atual, sem mudança) |
| `ldap` | Bind LDAP com a senha + TOTP do NodeAccess; sem TOTP cadastrado → negado com orientação |
| `oidc` | Reautenticação no provedor: novo fluxo com `prompt=login` e `max_age=0`, propósito `vault-step-up` ligado a usuário/tenant/cliente/desafio; aceitar só se `iss`/`sub` forem os da identidade vinculada, `nonce` correto e `auth_time` ≤ 5 min. MFA: `amr`/`acr` aceitos pela configuração do tenant; senão TOTP do NodeAccess |
| `google` | Novo token do Google (GIS) com `nonce` derivado do desafio, emitido há no máximo 5 min, da conta Google já vinculada ao usuário, mais TOTP do NodeAccess obrigatório (decisão do responsável em 2026-11-19; o login Google não tem fluxo no servidor nem client secret) |
| `break_glass` | Negado (`VAULT_FORBIDDEN`), auditado |

2. `RedisVaultOrigin.bind`: trocar a exigência `local` pela lista `local | ldap | oidc | google`; break-glass e método ausente/desconhecido negados. Registrar o método e a classe de garantia na sessão do cofre e na auditoria.
3. Rotas: o desafio (`/vault/sessions/challenges`) informa o tipo de confirmação; o unlock aceita senha+TOTP (local/LDAP) ou o resultado de uso único do retorno do provedor (OIDC/Google), consumido atomicamente e preso ao desafio. Sem token na URL.
4. Portal: tela de desbloqueio conforme o método (formulário atual ou botão "Confirmar no provedor"). Mesmas mensagens de erro neutras.
5. Testes por método e documentação (`docs/` do cofre e manual, se o procedimento mudar).

Fora: WebAuthn/Windows Hello (E5 da NA-0182), mudança no login central, SCIM, novas permissões.

## Critérios de aceitação

- [x] Usuário com permissão destrava o cofre no portal com login local, LDAP, OIDC e Google, cada um com a confirmação da tabela.
- [x] Break-glass, método desconhecido e sessão de outro usuário/tenant negados e auditados.
- [x] OIDC: `auth_time` antigo, `nonce`/state errado, retorno repetido, `sub`/`iss` de outra identidade ou ausência de MFA sem TOTP são negados.
- [x] LDAP: senha errada, conta desativada no diretório ou ausência de TOTP negados; erro de diretório não revela detalhes.
- [x] Logout da sessão central de origem, troca de `sessionVersion` e revogação do refresh negam o cofre para todos os métodos.
- [x] Login local e fluxo atual do cofre sem regressão (testes existentes de `vault-security` e auth PASS).
- [x] Limites de tentativa do desafio mantidos para todos os métodos.
- [ ] `npm run validate:sonar`, revisão independente de segurança e checks remotos PASS.

## Estratégia técnica

1. Baseline: `vault-security`, auth, OIDC (inclusive Keycloak real), VaultView; `validate:sonar`.
2. Refatorar `Reauthentication` para `VaultStepUp` sem mudar o adaptador local (testes atuais como rede de proteção).
3. OIDC: reaproveitar `OidcFlowService` com parâmetros de reautenticação e registro de fluxo separado por propósito; validação com a biblioteca já usada, sem criptografia própria.
4. LDAP: reaproveitar `ldap-identity.provider.ts` com a mesma política de timeout e mensagens.
5. Testes reais: Keycloak (OIDC, `prompt=login`/`max_age`/`auth_time`/`amr`), LDAP de teste descartável, MySQL/Redis reais; unitários para cada negativa.

## Riscos e mitigações

- Provedor ignorando `prompt=login`/`max_age`: validar `auth_time` no servidor; sem `auth_time` → negado.
- Ampliar o cofre para métodos externos: mesma barra de MFA; break-glass negado; flag `vault-step-up-external` (local continua ligado sem flag).
- Phishing do retorno OIDC: state/nonce/PKCE, redirect exato, resultado de uso único ligado ao desafio.
- Indisponibilidade do IdP/LDAP: nega o desbloqueio sem afetar SSH/RDP nem o login central.

## Matriz de testes e evidências

Unitários por adaptador e negativa; integração com MySQL/Redis; OIDC com Keycloak real; LDAP com servidor descartável; E2E do portal (desbloquear por método). SEC-01/02/06/13/18 do contrato NA-0177. Regressão: auth, OIDC, `vault-security`, VaultView.

## Baseline

2026-11-19, base 8ef8188a6: Vitest de `vault-security`, auth e telas/serviços do cofre 446 PASS/33 skipped; `npm run test:vault:real` (MySQL/Redis reais) PASS. Travas encontradas além do `authMethod === 'local'`: `readAuthority` negava o usuário sem hash de senha local e o tenant com login local desligado ou SSO obrigatório.

## Rollback ou recuperação

Flag `vault-step-up-external` desligada volta ao comportamento atual (só local). Sem migração destrutiva; revert da PR.

## Mudanças de escopo e decisões

2026-11-19: a revisão independente lembrou que o contrato NA-0177 §5 não aceita TOTP sozinho como substituto automático. No Google a prova é novo token ligado ao desafio (sessão Google ativa) + TOTP, não TOTP sozinho; a diferença em relação ao OIDC (sem nova senha no provedor) fica aceita pelo responsável e registrada aqui.

2026-11-19: Google confirmado por novo token GIS + TOTP (opção recomendada aceita pelo responsável); limite registrado: com sessão Google ativa no navegador, o Google pode não pedir a senha de novo, e o TOTP garante o segundo fator.

2026-11-19: implementação em duas fases na mesma frente. Fase 1: porta por método, LDAP, política de métodos por tenant (espelho de `canRefreshSession`, sem break-glass), flag `VAULT_STEP_UP_EXTERNAL_ENABLED`. Fase 2: reautenticação no provedor para OIDC/Google.

2026-11-19: responsável escolheu frente própria antes da E1 (opção B) e break-glass negado.

## Aprovação

Decisão: `GO_WITH_RISKS`

Aprovado pelo responsável em 2026-11-19. Risco: mudança em autenticação do cofre, mitigada por flag, adaptador local intacto e revisão independente.
