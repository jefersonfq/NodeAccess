# NA-0184 — Registro da implementação

Base: 8ef8188a6af1ee0b8180a9707ad54b54b8fd4002. Branch prevista: security/NA-0184-20261119-vault-stepup-methods.

## Pedido e objetivo

O cofre e a extensão devem depender só da permissão do usuário, não do método de login. Confirmação de identidade por método (local, LDAP, OIDC, Google), mesma barra de MFA, break-glass negado.

## Implementação

Fase 1 (local/LDAP e política por método):
- `vault-domain.ts`: `VaultAuthMethod`; a origem guarda o método assinado; a autorização traz `email`, `methods` e `passwordHash` opcional.
- `vault-identity.ts`: `vaultAuthMethod` aceita `local` sempre e `ldap`/`oidc`/`google` só com a flag; break-glass e valores desconhecidos negados. `MethodVaultReauthentication`: local = bcrypt + TOTP; LDAP = senha no diretório do mesmo usuário + TOTP; OIDC/Google negados até a fase 2.
- `vault.repository.ts`: TOTP continua obrigatório; o hash local só é exigido pelo adaptador local; métodos por tenant: local se login local ligado e SSO não obrigatório; LDAP se SSO não obrigatório; OIDC/Google sim.
- `vault.service.ts`: registro, uso e desbloqueio conferem o método contra a política atual do tenant; o desafio informa `stepUp` (`password_totp` ou `provider`).
- `env.ts` (`VAULT_STEP_UP_EXTERNAL_ENABLED`, padrão desligado) e `container.ts` (LDAP do login central).

Fase 2 (backend OIDC/Google):
- `oidc.service.ts`: `reauthenticate` adiciona `prompt=login` e `max_age=0`. `oidc-flow.service.ts`: fluxo `vault-step-up` com `binding` (digest do desafio); o login central recusa transação de confirmação e vice-versa; troca de código e validação de ID token reaproveitadas.
- `vault-provider.ts`: OIDC exige `auth_time` de até 5 min, identidade vinculada ao mesmo usuário e não revogada; MFA do provedor ou TOTP. Google exige token novo (`iat` até 5 min), `nonce` derivado do desafio, domínio do tenant e `googleId` já vinculado (sem vínculo por e-mail); TOTP sempre.
- `vault.service.ts`/`vault.routes.ts`: `sessions/provider/begin`, `sessions/provider/complete` (prova de uso único presa ao desafio; falha consome o desafio e audita `PROVIDER_PROOF_REJECTED`) e `sessions/unlock-provider`; registro e desafio informam `stepUp`.
- Retorno OIDC usa o mesmo redirect já cadastrado (`/auth/oidc/callback`); a finalidade gravada no fluxo separa login e confirmação.

## Validação

Ran (fase 2 backend): Vitest de `vault-security`, auth e cofre do frontend 552 PASS/33 skipped; typecheck e ESLint PASS (corrigido também um `async` sem `await` preexistente em `oidc.service.test.ts`, arquivo tocado). Testes novos: adaptador do provedor (OIDC e Google, positivos e 18 negativas), separação login × confirmação no fluxo OIDC, `prompt`/`max_age` só na reautenticação, prova de uso único, desafio consumido em falha, TOTP quando o provedor não comprova MFA, métodos locais sem fluxo de provedor.

Ran (fase 1): Vitest de `vault-security`, auth e cofre do frontend 474 PASS/33 skipped; ESLint dos arquivos alterados sem erros; typecheck do backend PASS. Testes novos: vínculo por método com e sem flag, break-glass/valores desconhecidos, LDAP (usuário diferente, senha inválida, diretório fora, política), OIDC/Google sem senha, política do tenant no registro e em cliente existente, derivação de métodos. Três casos antigos que esperavam negação total (sem hash local, login local desligado, SSO obrigatório) foram trocados por testes da derivação, que é o comportamento novo.

Ran (base): leitura de `vault-identity.ts`, `auth.service.ts` (`issueTokens` grava `refresh:<jti>` para todos os métodos; logout apaga), `oidc-flow.service.ts`, `oidc-auth.service.ts` (fallback ao TOTP quando o provedor não comprova MFA) e `ldap-identity.provider.ts`; harness Keycloak existente. Planned: testes da matriz do plano.

## Recuperação

Documental até a aprovação; depois flag `vault-step-up-external` e revert da PR.

## Pendências

Depois: baseline, implementação, Sonar, revisão independente.

## Diário de interações

### 2026-11-19T16:45:00-03:00 — Abertura

Responsável escolheu frente própria antes da E1 da extensão e negou break-glass no cofre. Plano escrito com adaptadores por método. Próximo: aprovação do responsável.

### 2026-11-19T17:00:00-03:00 — Plano aprovado

Responsável aprovou o plano; status `planned`. 

### 2026-11-19T17:40:00-03:00 — Base e fase 1

Planos aprovados; PR73 aberta com o plano da E1 e os encerramentos. Branch criada do master 8ef8188a6. Base registrada no plano. Fase 1 implementada e validada em unidade; `npm run test:vault:real` (MySQL/Redis reais) 32 PASS, limpeza confirmada. Próximo: fase 2 (reautenticação OIDC/Google), depois Sonar e revisão independente.

### 2026-11-19T18:40:00-03:00 — Fase 2 no backend

Responsável escolheu, para Google, novo token GIS ligado ao desafio + TOTP. Backend da fase 2 implementado; Vitest 552 PASS e `npm run test:vault:real` 32 PASS (limpeza confirmada). Pendente: portal (formulário por método, janela de confirmação OIDC, botão Google, retorno em `/auth/oidc/callback`), teste real com Keycloak, Sonar e revisão independente.
